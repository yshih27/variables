export function formatCompactUsd(n: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1) return `$${n.toFixed(2)}`;
  if (abs < 1_000) return `$${Math.round(n)}`;
  if (abs < 1_000_000) return `$${(n / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  if (abs < 1_000_000_000) return `$${(n / 1_000_000).toFixed(abs >= 100_000_000 ? 0 : abs >= 10_000_000 ? 1 : 2)}M`;
  return `$${(n / 1_000_000_000).toFixed(2)}B`;
}

export function formatCompactNumber(n: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1_000) return n.toLocaleString();
  if (abs < 1_000_000) return `${(n / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  if (abs < 1_000_000_000) return `${(n / 1_000_000).toFixed(abs >= 100_000_000 ? 0 : abs >= 10_000_000 ? 1 : 2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

/**
 * Below this magnitude (in PERCENT) a move is treated as flat: no sign, no
 * arrow, no colour. One convention, everywhere, so the app can't print "−0.0%"
 * or "+0.0%" — a value that rounds to 0.0 but keeps its sign, implying a move
 * that isn't there. `deltaDir` and `formatDelta` are the two readers.
 */
export const DELTA_DEADBAND_PCT = 0.05;

export type DeltaDir = "up" | "down" | "flat";

/** Direction of a percent delta, dead-banded — drives colour + arrow. */
export function deltaDir(pct: number | null | undefined): DeltaDir {
  if (pct == null || !Number.isFinite(pct)) return "flat";
  if (pct > DELTA_DEADBAND_PCT) return "up";
  if (pct < -DELTA_DEADBAND_PCT) return "down";
  return "flat";
}

/** Signed percent text, dead-banded: a flat value prints "0.0%" with NO sign. */
export function formatDelta(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const dir = deltaDir(pct);
  const sign = dir === "up" ? "+" : dir === "down" ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function formatPct(p: number | null): string {
  // Routed through the dead-band so a −0.02 that rounds to 0.0 loses its sign.
  return formatDelta(p);
}

export function formatInt(n: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

export function trendOf(p: number | null): "up" | "down" | "flat" {
  if (p == null || !Number.isFinite(p)) return "flat";
  if (p > 0.5) return "up";
  if (p < -0.5) return "down";
  return "flat";
}
