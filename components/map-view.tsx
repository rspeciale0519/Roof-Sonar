"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { MapProperty } from "@/lib/types";
import { ageBucket, roofAgeLabel } from "@/lib/types";
import { nearestProperty } from "@/lib/canvassing";
import { addGatedLayers, refreshGatedAreas, setGatedVisibility } from "@/lib/gated-overlay";

const LABEL_ZOOM = 16; // PRD: labels at zoom >= 16 only; dots/heat below
const FETCH_ZOOM = 13; // below this the bbox is too big to be useful
const START: [number, number] = [-81.3, 28.8]; // tri-county center

export interface MapFilters {
  jurisdictions: string[];
  ages: string[];
  occupancies: string[];
  uses: string[];
  showGated: boolean;
}

interface Props {
  filters: MapFilters;
  selectedIds: Set<number>;
  onToggleSelect: (p: MapProperty) => void;
  onBoxSelect: (ps: MapProperty[]) => void;
  onViewport: (ps: MapProperty[], zoom: number) => void;
  flyTo?: { lng: number; lat: number } | null;
  onOpenProperty: (id: number) => void;
  refreshTrigger?: number;
  armedPinId?: number | null;
  onPinDrop?: (propertyId: number, address: string) => void;
}

function toGeojson(ps: MapProperty[], selected: Set<number>): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: ps.map((p) => ({
      type: "Feature",
      id: p.id,
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        street_number: p.street_number ?? "",
        age_label: roofAgeLabel(p),
        sqrs_label: p.roofing_squares != null ? `${p.roofing_squares} sqrs` : "",
        bucket: ageBucket(p.roof_year),
        selected: selected.has(p.id),
        payload: JSON.stringify(p),
        pin_color: p.pin_color,
        has_pin: p.pin_type_id != null,
        dnk: p.do_not_knock,
      },
    })),
  };
}

const BUCKET_COLOR: mapboxgl.ExpressionSpecification = [
  "match",
  ["get", "bucket"],
  "0-5", "#22c55e",
  "6-10", "#eab308",
  "11-15", "#f97316",
  "16+", "#ef4444",
  "#9ca3af", // unknown
];

