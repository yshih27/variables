/**
 * IDENTITY DETAIL — one card across every venue and every token.
 *
 * `/i/<slug>` is one page per card IDENTITY (ip | set | number | name | grade),
 * where `/card/<id>` is one page per TOKEN. This reader joins the twenty
 * Charizard PSA 10s across venues into one picture: every slab, every realised
 * sale, the identity's own monthly price, the floor, the grade ladder.
 *
 * ⚠️ THE MONTHLY PRICE IS `monthlyIdentityPrices` AND NOTHING ELSE. It is the
 * index's own per-identity median, over the same panel rows, with the same
 * n ≥ MIN_SALES_PER_IDENTITY rule, so the page and the index agree by
 * construction. A month with fewer sales is ABSENT — never interpolated, never
 * a single sale dressed as a price.
 *
 * ⚠️ FRAGMENTS, DISCLOSED. The index keys identities on the RAW set string, and
 * 1,103 of 55,737 identities (measured 2026-09-14) are the same card keyed
 * twice — "Pokemon Obf EN-Obsidian Flames" and "Obsidian Flames", or a name
 * with and without a hyphen. The slug is the correct identity, so one slug can
 * resolve to several keys. This page shows ONE of them — the canonical fragment,
 * most sales then most slabs — so that `sales` and `monthly` are exactly one
 * index identity, and lists the others in `fragments` with their counts so
 * nothing is hidden. `tokens` is the union (a slab is a slab whichever key it
 * was filed under). Re-keying the index on the slug-level identity would
 * remove the fragmentation; that is an estimator change and a separate PR.
 *
 * ⚠️ TWO RESOLUTION PATHS, ONE OUTPUT. While `cards.identity_slug` does not exist
 * (migration unapplied) the slug is resolved by scanning the cached panel's
 * identities; once the column exists it becomes a keyset read. Both paths yield
 * the same candidate key set and hand it to the same `buildDetail`, so their
 * output is identical by construction — the PR body carries the measured check.
 *
 * Never throws; null when the slug resolves to nothing.
 */
import { unstable_cache } from "next/cache";
import { buildSalePanel, type SaleRow } from "./salePanel";
import { readAllCardDims, readCards, type CardPlatform } from "./cards";
import { identityKey, parseIdentityKey, type CardIdentityParts } from "./traits";
import { identitySlug, parseIdentitySlug, gradeSlug } from "@/lib/card/identity";
import { normalizeSetName } from "@/lib/card/setName";
import { cardHref, PLATFORM_META } from "@/lib/card/ids";
import { monthlyIdentityPrices, MIN_SALES_PER_IDENTITY } from "./identityIndex";
import { canonicalGrade, PREMIUM_PAIRS } from "./gradePremium";
import { readPremiumSeries, PREMIUM_TO_PERCENT } from "./gradeSetIndex";
import { readListings, type ListingEntry } from "./listings";
import { readPriceIndexKeys } from "./indices";
import { IP_CATALOG, categoryOf } from "./ipCatalog";
import { monthStartUtc, monthEndUtc } from "@/lib/chart/period";
import { db } from "@/lib/db/client";

// ── contracts (ADD fields, never rename) ─────────────────────────────────────

export type IdentityParts = {
  ip: string;
  ipName: string;
  setKey: string | null;
  setName: string | null;
  number: string | null;
  name: string;
  grade: string;
  edition: string | null;
  language: string | null;
};

export type IdentityToken = {
  platform: CardPlatform;
  tokenId: string;
  /** `/card/<id>` */
  cardId: string;
  cert: string | null;
  image: string | null;
  lastSale: { ts: string; priceUsd: number } | null;
  listing: { priceUsd: number; platform: string } | null;
};

export type IdentitySale = { ts: string; priceUsd: number; platform: CardPlatform; tokenId: string };

export type IdentityMonthly = {
  ts: string;
  value: number;
  n: number;
  /** True for the RUNNING month. `monthlyIdentityPrices` returns it verbatim
   *  (this is the index's own function), but the index never publishes it —
   *  its completeness gate stamps a month only after it ends. Shown, flagged. */
  partial: boolean;
};

