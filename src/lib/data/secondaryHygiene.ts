/**
 * Secondary-sale hygiene (D10-1) — the belt-and-suspenders that every row-level
 * secondary feed passes through before it reaches volume / trending / the spine /
 * the price index. Three passes, in order:
 *
 *   1. NATURAL-KEY DEDUPE — the Dune feeds expose no tx signature, so we dedupe on
 *      (tokenId, ts, buyer, seller, priceUsd). On today's data this drops 0 (the
 *      feeds are not duplicating — verified on-chain: the CC "506-row" token has
 *      1,088 real transactions, so its rows are a subset, not a fan-out). It's the
 *      guard against a FUTURE Dune SQL fan-out (a row-multiplying JOIN), which is
 *      exactly the failure mode D10-1 feared — it would surface as identical rows.
 *
 *   2. SELF-TRADE DROP — buyer === seller. Pure wash; a card "sold" to yourself.
 *      (The sale panel already did this; doing it here cleans core-volume + the
 *      spine too, which read the feed directly and previously did not.)
 *
 *   3. RING-WASH DROP — the real D10-1 finding. Two tokens (Bulbasaur 506 rows,
 *      Zamazenta 400) were being churned by small wallet rings: the SAME card
 *      ping-ponging between two wallets every ~25s at a fixed ~$2.88, hundreds of
 *      times. Not duplication — real transactions, but manipulation that inflates
 *      trade counts / momentum / hunt-pressure (and trade-weights in price-index
 *      cells) while barely moving volume. We drop a trade when its unordered wallet
 *      pair traded that token in BOTH directions at least `minRoundTrips` times each
 *      way. Threshold 2 (a 4+-trade bounce) was chosen from the data: on CC it
 *      catches 100% of the rings regardless of threshold (they do hundreds of
 *      trips); on Courtyard it separates systematic churn (0.57% of volume) from
 *      one-off A→B→A resales (which at threshold 1 would wrongly cost 3.1% of real
 *      volume). Conservative by design — data correctness cuts both ways: we must
 *      not silently drop real trades either.
 */
import type { NormalizedSale } from "../rarible/queries";

/** Min round-trips (each direction) between a wallet pair on one token to call it wash. */
export const WASH_MIN_ROUND_TRIPS = 2;

/**
 * One-directional BULK SWEEP thresholds (M9). The ring rule above needs BOTH
 * directions, so a one-way batch sailed through and topped trending: 10 sales from
 * ONE seller→buyer pair, 10 different tokens, all at an IDENTICAL $313.60, inside
 * the same instant. That's one negotiated batch, not 10 acts of price discovery.
 *
 * Deliberately NARROW — the same feed's biggest one-directional pairs are organic
 * (one pair moved 138 cards across 97 DIFFERENT prices over 26 days; another sold
 * 5 cards at one price but spread over 5 days). Requiring identical price AND a
 * tight window spares those and catches only the batch.
 *
 * ⚠️ The PRICE FLOOR is what keeps this from over-filtering, and it is load-bearing.
 * Count/window alone cannot separate the two feeds: Courtyard's normal mode IS
 * same-instant identical-price batching of commodity cards (~$10-13), so even at a
 * 1-minute window it flagged ~5% of its rows. Measured on the live feeds, the floor
 * collapses that to noise while leaving the CC abuse fully caught:
 *   floor $0  → Courtyard 5,423 rows (5.17% of vol) · CC 118
 *   floor $25 → Courtyard     6 rows (0.06% of vol) · CC  87   ← chosen
 * Rationale: a batch of sub-$25 cards is dealer/bulk commodity flow; a batch of
 * DISTINCT cards changing hands at an IDENTICAL price above that, in one instant,
 * is a negotiated block, not price discovery.
 */
export const SWEEP_MIN_SALES = 5;
export const SWEEP_WINDOW_MS = 60 * 60 * 1000; // 1h
export const SWEEP_MIN_PRICE_USD = 25;

export type HygieneStats = {
  input: number;
  dupeDropped: number;
  selfTradeDropped: number;
  washDropped: number;
  /** One-directional identical-price bulk sweeps (M9). */
  sweepDropped: number;
  /** USD volume removed by the self-trade + wash + sweep passes (dedupe removes none). */
  washVolumeUsd: number;
  output: number;
  /** Distinct tokens that had ≥1 wash/sweep trade removed — the manipulated cards. */
  washTokens: number;
};

function naturalKey(s: NormalizedSale): string {
  return `${s.tokenId}|${s.date}|${s.buyer}|${s.seller}|${s.priceUsd}`;
}

/**
 * Clean a row-level secondary-sale feed. Pure + deterministic (no clock, no I/O) —
 * order-preserving on the kept rows. Returns the cleaned list plus drop stats so
 * the caller can log an honest provenance line.
 */
