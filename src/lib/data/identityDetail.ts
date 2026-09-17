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
import { buildSalePanel, readSalePanel, type SaleRow } from "./salePanel";
import { readAllCardDims, readCards, type CardPlatform } from "./cards";
import { identityKey, parseIdentityKey, normalizeTraits, type CardIdentityParts } from "./traits";
import { identitySlug, parseIdentitySlug, gradeSlug } from "@/lib/card/identity";
import { characterOf, characterHref } from "@/lib/card/character";
import { normalizeSetName } from "@/lib/card/setName";
import { cardHref, parseCardId, PLATFORM_META } from "@/lib/card/ids";
import { monthlyIdentityPrices, MIN_SALES_PER_IDENTITY } from "./identityIndex";
import { canonicalGrade, PREMIUM_PAIRS } from "./gradePremium";
import { readPremiumSeries, PREMIUM_TO_PERCENT } from "./gradeSetIndex";
import { readListings, type ListingEntry } from "./listings";
import { readPriceIndexKeys } from "./indices";
import { IP_CATALOG, categoryOf } from "./ipCatalog";
import { monthStartUtc, monthEndUtc } from "@/lib/chart/period";
import { db } from "@/lib/db/client";
import { readSnapshot, writeSnapshot } from "@/lib/db/snapshots";
import { gzipSync, gunzipSync } from "node:zlib";

// ── contracts (ADD fields, never rename) ─────────────────────────────────────

export type IdentityParts = {
  ip: string;
  ipName: string;
  /** The card's name in the venue's own casing ("Charizard EX"), from the
   *  canonical token's traits; falls back to the identity key's upper-cased
   *  name. Surfaces print this; `name` stays the key's form for matching. */
  displayName: string;
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
  /**
   * The character this card depicts — "Charizard · every set and grade →".
   * From `characterOf(ip, name)` at read time (pure, no snapshot dependency);
   * null for trainers, energy, event cards and IPs without an extractor.
   * `identities` is filled from the character-rollups snapshot when it is
   * loaded, else 0 — the link is valid either way.
   */
  character: { key: string; name: string; href: string; identities: number } | null;
  generatedAt: string;
};

// ── the panel, cached ────────────────────────────────────────────────────────

/**
 * The sale panel is a ~150s build (the dims join is the expensive half), so it
 * is cached for 30 minutes and every identity read shares it. The first request
 * after a deploy pays the build; every one after reads the cache.
 */
const PANEL_TTL_MS = 30 * 60_000;

/**
 * The panel, SNAPSHOT FIRST. `warm-sale-panel` persists the panel it builds
 * (salePanel.ts `writeSalePanel`); this inflates it in well under a second.
 * Only when NO snapshot exists — a fresh database, or the indices batch has
 * never run — does it fall back to building the panel, and it says so on the
 * console, because a request path that builds the panel is a 90–220 s page.
 *
 * Next's data cache inside the app; an in-process memo with the same TTL
 * everywhere else, because `unstable_cache` throws ("incrementalCache missing")
 * outside the Next runtime and the probes and the CI gate must be able to read.
 */
async function loadPanel(): Promise<SaleRow[]> {
  const snap = await readSalePanel();
  if (snap) return snap.rows;
  console.warn(
    "[identity] no sale-panel snapshot — building the panel on the request path (90–220 s). Run warm-sale-panel.",
  );
  return buildSalePanel();
}
/**
 * ⚠️ AN IN-PROCESS MEMO, NOT `unstable_cache`. The inflated panel is ~5.3 MB and
 * Next's data cache refuses items over 2 MB ("items over 2MB can not be
 * cached") — measured on the audit dev server: the set failed on every read and
 * surfaced as an unhandledRejection, so the wrapper cached nothing and threw
 * noise. The per-SLUG result (`getIdentityDetail`) is small and stays in
 * `unstable_cache`; the panel itself lives in this module-level memo, which a
 * warm server instance keeps across requests for the same 30 minutes. A cold
 * instance pays one snapshot read and inflate (~1–4 s), never a build.
 */
