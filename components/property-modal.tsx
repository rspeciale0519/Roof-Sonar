"use client";

import { useEffect, useState } from "react";
import { X, Plus } from "lucide-react";
import type { Tag, Visit, PropertyNote, RouteStatus } from "@/lib/types";
import { roofAgeLabel, occLabel } from "@/lib/types";

interface PropertyDetail {
  id: number;
  situs_address: string;
  street_number: string | null;
  roof_year: number | null;
  year_built: number | null;
  roofing_squares: number | null;
  owner_name: string | null;
  owner_mailing_address: string | null;
  occupancy: string;
  homestead: boolean | null;
  last_permit_number: string | null;
  last_permit_date: string | null;
  do_not_knock: boolean;
  jurisdictions: { name: string } | null;
}

interface RouteEntry {
  id: number;
  name: string;
  status: RouteStatus;
  sales_reps: { name: string } | null;
}

interface Payload {
  property: PropertyDetail;
  visits: Visit[];
  notes: PropertyNote[];
  tags: { id: number; label: string }[];
  routes: RouteEntry[];
}

interface Props {
  propertyId: number;
  onClose: () => void;
  onDataChanged?: () => void;
}

const STATUS_CHIP: Record<RouteStatus, { label: string; color: string }> = {
  draft:       { label: "Draft",       color: "#9ca3af" },
  assigned:    { label: "Assigned",    color: "#3b82f6" },
  in_progress: { label: "In progress", color: "#eab308" },
  completed:   { label: "Completed",   color: "#22c55e" },
};

// Fix 6: date-only strings parse as UTC midnight → shift them to local noon.
const fmt = (value: string) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-ink-dim">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-medium truncate">{value ?? "—"}</dd>
    </div>
  );
}

