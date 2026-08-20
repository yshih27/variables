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

/**
 * Partner attribution rollup — CC's `memo_slug`, i.e. which partner surface a
 * pull was bought through.
 *
 * ⚠️ THIS SHAPE IS A CONTRACT with src/components/PlatformPartners.tsx, which is
 * already deployed and already wired at /platform/[key]. It reads exactly three
 * things — `rows[].slug`, `rows[].volumeUsd30d`, `config.minVolumeUsd` and
 * `attributedPct` — and it does its own flooring, ranking and top-3 cut. So the
 * backend sends the FULL rollup, unranked and unfiltered, and never pre-cuts it:
 * pre-cutting here would silently move the display rule into two places.
 * The extra per-window fields below are a superset the component ignores.
 *
 * ⚠️ Placement is also a contract: the page reads
 * `playerAnalyticsSnapshot.partners[platformKey]` — a TOP-LEVEL map keyed by
 * platform, not a field on the per-platform entries in `platforms[]`. Nesting it
 * there would typecheck and silently never render.
 */
export type PartnerRow = {
  /** CC memo slug, already lowercased/trimmed by the capture ('cc', 'rare', …). */
  slug: string;
  /** Display name where we actually know one; null falls back to the slug in the
   *  component. Deliberately sparse — see PARTNER_LABELS. */
  label?: string | null;
  /** REQUIRED by the component: attributed volume over the trailing 30 days. */
  volumeUsd30d: number;
  // ── superset: the component ignores these; they exist so the rollup can
  //    answer 24h/7d/lifetime questions without a second scan. ──
  pulls24h: number;
  volumeUsd24h: number;
  pulls7d: number;
  volumeUsd7d: number;
  pulls30d: number;
  pullsLifetime: number;
  volumeUsdLifetime: number;
};

export type PartnerAttribution = {
  /** The FULL rollup — every attributed partner. The component cuts to top 3. */
  rows: PartnerRow[];
  /** Snapshot-owned display config; the floor AND the house slug live with the
   *  data, not the FE. `houseSlug` = the platform's own storefront channel (CC's
   *  memo_slug 'cc') — a partner board renders partner SURFACES, so the component
   *  filters it out. Optional: rollups that predate the field filter nothing. */
  config: { minVolumeUsd: number; houseSlug?: string | null };
  /** Share of pulls in the TRAILING 30 DAYS carrying a memo_slug (0-100), to
   *  match the 30d volumes the component displays beside it. */
  attributedPct: number;
  /** Same ratio over the other windows — superset, for provenance. */
  attributedPct24h: number;
  attributedPct7d: number;
  attributedPctLifetime: number;
};

export type PlayerAnalyticsSnapshot = {
  generatedAt: string;
  /** Platforms with per-wallet attribution. Absent = no attribution, not zero. */
  platforms: PlatformPlayerAnalytics[];
  /** Platforms deliberately excluded, with the reason — surfaced, never silent. */
  excluded: { platform: string; reason: string }[];
  /** Rows scanned, for provenance against the table's own count. */
  rowsScanned: number;
  /**
   * Partner attribution, keyed by platform key. A platform appears only once it
   * has at least one attributed pull — an entry with 0% attribution would read
   * as "we measured the split and found none", when in fact capture simply has
   * not reached it yet. Only Collector Crypt emits memo_slug today.
   */
  partners?: Record<string, PartnerAttribution>;
};

/**
 * Display names for slugs whose partner we have actually confirmed. Everything
 * else falls back to the raw slug in the component.
 *
 * ⚠️ Deliberately sparse. The live feed also carries 'sol', 'comic', 'slabz',
 * 'watch', 'glyde', 'roll', 'me' — plausible guesses exist for several, but a
 * guessed brand name on a published board is a fabrication, and the slug itself
 * is honest. Add entries here only once a partner is confirmed.
 */
export const PARTNER_LABELS: Record<string, string> = {
  cc: "Collector Crypt",
  rare: "Rarible",
};

/**
 * Minimum trailing-30d attributed volume for a partner to be eligible for the
 * board. Lives in the snapshot (the component reads it from `config`) so the
 * threshold is versioned with the data rather than frozen into the FE.
 *
 * $250k is ~0.17% of Collector Crypt's measured trailing-30d gacha volume
 * (~$144.7M). A "top partner" moving less than 1/500th of the platform is not a
 * top partner, so the floor is what keeps the podium meaningful.
 *
 * ⚠️ SIZED SO THE BOARD STAYS HIDDEN FOR NOW, deliberately. memo_slug capture is
 * forward-only (shipped 2026-08-18) and currently attributes 0.08% of trailing
 * -30d pulls. At a $10k floor four slugs already clear it (cc $127,979, sol
 * $48,375, slabz $30,000, jupiter $13,775) and the component would publish a
 * three-row ranking derived from 296 of ~800,000 pulls — a ranking of who
 * happened to be captured first, not of partner share. Raise-not-lower: do not
 * cut this to light the board up early.
 *
 * ⚠️ KNOWN LIMITATION: this one knob conflates two questions — "is this partner
 * non-trivial?" (its actual job) and "is attribution complete enough to rank at
 * all?" (what is really gating today). The component floors on volume only, so
 * volume is the only lever the snapshot has. The cleaner fix, if the board is
 * wanted sooner, is a separate sufficiency gate on `attributedPct` — either
 * withholding `partners` below a share threshold here, or teaching the component
 * to require one. Flagged rather than silently encoded.
 */
export const PARTNER_MIN_VOLUME_USD = 250_000;