export type IdentityFloor = {
  priceUsd: number;
  platform: string;
  /** floor ÷ the latest COMPLETE month's identity price — null without one. A
   *  value like 0.03 is the receipt that this "floor" is a placeholder ask, not a
   *  market (measured: a $1.84 aggregator listing on a $53 card). A fact for the
   *  surface to disclose; no threshold is applied here. */
  vsMonthly: number | null;
  /** Which venues' listings are complete vs aggregator-sourced. A floor is never
   *  taken from a venue whose listings are known incomplete without saying so. */
  coverage: { platform: string; source: "native" | "aggregator" }[];
} | null;

export type IdentityVenue = {
  platform: CardPlatform;
  sales30d: number;
  volume30d: number;
  listings: number;
  /** Share of 30d sales (0–100). */
  share: number;
};

export type GradeRung = {
  slug: string;
  grade: string;
  isThis: boolean;
  latestMonthly: IdentityMonthly | null;
  /** The published matched-identity premium of THIS grade over the rung's grade
   *  (ratio, >1 = this grade is dearer), for the latest month the pair
   *  publishes; null when no published pair covers the two. Read from the
   *  price-index blob, so it is the same number the premium chart draws. */
  premiumVsThis: { ratio: number; n: number; month: string } | null;
};

export type IdentityDetail = {
  slug: string;
  /** The canonical identity key this page is built from. */
  key: string;
  parts: IdentityParts;
  tokens: IdentityToken[];
  sales: IdentitySale[];
  monthly: IdentityMonthly[];
  floor: IdentityFloor;
  venues: IdentityVenue[];
  gradeLadder: GradeRung[];
  /** Published index entities this identity was priced in for the latest
   *  complete month (n ≥ MIN_SALES_PER_IDENTITY within the entity's scope). */
  indexMembership: string[];
  /** Other raw identity keys that map to this slug — the same card, keyed twice.
   *  Their tokens are in `tokens`; their sales are NOT in `sales`/`monthly`. */
  fragments: { key: string; sales: number; slabs: number }[];
  /** Which path resolved the slug: the panel scan or the cards column. */
  resolvedVia: "panel" | "column";
  generatedAt: string;
};

// ── the panel, cached ────────────────────────────────────────────────────────

/**
 * The sale panel is a ~150s build (the dims join is the expensive half), so it
 * is cached for 30 minutes and every identity read shares it. The first request
 * after a deploy pays the build; every one after reads the cache.
 */
const PANEL_TTL_MS = 30 * 60_000;
const nextCachedPanel = unstable_cache(async () => buildSalePanel(), ["identity-sale-panel:v1"], {
  revalidate: 1800,
  tags: ["platform-buckets"],
});
let panelMemo: { at: number; p: Promise<SaleRow[]> } | null = null;
/**
 * Next's data cache inside the app; an in-process memo with the same TTL
 * everywhere else. `unstable_cache` THROWS ("incrementalCache missing") when
 * called outside the Next runtime, which would make this reader unusable from
 * the probe scripts and the CI gate — the places that prove it is right.
 */
async function cachedPanel(): Promise<SaleRow[]> {
  try {
    return await nextCachedPanel();
  } catch (e) {
    if (!/incrementalCache/.test(String(e))) throw e;
    if (!panelMemo || Date.now() - panelMemo.at > PANEL_TTL_MS) panelMemo = { at: Date.now(), p: buildSalePanel() };
    return panelMemo.p;
  }
}

/**
 * slug → identity keys, over the panel's identities AND the dims' identities
 * (a slab that has never sold still belongs to its identity's page). Memoised
 * per panel instance in-process; cheap next to the panel itself.
 */
type SlugIndex = {
  bySlug: Map<string, string[]>;
  slabsByKey: Map<string, { platform: CardPlatform; tokenId: string }[]>;
  /** base identity (everything but the grade) → every key sharing it, for the grade ladder. */
  siblingsOf: Map<string, string[]>;
};

/** The key with its grade field blanked — the grade ladder's join. */
function baseOf(key: string): string {
  const f = key.split("|");
  if (f.length !== 7) return key;
  f[4] = "";
  return f.join("|");
}
let slugMemo: { panel: SaleRow[]; idx: SlugIndex } | null = null;

