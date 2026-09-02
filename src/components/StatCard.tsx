import Link from "next/link";
import type { ReactNode } from "react";
import { MetricInfo } from "./MetricInfo";
import { deltaDir, formatDelta } from "@/lib/format";
import type { MetricKey } from "@/lib/metrics/glossary";

/**
 * StatCard — the app's headline number, at headline size.
 *
 * ⚠️ VALUE ABOVE LABEL, deliberately inverted from the rails and tables. At 48–64px
 * the number is the thing a reader lands on; the 11px label is what they check
 * afterwards to confirm what they just read. Putting the label first at this scale
 * makes the eye traverse a caption to reach the figure it already saw.
 *
 * Numbers are mono + `tabular` so a row of cards keeps its digits on a common
 * grid — a proportional 56px figure visibly reflows as the value changes.
 *
 * ⚠️ THE SUB LINE IS LOAD-BEARING, NOT DECORATION. Every caller that had a basis,
 * window or coverage note keeps it here (`sub`). Scaling a number up while dropping
 * the qualifier beside it is exactly how "market cap" stops meaning "vault
 * appraisal on one platform, listing floor on another".
 */
export type StatCardSize = "hero" | "lg";

export function StatCard({
  label,
  value,
  size = "lg",
  metric,
  href,
  sub,
  deltaPct,
  deltaLabel,
  tone,
  accent,
  className,
}: {
  label: ReactNode;
  /** Pre-formatted. Pass "—" for a missing figure; never a fabricated 0. */
  value: string;
  /** hero = 64px (one per page), lg = 48px (the row). */
  size?: StatCardSize;
  /** Glossary key → ⓘ on the label. */
  metric?: MetricKey;
  href?: string;
  /** Basis / window / coverage note. Survives from whatever this replaced. */
  sub?: ReactNode;
  deltaPct?: number | null;
  deltaLabel?: string;
  /** Colour the VALUE by sign — for cards whose value is itself a change. */
  tone?: number | null;
  /** Brand-lime value (the page's own headline). */
  accent?: boolean;
  className?: string;
}) {
  const valueCls =
    size === "hero"
      ? "text-[44px] sm:text-[56px] lg:text-[64px]"
      : "text-[34px] sm:text-[40px] lg:text-[48px]";

  const toneCls =
    tone == null || !Number.isFinite(tone)
      ? accent
        ? "text-yellow"
        : "text-ink"
      : deltaDir(tone) === "up"
        ? "text-green"
        : deltaDir(tone) === "down"
          ? "text-red"
          : "text-ink";

  const body = (
    <>
      <div
        className={`font-mono font-bold leading-[0.95] tracking-[-0.03em] tabular ${valueCls} ${toneCls}`}
      >
        {value}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">
          {metric ? <MetricInfo metric={metric}>{label}</MetricInfo> : label}
        </span>
        {deltaPct != null && Number.isFinite(deltaPct) && (
          <span className="inline-flex items-center gap-1">
            <Delta pct={deltaPct} />
            {deltaLabel && <span className="text-[10.5px] text-ink-4">{deltaLabel}</span>}
          </span>
        )}
      </div>
      {sub && <div className="mt-1 text-[10.5px] leading-snug text-ink-4">{sub}</div>}
    </>
  );

  // ⚠️ TOP-ALIGNED, NOT BOTTOM. Cards in a row stretch to a common height but carry
  // different numbers of lines beneath the value — Market Cap adds a basis line
  // ("vault appraisal"), a delta-less card has no delta row. Bottom-aligning made
  // every one of those differences push the VALUE to a different height, so a row
  // of headline numbers read as a ragged staircase. Anchoring the top instead puts
  // every value on one line and lets the label / delta / sub flow down from it;
  // the grid still stretches the cards, so the frame stays even.
  const base = `flex flex-col justify-start bg-bg-1 px-5 py-5 ${className ?? ""}`;
  return href ? (
    <Link href={href} className={`${base} group transition-colors hover:bg-bg-2`}>
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  );
}

/** Row wrapper — hairline-separated cards that collapse to two-up on mobile. */
export function StatCardRow({
  children,
  cols = 4,
  className,
}: {
  children: ReactNode;
  cols?: 3 | 4 | 5;
  className?: string;
}) {
  const md = cols === 3 ? "sm:grid-cols-3" : cols === 5 ? "sm:grid-cols-3 lg:grid-cols-5" : "sm:grid-cols-2 lg:grid-cols-4";
  return (
    <div
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line ${md} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function Delta({ pct }: { pct: number }) {
  const dir = deltaDir(pct);
  const cls = dir === "up" ? "text-green" : dir === "down" ? "text-red" : "text-ink-3";
  return (
    <span className={`font-mono text-[11.5px] font-semibold tabular ${cls}`}>
      {formatDelta(pct)}
    </span>
  );
}