export function readPlayerAnalytics(): Promise<PlayerAnalyticsSnapshot | null> {
  return readSnapshot<PlayerAnalyticsSnapshot>(PLAYER_ANALYTICS_SNAPSHOT_KEY);
}

export function writePlayerAnalytics(snap: PlayerAnalyticsSnapshot): Promise<void> {
  return writeSnapshot(PLAYER_ANALYTICS_SNAPSHOT_KEY, snap, snap.generatedAt);
}

// ── Aggregation ────────────────────────────────────────────────────────────

type WalletAcc = { spend: number; pulls: number; lastAt: number };
type PartnerAcc = {
  pulls24h: number; usd24h: number;
  pulls7d: number; usd7d: number;
  pulls30d: number; usd30d: number;
  pullsLife: number; usdLife: number;
};
type WindowCounts = { total24h: number; total7d: number; total30d: number; totalLife: number;
                      attr24h: number; attr7d: number; attr30d: number; attrLife: number };

type PlatformAcc = {
  wallets: Map<string, WalletAcc>;
  partners: Map<string, PartnerAcc>;
  win: WindowCounts;
  monthly: Map<string, { byPrice: Map<number, number>; total: number; pulls: number }>;
  rows: number;
  walletRows: number;
  pricedRows: number;
  first: string | null;
  last: string | null;
};

const blank = (): PlatformAcc => ({
  wallets: new Map(),
  partners: new Map(),
  win: { total24h: 0, total7d: 0, total30d: 0, totalLife: 0, attr24h: 0, attr7d: 0, attr30d: 0, attrLife: 0 },
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
  const DAY_MS = 24 * 60 * 60 * 1000;
  // Pinned once so every window boundary in this run is measured from the same
  // instant — a per-row Date.now() would drift across a multi-minute scan.
  const now = Date.now();
  const byPlatform = new Map<string, PlatformAcc>();

  let cursor = "";
  let scanned = 0;
  let page = 0;
  for (; page < maxPages; page++) {
    const { data, error } = await db()
      .from("gacha_pulls")
      .select("pull_id, platform_id, buyer, price_usd, pulled_at, memo_slug")
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

      // ── Partner attribution ────────────────────────────────────────────────
      // A NULL/empty memo_slug is UNKNOWN ORIGIN. It counts toward the window
      // totals (so attributedPct is honest about how much we cannot attribute)
      // and toward no partner, ever. There is no catch-all bucket on purpose: an
      // "unknown" row on a partner board reads as a partner named Unknown.
      const at_ms = Date.parse(at);
      if (Number.isFinite(at_ms)) {
        const age = now - at_ms;
        const slug = r.memo_slug ? String(r.memo_slug).trim().toLowerCase() : "";
        const inW = [age <= DAY_MS, age <= 7 * DAY_MS, age <= 30 * DAY_MS] as const;
        acc.win.totalLife += 1;
        if (inW[0]) acc.win.total24h += 1;
        if (inW[1]) acc.win.total7d += 1;
        if (inW[2]) acc.win.total30d += 1;
        if (slug) {
          acc.win.attrLife += 1;
          if (inW[0]) acc.win.attr24h += 1;
          if (inW[1]) acc.win.attr7d += 1;
          if (inW[2]) acc.win.attr30d += 1;
          let pa = acc.partners.get(slug);
          if (!pa) acc.partners.set(slug, (pa = { pulls24h: 0, usd24h: 0, pulls7d: 0, usd7d: 0, pulls30d: 0, usd30d: 0, pullsLife: 0, usdLife: 0 }));
          const usd = priced ? price : 0;
          pa.pullsLife += 1; pa.usdLife += usd;
          if (inW[0]) { pa.pulls24h += 1; pa.usd24h += usd; }
          if (inW[1]) { pa.pulls7d += 1; pa.usd7d += usd; }
          if (inW[2]) { pa.pulls30d += 1; pa.usd30d += usd; }
        }
      }

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

  const partners: Record<string, PartnerAttribution> = {};
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

    // Emit a partner entry only when something is actually attributed. An entry
    // with an empty rows[] would still render nothing (the component floors and
    // cuts, then bails on an empty top), but publishing 0% attribution asserts
    // we measured the split and found none — we simply have not captured it yet.
    if (acc.partners.size > 0) {
      const pct = (a: number, t: number) => (t > 0 ? (a / t) * 100 : 0);
      partners[platform] = {
        // FULL rollup, unranked and uncut — the component owns floor/rank/top-N.
        rows: [...acc.partners.entries()].map(([slug, v]) => ({
          slug,
          label: PARTNER_LABELS[slug] ?? null,
          volumeUsd30d: v.usd30d,
          pulls24h: v.pulls24h,
          volumeUsd24h: v.usd24h,
          pulls7d: v.pulls7d,
          volumeUsd7d: v.usd7d,
          pulls30d: v.pulls30d,
          pullsLifetime: v.pullsLife,
          volumeUsdLifetime: v.usdLife,
        })),
        config: { minVolumeUsd: PARTNER_MIN_VOLUME_USD, houseSlug: "cc" },
        attributedPct: pct(acc.win.attr30d, acc.win.total30d),
        attributedPct24h: pct(acc.win.attr24h, acc.win.total24h),
        attributedPct7d: pct(acc.win.attr7d, acc.win.total7d),
        attributedPctLifetime: pct(acc.win.attrLife, acc.win.totalLife),
      };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    platforms,
    excluded,
    rowsScanned: scanned,
    // Omit the key entirely when nothing is attributed anywhere, so the page's
    // `partners?.[key] ?? null` lookup stays a clean absence.
    ...(Object.keys(partners).length ? { partners } : {}),
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
