/**
 * CHARACTER ROLLUPS — "Charizard" across every set, grade and venue.
 *
 * `/ip/<ip>/characters/<key>` is one page per CHARACTER: a rollup of the
 * identity pages (block 2 of docs/roadmap/brief-card-identity-depth.md). The
 * extractor (src/lib/card/character.ts) groups the identity index's slugs by
 * character; this module turns each group into the page's numbers and
 * persists them, so the request path is one snapshot read.
 *
 * ⚠️ BUILT AT WARM TIME, READ AT REQUEST TIME, NEVER THE OTHER WAY. The build
 * needs the sale panel and the identity index — the two multi-minute inputs
 * `warm-sale-panel` already holds — so it runs THERE, in the same run, from
 * the same panel, and writes the `character-rollups` snapshot next to
 * `identity-index`. `readCharacterDetail` inflates that snapshot and nothing
 * else: no panel, no dims scan, no build on a request path.
 *
 * ⚠️ THE CHARACTER INDEX IS `identityIndex()` AND NOTHING ELSE — the v4
 * estimator on the panel filtered to the character's identities, monthly
 * grain, at the BROAD floor (MIN_IDENTITIES_BROAD = 20, the category floor: a
 * character is a pooled entity, not an IP), carrying the engine's `thin` flag
 * and `spansWeeks` unchanged. It is published only when at least 20 of the
 * character's identities are priced in the latest complete month; below that
 * `index` is null and `indexGate` says why. It is NOT in the naming SSOT, the
 * ticker tape or the indices page — it lives on the character page. The
 * identity's monthly price is `monthlyIdentityPrices` and nothing else.
 *
 * ⚠️ SHARES ARE PER CHARACTER AND NOT ADDITIVE. A multi-character card
 * ("CHARIZARD & BRAIXEN GX") counts under EACH of its characters, so Σ
 * shareOfIp30d over an IP's characters exceeds 100 by the multi-character
 * volume. `coverage[ip].multiCharacter` reports how many identities that is.
 *
 * ⚠️ `characterOf` NEVER RE-KEYS AN IDENTITY. Every identity here keeps the
 * slug and key the identity index gave it; the character only groups them.
 */
import { unstable_cache } from "next/cache";
import { gzipSync, gunzipSync } from "node:zlib";
import type { SaleRow } from "./salePanel";
import { readCardMeta, type CardPlatform } from "./cards";
import { parseIdentityKey } from "./traits";
import { identityIndex, monthlyIdentityPrices, MIN_IDENTITIES_BROAD, type IdentityIndexPoint } from "./identityIndex";
import { canonicalGrade } from "./gradePremium";
import { IP_CATALOG } from "./ipCatalog";
import { readSnapshot, writeSnapshot } from "@/lib/db/snapshots";
import { normalizeSetName } from "@/lib/card/setName";
import { identityDisplayName } from "@/lib/card/identity";
import { characterOf, characterHref, hasCharacterExtractor, CHARACTER_IPS, type CharacterMatch } from "@/lib/card/character";
import { IDENTITY_LISTING_SOURCE, canonicalKeysOf, pickCanonicalKey, type IdentityIndex, type ListingIndex } from "./identityDetail";
import { monthStartUtc, monthEndUtc } from "@/lib/chart/period";
import { formatCompactUsd } from "@/lib/format";

// ── contracts (ADD fields, never rename) ─────────────────────────────────────

export type CharacterKpis = {
  sales30d: number;
  volume30d: number;
  /**
   * This character's 30d resale volume ÷ the IP's 30d resale volume, in
   * PERCENT (0–100). Both sides come from the SAME sale panel (CC + Courtyard +
   * Beezie secondary rows), NOT the spine, so the ratio is internally
   * consistent and will not match a spine-derived IP volume to the dollar.
   * Per character, not additive across characters (see the header).
   */
  shareOfIp30d: number;
};

export type CharacterIndexGate = {
  /** Identities priced (n ≥ MIN_SALES_PER_IDENTITY) in the latest complete month. */
  priced: number;
  /** MIN_IDENTITIES_BROAD. */
  needed: number;
  /** Why `index` is null: below the floor, or the chain has fewer than the
   *  engine's minimum publishable months. Null when the index published. */
  held: "below-floor" | "too-few-months" | null;
};

