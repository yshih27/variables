/**
 * Renaiss pack pulls — the feed, its `gacha_pulls` rows, and the pack-spend
 * reads core-volume and the daily spine take from them.
 *
 * Upstream (`GET /v1/gacha/pulls?platform=renaiss`): one row per pull, oldest
 * first. `kind` is `checkout` (the on-chain pack checkout: buyer, price paid,
 * transaction) or `observed` (a draw seen on Renaiss's public recently-drawn
 * list whose checkout is not matched yet: card and value, no buyer). The prize
 * (`tokenId`, `slab`, `catalogCard`) arrives once Renaiss names it — for its V3
 * packs that is when the set sells out — so every incremental run re-reads the
 * trailing 14 days and the upsert updates a pull whose prize was named late.
 *
 * ⚠️ `prizeValue` IS THE PLATFORM'S STATED VALUE, stored as `prize_value_usd`
 * and labelled as stated wherever it is shown; it is never a realized price.
 * ⚠️ An `observed` row is stored with `price_usd` null and is never spend.
 */
import { renaissGet, RENAISS_PAGE_SIZE, type FeedPage, type FeedQuery, type RenaissEnv } from "./client";
import type { FeedCatalogCard, FeedMoney, FeedSlab, RenaissCardRow } from "./cards";
import { db } from "../db/client";

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

/** A `gacha_pulls` row (20260608000001_data_model_mvp.sql). */
export type GachaPullRow = {
  pull_id: string;
  platform_id: "renaiss";
  product_id: string;
  buyer: string | null;
  price_usd: number | null;
  prize_instance_id: string | null;
  prize_canonical_id: string | null;
  prize_value_usd: number | null;
  tx_hash: string | null;
  source: "renaiss-api";
  pulled_at: string;
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

/** The named prize's slab + card, for its `cards` row; null until Renaiss names it. */
export function linkedCardOfPull(p: RenaissPullRow): { tokenId: string; slab: FeedSlab; card: FeedCatalogCard } | null {
  return p.tokenId && p.slab && p.catalogCard ? { tokenId: p.tokenId, slab: p.slab, card: p.catalogCard } : null;
}

/**
 * One feed row → its `gacha_pulls` row. `card` is the prize's `cards` row when
 * the prize is named and resolves; its identity key becomes
 * `prize_canonical_id`, so "which pack pulls this card" is one lookup across
 * venues.
 */
export function toPullRow(p: RenaissPullRow, card: Pick<RenaissCardRow, "identity_key"> | null): GachaPullRow {
  return {
    pull_id: p.id,
    platform_id: "renaiss",
    product_id: p.machineId,
    buyer: p.buyer ? p.buyer.toLowerCase() : null,
    price_usd: p.kind === "checkout" ? usdOf(p.pricePaid) : null,
    prize_instance_id: p.tokenId ? `rn-${p.tokenId}` : null,
    prize_canonical_id: card?.identity_key ?? null,
    prize_value_usd: usdOf(p.prizeValue),
    tx_hash: p.transaction,
    source: "renaiss-api",
    pulled_at: p.pulledAt,
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
/** How far back every incremental run re-reads, for prizes named after the pull. */
export const PULLS_REREAD_DAYS = 14;

/**
 * Where an incremental run starts: the earlier of a day before the newest
 * stored pull (the cursor, as for sales) and 14 days before now (the re-read).
 * In the steady state that is the 14-day re-read; after a gap or a stopped
 * backfill, the cursor. Null (the oldest row) when nothing is stored.
 */
export function pullsIncrementalFrom(newestPulledAt: string | null, now: number = Date.now()): string | null {
  const t = newestPulledAt ? Date.parse(newestPulledAt) : NaN;
  if (!Number.isFinite(t)) return null;
  return new Date(Math.min(t - DAY_MS, now - PULLS_REREAD_DAYS * DAY_MS)).toISOString();
}

// ── Row store (`gacha_pulls`, platform_id = renaiss) ─────────────────────────

/** Upsert on `pull_id`: a re-read pull whose prize was named since updates in place. */
export async function upsertRenaissPulls(rows: GachaPullRow[]): Promise<number> {
  if (!rows.length) return 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db().from("gacha_pulls").upsert(rows.slice(i, i + CHUNK), { onConflict: "pull_id" });
    if (error) throw new Error(`[gacha_pulls] renaiss upsert failed: ${error.message}`);
  }
  return rows.length;
}

/** Newest stored Renaiss `pulled_at` — the incremental cursor. Null when none is stored. */
export async function latestStoredPulledAt(): Promise<string | null> {
  const { data, error } = await db()
    .from("gacha_pulls")
    .select("pulled_at")
    .eq("platform_id", "renaiss")
    .order("pulled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[gacha_pulls] renaiss cursor read failed: ${error.message}`);
  return (data?.pulled_at as string | undefined) ?? null;
}

/** Oldest stored Renaiss `pulled_at` — where the daily pack series starts. Null when none is stored. */
export async function oldestStoredPulledAt(): Promise<string | null> {
  const { data, error } = await db()
    .from("gacha_pulls")
    .select("pulled_at")
    .eq("platform_id", "renaiss")
    .order("pulled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[gacha_pulls] renaiss oldest read failed: ${error.message}`);
  return (data?.pulled_at as string | undefined) ?? null;
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
        .from("gacha_pulls")
        .select("price_usd")
        .eq("platform_id", "renaiss")
        .not("price_usd", "is", null)
        .gte("pulled_at", day)
        .lt("pulled_at", end)
        .order("pull_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`[gacha_pulls] renaiss daily spend read failed (${day.slice(0, 10)}): ${error.message}`);
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
 * null — an observed row never is spend). Paged past the 1,000-row cap on
 * (pulled_at, pull_id); the (platform_id, pulled_at) index from 20260930000001
 * keeps each page an index range read.
 */
export async function readPackSpend(since: string | null): Promise<{ pulledAt: string; usd: number }[]> {
  const PAGE = 1000;
  const out: { pulledAt: string; usd: number }[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db()
      .from("gacha_pulls")
      .select("pulled_at, price_usd")
      .eq("platform_id", "renaiss")
      .not("price_usd", "is", null)
      .order("pulled_at", { ascending: true })
      .order("pull_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (since) q = q.gte("pulled_at", since);
    const { data, error } = await q;
    if (error) throw new Error(`[gacha_pulls] renaiss spend read failed: ${error.message}`);
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
