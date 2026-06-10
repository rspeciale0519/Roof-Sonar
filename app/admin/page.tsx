"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, Calculator, Check, MapPin, Tag as TagIcon, Users } from "lucide-react";

const ADMIN_LINKS = [
  { href: "/admin/reps", label: "Sales reps", icon: Users },
  { href: "/admin/pins", label: "Pin types", icon: MapPin },
  { href: "/admin/tags", label: "Tags", icon: TagIcon },
  { href: "/admin/metrics", label: "Knock metrics", icon: BarChart3 },
];

const PRESETS = [1.1, 1.2, 1.3, 1.4, 1.5];

// settings.roof_slope_multiplier is a Postgres real; round away float32 noise
// (1.3 comes back as 1.2999999523162842, breaking display + chip highlighting).
const round2 = (v: number) => Math.round(v * 100) / 100;

export default function AdminPage() {
  const [multiplier, setMultiplier] = useState<number | null>(null);
  const [draft, setDraft] = useState("1.30");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => {
        setMultiplier(round2(j.roof_slope_multiplier));
        setDraft(String(round2(j.roof_slope_multiplier)));
      })
      .catch(() => setError("Could not load settings — is Supabase configured?"));
  }, []);

  async function save(value: number) {
    setSaving(true);
    setResult(null);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roof_slope_multiplier: value }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(json.error ?? "Save failed");
      return;
    }
    setMultiplier(round2(json.roof_slope_multiplier));
    setDraft(String(round2(json.roof_slope_multiplier)));
    setResult(`Saved — roofing squares recalculated on ${json.recalculated.toLocaleString()} properties.`);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#16233c_0%,#0b1220_60%)] p-6">
      <div className="mx-auto max-w-xl">
        <Link href="/map" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-dim hover:text-accent">
          <ArrowLeft className="h-4 w-4" /> Back to map
        </Link>

        <div className="mb-6 grid grid-cols-2 gap-3">
          {ADMIN_LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="rr-panel flex items-center gap-3 p-4 transition-colors hover:border-accent/60"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15">
                <Icon className="h-4 w-4 text-accent" />
              </div>
              <span className="text-sm font-semibold">{label}</span>
            </Link>
          ))}
        </div>

        <div className="rr-panel p-7">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 ring-1 ring-accent/40">
              <Calculator className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Admin settings</h1>
              <p className="text-sm text-ink-dim">Roof measurement configuration</p>
            </div>
          </div>

          <label className="mb-1.5 block text-sm font-medium">Roof slope multiplier</label>
          <p className="mb-3 text-[13px] leading-relaxed text-ink-dim">
            <code className="font-mono text-ink">squares = floor(building sqft × multiplier ÷ 100)</code>. Changing it
            recalculates every property immediately; the map reflects it on the next refresh. Current:{" "}
            <span className="font-semibold text-ink">{multiplier ?? "…"}</span>
          </p>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {PRESETS.map((v) => (
              <button key={v} className="rr-chip" data-active={multiplier === v} onClick={() => save(v)} disabled={saving}>
                {v.toFixed(1)}
                {v === 1.3 && <span className="text-[10px] text-ink-dim">(typical)</span>}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              className="rr-input flex-1"
              type="number"
              step="0.05"
              min="1"
              max="2"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="rr-btn rr-btn-primary" disabled={saving} onClick={() => save(parseFloat(draft))}>
              {saving ? "Recalculating…" : "Save"}
            </button>
          </div>

          {result && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-good">
              <Check className="h-4 w-4" /> {result}
            </p>
          )}
          {error && <p className="mt-3 text-sm text-hot">{error}</p>}
        </div>
      </div>
    </main>
  );
}