export type CharacterMonthly = {
  /** Month END, UTC — the identity page's stamping. */
  ts: string;
  sales: number;
  volumeUsd: number;
  /** True for the RUNNING month (the identity-page rule). */
  partial: boolean;
};

export type CharacterSetRow = {
  /** Null when the identity has a number but no set. */
  setKey: string | null;
  setName: string | null;
  identities: number;
  sales30d: number;
  volume30d: number;
};

export type CharacterVenueRow = {
  platform: CardPlatform;
  sales30d: number;
  volume30d: number;
  /** Live listings across the character's slabs on this venue. */
  listings: number;
  /** Lowest live listing on this venue, or null. */
  floorUsd: number | null;
  /** The cheapest clear at this venue inside the window, or null when it had no
   *  30d sale. The page's floor gate reads against it: an ask under half of it
   *  is a placeholder ($1.00 asks on 676 Charizard listings, measured
   *  2026-09-17), not a floor, and the page says so instead of printing it. */
  cheapestSale30dUsd: number | null;
  /** The identity page's rule: whose listings are complete. */
  coverage: "native" | "aggregator";
};

/** The card whose art fronts the character page: the first slab of the top
 *  identity by 30d volume (deterministic), its image resolved from the cards
 *  table by `resolveCharacterArt` at warm time. A null image means no slab of
 *  the leading identities carries one; the page falls back to the IP's icon. */
export type CharacterArt = { platform: CardPlatform; tokenId: string; image: string | null };

export type CharacterIdentityRow = {
  /** The identity slug — `identityHref(slug)` is its page. */
  slug: string;
  name: string;
  setKey: string | null;
  setName: string | null;
  number: string | null;
  grade: string;
  /** `monthlyIdentityPrices` for the identity's canonical key, latest COMPLETE
   *  month — null when it had fewer than MIN_SALES_PER_IDENTITY sales. */
  monthlyPriceUsd: number | null;
  /** Sales behind `monthlyPriceUsd`; 0 when it is null. */
  n: number;
  sales30d: number;
  volume30d: number;
  /** All-time sales in the panel, every fragment key of the slug summed. */
  sales: number;
  lastSale: { ts: string; priceUsd: number } | null;
  slabs: number;
  /** From the extractor: owner / form / variant, plus the co-stars. */
  facets: CharacterMatch["facets"] & { partners?: string[] };
};

export type CharacterRollup = {
  key: string;
  name: string;
  ip: string;
  ipName: string;
  identities: number;
  slabs: number;
  venues: CardPlatform[];
  kpis: CharacterKpis;
  index: IdentityIndexPoint[] | null;
  indexGate: CharacterIndexGate;
  monthly: CharacterMonthly[];
  bySet: CharacterSetRow[];
  byVenue: CharacterVenueRow[];
  /** EVERY identity under the character, sorted by 30d volume. */
  top: CharacterIdentityRow[];
  /** Identities on which this character shares the card with another. */
  multiCharacter: number;
  art: CharacterArt | null;
  /** Warm-time only: the next slabs to try when `art`'s carries no image.
   *  Consumed and deleted by `resolveCharacterArt`; never packed. */
  artFallbacks?: { platform: CardPlatform; tokenId: string }[];
};

export type CharacterLeaderboardRow = {
  key: string;
  name: string;
  identities: number;
  slabs: number;
  sales30d: number;
  volume30d: number;
  shareOfIp30d: number;
  /** Latest published point of the character index, or null (gated). */
  indexLatest: { ts: string; value: number; n: number; thin: boolean } | null;
};

export type CharacterCoverage = {
  /** Identities of the IP the extractor saw. */
  identities: number;
  /** …of which map to a character. */
  mapped: number;
  /** …of which carry more than one character. */
  multiCharacter: number;
  /** The unmapped names with the most 30d sales — misses visible, not hidden. */
  unmappedTop: { name: string; identities: number; sales30d: number }[];
};

export type CharacterRollupsSnapshot = {
  generatedAt: string;
  /** Panel rows the rollups were built against — readers check it matches. */
  panelRows: number;
  /** End of every 30d window here (the warm's clock). */
  windowEnd: string;
  /** `<ip>:<key>` → rollup. */
  characters: Record<string, CharacterRollup>;
  /** Per IP, sorted by 30d volume. */
  byIp: Record<string, CharacterLeaderboardRow[]>;
  coverage: Record<string, CharacterCoverage>;
};

