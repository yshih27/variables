/**
 * Phygitals marketplace API client (api.phygitals.com).
 *
 * Public read endpoints (need a browser UA + Origin). Lights up Phygitals'
 * cards, floor, and FMV — data we previously had none of. The listings feed
 * AGGREGATES Solana marketplaces (Tensor, Magic Eden, native). Gacha aggregates
 * stay on Dune; this client is marketplace/listings + the headline totals.
 *
 * Note: Phygitals cards are compressed NFTs (cNFT). The listings sort
 * price-low-high, so page 1 ≈ the floor.
 */
import { PHYGITALS_COLLECTIONS } from "@/lib/data/sources";

const BASE = "https://api.phygitals.com/api/marketplace";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Origin: "https://www.phygitals.com",
  Referer: "https://www.phygitals.com/",
  Accept: "application/json",
};

// Phygitals collection mints (cNFT). Canonical list lives in the platform
// registry (verified IDs); re-exported here for the listings query below.
export { PHYGITALS_COLLECTIONS };

export type PhygitalsListing = {
  address: string; // Solana mint
  name?: string;
  image?: string; // irys gateway
  slug?: string;
  price?: string; // USDC raw (/1e6)
  altFmv?: string | null;
  fmv_override?: boolean;
  marketplace?: string; // TENSOR | MAGIC_EDEN | native
  currency?: string;
  token_standard?: string; // CNFT
  collection_address?: string;
  listed?: boolean;
  properties?: { category?: unknown; files?: unknown; creators?: unknown };
  metadata?: unknown;
};

/**
 * The prize attached to a CLAW (pull) row. This is where Phygitals' gacha
 * value lives — the pulled card's FMV, art, grade, and mint. (On CLAW rows the
 * top-level `nft` is null; the prize is here.) `fmv` is reliably present;
 * `rarity` is currently null across the feed, so realized odds are derived from
 * `fmv` value-bands, not this field. See warmers/phygitalsGacha.ts.
 */
export type PhygitalsEbayListing = {
  fmv?: string | null; // prize market value, USD (e.g. "17.03")
  fmv_source?: string | null;
  rarity?: string | null; // observed null feed-wide — kept for when it lights up
  category?: string | null; // 'pokemon' | 'one piece' | …
  mint_address?: string | null; // Solana mint of the pulled card
  cert_number?: string | null;
  grader?: string | null;
  slug?: string | null;
  data?: {
    title?: string; // full card name incl. grade ("… CGC 9 MINT")
    image?: { imageUrl?: string };
    price?: { value?: string; currency?: string };
  };
};

export type PhygitalsSale = {
  txid: string;
  time: string; // ISO
  amount: string; // USDC raw
  type: string; // CLAW (pull) | BUY (buyback) | …
  from: string;
  to: string;
  clawId?: string | null; // gacha pack id when present
  currency?: string;
  nft?: { address: string; name?: string; image?: string } | null;
  ebayListing?: PhygitalsEbayListing | null; // the prize, on CLAW rows
};

const REQUEST_TIMEOUT_MS = 15_000;
const backoffMs = (attempt: number) =>
  Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);

