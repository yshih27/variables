/**
 * The `--shadow-venues` report (brief-backend-index-every-venue B2): the SAME
 * index built on two panels — today's legs (30-day windows + Beezie live) and
 * the `secondary_sales` store (every venue's history) — differenced per entity
 * per month. Pure over the two builds, so the test drives it without I/O.
 *
 * Per month: the step and level old → new, identities in the step old → new,
 * identities BY VENUE old → new, the hold (if the month was withheld) old →
 * new, and the thin flag. Per entity: the months that gained or lost
 * publication, the holds that appear or clear, the thin flags that clear, and
 * — the acceptance check — every month whose step now rests on FEWER
 * identities than it did.
 */
import type { IndexPoint } from "./indices";
import type { IndexHold } from "./identityIndex";

export type VenueCounts = Record<string, number>;

export type VenueMonthDiff = {
  /** "2026-08" */
  month: string;
  stepBefore: number | null;
  stepAfter: number | null;
  levelBefore: number | null;
  levelAfter: number | null;
  identitiesBefore: number | null;
  identitiesAfter: number | null;
  /** Identities by venue in the step's sample; null when the month did not publish. */
  venuesBefore: VenueCounts | null;
  venuesAfter: VenueCounts | null;
  /** The gate that withheld the month, when it was withheld. */
  holdBefore: IndexHold["reason"] | null;
  holdAfter: IndexHold["reason"] | null;
  thinBefore: boolean;
  thinAfter: boolean;
};

export type VenueEntityDiff = {
  id: string;
  baseBefore: string | null;
  baseAfter: string | null;
  months: VenueMonthDiff[];
  monthsGained: string[];
  monthsLost: string[];
  holdsAppear: string[];
  holdsClear: string[];
  thinCleared: string[];
  thinAppeared: string[];
  /**
   * Months whose STEP rests on fewer identities now (both builds have a step
   * into the month): the acceptance check, must be empty.
   */
  fewerIdentities: string[];
  /**
   * A series' first point has no step: its n is the identities priced in the
   * base month. A change there moves no level and is reported apart.
   */
  baseIdentitiesChanged: string[];
};

type Built = { points: IndexPoint[]; holds: IndexHold[] };

const ym = (ts: string) => ts.slice(0, 7);

function venueCounts(p: IndexPoint | undefined): VenueCounts | null {
  if (!p?.venues) return null;
  return Object.fromEntries(Object.entries(p.venues.byVenue).map(([v, x]) => [v, x.identities]));
}

