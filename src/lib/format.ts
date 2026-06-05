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

export function formatPct(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const sign = p > 0 ? "+" : p < 0 ? "−" : "";
  return `${sign}${Math.abs(p).toFixed(1)}%`;
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
