/**
 * Renaiss pack pulls — the feed, its own row store `renaiss_pulls`, and the
 * pack-spend reads core-volume and the daily spine take from it.
 *
 * Upstream (`GET /v1/gacha/pulls?platform=renaiss`): one row per pull, oldest
 * first. `kind` is `checkout` (the on-chain pack checkout: buyer, price paid,
 * transaction) or `observed` (a draw seen on Renaiss's public recently-drawn
 * list whose checkout is not matched yet: card and value, no buyer). The prize
 * (`tokenId`, `slab`, `catalogCard`) arrives once Renaiss names it — for its V3
 * packs that is when the set sells out — so every incremental run re-reads a
 * trailing window (PULLS_REREAD_DAYS) and writes the pulls that are new or
 * changed since they were stored (`selectPullsToWrite`).
 *
 * ⚠️ ITS OWN TABLE, NOT `gacha_pulls`. Renaiss's pull history was measured at
 * roughly 800,000 rows (four anonymous samples, Sep 30), and player analytics
 * scans every `gacha_pulls` row daily (31.4 min of the daily job's 75 on Sep
 * 30). So Renaiss pulls live apart, and Renaiss is absent from player analytics.
 *
 * ⚠️ A PRIZE WRITES NO `cards` ROW. Distinct prizes run close to one per pull,
 * and a `cards` row per prize would add hundreds of thousands of rows to the
 * table the dims scan and the identity snapshots read. The pull row carries its
 * prize's identity key and card fields itself; a prize token gets a `cards` row
 * only if it sells (sales.ts).
 *
 * ⚠️ `prizeValue` IS THE PLATFORM'S STATED VALUE, stored as `prize_value_usd`
 * and labelled as stated wherever it is shown; it is never a realized price.
 * ⚠️ An `observed` row is stored with `price_usd` null and is never spend.
 */
import { renaissGet, RENAISS_PAGE_SIZE, type FeedPage, type FeedQuery, type RenaissEnv } from "./client";
import type { FeedCatalogCard, FeedMoney, FeedSlab, RenaissCardRow } from "./cards";
import { db } from "../db/client";
import { PULLS_REREAD_DAYS } from "./constants";

export { PULLS_REREAD_DAYS };

export type RenaissPullRow = {
  id: string;
  platform: string;
  kind: "checkout" | "observed";
  machineId: string;
  machineName: string | null;
  pulledAt: string;
  buyer: string | null;
  checkoutId: string | null;
  transaction: string | null;
  pricePaid: FeedMoney | null;
  prizeValue: FeedMoney | null;
  tokenId: string | null;
  slab: FeedSlab | null;
  catalogCard: FeedCatalogCard | null;
  imageUrl: string | null;
};

type PullsResponse = { pulls?: RenaissPullRow[]; nextCursor?: string | null; hasMore?: boolean };

/** A `renaiss_pulls` row (20260930000001). */
export type RenaissStoredPull = {
  pull_id: string;
  kind: "checkout" | "observed";
  product_id: string;
  buyer: string | null;
  price_usd: number | null;
  tx_hash: string | null;
  pulled_at: string;
  /** `rn-<tokenId>` once named. A `cards` row exists for it only if the token has sold. */
  prize_instance_id: string | null;
  /** The prize's identity key, when its card resolves to one. */
  prize_canonical_id: string | null;
  prize_value_usd: number | null;
  prize_card_name: string | null;
  prize_set_name: string | null;
  prize_card_number: string | null;
  prize_grade_label: string | null;
  prize_cert: string | null;
  prize_language: string | null;
};

/**
 * Dollar stablecoins and dollars, counted 1:1 — USDT as USD, the way USDC is
 * everywhere else. Any other currency has no price here and stays null.
 */
const USD_LIKE = new Set(["USD", "USDT", "USDC"]);

/** A FeedMoney in dollars, or null when it is absent, unpriced or not a dollar. */
export function usdOf(m: FeedMoney | null | undefined): number | null {
  if (!m || !USD_LIKE.has(m.currency?.toUpperCase())) return null;
  const n = Number(m.amount);
  return Number.isFinite(n) ? n : null;
}

/** The named prize's slab + card; null until Renaiss names it. */
export function linkedCardOfPull(p: RenaissPullRow): { tokenId: string; slab: FeedSlab; card: FeedCatalogCard } | null {
  return p.tokenId && p.slab && p.catalogCard ? { tokenId: p.tokenId, slab: p.slab, card: p.catalogCard } : null;
}

type PrizeFields = Pick<RenaissCardRow, "identity_key" | "card_name" | "set_name" | "card_number" | "grade_label" | "cert" | "language">;

