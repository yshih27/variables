/**
 * Player spending analytics — derived entirely from OUR `gacha_pulls` table.
 * No new upstream source, no Dune: every figure here is a re-aggregation of pull
 * rows we already collect, which is why it can be fresher than a public dashboard.
 *
 * ⚠️ COVERAGE IS THE GATE. A platform only appears if its pulls carry per-wallet
 * attribution. Measured 2026-08-18 against the live table (1,524,254 rows):
 *   • collector-crypt  1,430,773 rows · buyer 100% · price 100% · 2026-01-05 →
 *   • phygitals           93,481 rows · buyer 100% · price 100% · 2026-06-09 →
 *   • beezie / courtyard / dyli — ZERO rows. They get NO player analytics: no
 *     estimate, no zero, no row. Absence is the honest output.
 * Coverage is re-measured on every run and published in the snapshot, so a
 * platform gaining or losing attribution shows up rather than silently shifting
 * the numbers.
 *
 * ⚠️ PRIVACY. Wallet addresses are aggregation keys and never leave this module.
 * The snapshot carries counts, sums and shares only — no addresses, not even
 * truncated. If a leaderboard is ever wanted, truncate at that point and revisit
 * this comment; today nothing needs one.
 *
 * ⚠️ NOT BUILDABLE TODAY: a CC partner split by `memo_slug`. That field exists on
 * Collector Crypt's live gacha feed but is not persisted — `gacha_pulls` has no
 * such column and `memo_slug` appears nowhere in this repo. It needs a schema
 * column plus a warmer change to capture it going forward; it cannot be
 * backfilled from rows that never stored it.
 */
import { db } from "../db/client";
import { readSnapshot, writeSnapshot } from "../db/snapshots";

export const PLAYER_ANALYTICS_SNAPSHOT_KEY = "player-analytics";

/** Lifetime-spend buckets, in USD. Upper bound is exclusive of the next floor. */
export const SPEND_TIERS: { label: string; min: number; max: number }[] = [
  { label: "≤$50", min: 0, max: 50 },
  { label: "$51–250", min: 50, max: 250 },
  { label: "$251–1k", min: 250, max: 1_000 },
  { label: "$1k–10k", min: 1_000, max: 10_000 },
  { label: "$10k–100k", min: 10_000, max: 100_000 },
  { label: "$100k–1M", min: 100_000, max: 1_000_000 },
  { label: ">$1M", min: 1_000_000, max: Infinity },
];

export type SpendTierRow = {
  label: string;
  users: number;
  totalSpendUsd: number;
  pctUsers: number;
  pctRevenue: number;
};

export type MonthlySpendRow = {
  /** UTC month, "YYYY-MM". */
  month: string;
  /** Pack price (USD, rounded) → spend that month. The stacked-bar series. */
  byPrice: Record<string, number>;
  totalUsd: number;
  pulls: number;
};

export type ConcentrationStats = {
  totalWallets: number;
  totalSpendUsd: number;
  avgLifetimeSpendUsd: number;
  medianLifetimeSpendUsd: number;
  /** Share of all spend held by the top 1% / 10% of wallets (0–100). */
  top1PctShare: number;
  top10PctShare: number;
  activeWallets30d: number;
};

export type PlatformPlayerAnalytics = {
  platform: string;
  coverage: {
    rows: number;
    walletAttributedRows: number;
    pricedRows: number;
    firstPullAt: string | null;
    lastPullAt: string | null;
  };
  tiers: SpendTierRow[];
  monthly: MonthlySpendRow[];
  concentration: ConcentrationStats;
};

export type PlayerAnalyticsSnapshot = {
  generatedAt: string;
  /** Platforms with per-wallet attribution. Absent = no attribution, not zero. */
  platforms: PlatformPlayerAnalytics[];
  /** Platforms deliberately excluded, with the reason — surfaced, never silent. */
  excluded: { platform: string; reason: string }[];
  /** Rows scanned, for provenance against the table's own count. */
  rowsScanned: number;
};

