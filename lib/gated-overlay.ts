import type mapboxgl from "mapbox-gl";

/**
 * Gated-community overlay (plan: .claude/plans/feature-gated-communities.md).
 * One purple hue, opacity by confidence; confirmed areas get a crisp border.
 * Display only: the layers register no event handlers, sit below the property
 * dots, and never affect routing or selection.
 */
const SOURCE = "gated-areas";
const FILL_LAYER = "gated-fill";
const BORDER_LAYER = "gated-confirmed-border";
const PURPLE = "#7c3aed";
const GATED_MIN_ZOOM = 10;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function addGatedLayers(map: mapboxgl.Map): void {
  map.addSource(SOURCE, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: FILL_LAYER,
    type: "fill",
    source: SOURCE,
    minzoom: GATED_MIN_ZOOM,
    paint: {
      "fill-color": PURPLE,
      "fill-opacity": [
        "match",
        ["get", "confidence"],
        "high", 0.28,
        "medium", 0.16,
        "low", 0.08,
        0.16,
      ],
    },
  });
  map.addLayer({
    id: BORDER_LAYER,
    type: "line",
    source: SOURCE,
    minzoom: GATED_MIN_ZOOM,
    filter: ["==", ["get", "status"], "confirmed"],
    paint: { "line-color": PURPLE, "line-width": 1.5, "line-opacity": 0.9 },
  });
}

export async function refreshGatedAreas(map: mapboxgl.Map, signal?: AbortSignal): Promise<void> {
  const src = map.getSource(SOURCE) as mapboxgl.GeoJSONSource | undefined;
  if (!src) return;
  if (map.getZoom() < GATED_MIN_ZOOM) {
    src.setData(EMPTY);
    return;
  }
  const b = map.getBounds();
  if (!b) return;
  try {
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(",");
    const res = await fetch(`/api/gated-areas?bbox=${bbox}`, { signal });
    if (!res.ok) throw new Error(await res.text());
    src.setData((await res.json()) as GeoJSON.FeatureCollection);
  } catch (err) {
    if ((err as Error).name !== "AbortError") console.error("gated overlay fetch failed:", err);
  }
}

export function setGatedVisibility(map: mapboxgl.Map, visible: boolean): void {
  for (const layer of [FILL_LAYER, BORDER_LAYER]) {
    if (map.getLayer(layer)) {
      map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
    }
  }
}
