"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";
import type { SalesRep } from "@/lib/types";

interface EditDraft {
  name: string;
  phone: string;
  email: string;
}

export default function RepsPage() {
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ name: "", phone: "", email: "" });
  const [addName, setAddName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadReps();
  }, []);

  async function loadReps() {
    setLoading(true);
    const res = await fetch("/api/reps?all=1").catch(() => null);
    if (!res || !res.ok) {
      setError("Failed to load reps");
      setLoading(false);
      return;
    }
    const j = await res.json();
    setReps(j.reps ?? []);
    setLoading(false);
  }

  function startEdit(rep: SalesRep) {
    setEditingId(rep.id);
    setEditDraft({ name: rep.name, phone: rep.phone ?? "", email: rep.email ?? "" });
    setError(null);
    setSuccess(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: number) {
    if (!editDraft.name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/reps/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editDraft.name.trim(), phone: editDraft.phone || null, email: editDraft.email || null }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "Save failed"); return; }
      setReps(prev => prev.map(r => r.id === id ? j.rep : r));
      setEditingId(null);
      setSuccess("Saved.");
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/reps/${id}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "Deactivate failed"); return; }
      setReps(prev => prev.map(r => r.id === id ? { ...r, active: false } : r));
      setSuccess("Deactivated.");
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  async function reactivate(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/reps/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "Reactivate failed"); return; }
      setReps(prev => prev.map(r => r.id === id ? j.rep : r));
      setSuccess("Reactivated.");
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  async function addRep() {
    if (!addName.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/reps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addName.trim(), phone: addPhone || null, email: addEmail || null }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "Add failed"); return; }
      setReps(prev => [...prev, j.rep]);
      setAddName("");
      setAddPhone("");
      setAddEmail("");
      setSuccess("Rep added.");
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
              <Users className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Sales reps</h1>
              <p className="text-sm text-ink-dim">Manage canvassing team members</p>
            </div>
          </div>

          {error && <p className="mb-4 text-sm text-hot">{error}</p>}
          {success && <p className="mb-4 text-sm text-good">{success}</p>}

          <div className="mb-6 divide-y divide-line">
            {loading && <p className="py-4 text-sm text-ink-dim">…</p>}
            {!loading && reps.length === 0 && (
              <p className="py-4 text-sm text-ink-dim">No reps yet.</p>
            )}
            {reps.map(rep => (
              <div key={rep.id} className={`py-4 ${!rep.active ? "opacity-50" : ""}`}>
                {editingId === rep.id ? (
                  <div className="flex flex-col gap-2">
                    <input
                      className="rr-input"
                      placeholder="Name"
                      aria-label="Name"
                      value={editDraft.name}
                      onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))}
                    />
                    <input
                      className="rr-input"
                      placeholder="Phone"
                      aria-label="Phone"
                      value={editDraft.phone}
                      onChange={e => setEditDraft(d => ({ ...d, phone: e.target.value }))}
                    />
                    <input
                      className="rr-input"
                      placeholder="Email"
                      aria-label="Email"
                      value={editDraft.email}
                      onChange={e => setEditDraft(d => ({ ...d, email: e.target.value }))}
                    />
                    <div className="flex gap-2">
                      <button className="rr-btn rr-btn-primary" disabled={saving} onClick={() => saveEdit(rep.id)}>
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button className="rr-btn rr-btn-ghost" onClick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{rep.name}</p>
                      <p className="truncate text-sm text-ink-dim">
                        {[rep.phone, rep.email].filter(Boolean).join(" · ") || "No contact info"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {rep.active ? (
                        <>
                          <button className="rr-btn rr-btn-ghost text-xs" onClick={() => startEdit(rep)}>Edit</button>
                          <button className="rr-btn rr-btn-ghost text-xs" disabled={saving} onClick={() => deactivate(rep.id)}>
                            Deactivate
                          </button>
                        </>
                      ) : (
                        <button className="rr-btn rr-btn-ghost text-xs" disabled={saving} onClick={() => reactivate(rep.id)}>
                          Reactivate
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-line pt-5">
            <p className="mb-3 text-sm font-semibold text-ink-dim uppercase tracking-wide">Add rep</p>
            <div className="flex flex-col gap-2">
              <input
                className="rr-input"
                placeholder="Name *"
                aria-label="Name"
                value={addName}
                onChange={e => setAddName(e.target.value)}
              />
              <input
                className="rr-input"
                placeholder="Phone"
                aria-label="Phone"
                value={addPhone}
                onChange={e => setAddPhone(e.target.value)}
              />
              <input
                className="rr-input"
                placeholder="Email"
                aria-label="Email"
                value={addEmail}
                onChange={e => setAddEmail(e.target.value)}
              />
              <button className="rr-btn rr-btn-primary self-start" disabled={saving} onClick={addRep}>
                {saving ? "Adding…" : "Add rep"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