export function cleanSecondarySales(
  sales: NormalizedSale[],
  opts: {
    minRoundTrips?: number;
    minSweepSales?: number;
    sweepWindowMs?: number;
    minSweepPriceUsd?: number;
  } = {},
): { sales: NormalizedSale[]; stats: HygieneStats } {
  const minTrips = opts.minRoundTrips ?? WASH_MIN_ROUND_TRIPS;
  const input = sales.length;

  // ── Pass 1: natural-key dedupe (fan-out guard) ──
  const seen = new Set<string>();
  const deduped: NormalizedSale[] = [];
  for (const s of sales) {
    const k = naturalKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(s);
  }
  const dupeDropped = input - deduped.length;

  // ── Pass 3 precompute: per-token directed trade counts (over the deduped set,
  //    self-trades excluded from the direction tally so a self-trade can't look
  //    like a round-trip against a real counterparty). ──
  const byTokenDir = new Map<string, Map<string, number>>(); // tokenId → "seller>buyer" → count
  for (const s of deduped) {
    if (!s.buyer || !s.seller || s.buyer === s.seller) continue;
    let dir = byTokenDir.get(s.tokenId);
    if (!dir) { dir = new Map(); byTokenDir.set(s.tokenId, dir); }
    const key = `${s.seller}>${s.buyer}`;
    dir.set(key, (dir.get(key) ?? 0) + 1);
  }

  // ── Passes 2 + 3: drop self-trades and ring-wash ──
  const kept: NormalizedSale[] = [];
  let selfTradeDropped = 0;
  let washDropped = 0;
  let washVolumeUsd = 0;
  const washTokenSet = new Set<string>();
  for (const s of deduped) {
    if (s.buyer && s.seller && s.buyer === s.seller) {
      selfTradeDropped += 1;
      washVolumeUsd += s.priceUsd;
      continue;
    }
    const dir = byTokenDir.get(s.tokenId);
    if (dir && s.buyer && s.seller) {
      const fwd = dir.get(`${s.seller}>${s.buyer}`) ?? 0;
      const rev = dir.get(`${s.buyer}>${s.seller}`) ?? 0;
      if (Math.min(fwd, rev) >= minTrips) {
        washDropped += 1;
        washVolumeUsd += s.priceUsd;
        washTokenSet.add(s.tokenId);
        continue;
      }
    }
    kept.push(s);
  }

  // ── Pass 4: one-directional identical-price bulk sweeps (M9) ──
  const sweepMask = sweepMaskOf(
    kept,
    opts.minSweepSales ?? SWEEP_MIN_SALES,
    opts.sweepWindowMs ?? SWEEP_WINDOW_MS,
    opts.minSweepPriceUsd ?? SWEEP_MIN_PRICE_USD,
  );
  const final: NormalizedSale[] = [];
  let sweepDropped = 0;
  for (let i = 0; i < kept.length; i++) {
    if (sweepMask[i]) {
      sweepDropped += 1;
      washVolumeUsd += kept[i].priceUsd;
      washTokenSet.add(kept[i].tokenId);
      continue;
    }
    final.push(kept[i]);
  }

  return {
    sales: final,
    stats: {
      input,
      dupeDropped,
      selfTradeDropped,
      washDropped,
      sweepDropped,
      washVolumeUsd,
      output: final.length,
      washTokens: washTokenSet.size,
    },
  };
}

/**
 * Mark sales belonging to a one-directional bulk sweep: same (seller→buyer) pair,
 * IDENTICAL price (to the cent), `minSales`+ of them inside `windowMs`. A sliding
 * window over each (pair, price) group flags every sale in a qualifying cluster, so
 * a long organic run at one price only trips where it actually bunches.
 */
function sweepMaskOf(
  sales: NormalizedSale[],
  minSales: number,
  windowMs: number,
  minPrice: number,
): boolean[] {
  const mask = new Array<boolean>(sales.length).fill(false);
  // group indices by directed pair + exact price (dust is exempt — see the floor note)
  const groups = new Map<string, number[]>();
  sales.forEach((s, i) => {
    if (!s.buyer || !s.seller || s.buyer === s.seller || s.priceUsd < minPrice) return;
    const k = `${s.seller}>${s.buyer}|${s.priceUsd.toFixed(2)}`;
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });

  for (const idxs of groups.values()) {
    if (idxs.length < minSales) continue;
    const sorted = idxs
      .map((i) => ({ i, t: Date.parse(sales[i].date) }))
      .filter((x) => Number.isFinite(x.t))
      .sort((a, b) => a.t - b.t);
    let lo = 0;
    for (let hi = 0; hi < sorted.length; hi++) {
      while (sorted[hi].t - sorted[lo].t > windowMs) lo += 1;
      if (hi - lo + 1 >= minSales) {
        for (let k = lo; k <= hi; k++) mask[sorted[k].i] = true;
      }
    }
  }
  return mask;
}

/** Format a hygiene-stats line for warmer logs. Returns null when nothing was dropped. */
export function formatHygiene(label: string, s: HygieneStats): string | null {
  const removed = s.dupeDropped + s.selfTradeDropped + s.washDropped + s.sweepDropped;
  if (removed === 0) return null;
  return (
    `  ⚠ ${label} hygiene: -${removed} of ${s.input} rows ` +
    `(dupe ${s.dupeDropped}, self ${s.selfTradeDropped}, wash ${s.washDropped}, sweep ${s.sweepDropped}` +
    ` across ${s.washTokens} tokens, $${Math.round(s.washVolumeUsd).toLocaleString()} vol) → ${s.output} clean`
  );
}