async function slugIndex(panel: SaleRow[]): Promise<SlugIndex> {
  if (slugMemo && slugMemo.panel === panel) return slugMemo.idx;
  const bySlug = new Map<string, string[]>();
  const slabsByKey = new Map<string, { platform: CardPlatform; tokenId: string }[]>();
  const siblingsOf = new Map<string, string[]>();
  const seenKey = new Set<string>();
  const add = (slug: string | null, key: string) => {
    if (!slug) return;
    const a = bySlug.get(slug);
    if (!a) bySlug.set(slug, [key]);
    else if (!a.includes(key)) a.push(key);
    if (!seenKey.has(key)) {
      seenKey.add(key);
      const b = baseOf(key);
      const sibs = siblingsOf.get(b);
      if (sibs) sibs.push(key);
      else siblingsOf.set(b, [key]);
    }
  };
  for (const r of panel) {
    if (!r.identity) continue;
    const pk = parseIdentityKey(r.identity);
    if (pk) add(identitySlug(pk.ip, pk.parts), r.identity);
  }
  const dims = await readAllCardDims();
  for (const [platform, m] of dims) {
    for (const [tokenId, d] of m) {
      if (!d.identity) continue;
      const key = identityKey(d.ip, d.identity);
      if (!key) continue;
      add(identitySlug(d.ip, d.identity), key);
      const s = slabsByKey.get(key);
      if (s) s.push({ platform: platform as CardPlatform, tokenId });
      else slabsByKey.set(key, [{ platform: platform as CardPlatform, tokenId }]);
    }
  }
  slugMemo = { panel, idx: { bySlug, slabsByKey, siblingsOf } };
  return slugMemo.idx;
}

// ── resolution: two paths, one candidate set ─────────────────────────────────

/** Panel path — works from day one, no column needed. */
async function resolveViaPanel(slug: string, panel: SaleRow[]): Promise<string[]> {
  const idx = await slugIndex(panel);
  return idx.bySlug.get(slug) ?? [];
}

/**
 * Column path — a keyset read on `cards.identity_slug` once the migration is
 * applied. Returns null (not []) while the column is absent so the caller can
 * tell "no such column yet" from "no such identity".
 */
export async function resolveViaColumn(slug: string): Promise<string[] | null> {
  try {
    const { data, error } = await db().from("cards").select("identity_key").eq("identity_slug", slug).limit(200);
    if (error) return /identity_slug|identity_key/.test(error.message) ? null : [];
    return [...new Set((data ?? []).map((r) => String(r.identity_key)).filter(Boolean))];
  } catch {
    return null;
  }
}

/** Most sales, then most slabs, then the lexicographically first key. */
function canonicalKey(keys: string[], panel: SaleRow[], idx: SlugIndex): string {
  const sales = new Map<string, number>();
  for (const r of panel) if (r.identity && keys.includes(r.identity)) sales.set(r.identity, (sales.get(r.identity) ?? 0) + 1);
  return [...keys].sort((a, b) => {
    const d = (sales.get(b) ?? 0) - (sales.get(a) ?? 0);
    if (d) return d;
    const s = (idx.slabsByKey.get(b)?.length ?? 0) - (idx.slabsByKey.get(a)?.length ?? 0);
    return s || a.localeCompare(b);
  })[0];
}

// ── helpers ──────────────────────────────────────────────────────────────────

const ipNameOf = (ip: string) => IP_CATALOG.find((i) => i.key === ip)?.name ?? ip;


/** Whose listings are complete. Beezie's still arrive through the aggregator. */
const LISTING_SOURCE: Record<string, "native" | "aggregator"> = {
  "collector-crypt": "native",
  phygitals: "native",
  courtyard: "native",
  beezie: "aggregator",
};

function certOf(attributes: { trait_type?: string; value?: unknown }[] | undefined): string | null {
  for (const a of attributes ?? []) {
    const t = (a.trait_type ?? "").toLowerCase();
    if (/cert|certificate|serial/.test(t) && a.value != null) return String(a.value);
  }
  return null;
}

// ── the build ────────────────────────────────────────────────────────────────

