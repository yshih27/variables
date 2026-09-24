/**
 * YOUR VAULT, VALUED — a wallet in, every slab priced by the same rule as its page.
 *
 * Portfolio apps make people type their collection; this reads it. The whole
 * value is in reading the chain honestly and pricing by the rule the site
 * already publishes, so this module adds NO estimator, NO floor rule and NO
 * number the identity page would not print:
 *
 *   address  → `parseWalletAddress` (chain detected, never asked)
 *   holdings → `enumerateHoldings` (DAS on Solana; on EVM an index finds
 *              candidates — Rarible for Courtyard, Blockscout for Beezie —
 *              and `ownerOf` on chain decides; budgeted, metered, a stop is
 *              a `partial` with its reason)
 *   join     → the `cards` row's `identity_key`; else the backfill's own
 *              derivation from the row; else from the metadata in hand
 *   price    → `valueIdentities` (the identity page's own `buildDetail`
 *              pricing, one panel walk for the whole vault) → `priceFieldsOf`
 *              (the reference price's own three fields)
 *
 * ⚠️ A FLOOR IS NEVER A VALUE. `value` is the identity's reference price (its
 * latest complete-month median, the Varible price) and, only without one, its
 * last sale. A floor is what someone ASKS; it is reported beside the value,
 * with the page's plausibility rule, and summed only as `atFloor` over
 * plausible floors — never into the headline.
 *
 * ⚠️ A HOLDING IS NEVER DROPPED. A slab we cannot key (Courtyard has no card
 * rows yet; a token too thin to identify) is listed with `identity: null` and
 * its reason; a keyed slab with no sale is listed with `value: null` and
 * `unvalued: "no-sale"`. The count of what could not be valued is part of the
 * answer.
 *
 * ⚠️ PRIVACY. An address is public on-chain, but the site must not become a
 * ledger of who looked up whom: nothing here writes or logs the address. The
 * 10-minute cache is the only state.
 */
import { unstable_cache } from "next/cache";
import { parseWalletAddress, type WalletAddress } from "@/lib/vault/address";
import { enumerateHoldings, VAULT_LIMITS, type HoldingsResult, type RawHolding } from "@/lib/vault/holdings";
import { readCardRowsByIds, cardRowFromMeta, type CardIdentityRow } from "./cards";
import { extractCardIdentity, identityKey, identityKeyRefusal, parseIdentityKey } from "./traits";
import { identitySlug, identityHref, identityDisplayName } from "@/lib/card/identity";
import { askInBand } from "@/lib/card/identityView";
import { cardHref, PLATFORM_META, type CardPlatform } from "@/lib/card/ids";
import { setDisplayName, normalizeSetName } from "@/lib/card/setName";
import { canonicalGrade } from "./gradePremium";
import { IP_CATALOG } from "./ipCatalog";
import { valueIdentities, identityKeyKnown, cachedListingIndex, cachedPanelAsOf, type IdentityValuation, type ListingIndex } from "./identityDetail";
import { priceFieldsOf, PRICE_METHOD, type PriceSaleRef } from "./referencePrice";
import { getBeezieMetadata, fixBeezieImage } from "./beezieTraits";
import { getTokenMetadata, type TokenMetadata } from "@/lib/onchain/tokenUri";

// ── contracts (ADD fields, never rename) ─────────────────────────────────────

