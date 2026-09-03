/**
 * Calendar-period math for the D | W | M toggles (P1-B) — ONE implementation,
 * shared by the server and by the two client components that aggregate in the
 * browser (IndexStudio, MetricBarCard).
 *
 * ⚠️ WHY IT LIVES HERE and not in `lib/data/indices.ts` beside `resampleWeekly`:
 * indices.ts imports the snapshot readers, so importing a VALUE from it inside a
 * client component would pull the DB client into the browser bundle. The week
 * helpers and the resamplers moved down here (pure, no I/O, no imports), and
 * `priceIndex.ts` / `indices.ts` re-export them — so every existing server import
 * keeps working and there is still exactly one implementation of each rule.
 *
 * Stamping convention, unchanged from the week-end work (PR #44): a period's
 * point is stamped at the period's LAST day, so a value computed from Mon–Sun IS
 * the value as of that Sunday, and a month's value is as of the last of the
 * month. Bucketing still keys off the period START.
 */

/** The three aggregation grains a chart can be read at. */
export type Period = "D" | "W" | "M";

/**
 * How a series collapses within a period:
 *   sum  — a FLOW (volume, trades, cards traded, gacha rips, buyback). Flows add.
 *   last — a LEVEL (market cap, holders, floor, an index). Summing seven daily
 *          holder counts is meaningless; the period's reading is its close.
 */
export type PeriodAgg = "sum" | "last";

const DAY_MS = 86_400_000;

/** Monday-anchored UTC week start (ISO week). The week IDENTITY — used to bucket. */
export function weekStartUtc(ms: number): string {
  const d = new Date(ms);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString();
}

/** Sunday-anchored UTC week END (week start + 6d). The week's point STAMP. */
export function weekEndUtc(ms: number): string {
  const d = new Date(Date.parse(weekStartUtc(ms)));
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 6)).toISOString();
}

