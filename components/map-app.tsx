"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { MapProperty, SavedRoute } from "@/lib/types";
import type { MapFilters } from "./map-view";
import FilterSidebar from "./filter-sidebar";
import SelectionPanel from "./selection-panel";
import PropertyModal from "./property-modal";

const MapView = dynamic(() => import("./map-view"), { ssr: false });

export default function MapApp() {
  const [filters, setFilters] = useState<MapFilters>({ jurisdictions: [], ages: [], occupancies: [] });
  const [visibleCount, setVisibleCount] = useState(0);
  // Selection survives viewport changes: we keep full property objects.
  const [selection, setSelection] = useState<Map<number, MapProperty>>(new Map());
  const [startId, setStartId] = useState<number | null>(null);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number } | null>(null);
  const [modalPropertyId, setModalPropertyId] = useState<number | null>(null);
  const [mapRefresh, setMapRefresh] = useState(0);

  const refreshRoutes = useCallback(async () => {
    const res = await fetch("/api/routes");
    if (res.ok) setSavedRoutes((await res.json()).routes);
  }, []);

  useEffect(() => {
    void refreshRoutes();
  }, [refreshRoutes]);

  const toggleSelect = useCallback((p: MapProperty) => {
    setSelection((prev) => {
      const next = new Map(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, p);
      return next;
    });
  }, []);

  const boxSelect = useCallback((ps: MapProperty[]) => {
    setSelection((prev) => {
      const next = new Map(prev);
      for (const p of ps) next.set(p.id, p);
      return next;
    });
  }, []);

  const removeStop = useCallback((id: number) => {
    setSelection((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const openRoute = useCallback(async (id: number) => {
    const res = await fetch(`/api/routes/${id}`);
    if (!res.ok) return;
    const json = (await res.json()) as { stops: (MapProperty & { stop_order: number })[] };
    const next = new Map<number, MapProperty>();
    for (const s of json.stops) {
      if (s.lng != null && s.lat != null) next.set(s.id, s);
    }
    setSelection(next);
    const first = json.stops[0];
    if (first?.lng != null) {
      setStartId(first.id);
      setFlyTo({ lng: first.lng, lat: first.lat });
    }
  }, []);

  const deleteRoute = useCallback(
    async (id: number) => {
      if (!confirm("Delete this saved route?")) return;
      await fetch(`/api/routes/${id}`, { method: "DELETE" });
      void refreshRoutes();
    },
    [refreshRoutes]
  );

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <MapView
        filters={filters}
        selectedIds={new Set(selection.keys())}
        onToggleSelect={toggleSelect}
        onBoxSelect={boxSelect}
        onViewport={(ps) => setVisibleCount(ps.length)}
        flyTo={flyTo}
        onOpenProperty={setModalPropertyId}
        refreshTrigger={mapRefresh}
      />
      <FilterSidebar
        filters={filters}
        onFilters={setFilters}
        visibleCount={visibleCount}
        savedRoutes={savedRoutes}
        onOpenRoute={openRoute}
        onDeleteRoute={deleteRoute}
        onRefreshRoutes={refreshRoutes}
      />
      <SelectionPanel
        selection={[...selection.values()]}
        startId={startId}
        onStart={setStartId}
        onRemove={removeStop}
        onClear={() => {
          setSelection(new Map());
          setStartId(null);
        }}
        onSaved={refreshRoutes}
        onOpenProperty={setModalPropertyId}
      />
      {modalPropertyId != null && (
        <PropertyModal
          propertyId={modalPropertyId}
          onClose={() => setModalPropertyId(null)}
          onDataChanged={() => setMapRefresh((n) => n + 1)}
        />
      )}
    </main>
  );
}