export type VaultHolding = {
  /** `/card/<cardId>` */
  cardId: string;
  platform: CardPlatform;
  tokenId: string;
  /** The card's name as the venue spells it; null when the read carried none
   *  (Courtyard: Rarible's item has no name and there is no card row). */
  name: string | null;
  ip: string | null;
  /** Set display name. */
  set: string | null;
  number: string | null;
  grade: string | null;
  image: string | null;
  identity: { key: string; slug: string; href: string } | null;
  /** The chain confirmed this address owns the token (DAS on Solana, `ownerOf`
   *  on EVM). False only when no RPC answered: listed, and the vault is partial. */
  ownerVerified: boolean;
  /** Why `identity` is null: "courtyard-no-card-row", "no-set-or-number",
   *  "no-name", "grade-as-name", "beezie-metadata-cap" / "-timeout", "no-metadata". */
  unkeyed?: string;
  /** The identity's latest COMPLETE-month median — the Varible price. */
  reference: { month: string; priceUsd: number; n: number; thin: boolean } | null;
  lastSale: PriceSaleRef | null;
  /** The identity's lowest live ask, with the page's plausibility rule. */
  floor: { priceUsd: number; venue: string; plausible: boolean } | null;
  /** THIS token's own live listing, judged by the page's band against the
   *  holding's reference (else its last sale), exactly as the floor is. An
   *  aggregator placeholder — a $1.00 "ask" on a $445 card — is listed and
   *  marked not plausible, never printed as what the holder asks. With nothing
   *  to judge it against it is not plausible either. */
  yourAsk: { priceUsd: number; source: string; plausible: boolean } | null;
  /** The reference when it exists, else the last sale. Never a floor. */
  value: { usd: number; basis: "reference" | "last-sale" } | null;
  unvalued?: "no-identity" | "no-sale";
};

export type VaultSum = { usd: number; n: number };
export type VaultGroup = { key: string; label: string; holdings: number; valued: number; usd: number };

export type VaultTotals = {
  holdings: number;
  keyed: number;
  valued: number;
  atReference: VaultSum;
  /** Reference-or-last-sale — THE headline. */
  atValue: VaultSum;
  /** Plausible floors only. */
  atFloor: VaultSum;
  /** atFloor − atReference over the holdings that have BOTH; null when none do. */
  spread: { usd: number; pct: number; n: number } | null;
  unvalued: { n: number; reasons: Record<string, number>; unkeyed: Record<string, number> };
};

export type VaultValuation = {
  chain: WalletAddress["chain"];
  address: string;
  /** Venues this address was read on. */
  venues: CardPlatform[];
  holdings: VaultHolding[];
  totals: VaultTotals;
  byVenue: VaultGroup[];
  byIp: VaultGroup[];
  byGrade: VaultGroup[];
  /** Null when every tracked collection was read to the end. */
  partial: { reason: string; after: number } | null;
  /** What the read spent — pages and credits, per leg. */
  reads: HoldingsResult["reads"] & { beezieMetadataReads: number; resolveMs: number; valueMs: number };
  /** The sale panel's `generatedAt` — every price here is as of it. */
  asOf: string;
  method: typeof PRICE_METHOD;
};

// ── the join ─────────────────────────────────────────────────────────────────

/** A holding with its identity resolved, before pricing. */
export type ResolvedHolding = Omit<VaultHolding, "reference" | "lastSale" | "floor" | "yourAsk" | "value" | "unvalued">;

/** Live tokenURI reads per request for Beezie tokens with no card row. */
export const BEEZIE_METADATA_CAP = 50;

type RowLike = { name: string | null; cardName: string | null; ip: string; set: string | null; gradeLabel: string | null; year: number | null; cardNumber: string | null; image: string | null };

const rowOfMeta = (platform: CardPlatform, tokenId: string, meta: TokenMetadata): RowLike => {
  const r = cardRowFromMeta(platform, tokenId, meta);
  // `year` / `card_number` are not columns `cardRowFromMeta` writes, so a
  // fresh row carries null for both — exactly what the backfill would read.
  return { name: r.name, cardName: r.card_name, ip: r.ip_key, set: r.set_name, gradeLabel: r.grade_label, year: null, cardNumber: null, image: r.image };
};

