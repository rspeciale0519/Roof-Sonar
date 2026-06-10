"use client";

import { useEffect, useState } from "react";
import { Radar, ChevronDown, Settings, FolderOpen, Trash2 } from "lucide-react";
import Link from "next/link";
import { AGE_BUCKETS, OCCUPANCIES, SavedRoute, SalesRep, RouteStatus } from "@/lib/types";
import { JURISDICTIONS, COUNTIES } from "@/lib/jurisdictions";
import type { MapFilters } from "./map-view";

interface Props {
  filters: MapFilters;
  onFilters: (f: MapFilters) => void;
  visibleCount: number;
  savedRoutes: SavedRoute[];
  onOpenRoute: (id: number) => void;
  onDeleteRoute: (id: number) => void;
  onRefreshRoutes: () => void;
  className?: string;
}

const STATUS_CHIP: Record<RouteStatus, { label: string; color: string }> = {
  draft:       { label: "Draft",       color: "#9ca3af" },
  assigned:    { label: "Assigned",    color: "#3b82f6" },
  in_progress: { label: "In progress", color: "#eab308" },
  completed:   { label: "Completed",   color: "#22c55e" },
};

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function FilterSidebar({ filters, onFilters, visibleCount, savedRoutes, onOpenRoute, onDeleteRoute, onRefreshRoutes, className = "" }: Props) {
  const [jurisOpen, setJurisOpen] = useState(false);
  const [routesOpen, setRoutesOpen] = useState(false);
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [assignError, setAssignError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/reps")
      .then((r) => r.json())
      .then((j) => setReps(j.reps ?? []))
      .catch(() => undefined);
  }, []);

  async function assignRep(routeId: number, newRepId: number | null) {
    setAssignError(null);
    try {
      const res = await fetch(`/api/routes/${routeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rep_id: newRepId }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) { setAssignError(j.error ?? "Assign failed"); return; }
      onRefreshRoutes();
    } catch {
      setAssignError("Network error — try again");
    }
  }

  return (
    <aside className={`rr-panel flex w-72 flex-col overflow-hidden ${className}`}>
      <div className="flex items-center gap-2.5 border-b border-line/60 px-4 py-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 ring-1 ring-accent/40">
          <Radar className="h-4.5 w-4.5 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-bold leading-tight tracking-tight">RoofSonar</h1>
          <p className="truncate text-[11px] text-ink-dim">{visibleCount.toLocaleString()} houses in view</p>
        </div>
        <Link href="/admin" title="Admin settings" className="text-ink-dim transition-colors hover:text-accent">
          <Settings className="h-4 w-4" />
        </Link>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Roof age</h2>
          <div className="flex flex-wrap gap-1.5">
            {AGE_BUCKETS.map((b) => (
              <button
                key={b.key}
                className="rr-chip"
                data-active={filters.ages.length === 0 || filters.ages.includes(b.key)}
                onClick={() => onFilters({ ...filters, ages: toggle(filters.ages, b.key) })}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: b.color }} />
                {b.label}
              </button>
            ))}
          </div>
          {filters.ages.length > 0 && (
            <button className="mt-1.5 text-[11px] text-accent hover:underline" onClick={() => onFilters({ ...filters, ages: [] })}>
              show all ages
            </button>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Occupancy</h2>
          <div className="flex flex-wrap gap-1.5">
            {OCCUPANCIES.map((o) => (
              <button
                key={o.key}
                className="rr-chip"
                data-active={filters.occupancies.length === 0 || filters.occupancies.includes(o.key)}
                onClick={() => onFilters({ ...filters, occupancies: toggle(filters.occupancies, o.key) })}
              >
                {o.label}
              </button>
            ))}
          </div>
          {filters.occupancies.length > 0 && (
            <button
              className="mt-1.5 text-[11px] text-accent hover:underline"
              onClick={() => onFilters({ ...filters, occupancies: [] })}
            >
              show all occupancy
            </button>
          )}
        </section>

        <section>
          <button
            className="mb-2 flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-ink-dim"
            onClick={() => setJurisOpen(!jurisOpen)}
          >
            <span>
              Jurisdictions{filters.jurisdictions.length > 0 && ` (${filters.jurisdictions.length})`}
            </span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${jurisOpen ? "rotate-180" : ""}`} />
          </button>
          {jurisOpen && (
            <div className="space-y-3">
              {filters.jurisdictions.length > 0 && (
                <button className="text-[11px] text-accent hover:underline" onClick={() => onFilters({ ...filters, jurisdictions: [] })}>
                  show all jurisdictions
                </button>
              )}
              {COUNTIES.map((county) => (
                <div key={county}>
                  <p className="mb-1 text-[11px] font-medium text-ink-dim">{county} County</p>
                  <div className="space-y-0.5">
                    {JURISDICTIONS.filter((j) => j.county === county).map((j) => (
                      <label key={j.slug} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[13px] hover:bg-panel-2">
                        <input
                          type="checkbox"
                          className="accent-[#f97316]"
                          checked={filters.jurisdictions.includes(j.slug)}
                          onChange={() => onFilters({ ...filters, jurisdictions: toggle(filters.jurisdictions, j.slug) })}
                        />
                        {j.name}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <button
            className="mb-2 flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-ink-dim"
            onClick={() => setRoutesOpen(!routesOpen)}
          >
            <span>Saved routes ({savedRoutes.length})</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${routesOpen ? "rotate-180" : ""}`} />
          </button>
          {routesOpen &&
            (savedRoutes.length === 0 ? (
              <p className="text-[12px] text-ink-dim">None yet — select houses and save a route.</p>
            ) : (
              <>
              {assignError && <p className="mb-1 text-[11px] text-hot">{assignError}</p>}
              <ul className="space-y-1.5">
                {savedRoutes.map((r) => {
                  const chip = STATUS_CHIP[r.status] ?? STATUS_CHIP.draft;
                  return (
                    <li key={r.id} className="group rounded-lg border border-line/60 px-2.5 py-2">
                      <div className="flex items-center gap-2">
                        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onOpenRoute(r.id)}>
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium">{r.name}</span>
                            <span className="block text-[11px] text-ink-dim">
                              {r.stop_count} stops · {new Date(r.created_at).toLocaleDateString()}
                            </span>
                          </span>
                        </button>
                        <button
                          title="Delete route"
                          className="text-ink-dim opacity-0 transition-opacity hover:text-hot group-hover:opacity-100"
                          onClick={() => onDeleteRoute(r.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={{ background: chip.color + "26", color: chip.color }}
                          >
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: chip.color }} />
                            {chip.label}
                          </span>
                          <span className="text-[11px] text-ink-dim">{r.rep_name ?? "Unassigned"}</span>
                        </div>
                        <select
                          className="rr-input py-2 text-[13px] min-h-11 md:min-h-0 md:py-1 md:text-[12px]"
                          value={r.rep_id ?? ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            void assignRep(r.id, val === "" ? null : Number(val));
                          }}
                        >
                          <option value="">Unassigned</option>
                          {reps.map((rep) => (
                            <option key={rep.id} value={rep.id}>{rep.name}</option>
                          ))}
                        </select>
                      </div>
                    </li>
                  );
                })}
              </ul>
              </>
            ))}
        </section>
      </div>

      <div className="border-t border-line/60 px-4 py-3 text-[11px] leading-relaxed text-ink-dim">
        <span className="font-medium text-ink">Click</span> a house to select ·{" "}
        <span className="font-medium text-ink">Shift-drag</span> to box-select
      </div>
    </aside>
  );
}
