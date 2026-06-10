"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Radar, Lock } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) {
      router.replace(params.get("next") ?? "/map");
    } else {
      setError("Wrong password — try again.");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,#16233c_0%,#0b1220_60%)] p-6">
      <div className="rr-panel w-full max-w-sm p-8">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 ring-1 ring-accent/40">
            <Radar className="h-7 w-7 text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">RoofRadar</h1>
            <p className="mt-1 text-sm text-ink-dim">Seminole · Volusia · Orange</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-dim" />
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Team password"
              className="rr-input pl-9"
            />
          </div>
          {error && <p className="text-sm text-hot">{error}</p>}
          <button type="submit" disabled={busy || !password} className="rr-btn rr-btn-primary w-full">
            {busy ? "Checking…" : "Enter"}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-ink-dim">Internal tool — contains property-owner data. Don’t share access.</p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