export const CHARACTER_ROLLUPS_SNAPSHOT_KEY = "character-rollups";
const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
const UNMAPPED_TOP = 50;

const ipNameOf = (ip: string) => IP_CATALOG.find((i) => i.key === ip)?.name ?? ip;
const entityId = (ip: string, key: string) => `${ip}:${key}`;

// ── the build (warm time) ────────────────────────────────────────────────────

type KeyStats = { sales: number; sales30d: number; volume30d: number; last: { ts: string; priceUsd: number } | null; rows: SaleRow[] };

type Member = {
  slug: string;
  keys: string[];
  ip: string;
  parts: NonNullable<ReturnType<typeof parseIdentityKey>>["parts"];
  match: CharacterMatch;
  /** True when this character is a partner on the card, not its lead. */
  asPartner: boolean;
};

/**
 * The rollups, from the panel, the identity index and the live listings. Pure
 * over its inputs (the clock is a parameter) so the probe can rebuild it from
 * local snapshots and compare.
 */
export function buildCharacterRollups(
  panel: SaleRow[],
  idx: IdentityIndex,
  opts: { listings?: ListingIndex | null; nowMs?: number } = {},
): CharacterRollupsSnapshot {
  const nowMs = opts.nowMs ?? Date.now();
  const listings = opts.listings ?? null;
  const d30 = nowMs - WINDOW_DAYS * DAY_MS;
  const runningMonth = monthStartUtc(nowMs);
  const latestComplete = monthStartUtc(Date.parse(runningMonth) - 1);

  // One pass over the panel: per identity key, the counters every row below
  // needs, plus the IP's own 30d volume (the denominator of shareOfIp30d).
  const byKey = new Map<string, KeyStats>();
  const ipVolume30d = new Map<string, number>();
  for (const r of panel) {
    if (!r.identity) continue;
    const t = Date.parse(r.ts);
    let s = byKey.get(r.identity);
    if (!s) byKey.set(r.identity, (s = { sales: 0, sales30d: 0, volume30d: 0, last: null, rows: [] }));
    s.sales += 1;
    s.rows.push(r);
    if (t >= d30) {
      s.sales30d += 1;
      s.volume30d += r.priceUsd;
      if (hasCharacterExtractor(r.ip)) ipVolume30d.set(r.ip, (ipVolume30d.get(r.ip) ?? 0) + r.priceUsd);
    }
    if (!s.last || r.ts > s.last.ts) s.last = { ts: r.ts, priceUsd: r.priceUsd };
  }
  const statsOf = (k: string): KeyStats => byKey.get(k) ?? { sales: 0, sales30d: 0, volume30d: 0, last: null, rows: [] };
  const slabsOf = (k: string) => idx.slabsByKey.get(k)?.length ?? 0;

  // Group every identity the index knows by character. A slug with several
  // fragment keys is ONE identity (the identity page's rule); all its keys
  // ride along so sales, slabs and the index see every row. An ALIAS slug (an
  // old URL kept answering) is skipped: its identity is counted at its own URL.
  const members = new Map<string, Member[]>();
  const coverage: Record<string, CharacterCoverage & { unmapped: Map<string, { identities: number; sales30d: number }> }> = {};
  for (const ip of CHARACTER_IPS) coverage[ip] = { identities: 0, mapped: 0, multiCharacter: 0, unmappedTop: [], unmapped: new Map() };
  for (const [slug, allKeysOfSlug] of idx.bySlug) {
    const keys = canonicalKeysOf(slug, allKeysOfSlug);
    if (!keys.length) continue;
    const pk = parseIdentityKey(keys[0]);
    if (!pk || !hasCharacterExtractor(pk.ip)) continue;
    const cov = coverage[pk.ip];
    cov.identities += 1;
    const match = characterOf(pk.ip, pk.parts.cardName);
    if (!match) {
      const name = pk.parts.cardName ?? "";
      const u = cov.unmapped.get(name) ?? { identities: 0, sales30d: 0 };
      u.identities += 1;
      u.sales30d += keys.reduce((a, k) => a + statsOf(k).sales30d, 0);
      cov.unmapped.set(name, u);
      continue;
    }
    cov.mapped += 1;
    const partnerKeys = match.partnerKeys.filter((k): k is string => !!k && k !== match.key);
    if (partnerKeys.length) cov.multiCharacter += 1;
    const add = (ck: string, asPartner: boolean) => {
      const id = entityId(pk.ip, ck);
      const a = members.get(id);
      const m: Member = { slug, keys, ip: pk.ip, parts: pk.parts, match, asPartner };
      if (a) a.push(m);
      else members.set(id, [m]);
    };
    add(match.key, false);
    for (const ck of new Set(partnerKeys)) add(ck, true);
  }

  // Display names for partner-only rollups: the partner's own name from the
  // match that produced it (the lexicon / alias display form).
  const nameOf = (ms: Member[], key: string): string => {
    for (const m of ms) {
      if (!m.asPartner) return m.match.name;
      const i = m.match.partnerKeys.indexOf(key);
      if (i >= 0) return m.match.partners[i];
    }
    return key;
  };

  const characters: Record<string, CharacterRollup> = {};
  for (const [id, ms] of members) {
    const ip = ms[0].ip;
    const key = id.slice(ip.length + 1);
    const allKeys = [...new Set(ms.flatMap((m) => m.keys))];
    const rows = allKeys.flatMap((k) => statsOf(k).rows);
    const sales30d = allKeys.reduce((a, k) => a + statsOf(k).sales30d, 0);
    const volume30d = allKeys.reduce((a, k) => a + statsOf(k).volume30d, 0);
    const slabs = allKeys.reduce((a, k) => a + slabsOf(k), 0);
    const ipVol = ipVolume30d.get(ip) ?? 0;

    // Monthly sales + volume, month-END stamped, running month flagged.
    const monthMap = new Map<string, { sales: number; volumeUsd: number }>();
    for (const r of rows) {
      const m = monthStartUtc(Date.parse(r.ts));
      const cur = monthMap.get(m) ?? { sales: 0, volumeUsd: 0 };
      cur.sales += 1;
      cur.volumeUsd += r.priceUsd;
      monthMap.set(m, cur);
    }
    const monthly: CharacterMonthly[] = [...monthMap]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([m, v]) => ({ ts: monthEndUtc(Date.parse(m)), sales: v.sales, volumeUsd: v.volumeUsd, partial: m === runningMonth }));

    // The character index: the engine on the filtered panel, broad floor.
    const mp = monthlyIdentityPrices(rows);
    const priced = mp.get(latestComplete)?.size ?? 0;
    let index: IdentityIndexPoint[] | null = null;
    let held: CharacterIndexGate["held"] = "below-floor";
    if (priced >= MIN_IDENTITIES_BROAD) {
      const pts = identityIndex(rows, { minIdentities: MIN_IDENTITIES_BROAD, grain: "month", nowMs });
      // `obs` is INV-13's raw sample for the published price-index blob; this
      // series is not in that blob, so the observations are dropped here.
      for (const p of pts) delete p.obs;
      if (pts.length) { index = pts; held = null; } else held = "too-few-months";
    }

    // Every identity under the character.
    const top: CharacterIdentityRow[] = ms.map((m) => {
      const canonical = pickCanonicalKey(m.keys, (k) => statsOf(k).sales, slabsOf);
      const priceAt = mp.get(latestComplete)?.get(canonical) ?? null;
      const last = m.keys.map((k) => statsOf(k).last).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.ts.localeCompare(a.ts))[0] ?? null;
      const setId = m.parts.set ? normalizeSetName(m.parts.set) : null;
      const facets: CharacterIdentityRow["facets"] = { ...m.match.facets };
      if (m.match.partners.length) facets.partners = m.asPartner ? [m.match.name, ...m.match.partners.filter((_, i) => m.match.partnerKeys[i] !== key)] : m.match.partners;
      return {
        slug: m.slug,
        name: identityDisplayName(m.parts.cardName ?? ""),
        setKey: setId?.key ?? null,
        setName: setId?.name ?? null,
        number: m.parts.number,
        grade: canonicalGrade(m.parts.grade),
        monthlyPriceUsd: priceAt?.price ?? null,
        n: priceAt?.n ?? 0,
        sales30d: m.keys.reduce((a, k) => a + statsOf(k).sales30d, 0),
        volume30d: m.keys.reduce((a, k) => a + statsOf(k).volume30d, 0),
        sales: m.keys.reduce((a, k) => a + statsOf(k).sales, 0),
        lastSale: last,
        slabs: m.keys.reduce((a, k) => a + slabsOf(k), 0),
        facets,
      };
    });
    top.sort((a, b) => b.volume30d - a.volume30d || b.sales30d - a.sales30d || b.slabs - a.slabs || a.slug.localeCompare(b.slug));

    // The page's art: one slab from each of the four leading identities, in
    // rank order; the first with an image wins at warm time.
    const memberBySlug = new Map(ms.map((m) => [m.slug, m]));
    const artRefs = top.slice(0, 4).flatMap((t) => {
      const m = memberBySlug.get(t.slug);
      if (!m) return [];
      const canonical = pickCanonicalKey(m.keys, (k) => statsOf(k).sales, slabsOf);
      return (idx.slabsByKey.get(canonical) ?? []).slice(0, 1);
    });

    // By set — from the identities' own set (the set-name SSOT).
    const setMap = new Map<string, CharacterSetRow>();
    for (const t of top) {
      const k = t.setKey ?? "";
      const cur = setMap.get(k) ?? { setKey: t.setKey, setName: t.setName, identities: 0, sales30d: 0, volume30d: 0 };
      cur.identities += 1;
      cur.sales30d += t.sales30d;
      cur.volume30d += t.volume30d;
      setMap.set(k, cur);
    }
    const bySet = [...setMap.values()].sort((a, b) => b.volume30d - a.volume30d || b.identities - a.identities);

    // By venue — sales from the panel, listings + floor from the live book
    // over the character's slabs, coverage per the identity page's rule.
    const venueMap = new Map<CardPlatform, CharacterVenueRow>();
    const venue = (p: CardPlatform) => {
      let v = venueMap.get(p);
      if (!v) venueMap.set(p, (v = { platform: p, sales30d: 0, volume30d: 0, listings: 0, floorUsd: null, cheapestSale30dUsd: null, coverage: IDENTITY_LISTING_SOURCE[p] ?? "aggregator" }));
      return v;
    };
    for (const r of rows) {
      if (Date.parse(r.ts) < d30) continue;
      const v = venue(r.platform);
      v.sales30d += 1;
      v.volume30d += r.priceUsd;
      if (v.cheapestSale30dUsd == null || r.priceUsd < v.cheapestSale30dUsd) v.cheapestSale30dUsd = r.priceUsd;
    }
    for (const k of allKeys) {
      for (const ref of idx.slabsByKey.get(k) ?? []) {
        const v = venue(ref.platform);
        const l = listings?.get(`${ref.platform}:${ref.tokenId}`);
        if (l && l.priceUsd > 0) {
          v.listings += 1;
          if (v.floorUsd == null || l.priceUsd < v.floorUsd) v.floorUsd = l.priceUsd;
        }
      }
    }
    const byVenue = [...venueMap.values()].sort((a, b) => b.sales30d - a.sales30d || b.listings - a.listings);

    characters[id] = {
      key,
      name: nameOf(ms, key),
      ip,
      ipName: ipNameOf(ip),
      identities: ms.length,
      slabs,
      venues: byVenue.map((v) => v.platform),
      kpis: { sales30d, volume30d, shareOfIp30d: ipVol > 0 ? (volume30d / ipVol) * 100 : 0 },
      index,
      indexGate: { priced, needed: MIN_IDENTITIES_BROAD, held },
      monthly,
      bySet,
      byVenue,
      top,
      multiCharacter: ms.filter((m) => m.match.partnerKeys.some((k) => !!k && k !== m.match.key)).length,
      art: artRefs[0] ? { platform: artRefs[0].platform, tokenId: artRefs[0].tokenId, image: null } : null,
      artFallbacks: artRefs.slice(1),
    };
  }

  // Per-IP leaderboards, by 30d volume.
  const byIp: Record<string, CharacterLeaderboardRow[]> = {};
  for (const c of Object.values(characters)) {
    const last = c.index?.at(-1) ?? null;
    (byIp[c.ip] ??= []).push({
      key: c.key,
      name: c.name,
      identities: c.identities,
      slabs: c.slabs,
      sales30d: c.kpis.sales30d,
      volume30d: c.kpis.volume30d,
      shareOfIp30d: c.kpis.shareOfIp30d,
      indexLatest: last ? { ts: last.ts, value: last.value, n: last.n ?? 0, thin: !!last.thin } : null,
    });
  }
  for (const rows of Object.values(byIp)) rows.sort((a, b) => b.volume30d - a.volume30d || b.sales30d - a.sales30d || b.identities - a.identities || a.key.localeCompare(b.key));

  const cov: Record<string, CharacterCoverage> = {};
  for (const [ip, c] of Object.entries(coverage)) {
    cov[ip] = {
      identities: c.identities,
      mapped: c.mapped,
      multiCharacter: c.multiCharacter,
      unmappedTop: [...c.unmapped]
        .map(([name, u]) => ({ name, ...u }))
        .sort((a, b) => b.sales30d - a.sales30d || b.identities - a.identities || a.name.localeCompare(b.name))
        .slice(0, UNMAPPED_TOP),
    };
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    panelRows: panel.length,
    windowEnd: new Date(nowMs).toISOString(),
    characters,
    byIp,
    coverage: cov,
  };
}

