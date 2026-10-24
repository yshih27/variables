/**
 * Renaiss's limited drops: one-time packs that sell their whole run inside a
 * day. Measured Oct 14 2026: 17 weekly $100 drops from Jun 18 to Oct 9, 666 to
 * 1,000 packs each, the fastest run gone in 24 minutes. Every one opened at 09:00
 * UTC (Oct 24 2026; see openingOf).
 *
 * Per drop: its run, how long the last pack took, how many wallets bought, how
 * concentrated the buying was (kept, never published: private to Renaiss), how
 * many buyers were new to Renaiss and how many had bought an earlier drop. Renaiss sees its own pulls; this reads them as a
 * series and keeps the history, `renaiss-drops`, written by
 * scripts/warm-renaiss-drops.ts.
 *
 * ⚠️ A DROP IS INFERRED, NEVER DECLARED. Renaiss publishes no drop calendar and
 * no supply: a product is a drop when at least DROP_MIN_PACKS paid pulls all fall
 * within DROP_MAX_SPAN_MS of its first, and it is only judged once that span and
 * DROP_SETTLE_MS more have passed, so a regular machine in a lull is not mistaken
 * for one. A later read that sees a stored drop still selling removes it
 * (sellingPastSpan). "Last pack after" is when the last pull came, not a stated
 * sell-out.
 */
import { db } from "../db/client";
import { readSnapshot, writeSnapshot } from "../db/snapshots";

export const RENAISS_DROPS_SNAPSHOT_KEY = "renaiss-drops";
export const DROP_MIN_PACKS = 100;
export const DROP_MAX_SPAN_MS = 24 * 3_600_000;
/** Quiet time after the span before a drop is judged: a machine in a lull sells again inside it. */
export const DROP_SETTLE_MS = 24 * 3_600_000;
/**
 * A read counts a product only when its first pull came at least this long after
 * the read began, so the read saw a day without it. The history therefore starts
 * this long after the earliest read.
 */
export const DROP_LEAD_MS = 24 * 3_600_000;
/** An incremental run re-reads this many days: each drop is judged on several runs, so a missed batch loses nothing. */
export const DROPS_READ_DAYS = 10;
/** Top buyers whose share of a drop is kept. Never published or logged: private to Renaiss. */
export const DROP_TOP_BUYERS = 10;
/**
 * A drop opens with a burst, and its clock starts there: the opening is the
 * first paid pull followed by OPEN_BURST_PACKS − 1 more within OPEN_BURST_MS.
 * Measured Oct 24 2026: all 18 drops opened at 09:00 UTC, and on the nine from
 * Jun 18 to Aug 14 one to three packs were bought before the opening. The Jun 18
 * drop's first came 19 hours early, which had stretched its "last pack after"
 * from 1h 32m to 20h 36m.
 */
export const OPEN_BURST_PACKS = 10;
export const OPEN_BURST_MS = 5 * 60_000;

const DAY_MS = 86_400_000;

/** A paid pull, as the detection reads it (a `renaiss_pulls` checkout row). */
export type DropPull = {
  product_id: string;
  machine_name: string | null;
  buyer: string | null;
  price_usd: number | string | null;
  pulled_at: string;
};

export type DropRow = {
  productId: string;
  /** The feed's name, else "Unnamed pack · <first day>". */
  name: string;
  named: boolean;
  /** The price most of its pulls paid. */
  priceUsd: number | null;
  packs: number;
  firstAt: string;
  /** The opening (openingOf): where the clock starts. Absent on a row stored before it was measured, until the warmer fills it. */
  openAt?: string;
  lastAt: string;
  buyers: number;
  /** Kept so a later drop can tell its returning buyers; never rendered. */
  buyerWallets: string[];
  /** Never rendered or logged (the repo and its Actions logs are public). */
  topBuyersSharePct: number;
  /** Buyers whose first Renaiss pull of all was in this drop. */
  newPlayers: number;
  /** Buyers who bought an earlier drop in the history. */
  returningBuyers: number;
};

export type RenaissDrops = {
  generatedAt: string;
  /** The earliest day any run has read: drops before it are not in the history. */
  historyFrom: string;
  drops: DropRow[];
};

