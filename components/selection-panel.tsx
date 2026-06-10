"use client";

import { useMemo, useState } from "react";
import { X, Download, Map as MapIcon, Save, Flag, ExternalLink } from "lucide-react";
import type { MapProperty } from "@/lib/types";
import { roofAgeLabel, OCCUPANCIES } from "@/lib/types";
import { nearestNeighborOrder } from "@/lib/route-order";
import { routeCsv, googleMapsLinks, downloadFile } from "@/lib/export";

interface Props {
  selection: MapProperty[];
  startId: number | null;
  onStart: (id: number) => void;
  onRemove: (id: number) => void;
  onClear: () => void;
  onSaved: () => void; // refresh saved-routes list
}

const occLabel = (k: string) => OCCUPANCIES.find((o) => o.key === k)?.label ?? k;

export default function SelectionPanel({ selection, startId, onStart, onRemove, onClear, onSaved }: Props) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [links, setLinks] = useState<string[] | null>(null);

  const ordered = useMemo(() => nearestNeighborOrder(selection, startId ?? undefined), [selection, startId]);

  if (selection.length === 0) return null;

  async function saveRoute() {
    setSaving(true);
    const res = await fetch("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || `Route ${new Date().toLocaleDateString()}`, property_ids: ordered.map((p) => p.id) }),
    });
    setSaving(false);
    if (res.ok) {
      setName("");
      onSaved();
    } else {
      alert(`Save failed: ${(await res.json()).error ?? res.status}`);
    }
  }

  function exportCsv() {
    const safeName = (name || "route").replace(/[^\w-]+/g, "-").toLowerCase();
    downloadFile(`roofradar-${safeName}-${new Date().toISOString().slice(0, 10)}.csv`, routeCsv(ordered));
  }

  return (
    <div className="rr-panel absolute bottom-4 right-4 z-20 flex max-h-[70vh] w-96 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-line/60 px-4 py-3">
        <h2 className="text-sm font-bold">
          Route <span className="ml-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">{selection.length} stops</span>
        </h2>
        <button onClick={onClear} title="Clear selection" className="text-ink-dim hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>

      <ol className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {ordered.map((p, i) => (
          <li key={p.id} className="group flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-panel-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-bold text-accent">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{p.situs_address}</p>
              <p className="text-[11px] text-ink-dim">
                {roofAgeLabel(p)}
                {p.roofing_squares != null && ` · ${p.roofing_squares} sqrs`}
                {p.owner_name && ` · ${p.owner_name}`} · {occLabel(p.occupancy)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                title="Start route here"
                onClick={() => onStart(p.id)}
                className={p.id === ordered[0].id ? "text-accent" : "text-ink-dim hover:text-accent"}
              >
                <Flag className="h-3.5 w-3.5" />
              </button>
              <button title="Remove stop" onClick={() => onRemove(p.id)} className="text-ink-dim hover:text-hot">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ol>

      <div className="space-y-2.5 border-t border-line/60 px-4 py-3">
        <input className="rr-input" placeholder="Route name (e.g. Deltona NE — Tuesday)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-3 gap-2">
          <button className="rr-btn rr-btn-primary" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <button className="rr-btn rr-btn-ghost" onClick={() => setLinks(googleMapsLinks(ordered))}>
            <MapIcon className="h-3.5 w-3.5" /> Maps
          </button>
          <button className="rr-btn rr-btn-ghost" disabled={saving} onClick={saveRoute}>
            <Save className="h-3.5 w-3.5" /> {saving ? "…" : "Save"}
          </button>
        </div>
        {links && (
          <div className="space-y-1 rounded-lg border border-line/60 p-2.5">
            <p className="text-[11px] font-medium text-ink-dim">Google Maps legs (≤10 stops each):</p>
            {links.map((url, i) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-[12px] text-accent hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Leg {i + 1}
              </a>
            ))}
          </div>
        )}
        <p className="text-[11px] text-ink-dim">Stops ordered nearest-neighbor from the flagged start.</p>
      </div>
    </div>
  );
}