// ── the persisted form ───────────────────────────────────────────────────────

type Gz = { __gz__: string };

/** The wrapped payload the warmer stores — `--out` writes these exact bytes. */
export function packCharacterRollups(snap: CharacterRollupsSnapshot): Gz {
  for (const c of Object.values(snap.characters)) delete c.artFallbacks;
  return { __gz__: gzipSync(Buffer.from(JSON.stringify(snap))).toString("base64") };
}

/**
 * Fill `art.image` for every character from the cards table — one chunked read
 * per platform over the leading identities' slabs, first with an image wins.
 * Warm-time only: the reader never touches the cards table. Leaves `image`
 * null when no candidate slab carries one, and clears the fallbacks either way.
 * Returns how many characters resolved an image.
 */
export async function resolveCharacterArt(
  snap: CharacterRollupsSnapshot,
  readMeta: (platform: CardPlatform, ids: string[]) => Promise<Map<string, { image: string | null }>> = readCardMeta,
): Promise<number> {
  const refsOf = (c: CharacterRollup) => (c.art ? [c.art, ...(c.artFallbacks ?? [])] : []);
  const byPlatform = new Map<CardPlatform, Set<string>>();
  for (const c of Object.values(snap.characters)) {
    for (const r of refsOf(c)) {
      let ids = byPlatform.get(r.platform);
      if (!ids) byPlatform.set(r.platform, (ids = new Set()));
      ids.add(r.tokenId);
    }
  }
  const images = new Map<string, string | null>();
  for (const [p, ids] of byPlatform) {
    const meta = await readMeta(p, [...ids]);
    for (const [id, m] of meta) images.set(`${p}:${id}`, m.image ?? null);
  }
  let n = 0;
  for (const c of Object.values(snap.characters)) {
    const hit = refsOf(c).find((r) => !!images.get(`${r.platform}:${r.tokenId}`));
    if (hit) {
      c.art = { platform: hit.platform, tokenId: hit.tokenId, image: images.get(`${hit.platform}:${hit.tokenId}`) ?? null };
      n += 1;
    }
    delete c.artFallbacks;
  }
  return n;
}