/** The backfill's lines, verbatim: `extractCardIdentity` → `identityKey` / `identitySlug`. */
function derive(row: RowLike): { key: string | null; slug: string | null; cardName: string | null; refusal: string | null } {
  const parts = extractCardIdentity({ name: row.name, cardName: row.cardName, set: row.set, grade: row.gradeLabel, year: row.year, cardNumber: row.cardNumber });
  const key = identityKey(row.ip, parts);
  const slug = key ? identitySlug(row.ip, parts) : null;
  return key && slug
    ? { key, slug, cardName: parts.cardName, refusal: null }
    : { key: null, slug: null, cardName: parts.cardName, refusal: identityKeyRefusal(parts) ?? "no-slug" };
}

/**
 * One holding → its identity. Pure over its inputs (the row, the metadata in
 * hand, and whether the index knows the column's key), so the unit tests can
 * drive every branch.
 *
 * ⚠️ THE COLUMN WINS ONLY WHEN IT IS CURRENT. `cards.identity_key` is written by
 * a backfill; between a method change and the backfill's re-run the column
 * holds the previous method's key (the identity page guards the same window —
 * identityDetail.ts `readIdentityDetail`). So the column's key is taken when it
 * equals the derivation or the current index knows it; otherwise the
 * derivation, which is always current, wins.
 */