export function diffVenues(id: string, before: Built, after: Built): VenueEntityDiff {
  const step = (pts: IndexPoint[]) => {
    const m = new Map<string, { p: IndexPoint; step: number | null }>();
    pts.forEach((p, i) => {
      const prev = i > 0 ? pts[i - 1] : null;
      m.set(ym(p.ts), { p, step: prev && prev.value > 0 ? (p.value / prev.value - 1) * 100 : null });
    });
    return m;
  };
  const b = step(before.points);
  const a = step(after.points);
  const hb = new Map(before.holds.map((h) => [ym(h.ts), h.reason]));
  const ha = new Map(after.holds.map((h) => [ym(h.ts), h.reason]));
  const monthKeys = [...new Set([...b.keys(), ...a.keys(), ...hb.keys(), ...ha.keys()])].sort();
  const months: VenueMonthDiff[] = monthKeys.map((m) => {
    const x = b.get(m);
    const y = a.get(m);
    return {
      month: m,
      stepBefore: x?.step ?? null,
      stepAfter: y?.step ?? null,
      levelBefore: x?.p.value ?? null,
      levelAfter: y?.p.value ?? null,
      identitiesBefore: x?.p.n ?? null,
      identitiesAfter: y?.p.n ?? null,
      venuesBefore: venueCounts(x?.p),
      venuesAfter: venueCounts(y?.p),
      holdBefore: hb.get(m) ?? null,
      holdAfter: ha.get(m) ?? null,
      thinBefore: x?.p.thin === true,
      thinAfter: y?.p.thin === true,
    };
  });
  const pub = (d: VenueMonthDiff, side: "Before" | "After") => d[`level${side}`] != null;
  return {
    id,
    baseBefore: before.points[0]?.ts ?? null,
    baseAfter: after.points[0]?.ts ?? null,
    months,
    monthsGained: months.filter((d) => pub(d, "After") && !pub(d, "Before")).map((d) => d.month),
    monthsLost: months.filter((d) => pub(d, "Before") && !pub(d, "After")).map((d) => d.month),
    holdsAppear: months.filter((d) => d.holdAfter && d.holdAfter !== d.holdBefore).map((d) => `${d.month} ${d.holdAfter}`),
    holdsClear: months.filter((d) => d.holdBefore && d.holdBefore !== d.holdAfter).map((d) => `${d.month} ${d.holdBefore}`),
    thinCleared: months.filter((d) => d.thinBefore && pub(d, "After") && !d.thinAfter).map((d) => d.month),
    thinAppeared: months.filter((d) => d.thinAfter && pub(d, "Before") && !d.thinBefore).map((d) => d.month),
    fewerIdentities: months
      .filter((d) => d.stepBefore != null && d.stepAfter != null && d.identitiesBefore != null && d.identitiesAfter != null && d.identitiesAfter < d.identitiesBefore)
      .map((d) => `${d.month} ${d.identitiesBefore} → ${d.identitiesAfter}`),
    baseIdentitiesChanged: months
      .filter((d) => (d.stepBefore == null || d.stepAfter == null) && d.identitiesBefore != null && d.identitiesAfter != null && d.identitiesAfter !== d.identitiesBefore)
      .map((d) => `${d.month} ${d.identitiesBefore} → ${d.identitiesAfter}`),
  };
}

/**
 * The next method version after every one the ledger holds (and the blob's
 * own): "v4.2" → "v4.3". The shadow build writes its ledger record under it, so
 * the version is the next one AT THE TIME THE SHADOW RUNS — run it at merge.
 */
export function nextMethodVersion(versions: string[]): string {
  let best: [number, number] = [0, 0];
  for (const v of versions) {
    const m = /^v(\d+)\.(\d+)$/.exec(v);
    if (!m) continue;
    const cur: [number, number] = [Number(m[1]), Number(m[2])];
    if (cur[0] > best[0] || (cur[0] === best[0] && cur[1] > best[1])) best = cur;
  }
  return `v${best[0]}.${best[1] + 1}`;
}

// ── The Markdown the PR body carries ─────────────────────────────────────────

const fl = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const fp = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
const fv = (c: VenueCounts | null) =>
  c
    ? Object.entries(c)
        .sort((x, y) => y[1] - x[1])
        .map(([v, n]) => `${v} ${n}`)
        .join(" · ")
    : "—";

/** One entity, every month either build has a point or a hold for. */
export function venuesTable(d: VenueEntityDiff): string {
  const lines = [
    `| month | step old → new | level old → new | identities old → new | by venue, old | by venue, new | hold old → new | thin |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- |`,
  ];
  for (const m of d.months) {
    lines.push(
      `| ${m.month} | ${fp(m.stepBefore)} → ${fp(m.stepAfter)} | ${fl(m.levelBefore)} → ${fl(m.levelAfter)} | ${m.identitiesBefore ?? "—"} → ${m.identitiesAfter ?? "—"} | ` +
        `${fv(m.venuesBefore)} | ${fv(m.venuesAfter)} | ${m.holdBefore ?? "—"} → ${m.holdAfter ?? "—"} | ${m.thinBefore ? "thin" : "—"} → ${m.thinAfter ? "thin" : "—"} |`,
    );
  }
  return lines.join("\n");
}