let panelMemo: { at: number; p: Promise<SaleRow[]> } | null = null;
export async function cachedPanel(): Promise<SaleRow[]> {
  if (!panelMemo || Date.now() - panelMemo.at > PANEL_TTL_MS) {
    const p = loadPanel();
    panelMemo = { at: Date.now(), p };
    // A failed load must not poison the memo for 30 minutes.
    p.catch(() => { if (panelMemo?.p === p) panelMemo = null; });
  }
  return panelMemo.p;
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

/**
 * The persisted form of the slug index — the SECOND thing that must never be
 * built on a request path. The panel snapshot removed one 90 s cost; measured
 * with it in place the cold read was STILL 98–172 s, because this index is
 * derived from `readAllCardDims()` — the 152K-row scan that is the expensive
 * half of the panel build itself. So `warm-sale-panel` persists this too, from
 * the same run and the same panel, and readers inflate it.
 */
export type IdentityIndexSnapshot = {
  generatedAt: string;
  /** panel rows the index was built against — readers check it matches. */
  panelRows: number;
  /**
   * COMPACT, AND SPLIT IN TWO. The first cut stored the 53-char identity key in
   * three maps: 9.3 MB base64, above the 6.8 MB listings blob that is the largest
   * snapshot proven to write through PostgREST. Interning the keys and deriving
   * `siblingsOf` on read brought it to 7.1 MB — still above, because the 119K
   * slab refs are 41-char base58 mints and do not compress. So the slabs live in
   * their OWN snapshot (`identity-slabs`), and each piece stays under the proven
   * size: this one ~1.5 MB, the slabs ~5.7 MB. Post-migration the slabs snapshot
   * is redundant (a keyset read on cards.identity_key replaces it).
   */
  keys: string[];
  bySlug: Record<string, number[]>;
};
export type IdentitySlabsSnapshot = {
  generatedAt: string;
  panelRows: number;
  /** key index (into identity-index.keys) → card ids (`<code>-<tokenId>`). */
  slabs: Record<number, string[]>;
};
export const IDENTITY_INDEX_SNAPSHOT_KEY = "identity-index";
export const IDENTITY_SLABS_SNAPSHOT_KEY = "identity-slabs";

/** Build the index from the panel + the dims scan. The warmer's path. */
export async function buildIdentityIndex(panel: SaleRow[]): Promise<SlugIndex> {
  const bySlug = new Map<string, string[]>();
  const slabsByKey = new Map<string, { platform: CardPlatform; tokenId: string }[]>();
  const seenKey = new Set<string>();
  const add = (slug: string | null, key: string) => {
    if (!slug) return;
    const a = bySlug.get(slug);
    if (!a) bySlug.set(slug, [key]);
    else if (!a.includes(key)) a.push(key);
    seenKey.add(key);
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
      const sl = slabsByKey.get(key);
      if (sl) sl.push({ platform: platform as CardPlatform, tokenId });
      else slabsByKey.set(key, [{ platform: platform as CardPlatform, tokenId }]);
    }
  }
  return { bySlug, slabsByKey, siblingsOf: siblingsFrom(seenKey) };
}

/** `siblingsOf` from a key set — the grade ladder's join, rebuilt on read. */
function siblingsFrom(keys: Iterable<string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const k of keys) {
    const b = baseOf(k);
    const sibs = out.get(b);
    if (sibs) sibs.push(k);
    else out.set(b, [k]);
  }
  return out;
}

type Gz = { __gz__: string };
const gz = (o: unknown): Gz => ({ __gz__: gzipSync(Buffer.from(JSON.stringify(o))).toString("base64") });