export async function writeCharacterRollups(snap: CharacterRollupsSnapshot): Promise<void> {
  await writeSnapshot(CHARACTER_ROLLUPS_SNAPSHOT_KEY, packCharacterRollups(snap), snap.generatedAt);
}

function inflate(raw: unknown): CharacterRollupsSnapshot | null {
  if (!raw || typeof raw !== "object" || typeof (raw as Gz).__gz__ !== "string") return null;
  try {
    const snap = JSON.parse(gunzipSync(Buffer.from((raw as Gz).__gz__, "base64")).toString()) as CharacterRollupsSnapshot;
    return snap && typeof snap.characters === "object" && typeof snap.byIp === "object" ? snap : null;
  } catch (e) {
    console.warn(`[characters] snapshot unreadable: ${(e as Error).message}`);
    return null;
  }
}

// ── the readers (request time) ───────────────────────────────────────────────

/**
 * ⚠️ AN IN-PROCESS MEMO, NOT `unstable_cache`. The inflated snapshot is well
 * over Next's 2 MB data-cache item limit (the panel and the identity index hit
 * the same wall — identityDetail.ts `cachedPanel`). A warm instance keeps it
 * for 30 minutes; a cold one pays one snapshot read and inflate. It NEVER
 * builds: with no snapshot every reader returns empty and says so once.
 */
