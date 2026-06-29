"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Custom metric dropdown matching the handoff's `.dd` spec — a themed
 * replacement for the native <select> (whose OS popup breaks the dark theme).
 * Trigger borders lime when open; menu fades in; selected row shows a lime check.
 * Click-outside closes.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative font-mono">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-8 items-center gap-2 rounded-[9px] border bg-bg-1 px-3 text-[12px] transition-colors ${
          open ? "border-yellow" : "border-line hover:border-line-2"
        }`}
      >
        {label && <span className="text-ink-4">{label}</span>}
        <span className="text-ink">{current?.label ?? value}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          className={`text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden
        >
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1.5 min-w-[160px] rounded-[11px] border border-line-2 bg-bg-2 p-1 shadow-[0_14px_36px_rgba(0,0,0,0.55)]">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex h-[34px] w-full items-center justify-between gap-3 rounded-[7px] px-2.5 text-[12.5px] transition-colors hover:bg-bg-3 ${
                o.value === value ? "text-ink" : "text-ink-2"
              }`}
            >
              {o.label}
              {o.value === value && <span className="text-yellow">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
