"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

interface GatedArea {
  id: number;
  county: string;
  name: string | null;
  confidence: "high" | "medium" | "low";
  status: "suggested" | "confirmed" | "cleared";
  notes: string | null;
  source: { segments?: number; gates?: number; area_m2?: number } | null;
  created_at: string;
}

const CONF_COLOR: Record<GatedArea["confidence"], string> = {
  high: "#7c3aed",
  medium: "#a78bfa",
  low: "#ddd6fe",
};
const STATUS_COLOR: Record<GatedArea["status"], string> = {
  suggested: "#9ca3af",
  confirmed: "#22c55e",
  cleared: "#ef4444",
};
const COUNTIES = ["", "Orange", "Seminole", "Volusia"];
const STATUSES = ["", "suggested", "confirmed", "cleared"];

export default function GatedAdminPage() {
  const [areas, setAreas] = useState<GatedArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [county, setCounty] = useState("");
  const [status, setStatus] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ list: "1" });
    if (county) params.set("county", county);
    if (status) params.set("status", status);
    const res = await fetch(`/api/gated-areas?${params}`).catch(() => null);
    if (!res || !res.ok) {
      setError("Failed to load gated areas");
      setLoading(false);
      return;
    }
    const j = (await res.json()) as { areas: GatedArea[] };
    setAreas(j.areas ?? []);
    setLoading(false);
  }, [county, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: number, body: Partial<Pick<GatedArea, "status" | "name" | "notes">>) {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/gated-areas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as { area?: GatedArea; error?: string };
      if (!res.ok || !j.area) {
        setError(j.error ?? "Save failed");
        return;
      }
      setAreas((prev) => prev.map((a) => (a.id === id ? { ...a, ...j.area } : a)));
      setEditingId(null);
    } catch {
      setError("Network error — try again");
    } finally {
      setSavingId(null);
    }
  }

  const acres = (a: GatedArea) => (a.source?.area_m2 ? Math.round(a.source.area_m2 / 4047) : null);

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#16233c_0%,#0b1220_60%)] p-6">
      <div className="mx-auto max-w-3xl">
        <Link href="/admin" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-dim hover:text-accent">
          <ArrowLeft className="h-4 w-4" /> Back to admin
        </Link>

        <div className="rr-panel p-7">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#7c3aed]/15 ring-1 ring-[#7c3aed]/40">
              <ShieldCheck className="h-5 w-5 text-[#7c3aed]" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Gated areas</h1>
              <p className="text-sm text-ink-dim">
                Confirm or clear suggested gated/private communities. Display only — routes are never affected.
              </p>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <select className="rr-input" aria-label="County filter" value={county} onChange={(e) => setCounty(e.target.value)}>
              {COUNTIES.map((c) => (
                <option key={c} value={c}>{c || "All counties"}</option>
              ))}
            </select>
            <select className="rr-input" aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s || "All statuses"}</option>
              ))}
            </select>
            <span className="self-center text-sm text-ink-dim">{areas.length.toLocaleString()} areas</span>
          </div>

          {error && <p className="mb-4 text-sm text-hot">{error}</p>}
          {loading && <p className="py-4 text-sm text-ink-dim">…</p>}
          {!loading && areas.length === 0 && <p className="py-4 text-sm text-ink-dim">No areas match.</p>}

          <div className="divide-y divide-line">
            {areas.map((a) => (
              <div key={a.id} className={`py-3 ${a.status === "cleared" ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {editingId === a.id ? (
                      <div className="flex gap-2">
                        <input
                          className="rr-input flex-1"
                          aria-label="Area name"
                          placeholder={`Area #${a.id}`}
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") void patch(a.id, { name: nameDraft }); }}
                        />
                        <button className="rr-btn rr-btn-primary text-xs" disabled={savingId === a.id} onClick={() => patch(a.id, { name: nameDraft })}>
                          Save
                        </button>
                        <button className="rr-btn rr-btn-ghost text-xs" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button
                        className="block w-full truncate text-left font-medium hover:text-accent"
                        title="Rename"
                        onClick={() => { setEditingId(a.id); setNameDraft(a.name ?? ""); }}
                      >
                        {a.name || `Area #${a.id}`}
                      </button>
                    )}
                    <p className="truncate text-[12px] text-ink-dim">
                      {a.county}
                      {acres(a) != null && ` · ${acres(a)!.toLocaleString()} acres`}
                      {a.source?.segments != null && ` · ${a.source.segments} road segs`}
                      {a.source?.gates != null && ` · ${a.source.gates} gates`}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                    style={{ background: CONF_COLOR[a.confidence] + "33", color: CONF_COLOR[a.confidence] }}
                  >
                    {a.confidence}
                  </span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                    style={{ background: STATUS_COLOR[a.status] + "26", color: STATUS_COLOR[a.status] }}
                  >
                    {a.status}
                  </span>
                  <div className="flex shrink-0 gap-1.5">
                    {a.status !== "confirmed" && (
                      <button className="rr-btn rr-btn-ghost text-xs" disabled={savingId === a.id} onClick={() => patch(a.id, { status: "confirmed" })}>
                        Confirm
                      </button>
                    )}
                    {a.status !== "cleared" && (
                      <button className="rr-btn rr-btn-ghost text-xs" disabled={savingId === a.id} onClick={() => patch(a.id, { status: "cleared" })}>
                        Clear
                      </button>
                    )}
                    {a.status !== "suggested" && (
                      <button className="rr-btn rr-btn-ghost text-xs" disabled={savingId === a.id} onClick={() => patch(a.id, { status: "suggested" })}>
                        Re-suggest
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