/**
 * One feed row → its `renaiss_pulls` row. `prize` is the prize's card as
 * `renaissCardRow` reads it (built in memory, never written): its identity key
 * becomes `prize_canonical_id`, so "which pack pulls this card" is one lookup
 * across venues, and its name, set, number, grade label, cert and language ride
 * on the pull row.
 */
export function toPullRow(p: RenaissPullRow, prize: PrizeFields | null): RenaissStoredPull {
  return {
    pull_id: p.id,
    kind: p.kind,
    product_id: p.machineId,
    buyer: p.buyer ? p.buyer.toLowerCase() : null,
    price_usd: p.kind === "checkout" ? usdOf(p.pricePaid) : null,
    tx_hash: p.transaction,
    pulled_at: p.pulledAt,
    prize_instance_id: p.tokenId ? `rn-${p.tokenId}` : null,
    prize_canonical_id: prize?.identity_key ?? null,
    prize_value_usd: usdOf(p.prizeValue),
    prize_card_name: prize?.card_name ?? null,
    prize_set_name: prize?.set_name ?? null,
    prize_card_number: prize?.card_number ?? null,
    prize_grade_label: prize ? prize.grade_label : null,
    prize_cert: prize?.cert ?? null,
    prize_language: prize?.language ?? null,
  };
}

/** One page of the pulls feed. */
export async function fetchPullsPage(q: FeedQuery, env: RenaissEnv = process.env): Promise<FeedPage<RenaissPullRow>> {
  const { body, rate } = await renaissGet<PullsResponse>(
    "/gacha/pulls",
    { platform: "renaiss", after: q.after, from: q.from, limit: q.limit ?? RENAISS_PAGE_SIZE },
    { env },
  );
  return { rows: body.pulls ?? [], nextCursor: body.nextCursor ?? null, hasMore: Boolean(body.hasMore), rate };
}

const DAY_MS = 86_400_000;

/**
 * Where an incremental run starts: the earlier of a day before the newest
 * stored pull (the cursor, as for sales) and PULLS_REREAD_DAYS before now (the
 * re-read). In the steady state that is the re-read; after a gap or a stopped
 * backfill, the cursor. Null (the oldest row) when nothing is stored.
 */
export function pullsIncrementalFrom(newestPulledAt: string | null, now: number = Date.now()): string | null {
  const t = newestPulledAt ? Date.parse(newestPulledAt) : NaN;
  if (!Number.isFinite(t)) return null;
  return new Date(Math.min(t - DAY_MS, now - PULLS_REREAD_DAYS * DAY_MS)).toISOString();
}

// ── Writing only what changed ────────────────────────────────────────────────

/** What the store already holds for one pull. */
export type StoredPullState = { named: boolean; kind: "checkout" | "observed" };

/**
 * The pulls a re-read must write: those not stored yet, those stored unnamed
 * that Renaiss has since named, and those stored as `observed` that have since
 * been matched to a checkout. Everything else is already stored as the feed
 * returns it; rewriting it would be tens of thousands of identical upserts a
 * run (the Sep 29 rate over the re-read window is about 30,000 pulls).
 */
export function selectPullsToWrite(
  rows: RenaissPullRow[],
  stored: Map<string, StoredPullState>,
): { write: RenaissPullRow[]; fresh: number; named: number; matched: number; unchanged: number } {
  const out = { write: [] as RenaissPullRow[], fresh: 0, named: 0, matched: 0, unchanged: 0 };
  for (const r of rows) {
    const s = stored.get(r.id);
    if (!s) {
      out.fresh++;
      out.write.push(r);
    } else if (!s.named && r.tokenId) {
      out.named++;
      out.write.push(r);
    } else if (s.kind === "observed" && r.kind === "checkout") {
      out.matched++;
      out.write.push(r);
    } else {
      out.unchanged++;
    }
  }
  return out;
}

/**
 * The stored state of every pull from `since` on, read once per run. Every id,
 * not only the unnamed ones, so "new" is known rather than assumed from the
 * cursor: a pull the index wrote late, behind the newest stored one, is still
 * found and written. Three narrow columns, paged past the 1,000-row cap.
 */
