"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function MobileDrawer({ open, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity md:hidden ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        aria-hidden
        onClick={onClose}
      />
      <div
        className={`fixed inset-y-0 left-0 z-50 flex w-[85vw] max-w-80 flex-col transition-transform duration-300 md:hidden ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="rr-panel flex h-full flex-col overflow-hidden rounded-l-none rounded-r-2xl">
          <div className="flex items-center justify-between border-b border-line/60 px-4 py-3">
            <span className="text-sm font-semibold">Filters</span>
            <button
              aria-label="Close filters"
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-dim hover:bg-panel-2 hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
