"use client";

import { useState } from "react";
import { EXPORT_HOST } from "@/lib/chart/export";

/**
 * "Cite this" — the figure, its window, its as-of date, and a permalink.
 *
 * ⚠️ THIS IS THE POINT OF /stats. Messari quoted community Dune boards for this
 * market instead of us, and a number without its window and its as-of is not
 * quotable — whoever repeats it cannot defend it, so they reach for something
 * they can. The block hands over the whole sentence, already written.
 *
 * The figure is passed PRE-FORMATTED by the server, so what gets copied is
 * character-for-character what the page displays.
 */
export function CiteBlock({
  figure,
  label,
  window: windowLabel,
  asOf,
  anchor,
}: {
  /** Pre-formatted, exactly as shown ("$1.31B"). */
  figure: string;
  /** What it measures ("gacha pull volume"). */
  label: string;
  /** The window ("30 complete days"). */
  window: string;
  /** The DATA's as-of. Never the clock's. */
  asOf: string | null;
  /** Fragment on /stats this figure lives at. */
  anchor: string;
}) {
  const [copied, setCopied] = useState(false);
  const permalink = `https://${EXPORT_HOST}/stats#${anchor}`;
  const sentence = `${label}: ${figure} over ${windowLabel}${asOf ? `, as of ${asOf}` : ""} — Varible, ${permalink}`;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/60 pt-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">Cite</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-3" title={sentence}>
        {sentence}
      </code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(sentence).then(
            () => setCopied(true),
            () => setCopied(true),
          );
          window.setTimeout(() => setCopied(false), 1600);
        }}
        className="shrink-0 rounded-md border border-line px-2 py-0.5 font-mono text-[10.5px] text-ink-3 transition-colors hover:border-line-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow/60"
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}
