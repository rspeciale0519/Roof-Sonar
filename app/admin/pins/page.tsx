"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MapPin } from "lucide-react";
import type { PinType } from "@/lib/types";

interface PinDraft {
  label: string;
  color: string;
  expires_after_days: string;
  is_do_not_knock: boolean;
  counts_as_contact: boolean;
  counts_as_lead: boolean;
  sort_order: string;
}

const defaultDraft = (): PinDraft => ({
  label: "",
  color: "#f97316",
  expires_after_days: "",
  is_do_not_knock: false,
  counts_as_contact: true,
  counts_as_lead: false,
  sort_order: "99",
});

function pinToDraft(p: PinType): PinDraft {
  return {
    label: p.label,
    color: p.color,
    expires_after_days: p.expires_after_days == null ? "" : String(p.expires_after_days),
    is_do_not_knock: p.is_do_not_knock,
    counts_as_contact: p.counts_as_contact,
    counts_as_lead: p.counts_as_lead,
    sort_order: String(p.sort_order),
  };
}

function draftToPayload(d: PinDraft) {
  return {
    label: d.label.trim(),
    color: d.color,
    expires_after_days: d.expires_after_days === "" ? null : Number(d.expires_after_days),
    is_do_not_knock: d.is_do_not_knock,
    counts_as_contact: d.counts_as_contact,
    counts_as_lead: d.counts_as_lead,
    sort_order: Number(d.sort_order) || 99,
  };
}

function PinChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full border border-white/20" style={{ background: color }} />
      <span className="text-sm font-medium">{label}</span>
    </span>
  );
}

function PinForm({
  draft,
  onChange,
}: {
  draft: PinDraft;
  onChange: (d: PinDraft) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          className="rr-input flex-1"
          placeholder="Label *"
          aria-label="Label"
          value={draft.label}
          onChange={e => onChange({ ...draft, label: e.target.value })}
        />
        <input
          type="color"
          className="h-[42px] w-12 cursor-pointer rounded-xl border border-line bg-panel-2 p-1"
          value={draft.color}
          onChange={e => onChange({ ...draft, color: e.target.value })}
          title="Pin color"
          aria-label="Pin color"
        />
      </div>
      <div className="flex gap-2">
        <input
          className="rr-input flex-1"
          type="number"
          min="1"
          placeholder="Expires after days (blank = never)"
          aria-label="Expires after days"
          value={draft.expires_after_days}
          onChange={e => onChange({ ...draft, expires_after_days: e.target.value })}
        />
        <input
          className="rr-input w-24"
          type="number"
          min="0"
          placeholder="Order"
          aria-label="Sort order"
          value={draft.sort_order}
          onChange={e => onChange({ ...draft, sort_order: e.target.value })}
        />
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.is_do_not_knock}
            onChange={e => onChange({ ...draft, is_do_not_knock: e.target.checked })}
          />
          Do Not Knock
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.counts_as_contact}
            onChange={e => onChange({ ...draft, counts_as_contact: e.target.checked })}
          />
          Counts as contact
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.counts_as_lead}
            onChange={e => onChange({ ...draft, counts_as_lead: e.target.checked })}
          />
          Counts as lead
        </label>
      </div>
    </div>
  );
}

