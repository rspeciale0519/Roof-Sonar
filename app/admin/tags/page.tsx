"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Tag as TagIcon } from "lucide-react";
import type { Tag } from "@/lib/types";

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadTags();
  }, []);

  async function loadTags() {
    setLoading(true);
    const res = await fetch("/api/tags?all=1").catch(() => null);
    if (!res || !res.ok) {
      setError("Failed to load tags");
      setLoading(false);
      return;
    }
    const j = await res.json();
    setTags(j.tags ?? []);
    setLoading(false);
  }

  function startEdit(tag: Tag) {
    setEditingId(tag.id);
    setEditLabel(tag.label);
    setError(null);
    setSuccess(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: number) {
    if (!editLabel.trim()) { setError("Label is required"); return; }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/tags/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: editLabel.trim() }),
    });
    const j = await res.json();
    setSaving(false);
    if (!res.ok) { setError(j.error ?? "Save failed"); return; }
    setTags(prev => prev.map(t => t.id === id ? j.tag : t));
    setEditingId(null);
    setSuccess("Saved.");
  }

  async function deleteTag(id: number) {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/tags/${id}`, { method: "DELETE" });
    const j = await res.json();
    setSaving(false);
    if (!res.ok) { setError(j.error ?? "Delete failed"); return; }
    if (j.archived) {
      setTags(prev => prev.map(t => t.id === id ? { ...t, archived: true } : t));
      setSuccess("In use — archived instead.");
    } else {
      setTags(prev => prev.filter(t => t.id !== id));
      setSuccess("Deleted.");
    }
  }

  async function unarchive(id: number) {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/tags/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: false }),
    });
    const j = await res.json();
    setSaving(false);
    if (!res.ok) { setError(j.error ?? "Unarchive failed"); return; }
    setTags(prev => prev.map(t => t.id === id ? j.tag : t));
    setSuccess("Unarchived.");
  }

  async function addTag() {
    if (!addLabel.trim()) { setError("Label is required"); return; }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: addLabel.trim() }),
    });
    const j = await res.json();
    setSaving(false);
    if (!res.ok) { setError(j.error ?? "Add failed"); return; }
    setTags(prev => [...prev, j.tag]);
    setAddLabel("");
    setSuccess("Tag added.");
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
              <TagIcon className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Tags</h1>
              <p className="text-sm text-ink-dim">Manage property classification tags</p>
            </div>
          </div>

          {error && <p className="mb-4 text-sm text-hot">{error}</p>}
          {success && <p className="mb-4 text-sm text-good">{success}</p>}

          <div className="mb-6 divide-y divide-line">
            {loading && <p className="py-4 text-sm text-ink-dim">…</p>}
            {!loading && tags.length === 0 && (
              <p className="py-4 text-sm text-ink-dim">No tags yet.</p>
            )}
            {tags.map(tag => (
              <div key={tag.id} className={`py-4 ${tag.archived ? "opacity-50" : ""}`}>
                {editingId === tag.id ? (
                  <div className="flex gap-2">
                    <input
                      className="rr-input flex-1"
                      value={editLabel}
                      onChange={e => setEditLabel(e.target.value)}
                    />
                    <button className="rr-btn rr-btn-primary" disabled={saving} onClick={() => saveEdit(tag.id)}>
                      {saving ? "…" : "Save"}
                    </button>
                    <button className="rr-btn rr-btn-ghost" onClick={cancelEdit}>Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-medium">
                      {tag.label}
                      {tag.archived && <span className="ml-2 text-xs text-ink-dim">(archived)</span>}
                    </span>
                    <div className="flex shrink-0 gap-2">
                      {tag.archived ? (
                        <button className="rr-btn rr-btn-ghost text-xs" disabled={saving} onClick={() => unarchive(tag.id)}>
                          Unarchive
                        </button>
                      ) : (
                        <>
                          <button className="rr-btn rr-btn-ghost text-xs" onClick={() => startEdit(tag)}>Rename</button>
                          <button className="rr-btn rr-btn-ghost text-xs" disabled={saving} onClick={() => deleteTag(tag.id)}>
                            Archive
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
            <p className="mb-3 text-sm font-semibold text-ink-dim uppercase tracking-wide">Add tag</p>
            <div className="flex gap-2">
              <input
                className="rr-input flex-1"
                placeholder="Tag label *"
                value={addLabel}
                onChange={e => setAddLabel(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addTag(); }}
              />
              <button className="rr-btn rr-btn-primary" disabled={saving} onClick={addTag}>
                {saving ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
