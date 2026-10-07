import type { ReactNode } from "react";
import { deltaDir, formatDelta } from "@/lib/format";
import type { IndexReading } from "@/lib/indices/reading";

/**
 * A V block — the figure an index leads with, and the lines that say what it is.
 *
 *   V-MKT 152.1 [October so far · provisional] −1.2% MTD
 *   63 identities · closes Nov 1 · as of Oct 14 09:12 UTC
 *   September close 151.2 · +51.2% since Jan 12
 *   sample: Beezie 31 · Collector Crypt 22 identities
 *
 * When the running month clears the floor, its provisional reading leads and
 * the last close sits one line below — never hidden. Below the floor the close
 * leads and the receipt line says why the month in progress is not shown.
 * Every string comes from `indexReading` (src/lib/indices/reading.ts); this
 * component only lays them out.
 *
 * ⚠️ RECEIPT LINES, NOT BANNERS. The chip is the only boxed element; the rest
 * is the mono receipt voice the site uses for disclosures. At 375 the chip and
 * the lines wrap under the figure (flex-wrap; no fixed widths).
 */
export function IndexReadingBlock({
  ticker,
  reading,
  sinceInception,
  sinceLabel,
  info,
  className = "",
}: {
  ticker: string;
  reading: IndexReading;
  /** Since-inception move of the last CLOSE (rebased − 100), as the hero has always printed it. */
  sinceInception?: number | null;
  sinceLabel?: string | null;
  /** The ⓘ beside the ticker. */
  info?: ReactNode;
  className?: string;
}) {
  const { lead, figure, stepPct, stepWindow, close, provisional } = reading;
  if (figure == null || !Number.isFinite(figure)) {
    return <span className={`text-ink-4 ${className}`}>rebased index building</span>;
  }
  const since =
    sinceInception != null && Number.isFinite(sinceInception) ? (
      <>
        <Delta pct={sinceInception} />
        {sinceLabel ? <span className="text-ink-4">{sinceLabel}</span> : null}
      </>
    ) : null;

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`} data-index-reading={lead}>
      {/* 1 — the figure, its chip, its step and that step's window. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="inline-flex items-center gap-1">
          {ticker}{" "}
          <span className="tabular font-semibold text-ink-2" data-index-figure>
            {figure.toFixed(1)}
          </span>
          {info}
        </span>
        {lead === "provisional" && provisional?.state === "leads" ? (
          <span
            data-index-chip
            className="rounded-md border border-line bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink-3"
          >
            {provisional.chip}
          </span>
        ) : lead === "close" && provisional?.state === "below-floor" && close ? (
          // The close leads because the running month is under its floor: name
          // which close it is, so the figure cannot read as this month's.
          <span
            data-index-chip
            className="rounded-md border border-line bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink-3"
          >
            {close.name}
          </span>
        ) : null}
        {stepPct != null && Number.isFinite(stepPct) ? (
          <span className="inline-flex items-center gap-1" data-index-step>
            <Delta pct={stepPct} />
            <span className="text-ink-4">{stepWindow}</span>
          </span>
        ) : null}
        {/* With the close leading, the since-inception move stays where it was. */}
        {lead === "close" ? since : null}
      </div>

      {/* 2 — the receipt line: the provisional's n, close date and as-of; or,
          below the floor, why the running month is not shown. */}
      {provisional ? (
        <p className="font-mono text-[10.5px] leading-snug text-ink-4" data-index-receipt>
          {provisional.receipt}
        </p>
      ) : null}

      {/* 3 — the last close, one line below the provisional that leads it. */}
      {lead === "provisional" && close ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-3" data-index-close>
          <span className="tabular">{close.label}</span>
          {since}
        </p>
      ) : null}

      {/* 4 — what the leading reading rests on, by venue. */}
      <SampleLine sample={lead === "provisional" && provisional?.state === "leads" ? provisional.sample : close?.sample ?? null} />
    </div>
  );
}

/** `sample: Beezie 31 · Collector Crypt 22 identities`, and the backend's note when an identity counts twice. */
export function SampleLine({ sample, className = "" }: { sample: { line: string; note: string | null } | null; className?: string }) {
  if (!sample) return null;
  return (
    <p className={`font-mono text-[10.5px] leading-snug text-ink-4 ${className}`} data-index-sample>
      {sample.line}
      {sample.note ? <span className="text-ink-4"> · {sample.note}</span> : null}
    </p>
  );
}

function Delta({ pct }: { pct: number }) {
  const dir = deltaDir(pct);
  const cls = dir === "up" ? "text-green" : dir === "down" ? "text-red" : "text-ink-3";
  return <span className={`tabular font-semibold ${cls}`}>{formatDelta(pct)}</span>;
}
