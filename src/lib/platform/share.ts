import type { PlatformRow } from "@/lib/types";

/**
 * How /platforms divides the pie. One definition, because the ribbon's DOMINANCE,
 * the rail's per-row share and the table's Share column all sit in one fold —
 * three answers to "how big a slice is Collector Crypt" would be indefensible.
 *
 * ⚠️ PlatformTable computes this same thing inline (its `totalActivity` +
 * `shareCell`) and is deliberately left alone; if you change the formula here,
 * change it there too or the fold starts disagreeing with itself.
 *
 * `total24Usd > 0 ? x : 0` rather than `x || 0` is load-bearing: an untracked
 * platform's figures are NaN (Phygitals has no secondary source), NaN > 0 is
 * false, and one NaN in the Σ would blank every percentage on the page.
 */
export function totalActivity24(rows: PlatformRow[]): number {
  return rows.reduce((s, p) => s + (p.total24Usd > 0 ? p.total24Usd : 0), 0);
}

/** A platform's share of 24h activity, in PERCENT. null when it has no activity
 *  to have a share of — the caller renders "—" rather than a confident 0.0%. */
export function sharePct24(p: PlatformRow, total: number): number | null {
  if (!(p.total24Usd > 0) || !(total > 0)) return null;
  return (p.total24Usd / total) * 100;
}

/** Herfindahl–Hirschman index over 24h-activity shares (0–1). */
export function concentrationHHI24(rows: PlatformRow[], total: number): number | null {
  if (!(total > 0)) return null;
  return rows.reduce((s, p) => s + Math.pow((p.total24Usd > 0 ? p.total24Usd : 0) / total, 2), 0);
}
