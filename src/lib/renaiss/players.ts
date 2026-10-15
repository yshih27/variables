/**
 * Renaiss players — lifetime pack spend per wallet, aggregated IN THE DATABASE
 * by `renaiss_wallet_spend()` (migration 20261007000002, the repo's first RPC),
 * then cut into tiers, concentration and active-30d by the same rule every
 * other venue's player analytics uses (`tiersAndConcentration`). Written to its
 * own snapshot, `players:renaiss`, in the `PlatformPlayerAnalytics` shape.
 *
 * ⚠️ NOT PART OF THE gacha_pulls SCAN. Renaiss's ~720,000 pulls live in their
 * own table; folding them through PostgREST pages would be the same full scan
 * that already times out the daily job. The function groups by wallet in
 * Postgres and returns one row per wallet (measured on a local Postgres 17
 * with 720,000 synthetic rows and 25,000 wallets: ~115 ms per call).
 *
 * ⚠️ PRIVACY, as playerAnalytics.ts: wallet addresses are aggregation keys and
 * never leave this module. The snapshot carries counts, sums and shares only.
 *
 * ⚠️ NO MONTHLY MIX. The aggregate is per wallet; a month-by-price split would be
 * a second full pass. `monthly` is empty and `monthlyReason` says so.
 */
import { db } from "../db/client";
import { readSnapshot, writeSnapshot } from "../db/snapshots";
import { firstMonths, monthlyPlayersFrom, tiersAndConcentration, type MonthlyPlayersRow, type PlatformPlayerAnalytics } from "../data/playerAnalytics";

export const RENAISS_PLAYERS_SNAPSHOT_KEY = "players:renaiss";
export const RENAISS_WALLET_SPEND_FN = "renaiss_wallet_spend";

/** One row of `renaiss_wallet_spend()`. */
export type WalletSpendRow = {
  buyer: string;
  spend: number | string;
  pulls: number | string;
  first_pull: string;
  last_pull: string;
};

export type RenaissPlayersSnapshot = {
  generatedAt: string;
  platform: PlatformPlayerAnalytics;
  /** How the aggregate was read: pages of 1,000 wallets, and the wall time. */
  read: { pages: number; wallets: number; ms: number };
};

/** True when PostgREST says the function does not exist (the migration is not applied). */
export function isMissingFunction(message: string): boolean {
  return message.includes(RENAISS_WALLET_SPEND_FN) && /could not find|does not exist|PGRST202/i.test(message);
}

/** Every wallet's row, ordered by buyer so each page is a stable slice. */
export async function readWalletSpend(): Promise<{ rows: WalletSpendRow[]; pages: number; ms: number }> {
  const PAGE = 1000;
  const t0 = Date.now();
  const rows: WalletSpendRow[] = [];
  let pages = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .rpc(RENAISS_WALLET_SPEND_FN)
      .order("buyer", { ascending: true })
      .range(from, from + PAGE - 1);
    pages++;
    if (error) throw new Error(`[${RENAISS_WALLET_SPEND_FN}] ${error.message}`);
    const page = (data ?? []) as WalletSpendRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return { rows, pages, ms: Date.now() - t0 };
}

/** The coverage counts every venue's player analytics publishes. Three head counts, no rows. */
export async function readPullCoverage(): Promise<{ rows: number; walletAttributedRows: number; pricedRows: number }> {
  const head = () => db().from("renaiss_pulls").select("pull_id", { count: "exact", head: true });
  const [all, wallet, priced] = await Promise.all([head(), head().not("buyer", "is", null), head().gt("price_usd", 0)]);
  for (const r of [all, wallet, priced]) if (r.error) throw new Error(`[renaiss_pulls] coverage count failed: ${r.error.message}`);
  return { rows: all.count ?? 0, walletAttributedRows: wallet.count ?? 0, pricedRows: priced.count ?? 0 };
}

/** The `PlatformPlayerAnalytics` entry, pure. */
export function buildRenaissPlayers(
  wallets: WalletSpendRow[],
  coverage: { rows: number; walletAttributedRows: number; pricedRows: number },
  nowMs: number = Date.now(),
): PlatformPlayerAnalytics {
  const parsed = wallets
    .map((w) => ({ spend: Number(w.spend), lastAt: Date.parse(w.last_pull), firstAt: Date.parse(w.first_pull) }))
    .filter((w) => Number.isFinite(w.spend) && w.spend > 0);
  const { tiers, concentration } = tiersAndConcentration(parsed.map((w) => ({ spend: w.spend, lastAt: Number.isFinite(w.lastAt) ? w.lastAt : 0 })), nowMs);
  const firsts = parsed.map((w) => w.firstAt).filter(Number.isFinite);
  const lasts = parsed.map((w) => w.lastAt).filter(Number.isFinite);
  return {
    platform: "renaiss",
    coverage: {
      ...coverage,
      firstPullAt: firsts.length ? new Date(firsts.reduce((m, v) => Math.min(m, v))).toISOString() : null,
      lastPullAt: lasts.length ? new Date(lasts.reduce((m, v) => Math.max(m, v))).toISOString() : null,
    },
    tiers,
    monthly: [],
    monthlyReason: "Renaiss's spend is aggregated per wallet in the database; no month-by-price split is built",
    concentration,
  };
}