// Resilient JSON GET: a request timeout + backoff retries on BOTH transient HTTP
// status (429 / 5xx) AND network-level failures (abort/timeout, "terminated",
// ECONNRESET) — which is how the marketplace endpoint throttles a fast crawl
// (it stalls the socket rather than returning 429). Without this, one stalled or
// rate-limited page threw and sank the whole warmer — silently, since freshness
// was only recorded on success, so it read "stale" not "error".
async function getJson<T>(url: string, attempt = 0): Promise<T> {
  let res: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      res = await fetch(url, { headers: HEADERS, cache: "no-store", signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
      return getJson<T>(url, attempt + 1);
    }
    throw err;
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt);
    await new Promise((r) => setTimeout(r, waitMs));
    return getJson<T>(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Phygitals ${res.status} on ${url.replace(BASE, "")}`);
  return (await res.json()) as T;
}

/**
 * One page of active marketplace listings (sorted cheapest-first).
 * `total` is the count of all matching listings (for pagination).
 */
export async function fetchPhygitalsListings(
  page = 1,
  itemsPerPage = 100,
  metadataConditions: Record<string, unknown> = {},
): Promise<{ listings: PhygitalsListing[]; total: number }> {
  const params = new URLSearchParams({
    searchTerm: "",
    sortBy: "price-low-high",
    itemsPerPage: String(itemsPerPage),
    page: String(page),
    metadataConditions: JSON.stringify(metadataConditions),
    priceRange: "[null,null]",
    fmvRange: "[null,null]",
    listedStatus: "listed",
    collectionAddresses: JSON.stringify(PHYGITALS_COLLECTIONS),
  });
  const d = await getJson<{ listings?: PhygitalsListing[]; amount?: number }>(
    `${BASE}/marketplace-listings?${params.toString()}`,
  );
  return { listings: d.listings ?? [], total: Number(d.amount ?? 0) };
}

/**
 * Recent sales feed (gacha-dominated: CLAW pulls + BUY buybacks, clawId-tagged;
 * peer-to-peer marketplace sales are rare). Fixed 10/page. Also carries the
 * headline totals we surface on the platform page.
 */
export async function fetchPhygitalsSales(page = 0): Promise<{
  sales: PhygitalsSale[];
  totalVolume: number;
  totalActiveListingsCount: number;
}> {
  const d = await getJson<{
    sales?: PhygitalsSale[];
    totalVolume?: number;
    totalActiveListingsCount?: number;
  }>(`${BASE}/sales?page=${page}`);
  return {
    sales: d.sales ?? [],
    totalVolume: Number(d.totalVolume ?? 0),
    totalActiveListingsCount: Number(d.totalActiveListingsCount ?? 0),
  };
}

// ─────────────────────────── Gacha pack catalog (vm) ───────────────────────────
// The pack picker UI is driven by the "vm" (vending machine) namespace.
// `/api/vm/chase/{slug}` returns each pack's ADVERTISED top prizes ("chase"
// items) — the grails you could pull. There is NO advertised odds/EV endpoint
// (all 404), so realized odds/EV come from our own pull spine. Pack slugs +
// prices are a stable hardcoded catalog (chase carries no price); the trailing-
// hash clawIds in the /sales feed are NOT these slugs and rotate on restock, so
// realized pulls join to a pack by (category, price), never by id.

const VM_BASE = "https://api.phygitals.com/api/vm";

/** One advertised top prize available in a pack. */
export type PhygitalsChaseItem = {
  id: string; // Solana mint
  name: string;
  image: string | null;
  fmv: number; // USD
};

/** A pack in the Phygitals catalog. Category here is authoritative (from the
 *  catalog), not inferred. Two Pokémon packs share $500 (Base Set + Platinum). */
export type PhygitalsPackDef = {
  slug: string;
  name: string;
  priceUsd: number;
  category: "pokemon" | "one_piece";
};

export const PHYGITALS_PACK_CATALOG: PhygitalsPackDef[] = [
  { slug: "trainer-pack", name: "Trainer", priceUsd: 10, category: "pokemon" },
  { slug: "rookie-pack", name: "Rookie", priceUsd: 25, category: "pokemon" },
  { slug: "elite-pack", name: "Elite", priceUsd: 50, category: "pokemon" },
  { slug: "sealed-pack", name: "Sealed", priceUsd: 100, category: "pokemon" },
  { slug: "legend-pack", name: "Legend", priceUsd: 250, category: "pokemon" },
  { slug: "base-set-pack", name: "Base Set", priceUsd: 500, category: "pokemon" },
  { slug: "platinum-pack", name: "Platinum", priceUsd: 500, category: "pokemon" },
  { slug: "mythic-pack", name: "Mythic", priceUsd: 1000, category: "pokemon" },
  { slug: "black-pack", name: "Black", priceUsd: 2500, category: "pokemon" },
  { slug: "diamond-pack", name: "Diamond", priceUsd: 5000, category: "pokemon" },
  { slug: "starter-one-piece-pack", name: "Starter", priceUsd: 25, category: "one_piece" },
  { slug: "elite-one-piece-pack", name: "Elite", priceUsd: 50, category: "one_piece" },
  { slug: "legend-one-piece-pack", name: "Legend", priceUsd: 250, category: "one_piece" },
];

/** A pack's advertised top prizes, value-desc. Empty array if the pack is inactive. */
export async function fetchPhygitalsChase(slug: string): Promise<PhygitalsChaseItem[]> {
  const res = await fetch(`${VM_BASE}/chase/${slug}`, { headers: HEADERS, cache: "no-store" });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Phygitals chase ${res.status} on ${slug}`);
  }
  const d = (await res.json()) as PhygitalsChaseItem[] | null;
  return Array.isArray(d) ? d : [];
}

/**
 * One STATED prize-value band from a pack's published odds — the rows under
 * "LIVE ODDS" on phygitals.com. `weight` is the raw probability (normalize by
 * the pack's band sum to get the %). `lower`/`upper` are USD value bounds.
 */
export type PhygitalsRarityBand = {
  name: string; // "Common" | "Uncommon" | "Rare" | "Epic" | "Mythic"
  color: string; // band swatch (a CSS color, e.g. "#22C55E" or "gray")
  lower: number; // USD
  upper: number; // USD
  weight: number;
};

/** A pack's published economics, keyed by slug — the source of the site's
 *  "Expected Value $X per pack" + "LIVE ODDS" panels. All STATED (vendor). */
