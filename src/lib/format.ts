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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon DD" for an ISO timestamp, in UTC (e.g. "Jul 18"); null if unparseable. */
export function formatMonthDayUtc(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * "as of Mon DD" when `iso` is older than `thresholdHours`, else null. The clock
 * read (Date.now) lives here in a lib helper — not at the call site — matching the
 * homepage's `floatAgeLabelOf`: a bare Date.now() in a render body trips the
 * no-impure-calls lint, but a time-relative formatter that reads it internally is
 * fine (the page is ISR-cached, so this is a once-per-render read anyway). Drives
 * the overview market-cap stale-guard (36h) on / and /ips.
 */
export function staleAsOfLabel(
  iso: string | null | undefined,
  thresholdHours = 36,
): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  if (Date.now() - t <= thresholdHours * 3_600_000) return null;
  const md = formatMonthDayUtc(iso);
  return md ? `as of ${md}` : null;
}