/** The two packed snapshots the warmer writes (and `--out` writes verbatim). */
export function packIdentityIndex(idx: SlugIndex, panelRows: number, generatedAt: string): { index: Gz; slabs: Gz } {
  const keys = [...new Set([...[...idx.bySlug.values()].flat(), ...idx.slabsByKey.keys()])];
  const at = new Map(keys.map((k, i) => [k, i]));
  const slabs: Record<number, string[]> = {};
  for (const [k, refs] of idx.slabsByKey) slabs[at.get(k)!] = refs.map((r) => cardHref(r.platform, r.tokenId).replace(/^\/card\//, ""));
  const index: IdentityIndexSnapshot = {
    generatedAt,
    panelRows,
    keys,
    bySlug: Object.fromEntries([...idx.bySlug].map(([s, ks]) => [s, ks.map((k) => at.get(k)!)])),
  };
  const slabSnap: IdentitySlabsSnapshot = { generatedAt, panelRows, slabs };
  return { index: gz(index), slabs: gz(slabSnap) };
}

export async function writeIdentityIndex(idx: SlugIndex, panelRows: number, generatedAt: string): Promise<void> {
  const packed = packIdentityIndex(idx, panelRows, generatedAt);
  await writeSnapshot(IDENTITY_INDEX_SNAPSHOT_KEY, packed.index, generatedAt);
  await writeSnapshot(IDENTITY_SLABS_SNAPSHOT_KEY, packed.slabs, generatedAt);
}

function inflate<T>(raw: { __gz__?: string } | null): T | null {
  if (!raw || typeof raw.__gz__ !== "string") return null;
  return JSON.parse(gunzipSync(Buffer.from(raw.__gz__, "base64")).toString()) as T;
}

async function readIdentityIndex(): Promise<SlugIndex | null> {
  try {
    const [index, slabSnap] = await Promise.all([
      readSnapshot<Gz>(IDENTITY_INDEX_SNAPSHOT_KEY).then((r) => inflate<IdentityIndexSnapshot>(r)),
      readSnapshot<Gz>(IDENTITY_SLABS_SNAPSHOT_KEY).then((r) => inflate<IdentitySlabsSnapshot>(r)),
    ]);
    if (!index || !Array.isArray(index.keys) || !slabSnap) return null;
    // Both must come from the same warmer run, or a key index would point at
    // the wrong key. `generatedAt` is the run stamp on both.
    if (index.generatedAt !== slabSnap.generatedAt) {
      console.warn(`[identity] identity-index (${index.generatedAt}) and identity-slabs (${slabSnap.generatedAt}) are from different runs — rebuilding`);
      return null;
    }
    const bySlug = new Map<string, string[]>();
    for (const [slug, idxs] of Object.entries(index.bySlug)) bySlug.set(slug, idxs.map((i) => index.keys[i]));
    const slabsByKey = new Map<string, { platform: CardPlatform; tokenId: string }[]>();
    for (const [i, ids] of Object.entries(slabSnap.slabs)) {
      const refs: { platform: CardPlatform; tokenId: string }[] = [];
      for (const id of ids) {
        const parsed = parseCardId(id);
        if (parsed) refs.push(parsed);
      }
      slabsByKey.set(index.keys[Number(i)], refs);
    }
    return { bySlug, slabsByKey, siblingsOf: siblingsFrom(index.keys) };
  } catch (e) {
    console.warn(`[identity] identity snapshots unreadable: ${(e as Error).message}`);
    return null;
  }
}

let slugMemo: { panel: SaleRow[]; idx: SlugIndex } | null = null;

/** Snapshot first; the dims scan only when no snapshot exists, and it says so. */
async function slugIndex(panel: SaleRow[]): Promise<SlugIndex> {
  if (slugMemo && slugMemo.panel === panel) return slugMemo.idx;
  let idx = await readIdentityIndex();
  if (!idx) {
    console.warn("[identity] no identity-index snapshot — scanning cards dims on the request path (~90 s). Run warm-sale-panel.");
    idx = await buildIdentityIndex(panel);
  }
  slugMemo = { panel, idx };
  return idx;
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
/**
 * Whether `cards.identity_slug` exists, learned ONCE per process per TTL and
 * OFF the critical path: the first read fires the probe and does not wait for
 * it (the panel path answers, identically — proven), later reads use whatever
 * it learned. Until the migration lands every read was paying a round trip to
 * relearn that the column is absent; after it lands the switch is automatic.
 */
let columnState: { known: "present" | "absent"; until: number } | null = null;
let columnProbe: Promise<void> | null = null;
function probeColumn(): Promise<void> {
  if (columnProbe) return columnProbe;
  columnProbe = (async () => {
    try {
      const { error } = await db().from("cards").select("identity_slug").limit(1);
      const absent = !!error && /identity_slug|identity_key/.test(error.message);
      columnState = { known: absent ? "absent" : "present", until: Date.now() + PANEL_TTL_MS };
    } catch {
      columnState = { known: "absent", until: Date.now() + 60_000 };
    } finally {
      columnProbe = null;
    }
  })();
  return columnProbe;
}

/** Keyset read on `cards.identity_slug`. Null while the column is absent OR not
 *  yet known — the caller then uses the panel path, which yields the same keys. */
export async function resolveViaColumn(slug: string): Promise<string[] | null> {
  if (!columnState || Date.now() > columnState.until) {
    void probeColumn(); // learn in the background; this read does not wait
    return null;
  }
  if (columnState.known === "absent") return null;
  try {
    const { data, error } = await db().from("cards").select("identity_key").eq("identity_slug", slug).limit(200);
    if (error) return null;
    return [...new Set((data ?? []).map((r) => String(r.identity_key)).filter(Boolean))];
  } catch {
    return null;
  }
}

/** For the probe scripts: wait for the column state to be known. */
export async function awaitColumnProbe(): Promise<"present" | "absent"> {
  await probeColumn();
  return columnState?.known ?? "absent";
}

/**
 * The canonical fragment of a slug: most sales, then most slabs, then the
 * lexicographically first key. ONE rule, pure over its two counters, so the
 * identity page and the character rollups (which precompute the counters
 * over the whole panel once) pick the same key for the same slug.
 */
export function pickCanonicalKey(keys: string[], salesOf: (key: string) => number, slabsOf: (key: string) => number): string {
  return [...keys].sort((a, b) => salesOf(b) - salesOf(a) || slabsOf(b) - slabsOf(a) || a.localeCompare(b))[0];
}

function canonicalKey(keys: string[], panel: SaleRow[], idx: SlugIndex): string {
  const sales = new Map<string, number>();
  for (const r of panel) if (r.identity && keys.includes(r.identity)) sales.set(r.identity, (sales.get(r.identity) ?? 0) + 1);
  return pickCanonicalKey(keys, (k) => sales.get(k) ?? 0, (k) => idx.slabsByKey.get(k)?.length ?? 0);
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Identities under a character, from the rollups snapshot (its own module
 * memo). Imported lazily: characterRollups imports this module's coverage
 * rule and canonical-key picker, so a static import would be a cycle.
 * Degrades to 0 — the link on the page does not depend on it.
 */
async function characterIdentityCount(ip: string, key: string): Promise<number> {
  try {
    const { readCharacterLeaderboard } = await import("./characterRollups");
    const board = await readCharacterLeaderboard(ip, Number.MAX_SAFE_INTEGER);
    return board.find((r) => r.key === key)?.identities ?? 0;
  } catch {
    return 0;
  }
}

const ipNameOf = (ip: string) => IP_CATALOG.find((i) => i.key === ip)?.name ?? ip;


/** Whose listings are complete. Beezie's still arrive through the aggregator.
 *  Exported as the ONE coverage rule: the character rollups' `byVenue` reads it. */
export const IDENTITY_LISTING_SOURCE: Record<string, "native" | "aggregator"> = {
  "collector-crypt": "native",
  phygitals: "native",
  courtyard: "native",
  beezie: "aggregator",
};

/**
 * The slab's grading cert, or null.
 *
 * ⚠️ MEASURED 2026-09-14: Collector Crypt's traits carry BOTH a `Serial Number`
 * (the CARD number — "085" on Pikachu #085) and a `Grading ID` (the PSA cert,
 * 130495647); Beezie's cert is its `Serial`. A first-match on
 * /cert|certificate|serial/ returned the card number for every CC slab. So the
 * grading id and any "cert" trait win, and a bare `serial` is accepted only
 * when nothing better exists — never a "serial number".
 */
function certOf(attributes: { trait_type?: string; value?: unknown }[] | undefined): string | null {
  const attrs = (attributes ?? []).filter((a) => a.value != null && String(a.value).trim() !== "");
  const find = (re: RegExp) => attrs.find((a) => re.test((a.trait_type ?? "").toLowerCase()));
  const hit = find(/grading id|^cert(ificate)?( number| no\.?| id)?$/) ?? find(/^serial$/);
  return hit ? String(hit.value) : null;
}

// ── the build ────────────────────────────────────────────────────────────────

/**
 * Listings are a multi-MB gzip blob; inflate once per process per TTL and index
 * by `platform:tokenId` once, so a 53-slab identity costs 53 map lookups rather
 * than 53 scans of ~59K entries (measured: 3.5s → sub-second).
 */
export type ListingIndex = Map<string, ListingEntry>;
let listingsMemo: { at: number; p: Promise<ListingIndex> } | null = null;
export function cachedListingIndex(): Promise<ListingIndex> {
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
          coverage: venuesPresent.map((p) => ({ platform: p, source: IDENTITY_LISTING_SOURCE[p] ?? "aggregator" })),
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
  // The venue's own spelling of the name, from the first token that carries one.
  let displayName: string | null = null;
  for (const [platform, ids] of byPlatform) {
    if (displayName) break;
    const meta = await readCards(platform, ids.slice(0, 3)).catch(() => new Map());
    for (const m of meta.values()) {
      const n = normalizeTraits(m as Parameters<typeof normalizeTraits>[0])?.cardName?.trim();
      if (n) { displayName = n; break; }
    }
  }
  // The character hand-up: the link is pure over the identity's own parts;
  // only the count comes from the rollups snapshot (its own 30-minute memo,
  // one inflate per instance), and it degrades to 0 without changing the link.
  const ch = characterOf(pk.ip, pk.parts.cardName);
  const character: IdentityDetail["character"] = ch
    ? { key: ch.key, name: ch.name, href: characterHref(pk.ip, ch.key), identities: await characterIdentityCount(pk.ip, ch.key) }
    : null;

  return {
    slug,
    key,
    character,
    parts: {
      ip: pk.ip,
      ipName: ipNameOf(pk.ip),
      displayName: displayName ?? (pk.parts.cardName ?? slug.split("/")[3]),
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
  ["identity-detail:v2"], // v2: + `character` (a v1 entry would serve it undefined for up to 30 min)
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

/** The whole persisted index (slugs, slabs, siblings) — search reads slab
 *  counts from here rather than scanning dims itself. */
export async function listIdentityIndex(): Promise<SlugIndex> {
  return slugIndex(await cachedPanel());
}
export type { SlugIndex as IdentityIndex };

/** Exposed for the probe: the same `buildDetail` from a given key set. */
export async function buildDetailForProbe(slug: string, keys: string[], via: "panel" | "column"): Promise<IdentityDetail | null> {
  return buildDetail(slug, keys, await cachedPanel(), via);
}

export { PLATFORM_META as IDENTITY_PLATFORM_META };
export type { CardIdentityParts };