export function readRenaissPlayers(): Promise<RenaissPlayersSnapshot | null> {
  return readSnapshot<RenaissPlayersSnapshot>(RENAISS_PLAYERS_SNAPSHOT_KEY);
}

export function writeRenaissPlayers(snap: RenaissPlayersSnapshot): Promise<void> {
  return writeSnapshot(RENAISS_PLAYERS_SNAPSHOT_KEY, snap, snap.generatedAt);
}

// ── Players per month (Oct 15 2026) ──────────────────────────────────────────

const DAY_MS = 86_400_000;

/**
 * Distinct buyers per UTC month among checkout rows in [fromMs, toMs), one day
 * per query over the `pulled_at` index, paged past the 1,000-row cap, each page
 * retried. Wallets stay keys in memory; the snapshot gets counts only.
 */
export async function readMonthlyBuyers(
  fromMs: number,
  toMs: number,
  log: (l: string) => void = () => {},
): Promise<{ months: Map<string, Set<string>>; spend: Map<string, number>; rows: number; queries: number }> {
  const PAGE = 1000;
  const months = new Map<string, Set<string>>();
  const spend = new Map<string, number>();
  let rows = 0;
  let queries = 0;
  for (let d = Math.floor(fromMs / DAY_MS) * DAY_MS; d < toMs; d += DAY_MS) {
    const day = new Date(d).toISOString();
    const end = new Date(Math.min(d + DAY_MS, toMs)).toISOString();
    for (let from = 0; ; from += PAGE) {
      const page = () =>
        db()
          .from("renaiss_pulls")
          .select("buyer, pulled_at, price_usd")
          .eq("kind", "checkout")
          .gte("pulled_at", day)
          .lt("pulled_at", end)
          .order("pull_id", { ascending: true })
          .range(from, from + PAGE - 1);
      let { data, error } = await page();
      queries++;
      for (let attempt = 1; error && attempt <= 3; attempt++) {
        await new Promise((r) => setTimeout(r, attempt * 3_000));
        ({ data, error } = await page());
        queries++;
      }
      if (error) throw new Error(`[renaiss_pulls] monthly buyers read failed (${day.slice(0, 10)}, row ${from}): ${error.message ?? JSON.stringify(error)}`);
      const batch = (data ?? []) as { buyer: string | null; pulled_at: string; price_usd: number | string | null }[];
      for (const r of batch) {
        if (!r.buyer || !r.pulled_at) continue;
        const m = r.pulled_at.slice(0, 7);
        let set = months.get(m);
        if (!set) months.set(m, (set = new Set()));
        set.add(r.buyer.toLowerCase());
        const usd = Number(r.price_usd);
        if (Number.isFinite(usd) && usd > 0) spend.set(m, (spend.get(m) ?? 0) + usd);
      }
      rows += batch.length;
      if (batch.length < PAGE) break;
    }
    if (new Date(d).getUTCDate() === 1) log(`  monthly buyers: through ${day.slice(0, 7)} · ${rows.toLocaleString()} checkouts read`);
  }
  return { months, spend, rows, queries };
}

/**
 * Renaiss's players per month: stored months before `recomputeFrom` ("YYYY-MM")
 * kept, months from it on replaced by this read. First-time from each wallet's
 * first pull (renaiss_wallet_spend, the whole history), counted the same way as
 * every other venue (monthlyPlayersFrom). Pure.
 */
export function renaissMonthlyPlayers(
  read: Map<string, Set<string>>,
  wallets: Pick<WalletSpendRow, "first_pull">[],
  stored: MonthlyPlayersRow[] | undefined,
  recomputeFrom: string,
  spend?: Map<string, number>,
): MonthlyPlayersRow[] {
  const firstByMonth = firstMonths(wallets.map((w) => ({ firstAt: Date.parse(w.first_pull) })));
  const fresh = monthlyPlayersFrom(new Map([...read.entries()].filter(([m]) => m >= recomputeFrom)), firstByMonth, spend);
  const kept = (stored ?? []).filter((r) => r.month < recomputeFrom);
  return [...kept, ...fresh].sort((a, b) => a.month.localeCompare(b.month));
}