export async function readStoredPullStates(since: string): Promise<Map<string, StoredPullState>> {
  const PAGE = 1000;
  const out = new Map<string, StoredPullState>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("renaiss_pulls")
      .select("pull_id, kind, prize_instance_id")
      .gte("pulled_at", since)
      .order("pulled_at", { ascending: true })
      .order("pull_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`[renaiss_pulls] state read failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      out.set(String(r.pull_id), { named: r.prize_instance_id != null, kind: r.kind === "observed" ? "observed" : "checkout" });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

// ── Row store (`renaiss_pulls`) ──────────────────────────────────────────────

/** Upsert on `pull_id`: a pull whose prize was named since updates in place. */
export async function upsertRenaissPulls(rows: RenaissStoredPull[]): Promise<number> {
  if (!rows.length) return 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db().from("renaiss_pulls").upsert(rows.slice(i, i + CHUNK), { onConflict: "pull_id" });
    if (error) throw new Error(`[renaiss_pulls] upsert failed: ${error.message}`);
  }
  return rows.length;
}

async function edgePulledAt(ascending: boolean): Promise<string | null> {
  const { data, error } = await db()
    .from("renaiss_pulls")
    .select("pulled_at")
    .order("pulled_at", { ascending })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[renaiss_pulls] ${ascending ? "oldest" : "cursor"} read failed: ${error.message}`);
  return (data?.pulled_at as string | undefined) ?? null;
}

/** Newest stored `pulled_at` — the incremental cursor. Null when none is stored. */
export function latestStoredPulledAt(): Promise<string | null> {
  return edgePulledAt(false);
}

/** Oldest stored `pulled_at` — where the daily pack series starts. Null when none is stored. */
export function oldestStoredPulledAt(): Promise<string | null> {
  return edgePulledAt(true);
}

/**
 * Pack spend per UTC day from `fromDayMs` through `throughDayMs` (both
 * midnights, inclusive). Every day in the range gets an entry, zero when no
 * checkout landed on it: inside the span the feed covers, a quiet day is a
 * measured zero. One query per day keeps each page an index range read with a
 * small offset, where one query over the whole history would page by offsets
 * into the hundreds of thousands.
 */
export async function readDailyPackSpend(fromDayMs: number, throughDayMs: number): Promise<Map<string, { usd: number; packs: number }>> {
  const PAGE = 1000;
  const out = new Map<string, { usd: number; packs: number }>();
  for (let d = fromDayMs; d <= throughDayMs; d += DAY_MS) {
    const day = new Date(d).toISOString();
    const end = new Date(d + DAY_MS).toISOString();
    const acc = { usd: 0, packs: 0 };
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db()
        .from("renaiss_pulls")
        .select("price_usd")
        .not("price_usd", "is", null)
        .gte("pulled_at", day)
        .lt("pulled_at", end)
        .order("pull_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`[renaiss_pulls] daily spend read failed (${day.slice(0, 10)}): ${error.message}`);
      const rows = data ?? [];
      for (const r of rows) {
        const usd = Number(r.price_usd);
        if (!Number.isFinite(usd)) continue;
        acc.usd += usd;
        acc.packs += 1;
      }
      if (rows.length < PAGE) break;
    }
    out.set(day, acc);
  }
  return out;
}

/**
 * Pack spend per pull since `since` (ISO): checkout rows only (`price_usd` not
 * null — an observed row never is spend), paged past the 1,000-row cap on
 * (pulled_at, pull_id) over the table's `pulled_at` index.
 */
export async function readPackSpend(since: string | null): Promise<{ pulledAt: string; usd: number }[]> {
  const PAGE = 1000;
  const out: { pulledAt: string; usd: number }[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db()
      .from("renaiss_pulls")
      .select("pulled_at, price_usd")
      .not("price_usd", "is", null)
      .order("pulled_at", { ascending: true })
      .order("pull_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (since) q = q.gte("pulled_at", since);
    const { data, error } = await q;
    if (error) throw new Error(`[renaiss_pulls] spend read failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const usd = Number(r.price_usd);
      if (Number.isFinite(usd)) out.push({ pulledAt: String(r.pulled_at), usd });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Rolling pack spend for core-volume: 24h and 7d, and the 24h pack count —
 * rolling, like every other platform's gacha figures (see fetchDyliLaneWindows
 * for why the basis must match across the column).
 */
export function packWindows(spend: { pulledAt: string; usd: number }[], now: number = Date.now()): {
  gachaVol24Usd: number;
  gachaVol7Usd: number;
  gachaSales24h: number;
} {
  let gachaVol24Usd = 0;
  let gachaVol7Usd = 0;
  let gachaSales24h = 0;
  for (const s of spend) {
    const age = now - Date.parse(s.pulledAt);
    if (!Number.isFinite(age) || age < 0 || !(s.usd > 0)) continue;
    if (age <= 7 * DAY_MS) gachaVol7Usd += s.usd;
    if (age <= DAY_MS) {
      gachaVol24Usd += s.usd;
      gachaSales24h += 1;
    }
  }
  return { gachaVol24Usd, gachaVol7Usd, gachaSales24h };
}
