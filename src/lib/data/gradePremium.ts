/**
 * GRADE PREMIUM — what a grade costs relative to the next one, over time.
 *
 * ⚠️ THE ONE RULE: a premium is ALWAYS a within-identity ratio, never two index
 * levels divided. Dividing the PSA 10 index by the PSA 9 index answers "how did
 * two different baskets of cards move", and those baskets differ by set, era and
 * price tier — the ratio would move when the MIX moved, which is the exact error
 * the identity index was built to remove. Here, a month's premium is the
 * weighted median over cards that sold in BOTH grades that month: same set, same
 * number, same name, same edition, same language. Whatever the card is, it is the
 * same card on both sides of the ratio.
 *
 * VALUES ARE RATIOS, NOT INDEX LEVELS. 2.4 means the better grade fetched 2.4x
 * the other one that month; 1.0 is parity. They are deliberately NOT rebased to
 * 100 — the level of a premium is the finding ("a PSA 10 costs 2.4x a PSA 9"),
 * so rebasing it away would throw out the number the page exists to show.
 * `n` is the count of MATCHED identities behind the month.
 */
import type { IndexPoint } from "./indices";
import type { SaleRow } from "./salePanel";
import { parseGradeLabel } from "../card/grade";
// The estimator is the index's own interpolated weighted median — one
// implementation, so a premium can never snap to one matched card either.
import { GRAINS, MIN_SALES_PER_IDENTITY, weightedMedian, type Grain } from "./identityIndex";

/** Matched identities below which a month is withheld, never interpolated. */
export const MIN_MATCHED_IDENTITIES = 5;

/**
 * Pseudo-grades. "graded" is any label a grader parsed out of; "raw" is
 * Ungraded. They let the graded-vs-raw pair use the same machinery as PSA 10 vs
 * PSA 9 without a second code path.
 */
export type GradeSelector = string; // canonical label ("PSA 10"), or "graded" / "raw"

/** Canonical grade label for a sale: "PSA 10" (folding "PSA 10.0"), or "Ungraded". */
export function canonicalGrade(raw: string | null | undefined): string {
  const p = parseGradeLabel(raw);
  if (p) return p.label; // BECKETT→BGS and "10.0"→"10" fold here (grade.ts SSOT)
  return raw && raw.trim() ? raw.trim() : "Ungraded";
}

function matchesSelector(canon: string, sel: GradeSelector): boolean {
  if (sel === "graded") return canon !== "Ungraded" && parseGradeLabel(canon) != null;
  if (sel === "raw") return canon === "Ungraded";
  return canon === sel;
}

/**
 * The identity MINUS its grade — the join key for a premium. Mirrors
 * `identityKey` field for field (ip | set | number | name | edition | language)
 * so a premium's "same card" means exactly what the index's does.
 */
export function baseIdentityKey(identity: string | null): string | null {
  if (!identity) return null;
  const f = identity.split("|");
  if (f.length < 7) return null;
  const [ip, set, number, name, , edition, language] = f;
  return [ip, set, number, name, edition, language].join("|");
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type PremiumOptions = {
  grain?: Grain;
  /** Sales of ONE grade of ONE card in a month, below which it is not a price.
   *  Defaults to the index's own rule; 1 is available because requiring two
   *  sales of BOTH grades of the SAME card in the SAME month is very thin. */
  minSales?: number;
  minMatched?: number;
  nowMs?: number;
};

/**
 * Monthly ratio series for one grade pair. Empty when no month clears
 * `minMatched`; a thin month is dropped, never filled in.
 */
export function gradePremiumSeries(
  sales: SaleRow[],
  better: GradeSelector,
  worse: GradeSelector,
  opts: PremiumOptions = {},
): IndexPoint[] {
  const grain = opts.grain ?? "month";
  const G = GRAINS[grain];
  const minSales = opts.minSales ?? MIN_SALES_PER_IDENTITY;
  const minMatched = opts.minMatched ?? MIN_MATCHED_IDENTITIES;

  // period → base identity → side → prices
  const buckets = new Map<string, Map<string, { a: number[]; b: number[] }>>();
  for (const s of sales) {
    if (!(s.priceUsd > 0)) continue;
    const base = baseIdentityKey(s.identity);
    if (!base) continue;
    const t = Date.parse(s.ts);
    if (!Number.isFinite(t)) continue;
    const canon = canonicalGrade(s.grade);
    const isA = matchesSelector(canon, better);
    const isB = matchesSelector(canon, worse);
    if (!isA && !isB) continue;
    const p = G.start(t);
    let byBase = buckets.get(p);
    if (!byBase) buckets.set(p, (byBase = new Map()));
    let e = byBase.get(base);
    if (!e) byBase.set(base, (e = { a: [], b: [] }));
    if (isA) e.a.push(s.priceUsd);
    else e.b.push(s.priceUsd);
  }

  const runningIdx = G.index(G.start(opts.nowMs ?? Date.now()));
  const out: IndexPoint[] = [];
  for (const period of [...buckets.keys()].sort()) {
    if (G.index(period) >= runningIdx) continue; // never the in-progress period
    const obs: { v: number; w: number }[] = [];
    for (const e of buckets.get(period)!.values()) {
      if (e.a.length < minSales || e.b.length < minSales) continue;
      const pa = median(e.a), pb = median(e.b);
      if (!(pa > 0) || !(pb > 0)) continue;
      obs.push({ v: Math.log(pa / pb), w: Math.min(e.a.length, e.b.length) });
    }
    if (obs.length < minMatched) continue;
    const ratio = Math.exp(weightedMedian(obs));
    // Band from the spread of the matched ratios themselves — with n this small
    // a bootstrap would be reporting the same few numbers back.
    const sorted = obs.map((o) => o.v).sort((x, y) => x - y);
    const lo = Math.exp(sorted[Math.floor((sorted.length - 1) * 0.25)]);
    const hi = Math.exp(sorted[Math.ceil((sorted.length - 1) * 0.75)]);
    out.push({ ts: G.end(Date.parse(period)), value: ratio, n: obs.length, lo, hi });
  }
  return out;
}

/** The pairs the site publishes. `id` is the blob key: `premium:<a>:<b>`. */
export const PREMIUM_PAIRS: { id: string; better: GradeSelector; worse: GradeSelector; label: string }[] = [
  { id: "premium:psa-10:psa-9", better: "PSA 10", worse: "PSA 9", label: "PSA 10 / PSA 9" },
  { id: "premium:cgc-10:psa-10", better: "CGC 10", worse: "PSA 10", label: "CGC 10 / PSA 10" },
  { id: "premium:psa-9:psa-8", better: "PSA 9", worse: "PSA 8", label: "PSA 9 / PSA 8" },
  { id: "premium:graded:raw", better: "graded", worse: "raw", label: "Graded / raw" },
];