export type PhygitalsPackOdds = {
  slug: string;
  name: string;
  priceUsd: number;
  evUsd: number; // stated expected value in $ per pack
  minEvUsd: number | null;
  maxEvUsd: number | null;
  buybackPct: number; // 0–1 (real, not assumed)
  pulls7d: number;
  enable: boolean; // vendor's on/off flag
  inStock: boolean; // currently has inventory (fluctuates as packs sell)
  bands: PhygitalsRarityBand[]; // the LIVE ODDS distribution, low→high value
};

type RawAvailable = {
  slug?: string;
  name?: string;
  mint_price?: string | number;
  ev?: number;
  min_ev?: number | null;
  max_ev?: number | null;
  buyback_percent?: number;
  num_pulls_7d?: number;
  enable?: boolean;
  in_stock?: boolean;
  rarity_distribution?: PhygitalsRarityBand[];
};

/** Live = the vendor has it enabled AND it's either stocked or still pulling.
 *  A popular pack can be momentarily out of stock yet very much alive (recent
 *  pulls); a truly archived pack is disabled OR has no stock AND no 7d pulls
 *  (e.g. base-set-pack: enable but in_stock=false, 0 pulls/7d). */
export function isPhygitalsLive(o: PhygitalsPackOdds | undefined): boolean {
  return !!o && o.enable && (o.inStock || o.pulls7d > 0);
}

/**
 * GET /api/vm/available — every live pack with its STATED odds + EV. One
 * unauthenticated call returns all ~69 packs (incl. category variants); we key
 * by slug. This is the published live-odds/EV the site renders (captured
 * 2026-06-11 — the endpoint we'd long flagged as "hidden"). Throws on non-200.
 */