export default function PinsPage() {
  const [pins, setPins] = useState<PinType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<PinDraft>(defaultDraft());
  const [addDraft, setAddDraft] = useState<PinDraft>(defaultDraft());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPins();
  }, []);

  async function loadPins() {
    setLoading(true);
    const res = await fetch("/api/pin-types?all=1").catch(() => null);
    if (!res || !res.ok) {
      setError("Failed to load pin types");
      setLoading(false);
      return;
    }
    const j = await res.json();
    setPins(j.pin_types ?? []);
    setLoading(false);
  }

  function startEdit(pin: PinType) {
    setEditingId(pin.id);
    setEditDraft(pinToDraft(pin));
    setError(null);
    setSuccess(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: number) {
    if (!editDraft.label.trim()) { setError("Label is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/pin-types/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToPayload(editDraft)),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "Save failed"); return; }
      setPins(prev => prev.map(p => p.id === id ? j.pin_type : p));
      setEditingId(null);
      setSuccess("Saved.");
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  async function deletePin(id: number) {
    if (!window.confirm("Delete? If it's in use it will be archived instead; otherwise this cannot be undone.")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/pin-types/${id}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "Delete failed"); return; }
      if (j.archived) {
        setPins(prev => prev.map(p => p.id === id ? { ...p, archived: true } : p));
        setSuccess("In use — archived instead.");
      } else {
        setPins(prev => prev.filter(p => p.id !== id));
        setSuccess("Deleted.");
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  async function unarchive(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/pin-types/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "Unarchive failed"); return; }
      setPins(prev => prev.map(p => p.id === id ? j.pin_type : p));
      setSuccess("Unarchived.");
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  async function addPin() {
    if (!addDraft.label.trim()) { setError("Label is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/pin-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToPayload(addDraft)),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "Add failed"); return; }
      setPins(prev => [...prev, j.pin_type]);
      setAddDraft(defaultDraft());
      setSuccess("Pin type added.");
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#16233c_0%,#0b1220_60%)] p-6">
      <div className="mx-auto max-w-xl">
        <Link href="/admin" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-dim hover:text-accent">
          <ArrowLeft className="h-4 w-4" /> Back to admin
        </Link>

        <div className="rr-panel p-7">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 ring-1 ring-accent/40">
              <MapPin className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Pin types</h1>
              <p className="text-sm text-ink-dim">Configure knock outcome categories</p>
            </div>
          </div>

          {error && <p className="mb-4 text-sm text-hot">{error}</p>}
          {success && <p className="mb-4 text-sm text-good">{success}</p>}

          <div className="mb-6 divide-y divide-line">
            {loading && <p className="py-4 text-sm text-ink-dim">…</p>}
            {!loading && pins.length === 0 && (
              <p className="py-4 text-sm text-ink-dim">No pin types yet.</p>
            )}
            {pins.map(pin => (
              <div key={pin.id} className={`py-4 ${pin.archived ? "opacity-50" : ""}`}>
                {editingId === pin.id ? (
                  <div className="flex flex-col gap-3">
                    <PinForm draft={editDraft} onChange={setEditDraft} />
                    <div className="flex gap-2">
                      <button className="rr-btn rr-btn-primary" disabled={saving} onClick={() => saveEdit(pin.id)}>
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button className="rr-btn rr-btn-ghost" onClick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <PinChip color={pin.color} label={pin.label} />
                      <p className="mt-0.5 text-xs text-ink-dim">
                        {pin.expires_after_days != null ? `Expires: ${pin.expires_after_days}d` : "No expiry"}
                        {pin.is_do_not_knock && " · DNK"}
                        {pin.counts_as_contact && " · Contact"}
                        {pin.counts_as_lead && " · Lead"}
                        {pin.archived && " · Archived"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {pin.archived ? (
                        <button className="rr-btn rr-btn-ghost text-xs" disabled={saving} onClick={() => unarchive(pin.id)}>
                          Unarchive
                        </button>
                      ) : (
                        <>
                          <button className="rr-btn rr-btn-ghost text-xs" onClick={() => startEdit(pin)}>Edit</button>
                          <button className="rr-btn rr-btn-ghost text-xs" disabled={saving} onClick={() => deletePin(pin.id)}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-line pt-5">
            <p className="mb-3 text-sm font-semibold text-ink-dim uppercase tracking-wide">Add pin type</p>
            <div className="flex flex-col gap-3">
              <PinForm draft={addDraft} onChange={setAddDraft} />
              <button className="rr-btn rr-btn-primary self-start" disabled={saving} onClick={addPin}>
                {saving ? "Adding…" : "Add pin type"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