export function readPlayerAnalytics(): Promise<PlayerAnalyticsSnapshot | null> {
  return readSnapshot<PlayerAnalyticsSnapshot>(PLAYER_ANALYTICS_SNAPSHOT_KEY);
}

export function writePlayerAnalytics(snap: PlayerAnalyticsSnapshot): Promise<void> {
  return writeSnapshot(PLAYER_ANALYTICS_SNAPSHOT_KEY, snap, snap.generatedAt);
}

// ── Aggregation ────────────────────────────────────────────────────────────

type WalletAcc = { spend: number; pulls: number; lastAt: number };
type PlatformAcc = {
  wallets: Map<string, WalletAcc>;
  monthly: Map<string, { byPrice: Map<number, number>; total: number; pulls: number }>;
  rows: number;
  walletRows: number;
  pricedRows: number;
  first: string | null;
  last: string | null;
};

const blank = (): PlatformAcc => ({
  wallets: new Map(),
  monthly: new Map(),
  rows: 0,
  walletRows: 0,
  pricedRows: 0,
  first: null,
  last: null,
});

/**
 * Full keyset scan of gacha_pulls, aggregating as it goes.
 *
 * ⚠️ Streaming is deliberate: 1.5M rows are never held in memory at once, only
 * the per-wallet map. PostgREST hard-caps responses at 1000 rows no matter what
 * `limit` asks for (verified: 5000/20000/50000 all return 1000), so this is
 * ~1,525 sequential requests at ~0.3–0.7s each — minutes, not seconds. That is
 * exactly why this is a daily precompute and never a request-path read.
 *
 * Pagination is pure-PK keyset on `pull_id`, not OFFSET: offsets past ~1M rows
 * degrade into full scans and time out (the same lesson as the cards reader).
 * `pull_id` is platform-prefixed, so the whole table is scanned once and
 * partitioned per platform in JS rather than filtered per platform — a
 * platform-filtered keyset would scan every other platform's rows to find its
 * first page.
 */
export async function aggregatePlayerAnalytics(opts: {
  maxPages?: number;
  log?: (msg: string) => void;
} = {}): Promise<PlayerAnalyticsSnapshot> {
  const log = opts.log ?? (() => {});
  const maxPages = opts.maxPages ?? Infinity;
  const PAGE = 1000;
  const byPlatform = new Map<string, PlatformAcc>();

  let cursor = "";
  let scanned = 0;
  let page = 0;
  for (; page < maxPages; page++) {
    const { data, error } = await db()
      .from("gacha_pulls")
      .select("pull_id, platform_id, buyer, price_usd, pulled_at")
      .gt("pull_id", cursor)
      .order("pull_id", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`[player-analytics] scan failed: ${error.message}`);
    const rows = data ?? [];
    if (!rows.length) break;

    for (const r of rows) {
      const platform = String(r.platform_id ?? "");
      if (!platform) continue;
      let acc = byPlatform.get(platform);
      if (!acc) byPlatform.set(platform, (acc = blank()));
      acc.rows += 1;

      const at = String(r.pulled_at ?? "");
      if (at) {
        if (acc.first === null || at < acc.first) acc.first = at;
        if (acc.last === null || at > acc.last) acc.last = at;
      }

      const price = Number(r.price_usd);
      const priced = Number.isFinite(price) && price > 0;
      if (priced) acc.pricedRows += 1;

      const buyer = r.buyer ? String(r.buyer) : "";
      if (buyer) {
        acc.walletRows += 1;
        if (priced) {
          const w = acc.wallets.get(buyer);
          const t = Date.parse(at);
          if (w) {
            w.spend += price;
            w.pulls += 1;
            if (Number.isFinite(t) && t > w.lastAt) w.lastAt = t;
          } else {
            acc.wallets.set(buyer, { spend: price, pulls: 1, lastAt: Number.isFinite(t) ? t : 0 });
          }
        }
      }

      if (priced && at.length >= 7) {
        const month = at.slice(0, 7);
        let m = acc.monthly.get(month);
        if (!m) acc.monthly.set(month, (m = { byPrice: new Map(), total: 0, pulls: 0 }));
        const bucket = Math.round(price);
        m.byPrice.set(bucket, (m.byPrice.get(bucket) ?? 0) + price);
        m.total += price;
        m.pulls += 1;
      }
    }

    scanned += rows.length;
    cursor = String(rows[rows.length - 1].pull_id);
    if (page % 100 === 0) log(`  scanned ${scanned.toLocaleString()} rows (page ${page})…`);
    if (rows.length < PAGE) break;
  }

  log(`  scan complete: ${scanned.toLocaleString()} rows over ${page + 1} pages`);

  const platforms: PlatformPlayerAnalytics[] = [];
  const excluded: { platform: string; reason: string }[] = [];
  for (const [platform, acc] of [...byPlatform.entries()].sort()) {
    if (acc.wallets.size === 0) {
      excluded.push({
        platform,
        reason: `${acc.rows.toLocaleString()} pull row(s) but no wallet-attributed priced rows — no player analytics`,
      });
      continue;
    }
    platforms.push(buildPlatform(platform, acc));
  }

  return {
    generatedAt: new Date().toISOString(),
    platforms,
    excluded,
    rowsScanned: scanned,
  };
}