const TTL_MS = 30 * 60_000;
let memo: { at: number; p: Promise<CharacterRollupsSnapshot | null> } | null = null;
async function cachedRollups(): Promise<CharacterRollupsSnapshot | null> {
  if (!memo || Date.now() - memo.at > TTL_MS) {
    const p = readSnapshot<Gz>(CHARACTER_ROLLUPS_SNAPSHOT_KEY)
      .then((raw) => {
        const snap = inflate(raw);
        if (!snap) console.warn("[characters] no character-rollups snapshot — character pages are empty until warm-sale-panel runs");
        return snap;
      })
      .catch((e) => {
        console.warn(`[characters] snapshot read failed: ${(e as Error).message}`);
        return null;
      });
    memo = { at: Date.now(), p };
    // A failed read must not poison the memo for 30 minutes.
    p.then((s) => { if (!s && memo?.p === p) memo = null; });
  }
  return memo.p;
}

export type CharacterDetail = CharacterRollup & {
  href: string;
  /** When the rollup was built; every 30d window ends here. */
  generatedAt: string;
};

/** Uncached core — runs outside Next (probes, the API). Never throws; null for an unknown character. */
export async function readCharacterDetail(ip: string, key: string): Promise<CharacterDetail | null> {
  try {
    if (!hasCharacterExtractor(ip)) return null;
    const k = String(key ?? "").trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(k)) return null;
    const snap = await cachedRollups();
    const c = snap?.characters[entityId(ip, k)];
    if (!snap || !c) return null;
    return { ...c, href: characterHref(ip, k), generatedAt: snap.generatedAt };
  } catch (e) {
    console.warn(`[characters] ${ip}/${key}: ${(e as Error).message}`);
    return null;
  }
}