export function resolveHolding(
  h: { platform: CardPlatform; tokenId: string; ownerVerified?: boolean },
  src: { row: CardIdentityRow | null; meta: TokenMetadata | null; columnKnown: boolean; noMetaReason?: string },
): ResolvedHolding {
  const cardId = cardHref(h.platform, h.tokenId).replace(/^\/card\//, "");
  const row: RowLike | null = src.row ?? (src.meta ? rowOfMeta(h.platform, h.tokenId, src.meta) : null);
  const base = { cardId, platform: h.platform, tokenId: h.tokenId, image: row?.image ?? src.meta?.image ?? null, ownerVerified: h.ownerVerified ?? true };

  if (!row) {
    const unkeyed = h.platform === "courtyard" ? "courtyard-no-card-row" : (src.noMetaReason ?? "no-metadata");
    return { ...base, name: src.meta?.name ?? null, ip: null, set: null, number: null, grade: null, identity: null, unkeyed };
  }

  const derived = derive(row);
  const col = src.row?.identityKey && src.row.identitySlug ? { key: src.row.identityKey, slug: src.row.identitySlug } : null;
  const chosen = col && (col.key === derived.key || src.columnKnown) ? col : derived.key && derived.slug ? { key: derived.key, slug: derived.slug } : null;
  const pk = chosen ? parseIdentityKey(chosen.key) : null;

  const name = derived.cardName?.trim() || (pk?.parts.cardName ? identityDisplayName(pk.parts.cardName) : null) || row.name;
  if (!chosen || !pk) {
    return {
      ...base,
      name,
      ip: row.ip,
      set: setDisplayName(normalizeSetName(row.set).key) ?? row.set,
      number: null,
      grade: row.gradeLabel ? canonicalGrade(row.gradeLabel) : null,
      identity: null,
      // Which of the index's rules refused it: sealed product and sneakers have
      // no set or number, a nameless token has no name. Same words as the rule.
      unkeyed: derived.refusal ?? "no-identity",
    };
  }
  return {
    ...base,
    name,
    ip: pk.ip,
    set: setDisplayName(pk.parts.set) ?? pk.parts.set,
    number: pk.parts.number,
    grade: canonicalGrade(pk.parts.grade),
    identity: { key: chosen.key, slug: chosen.slug, href: identityHref(chosen.slug) },
  };
}

// ── the valuation, one pass, one rule ────────────────────────────────────────

/**
 * Price resolved holdings from their identities' valuations and the listing
 * index. Pure — the unit tests run it over `valueIdentityGroups` on a fixture
 * panel.
 */
export function priceHoldings(resolved: ResolvedHolding[], valuations: Map<string, IdentityValuation>, listings: ListingIndex): VaultHolding[] {
  return resolved.map((r) => {
    const ask = listings.get(`${r.platform}:${r.tokenId}`);
    // The same band the floor is judged by (identityView.ts `readFloor`), against
    // the same reference: the monthly price, else the last sale, else nothing.
    const askOf = (ref: number | null): VaultHolding["yourAsk"] =>
      ask && ask.priceUsd > 0
        ? {
            priceUsd: ask.priceUsd,
            source: ask.source,
            plausible: askInBand(ask.priceUsd, ref),
          }
        : null;
    const v = r.identity ? valuations.get(r.identity.key) : undefined;
    if (!r.identity || !v) {
      return { ...r, reference: null, lastSale: null, floor: null, yourAsk: askOf(null), value: null, unvalued: r.identity ? "no-sale" : "no-identity" };
    }
    const f = priceFieldsOf(v);
    const value: VaultHolding["value"] = f.price
      ? { usd: f.price.priceUsd, basis: "reference" }
      : f.lastSale
        ? { usd: f.lastSale.priceUsd, basis: "last-sale" }
        : null;
    return {
      ...r,
      reference: f.price,
      lastSale: f.lastSale,
      floor: f.floor ? { priceUsd: f.floor.priceUsd, venue: f.floor.venue, plausible: f.floor.plausible } : null,
      yourAsk: askOf(f.price?.priceUsd ?? f.lastSale?.priceUsd ?? null),
      value,
      ...(value ? {} : { unvalued: "no-sale" as const }),
    };
  });
}

const ipLabel = (ip: string) => IP_CATALOG.find((i) => i.key === ip)?.name ?? ip;

function groupBy(holdings: VaultHolding[], keyOf: (h: VaultHolding) => string, labelOf: (k: string) => string): VaultGroup[] {
  const m = new Map<string, VaultGroup>();
  for (const h of holdings) {
    const k = keyOf(h);
    const g = m.get(k) ?? m.set(k, { key: k, label: labelOf(k), holdings: 0, valued: 0, usd: 0 }).get(k)!;
    g.holdings++;
    if (h.value) {
      g.valued++;
      g.usd += h.value.usd;
    }
  }
  return [...m.values()].sort((a, b) => b.usd - a.usd || b.holdings - a.holdings || a.key.localeCompare(b.key));
}

/** Totals and the three breakdowns, on the `atValue` basis. Pure. */
export function summarize(holdings: VaultHolding[]): { totals: VaultTotals; byVenue: VaultGroup[]; byIp: VaultGroup[]; byGrade: VaultGroup[] } {
  const sum = (xs: number[]): VaultSum => ({ usd: xs.reduce((a, b) => a + b, 0), n: xs.length });
  const both = holdings.filter((h) => h.reference && h.floor?.plausible);
  const refBoth = both.reduce((a, h) => a + h.reference!.priceUsd, 0);
  const floorBoth = both.reduce((a, h) => a + h.floor!.priceUsd, 0);
  const reasons: Record<string, number> = {};
  const unkeyed: Record<string, number> = {};
  for (const h of holdings) {
    if (h.unvalued) reasons[h.unvalued] = (reasons[h.unvalued] ?? 0) + 1;
    if (h.unkeyed) unkeyed[h.unkeyed] = (unkeyed[h.unkeyed] ?? 0) + 1;
  }
  const UNCLASSIFIED = "unclassified";
  return {
    totals: {
      holdings: holdings.length,
      keyed: holdings.filter((h) => h.identity).length,
      valued: holdings.filter((h) => h.value).length,
      atReference: sum(holdings.flatMap((h) => (h.reference ? [h.reference.priceUsd] : []))),
      atValue: sum(holdings.flatMap((h) => (h.value ? [h.value.usd] : []))),
      atFloor: sum(holdings.flatMap((h) => (h.floor?.plausible ? [h.floor.priceUsd] : []))),
      spread: both.length ? { usd: floorBoth - refBoth, pct: refBoth > 0 ? ((floorBoth - refBoth) / refBoth) * 100 : 0, n: both.length } : null,
      unvalued: { n: holdings.filter((h) => !h.value).length, reasons, unkeyed },
    },
    byVenue: groupBy(holdings, (h) => h.platform, (k) => PLATFORM_META[k as CardPlatform]?.label ?? k),
    byIp: groupBy(holdings, (h) => h.ip ?? UNCLASSIFIED, (k) => (k === UNCLASSIFIED ? "Unclassified" : ipLabel(k))),
    byGrade: groupBy(holdings, (h) => h.grade ?? UNCLASSIFIED, (k) => (k === UNCLASSIFIED ? "Unclassified" : k)),
  };
}

// ── the read ─────────────────────────────────────────────────────────────────

export type VaultReadOpts = {
  /** "persist" (the product): a Beezie token with no card row is read with
   *  `getBeezieMetadata`, which persists it as the identity page already does.
   *  "read-only" (probes, executors): the same tokenURI read, never written. */
  beezieMetadata?: "persist" | "read-only";
  /** Holdings-enumeration overrides (budgets, wall clock) — probes only. */
  limits?: Partial<typeof VAULT_LIMITS>;
};

/**
 * The Beezie metadata reads' own wall clock. ⚠️ MEASURED 2026-09-24: ten reads
 * took 73–87 s on one wallet — `getTokenMetadata` has no timeout and backs off
 * 2/4/8/16 s on every Cloudflare 429 from Beezie's metadata host, so an
 * unbounded step turned a one-second vault into a minute and a half. What is
 * not read by the deadline is listed `beezie-metadata-timeout`; in "persist"
 * mode the read carries on and lands in `cards`, so the next look keys it.
 */
export const BEEZIE_METADATA_WALL_MS = 8_000;

/** Read Beezie metadata for tokens with no card row, capped and bounded. */
async function beezieMetaFor(
  tokenIds: string[],
  mode: "persist" | "read-only",
): Promise<{ metas: Map<string, TokenMetadata>; reads: number; capped: Set<string>; late: Set<string> }> {
  const metas = new Map<string, TokenMetadata>();
  const todo = tokenIds.slice(0, BEEZIE_METADATA_CAP);
  const capped = new Set(tokenIds.slice(BEEZIE_METADATA_CAP));
  const read = (id: string) =>
    mode === "persist"
      ? getBeezieMetadata(id)
      : getTokenMetadata("base", "0xbb5ec6fd4b61723bd45c399840f1d868840ca16f", id).then((m) => (m ? fixBeezieImage(m) : null));
  const deadline = Date.now() + BEEZIE_METADATA_WALL_MS;
  // Three at a time: the host rate-limits per IP, and a 429 costs seconds.
  const queue = [...todo];
  const workers = Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let id = queue.shift(); id && Date.now() < deadline; id = queue.shift()) {
        const m = await read(id).catch(() => null);
        if (m && Date.now() <= deadline) metas.set(id, m);
      }
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([workers, new Promise<void>((r) => (timer = setTimeout(r, BEEZIE_METADATA_WALL_MS)))]);
  clearTimeout(timer);
  workers.catch(() => {});
  // Snapshot what arrived in time; a read that lands later is not used here.
  const inTime = new Map(metas);
  const late = new Set(todo.filter((id) => !inTime.has(id)));
  return { metas: inTime, reads: todo.length, capped, late };
}

