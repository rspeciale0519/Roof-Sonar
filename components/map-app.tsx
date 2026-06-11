"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { SlidersHorizontal } from "lucide-react";
import type { MapProperty, PinType, SalesRep, SavedRoute } from "@/lib/types";
import type { MapFilters } from "./map-view";
import FilterSidebar from "./filter-sidebar";
import MobileDrawer from "./mobile-drawer";
import SelectionPanel from "./selection-panel";
import PropertyModal from "./property-modal";
import PinTray from "./pin-tray";

const MapView = dynamic(() => import("./map-view"), { ssr: false });

interface UndoState {
  visitId: number;
  label: string;
  address: string;
}

export default function MapApp() {
  const [filters, setFilters] = useState<MapFilters>({ jurisdictions: [], ages: [], occupancies: [], uses: [], showGated: true });
  const [visibleCount, setVisibleCount] = useState(0);
  const [selection, setSelection] = useState<Map<number, MapProperty>>(new Map());
  const [startId, setStartId] = useState<number | null>(null);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number } | null>(null);
  const [modalPropertyId, setModalPropertyId] = useState<number | null>(null);
  const [mapRefresh, setMapRefresh] = useState(0);

  const [pinTypes, setPinTypes] = useState<PinType[]>([]);
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [armedPinId, setArmedPinId] = useState<number | null>(null);
  const [actingRepId, setActingRepId] = useState<number | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [pinDropError, setPinDropError] = useState<string | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    fetch("/api/pin-types")
      .then((r) => r.json())
      .then((j) => setPinTypes((j.pin_types as PinType[]) ?? []))
      .catch(() => undefined);
    fetch("/api/reps")
      .then((r) => r.json())
      .then((j) => setReps((j.reps as SalesRep[]) ?? []))
      .catch(() => undefined);
  }, []);

  const refreshRoutes = useCallback(async () => {
    const res = await fetch("/api/routes");
    if (res.ok) setSavedRoutes((await res.json()).routes);
  }, []);

  useEffect(() => {
    void refreshRoutes();
  }, [refreshRoutes]);

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

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

  const handlePinDrop = useCallback(
    async (propertyId: number, address: string) => {
      const pin = pinTypes.find((p) => p.id === armedPinId);
      if (!pin) return;
      setPinDropError(null);
      try {
        const res = await fetch("/api/visits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ property_id: propertyId, pin_type_id: pin.id, rep_id: actingRepId }),
        });
        const j = (await res.json()) as { visit_id?: number; error?: string };
        if (!res.ok) {
          setPinDropError(j.error ?? `Drop failed (${res.status})`);
          return;
        }
        if (!j.visit_id) {
          setPinDropError("Drop failed — try again");
          return;
        }
        const visitId = j.visit_id;
        setUndo({ visitId, label: pin.label, address });
        setMapRefresh((n) => n + 1);
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        undoTimerRef.current = setTimeout(() => setUndo((u) => (u?.visitId === visitId ? null : u)), 10000);
      } catch {
        setPinDropError("Network error — try again");
      }
    },
    [pinTypes, armedPinId, actingRepId]
  );

  const handleUndo = useCallback(async () => {
    if (!undo) return;
    const { visitId } = undo;
    try {
      const res = await fetch(`/api/visits/${visitId}`, { method: "DELETE" });
      if (res.ok) {
        setUndo(null);
        setMapRefresh((n) => n + 1);
      }
    } catch {
      // silently ignore network errors on undo
    }
  }, [undo]);

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
        armedPinId={armedPinId}
        onPinDrop={handlePinDrop}
      />
      {/* Mobile: floating toggle button (phones only) */}
      <button
        className="absolute left-4 top-4 z-30 flex min-h-11 min-w-11 items-center gap-2 rounded-xl border border-line/60 bg-panel/90 px-3 py-2.5 text-[13px] font-medium shadow-lg backdrop-blur-md md:hidden"
        aria-label="Open filters"
        onClick={() => setSidebarOpen(true)}
      >
        <SlidersHorizontal className="h-4 w-4 text-accent" />
        <span>{visibleCount.toLocaleString()}</span>
      </button>

      {/* Mobile: drawer */}
      <MobileDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
        <FilterSidebar
          filters={filters}
          onFilters={setFilters}
          visibleCount={visibleCount}
          savedRoutes={savedRoutes}
          onOpenRoute={openRoute}
          onDeleteRoute={deleteRoute}
          onRefreshRoutes={refreshRoutes}
          className="flex-1 overflow-hidden"
        />
      </MobileDrawer>

      {/* Desktop: docked sidebar */}
      <FilterSidebar
        filters={filters}
        onFilters={setFilters}
        visibleCount={visibleCount}
        savedRoutes={savedRoutes}
        onOpenRoute={openRoute}
        onDeleteRoute={deleteRoute}
        onRefreshRoutes={refreshRoutes}
        className="absolute left-4 top-4 bottom-4 z-20 hidden md:flex"
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

      {(undo || pinDropError) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-36 z-40 flex flex-col items-center gap-2">
          {pinDropError && (
            <div className="pointer-events-auto rr-panel flex items-center gap-3 px-4 py-2 text-[13px] text-hot">
              <span>{pinDropError}</span>
              <button onClick={() => setPinDropError(null)} className="text-ink-dim hover:text-ink" aria-label="Dismiss error">
                ✕
              </button>
            </div>
          )}
          {undo && (
            <div className="pointer-events-auto rr-panel flex items-center gap-3 px-4 py-2 text-[13px]">
              <span className="text-ink-dim">
                <span className="font-semibold text-ink">{undo.label}</span>
                {" → "}
                {undo.address}
              </span>
              <button
                onClick={() => void handleUndo()}
                className="rr-btn rr-btn-ghost px-3 py-1 text-[12px]"
              >
                Undo
              </button>
              <button onClick={() => setUndo(null)} className="text-ink-dim hover:text-ink" aria-label="Dismiss undo">
                ✕
              </button>
            </div>
          )}
        </div>
      )}

      <PinTray
        pinTypes={pinTypes}
        reps={reps}
        armedPinId={armedPinId}
        onArm={setArmedPinId}
        actingRepId={actingRepId}
        onActingRepChange={setActingRepId}
      />
    </main>
  );
}