const shortDay = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const num = (v: number | string | null): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Paid pulls by product. */
function byProduct(pulls: DropPull[]): Map<string, DropPull[]> {
  const out = new Map<string, DropPull[]>();
  for (const p of pulls) {
    if (!p.product_id || !(num(p.price_usd)! > 0)) continue;
    const list = out.get(p.product_id) ?? [];
    list.push(p);
    out.set(p.product_id, list);
  }
  return out;
}

/**
 * First and last pull. A loop, not Math.min(...): a regular machine carries
 * hundreds of thousands of pulls, past the spread-argument limit.
 */
function bounds(list: DropPull[]): { first: number; last: number } {
  let first = Infinity;
  let last = -Infinity;
  for (const p of list) {
    const t = Date.parse(p.pulled_at);
    if (!Number.isFinite(t)) continue;
    if (t < first) first = t;
    if (t > last) last = t;
  }
  return { first, last };
}

/** The opening among `times` (ms, ascending): the first time a burst follows, else the first time; null when there are none. */
export function openingOf(times: number[]): number | null {
  if (!times.length) return null;
  for (let i = 0; i + OPEN_BURST_PACKS - 1 < times.length; i++) {
    if (times[i + OPEN_BURST_PACKS - 1] - times[i] <= OPEN_BURST_MS) return times[i];
  }
  return times[0];
}

/** A drop's paid pull times, ascending. */
function pullTimes(list: DropPull[]): number[] {
  return list.map((p) => Date.parse(p.pulled_at)).filter(Number.isFinite).sort((a, b) => a - b);
}

/**
 * The drops among `pulls` (paid checkouts, any order), judged at `nowMs`. A
 * product counts only when its first pull is at least DROP_LEAD_MS after
 * `readFromMs` (the read saw a day without it) and its span plus DROP_SETTLE_MS
 * has passed. `newPlayers` and `returningBuyers` are left at 0: scoreDrops fills
 * them against the whole history.
 */
export function detectDrops(pulls: DropPull[], readFromMs: number, nowMs: number): DropRow[] {
  const out: DropRow[] = [];
  for (const [productId, list] of byProduct(pulls)) {
    if (list.length < DROP_MIN_PACKS) continue;
    const { first, last } = bounds(list);
    if (first < readFromMs + DROP_LEAD_MS || last - first > DROP_MAX_SPAN_MS || nowMs - first < DROP_MAX_SPAN_MS + DROP_SETTLE_MS) continue;
    const named = [...list].sort((a, b) => b.pulled_at.localeCompare(a.pulled_at)).find((p) => p.machine_name?.trim());
    const prices = new Map<number, number>();
    for (const p of list) {
      const v = num(p.price_usd)!;
      prices.set(v, (prices.get(v) ?? 0) + 1);
    }
    const byBuyer = new Map<string, number>();
    for (const p of list) {
      const b = p.buyer?.toLowerCase();
      if (b) byBuyer.set(b, (byBuyer.get(b) ?? 0) + 1);
    }
    const top = [...byBuyer.values()].sort((a, b) => b - a).slice(0, DROP_TOP_BUYERS).reduce((s, n) => s + n, 0);
    out.push({
      productId,
      name: named?.machine_name?.trim() ?? `Unnamed pack · ${shortDay(first)}`,
      named: Boolean(named),
      priceUsd: [...prices.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      packs: list.length,
      firstAt: new Date(first).toISOString(),
      openAt: new Date(openingOf(pullTimes(list)) ?? first).toISOString(),
      lastAt: new Date(last).toISOString(),
      buyers: byBuyer.size,
      buyerWallets: [...byBuyer.keys()].sort(),
      topBuyersSharePct: list.length ? (100 * top) / list.length : 0,
      newPlayers: 0,
      returningBuyers: 0,
    });
  }
  return out;
}

/**
 * Products this read saw selling across more than DROP_MAX_SPAN_MS: never a
 * drop, whatever an earlier run judged. A read can only shorten a span it
 * clips, so this is proof, and scoreDrops removes their stored rows.
 */
export function sellingPastSpan(pulls: DropPull[]): Set<string> {
  const out = new Set<string>();
  for (const [productId, list] of byProduct(pulls)) {
    const { first, last } = bounds(list);
    if (last - first > DROP_MAX_SPAN_MS) out.add(productId);
  }
  return out;
}

/**
 * The history: stored drops with fresh detections replacing them by product,
 * less any product in `notDrops`, newest first, each scored against every drop
 * before it. `firstPullMs` is each wallet's first Renaiss pull of all
 * (renaiss_wallet_spend).
 */
export function scoreDrops(stored: DropRow[], fresh: DropRow[], firstPullMs: Map<string, number>, notDrops: Set<string> = new Set()): DropRow[] {
  const byId = new Map(stored.filter((d) => !notDrops.has(d.productId)).map((d) => [d.productId, d]));
  for (const d of fresh) byId.set(d.productId, d);
  const chronological = [...byId.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt));
  const seen = new Set<string>();
  const scored = chronological.map((d) => {
    const first = Date.parse(d.firstAt);
    const last = Date.parse(d.lastAt);
    let newPlayers = 0;
    let returningBuyers = 0;
    for (const w of d.buyerWallets) {
      const t = firstPullMs.get(w);
      if (t != null && t >= first && t <= last) newPlayers++;
      if (seen.has(w)) returningBuyers++;
    }
    for (const w of d.buyerWallets) seen.add(w);
    return { ...d, newPlayers, returningBuyers };
  });
  return scored.reverse();
}