/**
 * Listings are a multi-MB gzip blob; inflate once per process per TTL and index
 * by `platform:tokenId` once, so a 53-slab identity costs 53 map lookups rather
 * than 53 scans of ~59K entries (measured: 3.5s → sub-second).
 */
type ListingIndex = Map<string, ListingEntry>;
let listingsMemo: { at: number; p: Promise<ListingIndex> } | null = null;
function cachedListingIndex(): Promise<ListingIndex> {
  if (!listingsMemo || Date.now() - listingsMemo.at > PANEL_TTL_MS) {
    listingsMemo = {
      at: Date.now(),
      p: readListings()
        .then((snap) => {
          const m: ListingIndex = new Map();
          for (const e of Object.values(snap?.byItem ?? {})) {
            // "SOLANA:<mint>" → mint · "CHAIN:contract:tokenId" → tokenId
            const tokenId = e.itemId.includes(":") ? e.itemId.slice(e.itemId.lastIndexOf(":") + 1) : e.itemId;
            const k = `${e.platform}:${tokenId}`;
            const cur = m.get(k);
            if (!cur || e.priceUsd < cur.priceUsd) m.set(k, e);
          }
          return m;
        })
        .catch(() => new Map()),
    };
  }
  return listingsMemo.p;
}

async function buildDetail(slug: string, rawKeys: string[], panel: SaleRow[], via: "panel" | "column"): Promise<IdentityDetail | null> {
  if (!rawKeys.length) return null;
  // Deterministic input order: the panel path and the column path hand over the
  // same SET of keys in different orders, and everything below that iterates
  // keys (tokens, fragments) must not let that order leak into the output.
  const keys = [...new Set(rawKeys)].sort();
  const idx = await slugIndex(panel);
  const key = canonicalKey(keys, panel, idx);
  const pk = parseIdentityKey(key);
  if (!pk) return null;

  const mine = panel.filter((r) => r.identity === key).sort((a, b) => a.ts.localeCompare(b.ts));
  const sales: IdentitySale[] = mine.map((r) => ({ ts: r.ts, priceUsd: r.priceUsd, platform: r.platform, tokenId: r.tokenId }));

  // The identity's own monthly price — the index's per-identity median.
  const mp = monthlyIdentityPrices(mine);
  const runningMonth = monthStartUtc(Date.now());
  const monthly: IdentityMonthly[] = [...mp]
    .map(([m, byId]) => ({ m, v: byId.get(key) }))
    .filter((x): x is { m: string; v: { price: number; n: number } } => !!x.v)
    .map(({ m, v }) => ({ ts: monthEndUtc(Date.parse(m)), value: v.price, n: v.n, partial: m === runningMonth }))
    .sort((a, b) => a.ts.localeCompare(b.ts));
  const latestCompleteMonthly = [...monthly].reverse().find((m) => !m.partial) ?? null;

  // Tokens — the union across fragments; a slab is a slab.
  const slabRefs = keys.flatMap((k) => idx.slabsByKey.get(k) ?? []);
  const byPlatform = new Map<CardPlatform, string[]>();
  for (const s of slabRefs) (byPlatform.get(s.platform) ?? byPlatform.set(s.platform, []).get(s.platform)!).push(s.tokenId);
  const listingIdx = await cachedListingIndex();
  const lastSaleByToken = new Map<string, { ts: string; priceUsd: number }>();
  for (const r of panel) {
    if (!keys.includes(r.identity ?? "")) continue;
    const k = `${r.platform}:${r.tokenId}`;
    const cur = lastSaleByToken.get(k);
    if (!cur || r.ts > cur.ts) lastSaleByToken.set(k, { ts: r.ts, priceUsd: r.priceUsd });
  }
  const tokens: IdentityToken[] = [];
  for (const [platform, ids] of byPlatform) {
    const meta = await readCards(platform, ids).catch(() => new Map());
    for (const tokenId of ids) {
      const m = meta.get(tokenId);
      const l = listingIdx.get(`${platform}:${tokenId}`) ?? null;
      tokens.push({
        platform,
        tokenId,
        cardId: cardHref(platform, tokenId).replace(/^\/card\//, ""),
        cert: certOf(m?.attributes),
        image: m?.image ?? null,
        lastSale: lastSaleByToken.get(`${platform}:${tokenId}`) ?? null,
        listing: l ? { priceUsd: l.priceUsd, platform: l.platform } : null,
      });
    }
  }
  tokens.sort((a, b) => (b.lastSale?.ts ?? "").localeCompare(a.lastSale?.ts ?? "") || a.platform.localeCompare(b.platform) || a.tokenId.localeCompare(b.tokenId));

  // Floor — lowest live listing, with coverage stated per venue present.
  const listed = tokens.filter((t) => t.listing && t.listing.priceUsd > 0);
  const venuesPresent = [...new Set(tokens.map((t) => t.platform))];
  const floor: IdentityFloor = listed.length
    ? (() => {
        const best = listed.reduce((a, b) => (b.listing!.priceUsd < a.listing!.priceUsd ? b : a));
        return {
          priceUsd: best.listing!.priceUsd,
          platform: best.listing!.platform,
          vsMonthly: latestCompleteMonthly && latestCompleteMonthly.value > 0 ? best.listing!.priceUsd / latestCompleteMonthly.value : null,
          coverage: venuesPresent.map((p) => ({ platform: p, source: LISTING_SOURCE[p] ?? "aggregator" })),
        };
      })()
    : null;

  // Venues — 30d sales/volume, live listings, share of 30d sales.
  const d30 = Date.now() - 30 * 86_400_000;
  const venueMap = new Map<CardPlatform, IdentityVenue>();
  for (const p of venuesPresent) venueMap.set(p, { platform: p, sales30d: 0, volume30d: 0, listings: 0, share: 0 });
  for (const s of sales) {
    if (Date.parse(s.ts) < d30) continue;
    const v = venueMap.get(s.platform) ?? venueMap.set(s.platform, { platform: s.platform, sales30d: 0, volume30d: 0, listings: 0, share: 0 }).get(s.platform)!;
    v.sales30d += 1;
    v.volume30d += s.priceUsd;
  }
  for (const t of listed) { const v = venueMap.get(t.platform); if (v) v.listings += 1; }
  const tot30 = [...venueMap.values()].reduce((a, v) => a + v.sales30d, 0);
  const venues = [...venueMap.values()].map((v) => ({ ...v, share: tot30 ? (v.sales30d / tot30) * 100 : 0 })).sort((a, b) => b.sales30d - a.sales30d);

  // Grade ladder — siblings share ip/set/number/name (and edition/language).
  const siblingKeys = idx.siblingsOf.get(baseOf(key)) ?? [key];
  const sibPanel = panel.filter((r) => r.identity && siblingKeys.includes(r.identity));
  const sibMonthly = monthlyIdentityPrices(sibPanel);
  const premiums = await readPremiumSeries().catch(() => []);
  const myGrade = canonicalGrade(pk.parts.grade);
  const rungs = new Map<string, GradeRung>();
  for (const k of siblingKeys) {
    const q = parseIdentityKey(k)!;
    const g = canonicalGrade(q.parts.grade);
    if (rungs.has(g)) continue;
    let latest: IdentityMonthly | null = null;
    for (const [m, byId] of sibMonthly) { const v = byId.get(k); if (v) { const ts = monthEndUtc(Date.parse(m)); if (!latest || ts > latest.ts) latest = { ts, value: v.price, n: v.n, partial: m === runningMonth }; } }
    let premiumVsThis: GradeRung["premiumVsThis"] = null;
    if (g !== myGrade) {
      const pair = PREMIUM_PAIRS.find((p) => (p.better === myGrade && p.worse === g) || (p.better === g && p.worse === myGrade));
      const series = pair ? premiums.find((s) => s.pair.id === pair.id) : null;
      const last = series?.points.at(-1);
      if (pair && last) {
        const ratio = last.value / PREMIUM_TO_PERCENT;
        premiumVsThis = { ratio: pair.better === myGrade ? ratio : 1 / ratio, n: last.n ?? 0, month: last.ts.slice(0, 7) };
      }
    }
    rungs.set(g, { slug: identitySlug(q.ip, q.parts) ?? slug, grade: g, isThis: g === myGrade, latestMonthly: latest, premiumVsThis });
  }
  const gradeOrder = (g: string) => { const m = /^(\w+)\s+(\d+(?:\.\d)?)$/.exec(g); return m ? -parseFloat(m[2]) + (m[1] === "PSA" ? 0 : 0.01) : 99; };
  const gradeLadder = [...rungs.values()].sort((a, b) => gradeOrder(a.grade) - gradeOrder(b.grade));

  // Index membership — computed on read, not stored: the rule is one line
  // (published entity whose scope contains this identity, and n ≥ 2 in the
  // latest complete month) and the inputs are already in hand. A second
  // snapshot would only be a cache of this line that could drift from it.
  const latestComplete = monthStartUtc(Date.parse(monthStartUtc(Date.now())) - 1);
  const pricedLatest = (mp.get(latestComplete)?.get(key)?.n ?? 0) >= MIN_SALES_PER_IDENTITY;
  const published = new Set(await readPriceIndexKeys().catch(() => [] as string[]));
  const candidates = [
    "market:total",
    `category:${categoryOf(pk.ip)}`,
    `ip:${pk.ip}`,
    `grade:${gradeSlug(myGrade)}`,
    pk.parts.set ? `set:${pk.ip}:${normalizeSetName(pk.parts.set).key ?? ""}` : "",
  ].filter(Boolean);
  const indexMembership = pricedLatest && pk.ip !== "other" ? candidates.filter((c) => published.has(c)) : [];

  const fragments = keys
    .filter((k) => k !== key)
    .map((k) => ({ key: k, sales: panel.filter((r) => r.identity === k).length, slabs: idx.slabsByKey.get(k)?.length ?? 0 }));

  const setId = pk.parts.set ? normalizeSetName(pk.parts.set) : null;
  return {
    slug,
    key,
    parts: {
      ip: pk.ip,
      ipName: ipNameOf(pk.ip),
      setKey: setId?.key ?? null,
      setName: setId?.name ?? null,
      number: pk.parts.number,
      name: pk.parts.cardName ?? slug.split("/")[3],
      grade: myGrade,
      edition: pk.parts.edition,
      language: pk.parts.language,
    },
    tokens,
    sales,
    monthly,
    floor,
    venues,
    gradeLadder,
    indexMembership,
    fragments,
    resolvedVia: via,
    generatedAt: new Date().toISOString(),
  };
}

/** Uncached core — exported for the equivalence probe and the API. */
export async function readIdentityDetail(rawSlug: string): Promise<IdentityDetail | null> {
  try {
    const parsed = parseIdentitySlug(rawSlug);
    if (!parsed) return null;
    const panel = await cachedPanel();
    const viaColumn = await resolveViaColumn(parsed.slug);
    const keys = viaColumn ?? (await resolveViaPanel(parsed.slug, panel));
    return buildDetail(parsed.slug, keys, panel, viaColumn ? "column" : "panel");
  } catch (e) {
    console.warn(`[identity] ${rawSlug}: ${(e as Error).message}`);
    return null;
  }
}

export const getIdentityDetail: (slug: string) => Promise<IdentityDetail | null> = unstable_cache(
  readIdentityDetail,
  ["identity-detail:v1"],
  { revalidate: 1800, tags: ["platform-buckets"] },
);

/** The panel path alone — for the two-path equivalence check. */
export async function resolveViaPanelForProbe(slug: string): Promise<string[]> {
  return resolveViaPanel(slug, await cachedPanel());
}

/** Every slug the panel + dims know, with its keys — for search and the probe. */
export async function listIdentitySlugs(): Promise<Map<string, string[]>> {
  return (await slugIndex(await cachedPanel())).bySlug;
}

/** Exposed for the probe: the same `buildDetail` from a given key set. */
export async function buildDetailForProbe(slug: string, keys: string[], via: "panel" | "column"): Promise<IdentityDetail | null> {
  return buildDetail(slug, keys, await cachedPanel(), via);
}

export { PLATFORM_META as IDENTITY_PLATFORM_META };
export type { CardIdentityParts };
