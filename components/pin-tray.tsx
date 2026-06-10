"use client";

import type { PinType, SalesRep } from "@/lib/types";

interface PinTrayProps {
  pinTypes: PinType[];
  reps: SalesRep[];
  armedPinId: number | null;
  onArm: (id: number | null) => void;
  actingRepId: number | null;
  onActingRepChange: (id: number | null) => void;
}

export default function PinTray({ pinTypes, reps, armedPinId, onArm, actingRepId, onActingRepChange }: PinTrayProps) {
  const armed = armedPinId != null ? pinTypes.find((p) => p.id === armedPinId) ?? null : null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col items-center pb-[env(safe-area-inset-bottom)]">
      {armed && (
        <div className="pointer-events-auto mb-1 flex items-center gap-2 rounded-full bg-panel/90 px-4 py-1.5 text-[13px] text-ink-dim shadow-lg backdrop-blur-md">
          <span>
            Tap a house to drop <span className="font-semibold text-ink">&#39;{armed.label}&#39;</span>
          </span>
          <button
            aria-label="Disarm pin"
            onClick={() => onArm(null)}
            className="ml-1 text-ink-dim hover:text-hot"
          >
            ✕
          </button>
        </div>
      )}

      <div className="pointer-events-auto rr-panel flex w-full max-w-3xl items-center gap-2 overflow-x-auto rounded-b-none rounded-t-2xl px-3 py-2 sm:rounded-2xl sm:mb-2">
        <div className="flex shrink-0 items-center gap-2">
          {pinTypes.map((pt) => {
            const isArmed = pt.id === armedPinId;
            return (
              <button
                key={pt.id}
                data-active={isArmed ? "true" : "false"}
                onClick={() => onArm(isArmed ? null : pt.id)}
                className="rr-chip min-h-11 shrink-0 px-3 py-2 text-[13px]"
                style={isArmed ? { borderColor: pt.color, boxShadow: `0 0 0 2px ${pt.color}` } : undefined}
                title={pt.label}
              >
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: pt.color }}
                />
                {pt.label}
              </button>
            );
          })}

          {armedPinId != null && (
            <button
              onClick={() => onArm(null)}
              className="rr-chip min-h-11 shrink-0 px-3 py-2 text-[13px] hover:border-hot hover:text-hot"
              title="Disarm"
            >
              ✕ Disarm
            </button>
          )}
        </div>

        <div className="ml-auto shrink-0">
          <select
            className="rr-input w-auto py-1.5 text-[13px]"
            value={actingRepId ?? ""}
            onChange={(e) => onActingRepChange(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">Admin</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