export default function PropertyModal({ propertyId, onClose, onDataChanged }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagError, setTagError] = useState<string | null>(null);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fix 5: body scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Fix 1: AbortController to prevent race conditions on propertyId change
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFetchError(null);
    setData(null);
    setShowTagPicker(false);
    setNoteBody("");
    Promise.all([
      fetch(`/api/properties/${propertyId}`, { signal: controller.signal }).then(
        (r) => r.json() as Promise<Payload & { error?: string }>
      ),
      fetch("/api/tags", { signal: controller.signal }).then(
        (r) => r.json() as Promise<{ tags: Tag[] }>
      ),
    ])
      .then(([pd, td]) => {
        if (controller.signal.aborted) return;
        if (pd.error) { setFetchError(pd.error); return; }
        setData(pd);
        setAllTags(td.tags ?? []);
      })
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        setFetchError("Failed to load property");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [propertyId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function toggleTag(tagId: number) {
    if (!data) return;
    const current = data.tags.map((t) => t.id);
    const next = current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId];
    const prevTags = data.tags;
    const newTags = allTags.filter((t) => next.includes(t.id));
    // Fix 3: functional update to avoid stale closure
    setData((prev) => prev ? { ...prev, tags: newTags } : prev);
    setTagError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_ids: next }),
      });
      const j = (await res.json()) as { tags?: { id: number; label: string }[]; error?: string };
      if (!res.ok) {
        // Fix 3: functional update on error revert
        setData((prev) => prev ? { ...prev, tags: prevTags } : prev);
        setTagError(j.error ?? "Tag update failed");
        return;
      }
      // Fix 3: functional update on success, using server-corrected tags
      setData((prev) => prev ? { ...prev, tags: j.tags ?? newTags } : prev);
      onDataChanged?.();
    } catch {
      // Fix 3: functional update on catch revert
      setData((prev) => prev ? { ...prev, tags: prevTags } : prev);
      setTagError("Network error — try again");
    }
  }

  async function addNote() {
    if (!noteBody.trim() || !data) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteBody.trim() }),
      });
      const j = (await res.json()) as { note?: PropertyNote; error?: string };
      if (!res.ok) { setNoteError(j.error ?? "Save failed"); return; }
      // Fix 4: functional update to avoid stale closure
      if (j.note) setData((prev) => prev ? { ...prev, notes: [j.note!, ...prev.notes] } : prev);
      setNoteBody("");
      onDataChanged?.();
    } catch {
      setNoteError("Network error — try again");
    } finally {
      setNoteSaving(false);
    }
  }

  const p = data?.property;

  return (
    <>
      {/* Backdrop — desktop only */}
      <div
        className="fixed inset-0 z-30 hidden bg-black/60 md:block"
        onClick={onClose}
        aria-hidden
      />

      {/* Sheet (mobile) / Card (md+) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Property details"
        className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-panel md:inset-auto md:left-1/2 md:top-1/2 md:h-auto md:max-h-[85vh] md:w-full md:max-w-[560px] md:-translate-x-1/2 md:-translate-y-1/2 md:overflow-y-auto md:rounded-[14px] rr-panel"
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line/60 bg-panel px-4 py-3">
          <div className="min-w-0 flex-1">
            {loading ? (
              <p className="text-sm text-ink-dim">Loading…</p>
            ) : fetchError ? (
              <p className="text-sm text-hot">{fetchError}</p>
            ) : p ? (
              <>
                <h2 className="text-[15px] font-bold leading-tight">{p.situs_address}</h2>
                <p className="mt-0.5 text-[12px] text-ink-dim">{p.jurisdictions?.name ?? "—"}</p>
                {p.do_not_knock && (
                  <div className="mt-2 rounded-md bg-hot/15 px-3 py-1.5 text-[12px] font-semibold text-hot ring-1 ring-hot/30">
                    DO NOT KNOCK
                  </div>
                )}
              </>
            ) : null}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-ink-dim hover:bg-panel-2 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        {p && (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            {/* Details grid */}
            <section>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Detail
                  label="Roof year"
                  value={p.roof_year != null ? `${p.roof_year} (${roofAgeLabel({ roof_year: p.roof_year, year_built: p.year_built })})` : null}
                />
                <Detail label="Year built" value={p.year_built != null ? String(p.year_built) : null} />
                <Detail label="Roofing squares" value={p.roofing_squares != null ? String(p.roofing_squares) : null} />
                <Detail label="Owner" value={p.owner_name} />
                {/* Fix 11: owner mailing address */}
                <Detail label="Owner mailing" value={p.owner_mailing_address} />
                <Detail label="Occupancy" value={occLabel(p.occupancy)} />
                <Detail label="Homestead" value={p.homestead === true ? "Yes" : p.homestead === false ? "No" : null} />
                <Detail label="Last permit #" value={p.last_permit_number} />
                <Detail label="Last permit date" value={p.last_permit_date ? fmt(p.last_permit_date) : null} />
              </dl>
            </section>

            {/* Routes */}
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Routes</h3>
              {data!.routes.length === 0 ? (
                <p className="text-[12px] text-ink-dim">Not on any route.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data!.routes.map((r) => {
                    const chip = STATUS_CHIP[r.status] ?? STATUS_CHIP.draft;
                    return (
                      <li key={r.id} className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium">{r.name}</span>
                        <span
                          className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: chip.color + "26", color: chip.color }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: chip.color }} />
                          {chip.label}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-dim">{r.sales_reps?.name ?? "Unassigned"}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Tags */}
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Tags</h3>
              {tagError && <p className="mb-1 text-[11px] text-hot">{tagError}</p>}
              <div className="flex flex-wrap gap-1.5">
                {data!.tags.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => toggleTag(t.id)}
                    className="rr-chip"
                    data-active="true"
                  >
                    {t.label}
                  </button>
                ))}
                <button
                  className="rr-chip"
                  onClick={() => setShowTagPicker((v) => !v)}
                >
                  <Plus className="h-3 w-3" /> Tag
                </button>
              </div>
              {showTagPicker && (
                <div className="mt-2 flex flex-wrap gap-1.5 rounded-lg border border-line/60 p-2.5">
                  {allTags
                    .filter((t) => !t.archived)
                    .sort((a, b) => a.label.localeCompare(b.label))
                    .map((t) => {
                      const active = data!.tags.some((dt) => dt.id === t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => toggleTag(t.id)}
                          className="rr-chip"
                          data-active={active ? "true" : "false"}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  {allTags.filter((t) => !t.archived).length === 0 && (
                    <p className="text-[12px] text-ink-dim">No tags configured.</p>
                  )}
                </div>
              )}
            </section>

            {/* Visit timeline */}
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Visit timeline</h3>
              {data!.visits.length === 0 ? (
                <p className="text-[12px] text-ink-dim">No visits yet.</p>
              ) : (
                <ul className="space-y-2">
                  {data!.visits.map((v) => (
                    <li key={v.id} className="flex gap-2.5">
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-panel"
                        style={{ background: v.pin_color }}
                      />
                      <div className="min-w-0">
                        <p className="text-[13px]">
                          <span className="font-bold">{v.pin_label}</span>
                          {" — "}
                          <span>{v.rep_name ?? "Admin"}</span>
                          <span className="ml-2 text-[11px] text-ink-dim">{fmt(v.knocked_at)}</span>
                        </p>
                        {v.note && <p className="mt-0.5 text-[12px] text-ink-dim">{v.note}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Notes */}
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Notes</h3>
              {data!.notes.length > 0 && (
                <ul className="mb-3 space-y-2">
                  {data!.notes.map((n) => (
                    <li key={n.id} className="rounded-lg border border-line/60 px-3 py-2">
                      <p className="text-[11px] text-ink-dim">
                        {n.rep_name ?? "Admin"} · {fmt(n.created_at)}
                      </p>
                      <p className="mt-0.5 text-[13px]">{n.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              {noteError && <p className="mb-1 text-[11px] text-hot">{noteError}</p>}
              <textarea
                className="rr-input min-h-[72px] resize-y"
                placeholder="Add a note…"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
              />
              <button
                className="rr-btn rr-btn-primary mt-2 w-full"
                disabled={noteSaving || !noteBody.trim()}
                onClick={addNote}
              >
                {noteSaving ? "Saving…" : "Add note"}
              </button>
            </section>
          </div>
        )}
      </div>
    </>
  );
}
