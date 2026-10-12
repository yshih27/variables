/**
 * The `secondary_sales` backfill's pure parts (scripts/backfill-secondary-sales.ts;
 * brief-backend-index-every-venue B2): calendar-month windows, the split of a
 * venue's history into them, and the Collector Crypt cost estimate the
 * `--count` mode prints. No I/O, so the test drives every branch.
 *
 * ⚠️ WHY MONTHS. One Dune execution per month bounds each read: a failed or
 * timed-out month is re-run alone, and the estimate can be approved, or cut,
 * a month at a time. The free venues (Beezie /activity, Courtyard via Rarible)
 * are one request stream each, split by month only for the report and the write.
 */

/** A calendar month as a half-open UTC window: `start` inclusive, `end` exclusive. */
export type MonthWindow = { month: string; start: string; end: string };

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-03" → the UTC ms of its first instant; null when it is not a month. */
export function monthStartMs(month: string): number | null {
  const m = MONTH_RE.exec(month);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) : null;
}

/** The calendar month an ISO instant falls in, UTC. */
export function monthOf(iso: string): string {
  return new Date(iso).toISOString().slice(0, 7);
}

/** Every month from `from` to `to`, both inclusive, oldest first. Empty when `to` precedes `from`. */
export function monthWindows(from: string, to: string): MonthWindow[] {
  const a = monthStartMs(from);
  const b = monthStartMs(to);
  if (a == null || b == null) throw new Error(`months are YYYY-MM: got ${from} → ${to}`);
  const out: MonthWindow[] = [];
  for (let d = new Date(a); d.getTime() <= b; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    out.push({ month: d.toISOString().slice(0, 7), start: d.toISOString(), end: next.toISOString() });
  }
  return out;
}

/** The month before the one `nowMs` falls in: the newest COMPLETE month. */
export function lastCompleteMonth(nowMs: number): string {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}

/**
 * Rows into their month windows. A row outside every window is returned apart
 * (`outside`), never silently dropped, so the script can say how many the
 * feed returned beyond the range asked for.
 */
export function splitByMonth<T extends { sold_at: string }>(rows: T[], windows: MonthWindow[]): { byMonth: Map<string, T[]>; outside: number } {
  const byMonth = new Map<string, T[]>(windows.map((w) => [w.month, [] as T[]]));
  let outside = 0;
  for (const r of rows) {
    const bucket = byMonth.get(monthOf(r.sold_at));
    if (bucket) bucket.push(r);
    else outside++;
  }
  return { byMonth, outside };
}

/** An ISO instant as a Dune `datetime` parameter: "2026-03-01 00:00:00". */
export function duneDatetime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace("T", " ");
}

// ── The Collector Crypt cost estimate (`--count`) ────────────────────────────

/**
 * Columns `dune/cc-secondary-history.sql` returns: block_time, price_usd,
 * nft_mint, buyer, seller, tx_id. Dune counts one datapoint per cell.
 */
export const CC_HISTORY_COLUMNS = 6;

/**
 * Exported bytes per history row. MEASURED for 7675297's five columns: 449.1 KB
 * for 3,111 rows (147.8 B/row; core run 36783479194, Sep 30 22:05 UTC). The
 * history query adds `tx_id`, an 87–88-character base58 signature: +88.
 */
export const CC_HISTORY_BYTES_PER_ROW = 148 + 88;

/** Analyst plan: 10 credits per MB exported (dune/README.md, cost model). */
export const DUNE_CREDITS_PER_MB = 10;

/** One month of `dune/cc-secondary-history-count.sql`. */
export type CountRow = { month: string; sales: number; volumeUsd: number };

/** The count query's rows → months. Tolerates Dune's "2026-03-01 00:00:00.000 UTC" stamps. */
export function parseCountRows(rows: Record<string, unknown>[]): CountRow[] {
  return rows
    .map((r) => {
      const raw = String(r.month ?? "");
      // ⚠️ Not `includes("T")`: "UTC" has a T in it.
      const iso = /\dT\d/.test(raw) ? raw : raw.replace(" UTC", "Z").replace(" ", "T");
      const t = Date.parse(iso.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
      return Number.isFinite(t) ? { month: new Date(t).toISOString().slice(0, 7), sales: Number(r.sales) || 0, volumeUsd: Number(r.volume_usd) || 0 } : null;
    })
    .filter((x): x is CountRow => x != null)
    .sort((a, b) => a.month.localeCompare(b.month));
}

export type MonthCost = CountRow & { datapoints: number; exportMb: number; exportCredits: number };

export type HistoryCostEstimate = {
  months: MonthCost[];
  sales: number;
  datapoints: number;
  exportMb: number;
  exportCredits: number;
  /**
   * The count execution's compute, MEASURED from the account meter (null when
   * the meter had not moved by the time it was read). The count query scans the
   * same rows over the same range as the backfill's executions together, so it
   * stands in for their compute; one execution per month adds some per-run
   * overhead on top, which this does not include.
   */
  executionCredits: number | null;
  totalCredits: number | null;
  /** Every extra credit is billed when the account is past its included credits. */
  usd: number | null;
};

/** The backfill's cost from its count: datapoints, export MB and credits per month, then the total. */
export function estimateHistoryCost(
  counts: CountRow[],
  opts: { executionCredits: number | null; usdPerCredit: number; bytesPerRow?: number; creditsPerMb?: number },
): HistoryCostEstimate {
  const bpr = opts.bytesPerRow ?? CC_HISTORY_BYTES_PER_ROW;
  const cpm = opts.creditsPerMb ?? DUNE_CREDITS_PER_MB;
  const months = counts.map((c) => {
    const exportMb = (c.sales * bpr) / (1024 * 1024);
    return { ...c, datapoints: c.sales * CC_HISTORY_COLUMNS, exportMb, exportCredits: exportMb * cpm };
  });
  const sum = (f: (m: MonthCost) => number) => months.reduce((s, m) => s + f(m), 0);
  const exportCredits = sum((m) => m.exportCredits);
  const totalCredits = opts.executionCredits != null ? exportCredits + opts.executionCredits : null;
  return {
    months,
    sales: sum((m) => m.sales),
    datapoints: sum((m) => m.datapoints),
    exportMb: sum((m) => m.exportMb),
    exportCredits,
    executionCredits: opts.executionCredits,
    totalCredits,
    usd: totalCredits != null ? totalCredits * opts.usdPerCredit : null,
  };
}
