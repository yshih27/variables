import Link from "next/link";
import { deltaDir, formatDelta } from "@/lib/format";

/**
 * A single clickable stat — label · value · optional colored delta.
 *
 * ONE implementation, shared by the legacy NavBar's ticker band and by SHELL_V2's
 * top-bar market strip. They render the same five market numbers; a second copy
 * of the delta rules (dead-band, palette, window suffix) is exactly the kind of
 * duplication that goes stale on one surface and not the other.
 *
 * Deliberately server-compatible (no state, no hooks) so the shell's server
 * components can render it directly without widening a client boundary.
 */

/**
 * Deliberately generic: the SHELL_V2 tape (design-north-star Move 2) streams
 * EVENTS — cleared sales, big pulls — through this same slot, so nothing here is
 * named for market stats.
 */
export type TickerItem = {
  label: string;
  value: string;
  href: string;
  /** Signed percent move (already a PERCENT, not a fraction). null/absent = no delta. */
  delta?: number | null;
  /** Window the delta covers ("1w", "24h", "7d"). Omit when `label` already says it. */
  deltaWindow?: string;
  /** Hover explanation of what the number means. */
  title?: string;
  /** Kept in the narrow slot, where only the first couple of items fit. */
  priority?: boolean;
};

export function TickerStat({ item, className = "" }: { item: TickerItem; className?: string }) {
  return (
    <Link
      href={item.href}
      title={item.title}
      className={`group shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] ${
        item.priority ? "flex" : "hidden sm:flex"
      } ${className}`}
    >
      <span className="text-ink-3">{item.label}</span>
      <span className="font-semibold tabular text-ink transition-colors group-hover:text-yellow">
        {item.value}
      </span>
      {item.delta != null && Number.isFinite(item.delta) && (
        <TickerDelta pct={item.delta} windowLabel={item.deltaWindow} />
      )}
    </Link>
  );
}

/**
 * Colored delta inside a ticker item — the house palette + dead-band, same as
 * every other delta on the site (formatDelta drops the sign inside the band, so a
 * flat move can never print "−0.0%"). The window suffix is only rendered when the
 * item's label doesn't already state it, so "24h vol −8.2%" doesn't say 24h twice.
 */
// `windowLabel`, not `window` — a prop named `window` would shadow the global in a
// client component.
function TickerDelta({ pct, windowLabel }: { pct: number | null | undefined; windowLabel?: string }) {
  const dir = deltaDir(pct);
  const cls = dir === "up" ? "text-green" : dir === "down" ? "text-red" : "text-ink-3";
  return (
    <span className={`font-semibold tabular ${cls}`}>
      {formatDelta(pct)}
      {windowLabel && <span className="ml-1 font-normal text-ink-4">{windowLabel}</span>}
    </span>
  );
}