async function resolveAll(raw: RawHolding[], opts: VaultReadOpts): Promise<{ resolved: ResolvedHolding[]; beezieReads: number }> {
  const byPlatform = new Map<CardPlatform, string[]>();
  for (const h of raw) if (h.platform !== "courtyard") (byPlatform.get(h.platform) ?? byPlatform.set(h.platform, []).get(h.platform)!).push(h.tokenId);
  const rows = new Map<string, CardIdentityRow>();
  await Promise.all(
    [...byPlatform].map(async ([p, ids]) => {
      const m = await readCardRowsByIds(p, ids).catch(() => new Map<string, CardIdentityRow>());
      for (const [id, r] of m) rows.set(`${p}:${id}`, r);
    }),
  );
  // Blockscout's metadata rides along for most Beezie tokens; a live tokenURI
  // read is only for a token with neither a card row nor metadata in hand.
  const beezieMissing = raw.filter((h) => h.platform === "beezie" && !h.meta && !rows.has(`beezie:${h.tokenId}`)).map((h) => h.tokenId);
  const bz = beezieMissing.length
    ? await beezieMetaFor(beezieMissing, opts.beezieMetadata ?? "persist")
    : { metas: new Map<string, TokenMetadata>(), reads: 0, capped: new Set<string>(), late: new Set<string>() };

  const known = new Map<string, boolean>();
  for (const r of rows.values()) if (r.identityKey && !known.has(r.identityKey)) known.set(r.identityKey, await identityKeyKnown(r.identityKey));

  const resolved = raw.map((h) => {
    const row = rows.get(`${h.platform}:${h.tokenId}`) ?? null;
    const meta = h.meta ?? (h.platform === "beezie" ? (bz.metas.get(h.tokenId) ?? null) : null);
    const noMetaReason =
      h.platform !== "beezie" ? undefined : bz.capped.has(h.tokenId) ? "beezie-metadata-cap" : bz.late.has(h.tokenId) ? "beezie-metadata-timeout" : undefined;
    return resolveHolding(h, { row, meta, columnKnown: row?.identityKey ? (known.get(row.identityKey) ?? false) : false, noMetaReason });
  });
  return { resolved, beezieReads: bz.reads };
}