/** Paid pulls in [fromMs, toMs), one UTC day per query over the `pulled_at` index. */
export async function readDropPulls(fromMs: number, toMs: number): Promise<DropPull[]> {
  const PAGE = 1000;
  const out: DropPull[] = [];
  for (let d = fromMs; d < toMs; d += DAY_MS) {
    const day = new Date(d).toISOString();
    const end = new Date(Math.min(d + DAY_MS, toMs)).toISOString();
    for (let from = 0; ; from += PAGE) {
      const page = () =>
        db()
          .from("renaiss_pulls")
          .select("product_id, machine_name, buyer, price_usd, pulled_at")
          .eq("kind", "checkout")
          .gte("pulled_at", day)
          .lt("pulled_at", end)
          .order("pull_id", { ascending: true })
          .range(from, from + PAGE - 1);
      // A busy day's page can fail transiently (measured Oct 14: one empty error
      // on a drop day); three retries, then the run fails loudly.
      let { data, error } = await page();
      for (let attempt = 1; error && attempt <= 3; attempt++) {
        await new Promise((r) => setTimeout(r, attempt * 3_000));
        ({ data, error } = await page());
      }
      if (error) throw new Error(`[renaiss_pulls] drops read failed (${day.slice(0, 10)}, row ${from}): ${error.message ?? error.code ?? JSON.stringify(error)}`);
      const rows = (data ?? []) as DropPull[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/**
 * The opening of a stored drop, read from its own paid pulls (one product, its
 * first-to-last window over the `pulled_at` index): for rows stored before the
 * opening was measured.
 */
export async function readDropOpening(d: Pick<DropRow, "productId" | "firstAt" | "lastAt">): Promise<string> {
  const PAGE = 1000;
  const rows: DropPull[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("renaiss_pulls")
      .select("product_id, machine_name, buyer, price_usd, pulled_at")
      .eq("kind", "checkout")
      .eq("product_id", d.productId)
      .gte("pulled_at", d.firstAt)
      .lte("pulled_at", d.lastAt)
      .order("pull_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`[renaiss_pulls] opening read failed (${d.firstAt.slice(0, 10)}): ${error.message}`);
    const page = (data ?? []) as DropPull[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  const opening = openingOf(pullTimes(rows.filter((p) => (num(p.price_usd) ?? 0) > 0)));
  return new Date(opening ?? Date.parse(d.firstAt)).toISOString();
}

export function readRenaissDrops(): Promise<RenaissDrops | null> {
  return readSnapshot<RenaissDrops>(RENAISS_DROPS_SNAPSHOT_KEY);
}

export function writeRenaissDrops(snap: RenaissDrops): Promise<void> {
  return writeSnapshot(RENAISS_DROPS_SNAPSHOT_KEY, snap, snap.generatedAt);
}