export default function MapView({ filters, selectedIds, onToggleSelect, onBoxSelect, onViewport, flyTo, onOpenProperty, refreshTrigger, armedPinId, onPinDrop }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const propertiesRef = useRef<MapProperty[]>([]);
  const filtersRef = useRef(filters);
  const selectedRef = useRef(selectedIds);
  const abortRef = useRef<AbortController | null>(null);
  const onViewportRef = useRef(onViewport);
  const onToggleRef = useRef(onToggleSelect);
  const onBoxRef = useRef(onBoxSelect);
  const onOpenPropertyRef = useRef(onOpenProperty);
  const armedPinRef = useRef(armedPinId ?? null);
  const onPinDropRef = useRef(onPinDrop ?? null);
  const [zoom, setZoom] = useState(10);
  const [loading, setLoading] = useState(false);
  const [box, setBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  filtersRef.current = filters;
  selectedRef.current = selectedIds;
  onViewportRef.current = onViewport;
  onToggleRef.current = onToggleSelect;
  onBoxRef.current = onBoxSelect;
  onOpenPropertyRef.current = onOpenProperty;
  armedPinRef.current = armedPinId ?? null;
  onPinDropRef.current = onPinDrop ?? null;

  // ----- init map once -----
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: START,
      zoom: 10,
      boxZoom: false, // shift-drag is ours (box select)
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true,
        showAccuracyCircle: false,
      }),
      "bottom-right"
    );

    map.on("load", () => {
      // gated overlay first: its fill must render BENEATH the property layers
      // and it registers no handlers (display only — never affects routing)
      addGatedLayers(map);
      setGatedVisibility(map, filtersRef.current.showGated);

      map.addSource("properties", { type: "geojson", data: toGeojson([], new Set()), promoteId: "id" });

      // Dots below label zoom (and selection ring at all zooms)
      map.addLayer({
        id: "property-dots",
        type: "circle",
        source: "properties",
        maxzoom: LABEL_ZOOM,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], FETCH_ZOOM, 2.5, LABEL_ZOOM, 5],
          "circle-color": BUCKET_COLOR,
          "circle-opacity": 0.85,
          "circle-stroke-width": 0.5,
          "circle-stroke-color": "#0b1220",
        },
      });

      map.addLayer({
        id: "property-selected",
        type: "circle",
        source: "properties",
        filter: ["==", ["get", "selected"], true],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], FETCH_ZOOM, 6, 19, 22],
          "circle-color": "rgba(249,115,22,0.18)",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#f97316",
        },
      });

      map.addLayer({
        id: "visit-pins",
        type: "circle",
        source: "properties",
        filter: ["==", ["get", "has_pin"], true],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], FETCH_ZOOM, 5, 19, 9],
          "circle-color": ["coalesce", ["get", "pin_color"], "#f97316"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
          "circle-translate": [0, -34],
          "circle-pitch-alignment": "map",
        },
      });

      map.addLayer({
        id: "dnk-marks",
        type: "symbol",
        source: "properties",
        filter: ["==", ["get", "dnk"], true],
        layout: { "text-field": "✕", "text-size": 12, "text-offset": [0, -5.4], "text-allow-overlap": true },
        paint: { "text-color": "#ffffff" },
      });

      // Three-line label centered on the roof (PRD: Map Display Spec)
      map.addLayer({
        id: "property-labels",
        type: "symbol",
        source: "properties",
        minzoom: LABEL_ZOOM,
        layout: {
          "text-field": [
            "format",
            // per-section text-color keeps the street number white while the
            // age/squares lines take the bucket color from paint.text-color
            ["get", "street_number"], { "font-scale": 1.15, "text-font": ["literal", ["DIN Pro Bold", "Arial Unicode MS Bold"]], "text-color": "#ffffff" },
            "\n", {},
            ["get", "age_label"], { "font-scale": 0.9 },
            "\n", {},
            ["get", "sqrs_label"], { "font-scale": 0.8 },
          ],
          "text-size": 14,
          "text-line-height": 1.15,
          "text-allow-overlap": false,
          "text-padding": 2,
        },
        paint: {
          "text-color": BUCKET_COLOR,
          "text-halo-color": "#0b1220",
          "text-halo-width": 1.6,
        },
      });

      const clickHandler = (e: mapboxgl.MapMouseEvent) => {
        if (armedPinRef.current != null) {
          const target = nearestProperty(propertiesRef.current, e.lngLat.lng, e.lngLat.lat, 30);
          if (target) {
            const full = propertiesRef.current.find((p) => p.id === target.id);
            if (full) onPinDropRef.current?.(full.id, full.situs_address);
          }
          return;
        }
        const pinHit = map.queryRenderedFeatures(e.point, { layers: ["visit-pins"] })[0];
        if (pinHit?.properties?.payload) {
          onOpenPropertyRef.current((JSON.parse(pinHit.properties.payload as string) as MapProperty).id);
          return;
        }
        const features = map.queryRenderedFeatures(e.point, {
          layers: ["property-labels", "property-dots"],
        });
        const f = features[0];
        if (!f?.properties?.payload) return;
        onToggleRef.current(JSON.parse(f.properties.payload as string) as MapProperty);
      };
      map.on("click", clickHandler);
      for (const layer of ["visit-pins", "property-labels", "property-dots"]) {
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
      }

      void refresh();
    });

    const refresh = async () => {
      const z = map.getZoom();
      setZoom(z);
      void refreshGatedAreas(map); // own zoom floor — polygons show before dots
      if (z < FETCH_ZOOM) {
        propertiesRef.current = [];
        (map.getSource("properties") as mapboxgl.GeoJSONSource | undefined)?.setData(toGeojson([], new Set()));
        onViewportRef.current([], z);
        return;
      }
      const b = map.getBounds();
      if (!b) return;
      const f = filtersRef.current;
      const params = new URLSearchParams({ bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(",") });
      if (f.jurisdictions.length) params.set("jurisdictions", f.jurisdictions.join(","));
      if (f.ages.length) params.set("ages", f.ages.join(","));
      if (f.occupancies.length) params.set("occupancies", f.occupancies.join(","));
      if (f.uses.length) params.set("uses", f.uses.join(","));

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const res = await fetch(`/api/properties?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error(await res.text());
        const json = (await res.json()) as { properties: MapProperty[] };
        propertiesRef.current = json.properties;
        (map.getSource("properties") as mapboxgl.GeoJSONSource | undefined)?.setData(
          toGeojson(json.properties, selectedRef.current)
        );
        onViewportRef.current(json.properties, z);
      } catch (err) {
        if ((err as Error).name !== "AbortError") console.error(err);
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    };

    let t: ReturnType<typeof setTimeout>;
    const debounced = () => {
      clearTimeout(t);
      t = setTimeout(refresh, 250);
    };
    map.on("moveend", debounced);
    map.on("zoomend", debounced);
    (map as unknown as { _rrRefresh?: () => void })._rrRefresh = () => void refresh();
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __rrMap?: mapboxgl.Map }).__rrMap = map; // dev-only: browser-test navigation hook
    }

    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ----- refetch when filters change -----
  useEffect(() => {
    const map = mapRef.current as (mapboxgl.Map & { _rrRefresh?: () => void }) | null;
    map?._rrRefresh?.();
  }, [filters]);

  // ----- gated overlay visibility toggle -----
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) setGatedVisibility(map, filters.showGated);
  }, [filters.showGated]);

  // ----- Phase 5 refresh hook (triggered by parent after modal edits) -----
  useEffect(() => {
    (mapRef.current as (mapboxgl.Map & { _rrRefresh?: () => void }) | null)?._rrRefresh?.();
  }, [refreshTrigger]);

  // ----- repaint selection -----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    (map.getSource("properties") as mapboxgl.GeoJSONSource | undefined)?.setData(
      toGeojson(propertiesRef.current, selectedIds)
    );
  }, [selectedIds]);

  // ----- fly to a stop (saved-route reopen) -----
  useEffect(() => {
    if (flyTo && mapRef.current) {
      mapRef.current.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: Math.max(mapRef.current.getZoom(), LABEL_ZOOM) });
    }
  }, [flyTo]);

  // ----- shift-drag box select -----
  useEffect(() => {
    const el = containerRef.current;
    const map = mapRef.current;
    if (!el || !map) return;
    let start: { x: number; y: number } | null = null;

    const down = (e: MouseEvent) => {
      if (!e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      map.dragPan.disable();
      const r = el.getBoundingClientRect();
      start = { x: e.clientX - r.left, y: e.clientY - r.top };
      setBox({ x1: start.x, y1: start.y, x2: start.x, y2: start.y });
    };
    const move = (e: MouseEvent) => {
      if (!start) return;
      const r = el.getBoundingClientRect();
      setBox({ x1: start.x, y1: start.y, x2: e.clientX - r.left, y2: e.clientY - r.top });
    };
    const up = (e: MouseEvent) => {
      if (!start) return;
      const r = el.getBoundingClientRect();
      const end = { x: e.clientX - r.left, y: e.clientY - r.top };
      const sw: [number, number] = [Math.min(start.x, end.x), Math.max(start.y, end.y)];
      const ne: [number, number] = [Math.max(start.x, end.x), Math.min(start.y, end.y)];
      start = null;
      setBox(null);
      map.dragPan.enable();
      const features = map.queryRenderedFeatures([sw, ne] as [mapboxgl.PointLike, mapboxgl.PointLike], {
        layers: ["property-dots", "property-labels"],
      });
      const seen = new Set<number>();
      const picked: MapProperty[] = [];
      for (const f of features) {
        const p = JSON.parse((f.properties?.payload as string) ?? "null") as MapProperty | null;
        if (p && !seen.has(p.id)) {
          seen.add(p.id);
          picked.push(p);
        }
      }
      if (picked.length) onBoxRef.current(picked);
    };

    el.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      el.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {box && (
        <div
          className="rr-select-box"
          style={{
            left: Math.min(box.x1, box.x2),
            top: Math.min(box.y1, box.y2),
            width: Math.abs(box.x2 - box.x1),
            height: Math.abs(box.y2 - box.y1),
          }}
        />
      )}
      {zoom < FETCH_ZOOM && (
        <div className="rr-panel pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 px-4 py-2 text-sm text-ink-dim">
          Zoom in to load houses (labels appear at z{LABEL_ZOOM})
        </div>
      )}
      {loading && (
        <div className="rr-panel absolute right-4 top-4 px-3 py-1.5 text-xs text-ink-dim">loading…</div>
      )}
    </div>
  );
}