const byValue = (a: VaultHolding, b: VaultHolding) =>
  (b.value?.usd ?? -1) - (a.value?.usd ?? -1) || (a.name ?? "").localeCompare(b.name ?? "") || a.cardId.localeCompare(b.cardId);

/** Uncached core — for the probes and the cache wrapper. */
export async function readVaultValuation(parsed: WalletAddress, opts: VaultReadOpts = {}): Promise<VaultValuation> {
  const [enumerated, panel] = await Promise.all([enumerateHoldings(parsed, opts.limits ?? {}), cachedPanelAsOf()]);
  const t1 = Date.now();
  const { resolved, beezieReads } = await resolveAll(enumerated.holdings, opts);
  const t2 = Date.now();
  const keys = [...new Set(resolved.flatMap((r) => (r.identity ? [r.identity.key] : [])))];
  const [valuations, listings] = await Promise.all([valueIdentities(keys), cachedListingIndex()]);
  const t3 = Date.now();
  const holdings = priceHoldings(resolved, valuations, listings).sort(byValue);
  const venues = [...new Set(enumerated.reads.legs.map((l) => l.platform))];
  return {
    chain: parsed.chain,
    address: parsed.address,
    venues,
    holdings,
    ...summarize(holdings),
    partial: enumerated.partial,
    reads: { ...enumerated.reads, beezieMetadataReads: beezieReads, resolveMs: t2 - t1, valueMs: t3 - t2 },
    asOf: panel.generatedAt,
    method: PRICE_METHOD,
  };
}

/**
 * Ten minutes per (chain, address). The payload is small by construction —
 * `maxHoldings` caps it at 2,000 lines (~1 MB), under Next's 2 MB item limit.
 */
const cachedVault = unstable_cache(
  (chain: WalletAddress["chain"], address: string) => readVaultValuation({ chain, address } as WalletAddress),
  ["vault:v1"],
  { revalidate: 600 },
);

/** The page's and the API's door. The chain is detected, never asked. */
export async function getVaultValuation(input: string): Promise<VaultValuation | { error: "invalid-address" }> {
  const parsed = parseWalletAddress(input);
  if (!parsed) return { error: "invalid-address" };
  return cachedVault(parsed.chain, parsed.address);
}
