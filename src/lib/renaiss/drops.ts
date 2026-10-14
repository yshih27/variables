/**
 * Renaiss's limited drops: one-time packs that sell their whole run inside a
 * day. Measured Oct 14 2026: eight $100 drops since Aug 21, released at 09:00
 * UTC, 666 to 1,000 packs each, the fastest run gone in 23 minutes.
 *
 * Per drop: its run, how long the last pack took, how many wallets bought, how
 * concentrated the buying was, how many buyers were new to Renaiss and how many
 * had bought an earlier drop. Renaiss sees its own pulls; this reads them as a
 * series and keeps the history, `renaiss-drops`, written by
 * scripts/warm-renaiss-drops.ts.
 *
 * ⚠️ A DROP IS INFERRED, NEVER DECLARED. Renaiss publishes no drop calendar and
 * no supply: a product is a drop when at least DROP_MIN_PACKS paid pulls all fall
 * within DROP_MAX_SPAN_MS of its first, and it is only judged once that span has
 * passed, so a regular machine launched today is never mistaken for one. "Last
 * pack after" is when the last pull came, not a stated sell-out.
 */
import { db } from "../db/client";
import { readSnapshot, writeSnapshot } from "../db/snapshots";

export const RENAISS_DROPS_SNAPSHOT_KEY = "renaiss-drops";
export const DROP_MIN_PACKS = 100;
export const DROP_MAX_SPAN_MS = 24 * 3_600_000;
/** An incremental run re-reads this many days: a drop finishes inside one. */
export const DROPS_READ_DAYS = 10;
/** Top buyers whose share of a drop is published. */
export const DROP_TOP_BUYERS = 10;

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
  lastAt: string;
  buyers: number;
  /** Kept so a later drop can tell its returning buyers; never rendered. */
  buyerWallets: string[];
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

/**
 * The drops among `pulls` (paid checkouts, any order), judged at `nowMs`. A
 * product counts only when its first pull is at least a day after `readFromMs`
 * (its start was read, so it did not begin before the window) and its span has
 * fully passed. `newPlayers` and `returningBuyers` are left at 0: scoreDrops
 * fills them against the whole history.
 */
export function detectDrops(pulls: DropPull[], readFromMs: number, nowMs: number): DropRow[] {
  const byProduct = new Map<string, DropPull[]>();
  for (const p of pulls) {
    if (!p.product_id || !(num(p.price_usd)! > 0)) continue;
    const list = byProduct.get(p.product_id) ?? [];
    list.push(p);
    byProduct.set(p.product_id, list);
  }
  const out: DropRow[] = [];
  for (const [productId, list] of byProduct) {
    if (list.length < DROP_MIN_PACKS) continue;
    // A loop, not Math.min(...): a regular machine carries hundreds of thousands
    // of pulls, past the spread-argument limit.
    let first = Infinity;
    let last = -Infinity;
    for (const p of list) {
      const t = Date.parse(p.pulled_at);
      if (!Number.isFinite(t)) continue;
      if (t < first) first = t;
      if (t > last) last = t;
    }
    if (first < readFromMs + DAY_MS || last - first > DROP_MAX_SPAN_MS || nowMs - first < DROP_MAX_SPAN_MS) continue;
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
 * The history: stored drops with fresh detections replacing them by product,
 * newest first, each scored against every drop before it. `firstPullMs` is each
 * wallet's first Renaiss pull of all (renaiss_wallet_spend).
 */
export function scoreDrops(stored: DropRow[], fresh: DropRow[], firstPullMs: Map<string, number>): DropRow[] {
  const byProduct = new Map(stored.map((d) => [d.productId, d]));
  for (const d of fresh) byProduct.set(d.productId, d);
  const chronological = [...byProduct.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt));
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

export function readRenaissDrops(): Promise<RenaissDrops | null> {
  return readSnapshot<RenaissDrops>(RENAISS_DROPS_SNAPSHOT_KEY);
}

export function writeRenaissDrops(snap: RenaissDrops): Promise<void> {
  return writeSnapshot(RENAISS_DROPS_SNAPSHOT_KEY, snap, snap.generatedAt);
}