/**
 * The page's reader: `unstable_cache` per character, 30 minutes. One
 * character's payload is a few hundred KB at most (every identity row of the
 * largest character — measured in the PR), under the 2 MB item limit that
 * keeps the whole snapshot in the memo above.
 */
export const getCharacterDetail: (ip: string, key: string) => Promise<CharacterDetail | null> = unstable_cache(
  readCharacterDetail,
  ["character-detail:v1"],
  { revalidate: 1800, tags: ["platform-buckets"] },
);

/** The IP page's leaderboard — top `limit` characters by 30d volume. Never throws. */
export async function readCharacterLeaderboard(ip: string, limit = 50): Promise<CharacterLeaderboardRow[]> {
  try {
    const snap = await cachedRollups();
    return (snap?.byIp[ip] ?? []).slice(0, Math.max(0, limit));
  } catch {
    return [];
  }
}

export type CharacterSearchRow = {
  ip: string;
  key: string;
  /** "Charizard" */
  label: string;
  /** "Pokémon · 187 cards · $412K 30d" */
  sub: string;
  href: string;
  /** Lowercased haystack the matcher scores against. */
  haystack: string;
  volume30d: number;
  identities: number;
};

/**
 * One row per character for the palette, every IP, ranked by 30d volume.
 * Derived from the memoised snapshot; small enough to rebuild on each call
 * after the first (a few hundred rows).
 */
export async function readCharacterSearchRows(): Promise<CharacterSearchRow[]> {
  try {
    const snap = await cachedRollups();
    if (!snap) return [];
    const rows: CharacterSearchRow[] = [];
    for (const [ip, board] of Object.entries(snap.byIp)) {
      const ipName = ipNameOf(ip);
      for (const r of board) {
        rows.push({
          ip,
          key: r.key,
          label: r.name,
          sub: `${ipName} · ${r.identities.toLocaleString("en-US")} card${r.identities === 1 ? "" : "s"} · ${formatCompactUsd(r.volume30d)} 30d`,
          href: characterHref(ip, r.key),
          haystack: `${r.name} ${r.key.replace(/-/g, " ")} ${ipName} ${ip}`.toLowerCase(),
          volume30d: r.volume30d,
          identities: r.identities,
        });
      }
    }
    return rows.sort((a, b) => b.volume30d - a.volume30d || b.identities - a.identities);
  } catch {
    return [];
  }
}

/** The whole snapshot — for the probe and check scripts, never a page. */
export async function readCharacterRollupsSnapshot(): Promise<CharacterRollupsSnapshot | null> {
  return cachedRollups();
}