export async function fetchPhygitalsAvailable(): Promise<Map<string, PhygitalsPackOdds>> {
  const res = await fetch(`${VM_BASE}/available?includeRepacks=false&platform=mainnet`, {
    headers: HEADERS,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Phygitals available ${res.status}`);
  const d = (await res.json()) as RawAvailable[] | null;
  const out = new Map<string, PhygitalsPackOdds>();
  for (const p of d ?? []) {
    if (!p.slug) continue;
    out.set(p.slug, {
      slug: p.slug,
      name: p.name ?? p.slug,
      priceUsd: Number(p.mint_price) || 0,
      evUsd: Number(p.ev) || 0,
      minEvUsd: p.min_ev != null ? Number(p.min_ev) : null,
      maxEvUsd: p.max_ev != null ? Number(p.max_ev) : null,
      buybackPct: Number(p.buyback_percent) || 0,
      pulls7d: Number(p.num_pulls_7d) || 0,
      enable: p.enable !== false,
      inStock: p.in_stock === true,
      bands: Array.isArray(p.rarity_distribution) ? p.rarity_distribution : [],
    });
  }
  return out;
}

// ─────────────────────────── Gacha (CLAW) feed ───────────────────────────
// Phygitals' gacha is the dominant activity in /sales. Each CLAW row links a
// pull to its prize in one record (clawId + ebayListing) — the thing Dune
// can't give us (pay and prize are separate txs there). We page the feed to
// derive realized odds, EV, and biggest hits. Long-window VOLUME stays on Dune.

/** One pull, flattened from a CLAW row. */
export type PhygitalsPull = {
  txid: string;
  time: string; // ISO
  pricePaidUsd: number; // amount / 1e6
  clawId: string; // pack/product id ("13", "elite-one-piece-pack-9ovh6m")
  buyer: string; // recipient wallet (`to`)
  prizeFmvUsd: number | null;
  prizeName: string | null;
  prizeImage: string | null;
  prizeMint: string | null;
  prizeCategory: string | null;
  prizeRarity: string | null;
};

/** One instant cash-out, flattened from a BUY row (player → gacha wallet). */
export type PhygitalsBuyback = {
  txid: string;
  time: string;
  payoutUsd: number; // amount / 1e6
  clawId: string | null;
  nftMint: string | null;
};

export type PhygitalsClawFeed = {
  pulls: PhygitalsPull[];
  buybacks: PhygitalsBuyback[];
  pagesScanned: number;
  /** Oldest event timestamp reached (ISO), for honest window labeling. */
  oldestTime: string | null;
  newestTime: string | null;
  /** Headline totals carried on the feed response (raw, /1e6 in caller). */
  totalVolume: number;
  totalActiveListingsCount: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usdFromRaw = (raw?: string | number | null): number | null => {
  if (raw == null) return null;
  const n = Number(raw) / 1e6;
  return Number.isFinite(n) ? n : null;
};
const fmvUsd = (raw?: string | null): number | null => {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function toPull(s: PhygitalsSale): PhygitalsPull | null {
  const el = s.ebayListing ?? null;
  const price = usdFromRaw(s.amount);
  if (price == null) return null;
  return {
    txid: s.txid,
    time: s.time,
    pricePaidUsd: price,
    clawId: String(s.clawId ?? ""),
    buyer: s.to,
    prizeFmvUsd: fmvUsd(el?.fmv),
    prizeName: el?.data?.title ?? null,
    prizeImage: el?.data?.image?.imageUrl ?? null,
    prizeMint: el?.mint_address ?? null,
    prizeCategory: el?.category ?? null,
    prizeRarity: el?.rarity ?? null,
  };
}

/**
 * Page the recent CLAW feed, collecting UNIQUE pulls + buybacks (deduped by
 * txid). ⚠️ Phygitals' `?page=N` offset pagination is unreliable for deep
 * traversal: it's non-monotonic in time and re-serves the same recent window
 * once the feed is churning (observed: page 5 and page 20 returning identical
 * spans; saturating to zero new rows after ~3 pages). So we don't trust it as a
 * contiguous time window — we just harvest whatever unique recent pulls it
 * yields. The WARMER accumulates these into gacha_pulls across runs and computes
 * odds/EV from the durable table; one scan is only ever a recent sample.
 *
 * Stops at the first of:
 *   • `maxPages` reached (the feed is 265K+ pages deep), or
 *   • `saturationPages` consecutive pages with zero new (deduped) rows — the
 *     tell-tale of the feed repeating its recent window, or
 *   • `maxPulls` unique pulls collected, or
 *   • an empty page / a fetch error (returns what's collected so far).
 *
 * Polite: a short delay between pages. `oldestTime`/`newestTime` are the TRUE
 * min/max of the unique rows seen (honest, possibly patchy — not a clean window).
 */
export async function fetchPhygitalsClawFeed(
  opts: {
    maxPages?: number;
    maxPulls?: number;
    saturationPages?: number;
    delayMs?: number;
    log?: (m: string) => void;
  } = {},
): Promise<PhygitalsClawFeed> {
  const maxPages = opts.maxPages ?? 300;
  const maxPulls = opts.maxPulls ?? Infinity;
  const saturationPages = opts.saturationPages ?? 6;
  const delayMs = opts.delayMs ?? 120;
  const log = opts.log ?? (() => {});

  const seen = new Set<string>(); // txid dedup across the whole scan
  const pulls: PhygitalsPull[] = [];
  const buybacks: PhygitalsBuyback[] = [];
  let pagesScanned = 0;
  let consecutiveDup = 0;
  let oldestMs = Infinity;
  let newestMs = -Infinity;
  let totalVolume = 0;
  let totalActiveListingsCount = 0;

  for (let page = 0; page < maxPages; page++) {
    let resp;
    try {
      resp = await fetchPhygitalsSales(page);
    } catch (err) {
      log(`  claw feed stopped at page ${page}: ${(err as Error).message}`);
      break;
    }
    pagesScanned = page + 1;
    if (page === 0) {
      totalVolume = resp.totalVolume;
      totalActiveListingsCount = resp.totalActiveListingsCount;
    }
    if (resp.sales.length === 0) break;

    let newThisPage = 0;
    for (const s of resp.sales) {
      if (seen.has(s.txid)) continue;
      seen.add(s.txid);
      newThisPage++;
      const tMs = Date.parse(s.time);
      if (Number.isFinite(tMs)) {
        if (tMs < oldestMs) oldestMs = tMs;
        if (tMs > newestMs) newestMs = tMs;
      }
      if (s.type === "CLAW") {
        const p = toPull(s);
        if (p) pulls.push(p);
      } else if (s.type === "BUY") {
        buybacks.push({
          txid: s.txid,
          time: s.time,
          payoutUsd: usdFromRaw(s.amount) ?? 0,
          clawId: s.clawId != null ? String(s.clawId) : null,
          nftMint: s.nft?.address ?? null,
        });
      }
    }

    if (newThisPage === 0) {
      if (++consecutiveDup >= saturationPages) {
        log(`  claw feed saturated at page ${page} (${saturationPages} repeat pages)`);
        break;
      }
    } else {
      consecutiveDup = 0;
    }
    if (pulls.length >= maxPulls) break;
    if (delayMs > 0) await sleep(delayMs);
  }

  const oldestTime = Number.isFinite(oldestMs) ? new Date(oldestMs).toISOString() : null;
  const newestTime = newestMs > 0 ? new Date(newestMs).toISOString() : null;
  log(
    `claw feed: ${pulls.length} unique pulls + ${buybacks.length} buybacks over ${pagesScanned} pages (${oldestTime ?? "?"} → ${newestTime ?? "?"})`,
  );
  return {
    pulls,
    buybacks,
    pagesScanned,
    oldestTime,
    newestTime,
    totalVolume,
    totalActiveListingsCount,
  };
}
