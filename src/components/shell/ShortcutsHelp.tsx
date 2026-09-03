"use client";

/**
 * The `?` overlay — the keyboard map, written down.
 *
 * A keyboard-first interface that doesn't document itself is a keyboard-first
 * interface for the person who wrote it. This is the discoverability half of
 * Move 4, and it is the ONE place the map is defined for a reader; the handlers
 * in KeyboardLayer are the other half and this list is kept beside them
 * deliberately so they are edited together.
 */
export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘K", "Ctrl K"], label: "Command palette" },
  { keys: ["/"], label: "Search" },
  { keys: ["[", "]"], label: "Cycle D / W / M on the chart under the cursor" },
  { keys: ["j", "k"], label: "Move between table rows" },
  { keys: ["Enter"], label: "Open the focused row" },
  { keys: ["g", "m"], label: "Go to Market" },
  { keys: ["g", "i"], label: "Go to Categories" },
  { keys: ["g", "p"], label: "Go to Platforms" },
  { keys: ["g", "r"], label: "Go to Report" },
  { keys: ["g", "w"], label: "Go to Watchlist" },
  { keys: ["d"], label: "Toggle density" },
  { keys: ["?"], label: "This help" },
  { keys: ["Esc"], label: "Close" },
];

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        tabIndex={-1}
        ref={(el) => el?.focus()}
        className="relative w-full max-w-[460px] rounded-2xl border border-line-2 bg-bg-1 p-5 shadow-[0_24px_64px_rgba(0,0,0,0.6)] focus:outline-none"
      >
        <h2 className="mb-3 text-[14px] font-semibold">Keyboard</h2>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[12.5px]">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="contents">
              <dt className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded-md border border-line bg-bg-2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2"
                  >
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd className="text-ink-3">{s.label}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[11px] text-ink-4">
          Shortcuts never fire while you are typing in a field.
        </p>
      </div>
    </div>
  );
}