/** First-of-month UTC. The month IDENTITY — used to bucket. */
export function monthStartUtc(ms: number): string {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** Last-of-month UTC (day 0 of the NEXT month). The month's point STAMP. */
export function monthEndUtc(ms: number): string {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString();
}

/** Calendar days in the UTC month containing `ms`. */
export function daysInMonthUtc(ms: number): number {
  return new Date(Date.parse(monthEndUtc(ms))).getUTCDate();
}

type Pt = { ts: string; value: number };

/**
 * Collapse `points` into buckets keyed by `keyOf`, stamped by `stampOf`.
 *
 * `dropPartialLead` refuses the FIRST bucket when the series begins part-way
 * through it — a 5-day stub summed and drawn as a whole week understates by 30%
 * and there is no future write that will ever fill it in.
 *
 * ⚠️ Only the LEAD, never the tail. The obvious generalisation — demand every
 * bucket cover its whole calendar span — collides head-on with the INV-8
 * source-completeness gate applied server-side: that gate deliberately truncates
 * the newest day or two, so a strict check reads its own upstream gate as "this
 * month is incomplete" and throws the whole month away. Measured on the live
 * spine: cards_traded's August had 30 of 31 days, the missing one being exactly
 * the day dropIncompleteTail had removed, and the strict rule silently deleted
 * August from every M card. The tail is the calendar gates' job
 * (completeWeeksOnly / completeMonthsOnly); this is the lead's.
 */
function bucket(
  points: Pt[],
  agg: PeriodAgg,
  keyOf: (ms: number) => string,
  stampOf: (ms: number) => string,
  dropPartialLead?: boolean,
): Pt[] {
  const acc = new Map<string, { sum: number; last: number; lastTs: string }>();
  let firstDayMs = Infinity;
  for (const p of points) {
    const t = Date.parse(p.ts);
    if (!Number.isFinite(t) || !Number.isFinite(p.value)) continue;
    firstDayMs = Math.min(firstDayMs, Math.floor(t / DAY_MS) * DAY_MS);
    const k = keyOf(t);
    const cur = acc.get(k);
    if (!cur) acc.set(k, { sum: p.value, last: p.value, lastTs: p.ts });
    else {
      cur.sum += p.value;
      // Last BY TIMESTAMP, not by array position — the input need not be sorted.
      if (p.ts >= cur.lastTs) {
        cur.last = p.value;
        cur.lastTs = p.ts;
      }
    }
  }
  const keys = [...acc.keys()].sort();
  // The lead bucket starts before the series does → it can only ever be a stub.
  if (dropPartialLead && keys.length && Date.parse(keys[0]) < firstDayMs) keys.shift();
  return keys.map((k) => {
    const v = acc.get(k)!;
    return { ts: stampOf(Date.parse(k)), value: agg === "sum" ? v.sum : v.last };
  });
}

/**
 * Daily → ISO-weekly, stamped at the week END (Sunday). The canonical
 * implementation — the /api/v1 + /api/internal chart routes, the benchmarks
 * reader and the studio all come through here.
 */
export function resampleWeekly(points: Pt[], agg: PeriodAgg = "last", dropPartialLead = false): Pt[] {
  return bucket(points, agg, weekStartUtc, weekEndUtc, dropPartialLead);
}

/** Daily → calendar-monthly (UTC), stamped at the month END. The monthly sibling. */
export function resampleMonthly(points: Pt[], agg: PeriodAgg = "last", dropPartialLead = false): Pt[] {
  return bucket(points, agg, monthStartUtc, monthEndUtc, dropPartialLead);
}

/**
 * Drop the RUNNING (partial) week. Points are stamped at the week END, so a
 * complete week's Sunday falls BEFORE the running week's Monday (kept) while the
 * running week's Sunday falls after it (dropped) — the same weeks are selected
 * regardless of start-vs-end stamping.
 */
export function completeWeeksOnly<T extends { ts: string }>(series: T[], nowMs: number = Date.now()): T[] {
  const cutoff = Date.parse(weekStartUtc(nowMs));
  return series.filter((p) => {
    const t = Date.parse(p.ts);
    return Number.isFinite(t) && t < cutoff;
  });
}

/** Drop the RUNNING calendar month, by the same argument as completeWeeksOnly. */
export function completeMonthsOnly<T extends { ts: string }>(series: T[], nowMs: number = Date.now()): T[] {
  const cutoff = Date.parse(monthStartUtc(nowMs));
  return series.filter((p) => {
    const t = Date.parse(p.ts);
    return Number.isFinite(t) && t < cutoff;
  });
}

/**
 * The single entry point both toggles call: aggregate a DAILY series to `period`,
 * keeping COMPLETE periods only.
 *
 * `weekly` marks a source that is ALREADY weekly (the price indices — V-MKT and
 * the IP indices, which are stratified-median weekly and cannot be shown daily).
 * It changes one thing: under M its running partial week is dropped BEFORE the
 * monthly roll-up, so a month closes on its last COMPLETE week. Doing that to a
 * daily series would be a bug — this week's Monday and Tuesday belong to last
 * month whenever the week straddles the boundary, and dropping them would silently
 * shorten that month's sum.
 *
 * `dropPartialLead` additionally refuses a first bucket the series only partly
 * covers. Flows only — a level's first reading IS that period's close, however
 * few days preceded it.
 */
export function resampleToPeriod(
  points: Pt[],
  period: Period,
  agg: PeriodAgg,
  opts: { weekly?: boolean; dropPartialLead?: boolean; nowMs?: number } = {},
): Pt[] {
  const nowMs = opts.nowMs ?? Date.now();
  // A source that is already weekly can't be made denser; D shows it as it is,
  // which is what the "weekly" tag beside it has always said.
  if (period === "D") return points;
  // Meaningless for an already-weekly source: its one point per week IS the week,
  // not a fraction of one.
  const dropLead = !!opts.dropPartialLead && !opts.weekly;
  if (period === "W") return completeWeeksOnly(resampleWeekly(points, agg, dropLead), nowMs);
  const base = opts.weekly ? completeWeeksOnly(points, nowMs) : points;
  return completeMonthsOnly(resampleMonthly(base, agg, dropLead), nowMs);
}

/** Label for a period's grain, used in captions ("14d total", "12w total"). */
export const PERIOD_UNIT: Record<Period, { one: string; many: string; short: string }> = {
  D: { one: "day", many: "days", short: "d" },
  W: { one: "week", many: "weeks", short: "w" },
  M: { one: "month", many: "months", short: "m" },
};

/** Bucket index for a timestamp at this grain — the slot arithmetic a plot lays
 *  its points into (adjacent buckets differ by exactly 1 at every grain). */
export function periodIndex(ts: string, period: Period): number {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return NaN;
  if (period === "D") return Math.floor(t / DAY_MS);
  if (period === "W") return Math.floor(Date.parse(weekStartUtc(t)) / (7 * DAY_MS));
  const d = new Date(t);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** Keep the last `n` PERIODS of a series, counted on the calendar (not on point
 *  count) so a sparse series can't make an "12W" window span 20 weeks. */
export function lastNPeriods<T extends { ts: string }>(series: T[], n: number, period: Period): T[] {
  if (!series.length || n < 1) return series;
  const end = periodIndex(series[series.length - 1].ts, period);
  if (!Number.isFinite(end)) return series;
  const cutoff = end - (n - 1);
  return series.filter((p) => periodIndex(p.ts, period) >= cutoff);
}
