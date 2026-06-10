"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3 } from "lucide-react";

interface RepStat {
  rep_id: number;
  rep_name: string;
  doors_knocked: number;
  contacts: number;
  leads: number;
  routes_assigned: number;
  routes_completed: number;
}

const WINDOWS = [
  { label: "Today", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

function pct(numerator: number, denominator: number): string {
  if (Number(denominator) === 0) return "—";
  return `${Math.round((Number(numerator) / Number(denominator)) * 100)}%`;
}

export default function MetricsPage() {
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState<RepStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load(days);
  }, [days]);

  async function load(d: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/metrics?days=${d}`);
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "Failed to load metrics");
        setStats([]);
      } else {
        setStats(j.stats ?? []);
      }
    } catch {
      setError("Network error — try again");
      setStats([]);
    } finally {
      setLoading(false);
    }
  }

  const isEmpty = !loading && !error && (stats.length === 0 || stats.every((r) => Number(r.doors_knocked) === 0));

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#16233c_0%,#0b1220_60%)] p-6">
      <div className="mx-auto max-w-3xl">
        <Link href="/admin" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-dim hover:text-accent">
          <ArrowLeft className="h-4 w-4" /> Back to admin
        </Link>

        <div className="rr-panel p-7">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 ring-1 ring-accent/40">
              <BarChart3 className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Knock metrics</h1>
              <p className="text-sm text-ink-dim">Canvassing performance by rep</p>
            </div>
          </div>

          {error && <p className="mb-4 text-sm text-hot">{error}</p>}

          <div className="mb-5 flex flex-wrap gap-1.5">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                className="rr-chip"
                data-active={days === w.days}
                onClick={() => setDays(w.days)}
              >
                {w.label}
              </button>
            ))}
          </div>

          {loading && <p className="py-6 text-sm text-ink-dim">…</p>}

          {!loading && isEmpty && (
            <p className="py-6 text-sm text-ink-dim">No knocks recorded yet.</p>
          )}

          {!loading && !isEmpty && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink-dim">
                    <th className="pb-2 pr-4 font-medium">Rep</th>
                    <th className="pb-2 pr-4 font-medium">Doors knocked</th>
                    <th className="pb-2 pr-4 font-medium">Contacts</th>
                    <th className="pb-2 pr-4 font-medium">Leads</th>
                    <th className="pb-2 font-medium">Routes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {stats.map((r) => (
                    <tr key={r.rep_id}>
                      <td className="py-3 pr-4 font-medium">{r.rep_name}</td>
                      <td className="py-3 pr-4">{Number(r.doors_knocked)}</td>
                      <td className="py-3 pr-4">
                        {Number(r.contacts)}{" "}
                        <span className="text-ink-dim">({pct(r.contacts, r.doors_knocked)})</span>
                      </td>
                      <td className="py-3 pr-4">
                        {Number(r.leads)}{" "}
                        <span className="text-ink-dim">({pct(r.leads, r.contacts)})</span>
                      </td>
                      <td className="py-3">
                        {Number(r.routes_completed)}/{Number(r.routes_assigned)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