function buildPlatform(platform: string, acc: PlatformAcc): PlatformPlayerAnalytics {
  const spends = [...acc.wallets.values()].map((w) => w.spend).sort((a, b) => b - a);
  const totalSpend = spends.reduce((s, v) => s + v, 0);
  const n = spends.length;

  const tiers: SpendTierRow[] = SPEND_TIERS.map((t) => {
    let users = 0;
    let sum = 0;
    for (const s of spends) {
      if (s > t.min && s <= t.max) {
        users += 1;
        sum += s;
      }
    }
    return {
      label: t.label,
      users,
      totalSpendUsd: sum,
      pctUsers: n ? (users / n) * 100 : 0,
      pctRevenue: totalSpend > 0 ? (sum / totalSpend) * 100 : 0,
    };
  });

  // Top-k share: k is CEILED so a small wallet population still yields a real
  // "top 1%" (with 189 wallets, floor(1%) would be 1 and floor→0 for smaller
  // sets, reporting 0% concentration for a set that is in fact concentrated).
  const shareOfTop = (pct: number): number => {
    if (!n || totalSpend <= 0) return 0;
    const k = Math.max(1, Math.ceil((n * pct) / 100));
    let sum = 0;
    for (let i = 0; i < k && i < n; i++) sum += spends[i];
    return (sum / totalSpend) * 100;
  };

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let active30 = 0;
  for (const w of acc.wallets.values()) if (w.lastAt >= cutoff) active30 += 1;

  const monthly: MonthlySpendRow[] = [...acc.monthly.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, m]) => ({
      month,
      byPrice: Object.fromEntries([...m.byPrice.entries()].sort((a, b) => a[0] - b[0]).map(([p, v]) => [String(p), v])),
      totalUsd: m.total,
      pulls: m.pulls,
    }));

  return {
    platform,
    coverage: {
      rows: acc.rows,
      walletAttributedRows: acc.walletRows,
      pricedRows: acc.pricedRows,
      firstPullAt: acc.first,
      lastPullAt: acc.last,
    },
    tiers,
    monthly,
    concentration: {
      totalWallets: n,
      totalSpendUsd: totalSpend,
      avgLifetimeSpendUsd: n ? totalSpend / n : 0,
      medianLifetimeSpendUsd: n ? spends[Math.floor(n / 2)] : 0,
      top1PctShare: shareOfTop(1),
      top10PctShare: shareOfTop(10),
      activeWallets30d: active30,
    },
  };
}
