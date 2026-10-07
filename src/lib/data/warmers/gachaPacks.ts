/**
 * Pack-catalog warmer — assembles the cross-platform GachaPack[] the /gacha
 * comparison reads. Every venue with a gacha, into ONE honest model:
 *
 *   • Beezie  — GET /claw: advertised odds + vendor EV + grail pool + floor +
 *               buyback (from swapFees) + stock. All STATED.
 *   • Phygitals — GET /vm/chase/{slug}: advertised top-hits per pack; joined to
 *               REALIZED odds/EV/median/biggest-pull from our gacha_pulls spine
 *               by (category, price) — NOT clawId (which rotates and differs
 *               between the advertised and realized feeds).
 *   • Collector Crypt — its machine catalog (stated odds, buyback) + realized
 *               stats from the gacha:cc snapshot (the spine over listener
 *               coverage, ccRealized.ts); Dune platform-grain shells only as a fallback.
 *   • DYLI    — its boxes: declared EV/odds/buyback, the advertised chase list,
 *               realized pulls at DYLI's FMV mark (gachaPacksVenues.ts).
 *   • Renaiss — every machine active in 72 h, realized in Renaiss's STATED prize
 *               value; no stated odds/EV/buyback exist, so none are assumed.
 *   • Courtyard — none: it publishes no pack catalog (gachaVenues.ts).
 *
 * Every metric carries its basis (stated|realized|platform) so the UI never
 * ranks a vendor number above a measured one. Writes the gacha:packs snapshot
 * (cache-only, no DDL) + a source_freshness row.
 */
import {
  fetchBeezieClaws,
  beezieImage,
  type BeezieClaw,
} from "../../beezie/claw";
import { readCCGacha } from "../ccGachaCache";
import type { CCGachaPack } from "../ccGachaCache";
import {
  fetchPhygitalsChase,
  fetchPhygitalsAvailable,
  phygitalsCatalog,
  type PhygitalsPackDef,
  type PhygitalsChaseItem,
  type PhygitalsPackOdds,
} from "../../phygitals/client";
import { readGachaDune } from "../gachaDuneCache";
import { PHYGITALS_VALUE_BANDS } from "../phygitalsGachaCache";
import {
  writeGachaPacks,
  type GachaPack,
  type GachaPacksSnapshot,
  type GachaPrize,
  type OddsBand,
  type PackHit,
} from "../gachaPacksCache";
import { getBeezieMetadataBatch } from "../beezieTraits";
import { dyliPacks, readDyliProducts, readDyliPulls, readRenaissPackPulls, renaissPacks } from "./gachaPacksVenues";
import { readDyliBoxPrizes } from "../../dyli/boxPrizes";
import { db } from "../../db/client";
import type { Chain } from "@/lib/types";
import { parseGrade } from "@/lib/card/grade";

const TOP_HITS = 12;
const CHASE_GAP_MS = 1_200;
const CHASE_RETRY_MS = 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Grade parsing lives in @/lib/card/grade. NOTE: BECKETT now folds to BGS —
 *  same grader, two names in the feeds — so this warmer's output labels change
 *  from "BECKETT 9.5" to "BGS 9.5". */
const gradeOf = (name: string | null) => parseGrade(name)?.label ?? null;
function catLabel(cat: string | null): string {
  if (cat === "pokemon") return "Pokémon";
  if (cat === "one_piece") return "One Piece";
  if (cat === "sports") return "Sports";
  if (cat === "pop") return "Pop";
  return "Mixed";
}
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ─────────────────────────── Beezie ───────────────────────────

function beeziePacks(claws: BeezieClaw[], asOf: string): GachaPack[] {
  return claws
    .filter((c) => c.status === "active" && c.isVisible !== false)
    .map((c): GachaPack => {
      const price = c.priceUsdc / 1e6;
      const pool: PackHit[] = [
        ...(c.grails.grails ?? []),
        ...(c.grails.high ?? []),
        ...(c.grails.medium ?? []),
      ].map((g) => ({
        id: String(g.tokenId),
        name: null, // Beezie exposes no card name for a tokenId
        image: beezieImage(g.tokenId),
        fmvUsd: g.swapValue / 1e6,
        grade: null,
      }));
      pool.sort((a, b) => b.fmvUsd - a.fmvUsd);

      const pr = c.priceRanges;
      const band = (label: string, pctStr: string, from: number, to: number, hit: boolean): OddsBand => ({
        label,
        pct: (Number(pctStr) || 0) / 100,
        hit,
        minUsd: from,
        maxUsd: to,
      });
      // Rarest → commonest. base sits below the price (a loss); everything else
      // is ≥ stake, so "hit" = pulled at least your money back in card value.
      const oddsStated: OddsBand[] = [
        band("Grail", c.odds.grails, pr.fromGrails, pr.toGrails, true),
        band("High", c.odds.high, pr.fromHigh, pr.toHigh, true),
        band("Mid", c.odds.medium, pr.fromMedium, pr.toMedium, true),
        band("Low", c.odds.low, pr.fromLow, pr.toLow, true),
        band("Common", c.odds.base, pr.fromBase, pr.toBase, false),
      ];
      const hitOddsStated = oddsStated.filter((b) => b.hit).reduce((s, b) => s + b.pct, 0);
      const feePct = c.swapFees?.percentages?.[0] ?? 0;

      return {
        id: `beezie:${c.id}`,
        platform: "beezie",
        platformName: "Beezie",
        platformShort: "B",
        chain: "Base" as Chain,
        category: null,
        categoryLabel: "Mixed",
        categoryDerived: false,
        name: c.name,
        image: null,
        priceUsd: price,
        currency: "USDC",
        packType: "mixed",
        topHitsAvailable: pool.slice(0, TOP_HITS),
        topHitAvailableUsd: pool[0]?.fmvUsd ?? null,
        poolDepth: pool.length,
        oddsStated,
        hitOddsStated,
        evStated: price > 0 ? c.averageValue / price : null,
        evStatedUsd: c.averageValue,
        floorUsd: pr.fromBase ?? null,
        stockCount: c.clawStockCount ?? null,
        buybackPct: 1 - feePct / 100,
        buybackBasis: "stated",
        topHitRealized: null,
        topHitRealizedUsd: null,
        oddsRealized: null,
        hitOddsRealized: null,
        valueBands: null, // no realized pull feed — stated tiers only
        evRealized: null,
        medianReturn: null,
        realizedN: null,
        realizedWindow: null,
        pulls24h: null,
        evBasis: "stated",
        oddsBasis: "stated",
        notDirectlyComparable: false,
        asOf,
        sources: { advertised: "beezie-claw", realized: null },
      };
    });
}

/** Beezie's per-card `Category` attribute → our category keys. Positive signal
 *  only — unknown categories stay null (mixed), never guessed. */
function beezieCatKey(v: string | undefined): string | null {
  const c = (v ?? "").trim().toLowerCase();
  if (c === "pokemon") return "pokemon";
  if (c === "one piece") return "one_piece";
  if (["basketball", "baseball", "football", "soccer", "sports"].includes(c)) return "sports";
  return null;
}

/**
 * Beezie's full advertised pools as flat prizes (Grail/High/Mid tiers — the
 * commons aren't enumerated by the API). Names + TRAITS come from our metadata
 * cache (on-chain fallback persists misses): the grid is searchable by card,
 * grader, grade, set, language, serial — and each prize gets its REAL category
 * (the packs are mixed-IP, the cards inside aren't).
 */
async function beeziePrizes(claws: BeezieClaw[], log: (m: string) => void): Promise<GachaPrize[]> {
  const active = claws.filter((c) => c.status === "active" && c.isVisible !== false);
  const ids = active.flatMap((c) =>
    [...(c.grails.grails ?? []), ...(c.grails.high ?? []), ...(c.grails.medium ?? [])].map((g) =>
      String(g.tokenId),
    ),
  );
  let meta = new Map<string, { name?: string | null; attributes?: { trait_type: string; value: string | number }[] }>();
  try {
    meta = await getBeezieMetadataBatch(ids);
  } catch (err) {
    log(`  beezie prize names FAILED (grid stays searchable by value): ${(err as Error).message}`);
  }
  const out: GachaPrize[] = [];
  for (const c of active) {
    const price = c.priceUsdc / 1e6;
    const tiers: [string, BeezieClaw["grails"]["grails"]][] = [
      ["Grail", c.grails.grails],
      ["High", c.grails.high],
      ["Mid", c.grails.medium],
    ];
    for (const [tier, items] of tiers) {
      for (const g of items ?? []) {
        const m = meta.get(String(g.tokenId));
        const name = m?.name ?? null;
        const attrs = m?.attributes ?? [];
        const traits = attrs.map((a) => `${a.trait_type} ${a.value}`);
        const cat = beezieCatKey(
          String(attrs.find((a) => a.trait_type.toLowerCase() === "category")?.value ?? ""),
        );
        out.push({
          id: String(g.tokenId),
          name,
          image: beezieImage(g.tokenId),
          fmvUsd: g.swapValue / 1e6,
          grade: gradeOf(name),
          tier,
          traits: traits.length ? traits : null,
          packId: `beezie:${c.id}`,
          platform: "beezie",
          platformShort: "B",
          packName: c.name,
          priceUsd: price,
          category: cat,
        });
      }
    }
  }
  return out;
}

// ─────────────────────────── Phygitals ───────────────────────────

type RealizedGroup = {
  n: number;
  pulls24h: number;
  evRealized: number | null;
  medianReturn: number | null;
  oddsRealized: OddsBand[];
  topUsd: number;
  topMint: string | null;
};

/**
 * Derive category from a realized clawId/product_id (the spine has no category
 * column). Only attribute on a POSITIVE signal — an unknown themed pack must NOT
 * be force-bucketed into Pokémon (that would pollute a shown pack's realized
 * odds/EV). Bare-numeric legacy ids are empirically Pokémon, and the later
 * (category,price) join only attaches when the price matches a catalog pack, so
 * a stray numeric can't bleed into a pack that isn't priced for it.
 */
function catFromProductId(pid: string): string | null {
  const s = pid.replace(/^phygitals:/, "").toLowerCase();
  if (s.includes("one-piece") || s.includes("one_piece")) return "one_piece";
  if (/riftbound|lorcana|yugioh|yu-gi|magic|sport|basketball|football|soccer/.test(s)) return null;
  if (/^\d+$/.test(s)) return "pokemon"; // legacy numeric ids (13/14) — empirically Pokémon
  if (/trainer|rookie|elite|sealed|legend|base-set|platinum|mythic|black|diamond|pokemon/.test(s))
    return "pokemon";
  return null; // unknown themed packs (all-or-nothing, mini-villain, …) → unattributed, not guessed
}

/** The live slug a realized product id belongs to: the longest slug it is, or starts with ("<slug>-<hash>"). */
export function slugOfProduct(productId: string, slugs: string[]): string | null {
  const pid = productId.replace(/^phygitals:/, "").toLowerCase();
  let best: string | null = null;
  for (const s of slugs) {
    if ((pid === s || pid.startsWith(`${s}-`)) && (!best || s.length > best.length)) best = s;
  }
  return best;
}

/**
 * Realized stats from the gacha_pulls spine over the last `days`, keyed by the
 * live pack each pull belongs to (`slug:<slug>`, by its product id) and, for a
 * pull no live slug claims, by (category, price) as before.
 *
 * ⚠️ EVERY PULL OF THE WINDOW. The old read was `.limit(8000)` with no order,
 * which kept an arbitrary 8,000 of the window's pulls. This pages them all, in
 * a stable order, over the (product_id, pulled_at) index.
 */
async function phygitalsRealizedGroups(
  days: number,
  catalog: PhygitalsPackDef[],
): Promise<{ groups: Map<string, RealizedGroup>; window: { fromISO: string | null; toISO: string | null; hours: number | null; pulls: number }; queries: number }> {
  const PAGE = 1000;
  const now = Date.now();
  const dayAgo = now - 86_400_000;
  const slugs = catalog.map((p) => p.slug);
  type Acc = { ms: number[]; prices: number[]; mults: number[]; pulls24h: number; topUsd: number; topMint: string | null };
  const groups = new Map<string, Acc>();
  let queries = 0;
  let pulls = 0;
  let first = Infinity;
  let last = -Infinity;
  // One stream over the (product_id, pulled_at) index: every Phygitals product
  // id ("phygitals:<claw id>") sorts from "phygitals:" to below "phygitalt", so the
  // product range is an index range scan with the window as its second key.
  // ⚠️ Not "phygitals;" as the bound: the column sorts by a linguistic collation
  // that ignores punctuation, so ":" < ";" does not hold there (measured: 0 rows).
  // ⚠️ Not `.eq("platform_id")` + a pulled_at range: no index covers that pair,
  // and measured Oct 7 it scanned the table per query (21 queries, 456 s).
  const since = new Date(now - days * 86_400_000).toISOString();
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await db()
      .from("gacha_pulls")
      .select("pull_id, product_id, price_usd, prize_value_usd, prize_instance_id, pulled_at")
      .gte("product_id", "phygitals:")
      .lt("product_id", "phygitalt")
      .gte("pulled_at", since)
      .order("product_id", { ascending: true })
      .order("pulled_at", { ascending: true })
      .order("pull_id", { ascending: true })
      .range(off, off + PAGE - 1);
    queries++;
    if (error) throw new Error(`gacha_pulls readback: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const pid = String(r.product_id ?? "");
      const price = Math.round(Number(r.price_usd) || 0);
      if (price <= 0) continue;
      const slug = slugOfProduct(pid, slugs);
      const cat = slug ? null : catFromProductId(pid);
      if (!slug && !cat) continue;
      const key = slug ? `slug:${slug}` : `${cat}:${price}`;
      const t = Date.parse(String(r.pulled_at));
      pulls++;
      if (t < first) first = t;
      if (t > last) last = t;
      const fmv = r.prize_value_usd != null ? Number(r.prize_value_usd) : null;
      const g = groups.get(key) ?? { ms: [], prices: [], mults: [], pulls24h: 0, topUsd: 0, topMint: null };
      if (fmv != null && fmv > 0) {
        g.mults.push(fmv / price);
        if (fmv > g.topUsd) {
          g.topUsd = fmv;
          g.topMint = r.prize_instance_id ? String(r.prize_instance_id).replace(/^pg-/, "") : null;
        }
      }
      g.prices.push(price);
      if (t >= dayAgo) g.pulls24h++;
      groups.set(key, g);
    }
    if (rows.length < PAGE) break;
  }

  const out = new Map<string, RealizedGroup>();
  for (const [key, g] of groups) {
    // The sample size the UI badges + the thin-gate must be the FMV-bearing count
    // the EV/odds/median actually rest on — not every pull (some carry no prize FMV).
    const n = g.mults.length;
    const counts = PHYGITALS_VALUE_BANDS.map(() => 0);
    for (const m of g.mults) {
      const i = PHYGITALS_VALUE_BANDS.findIndex((b) => m >= b.minMult && m < b.maxMult);
      if (i >= 0) counts[i]++;
    }
    const total = g.mults.length;
    const oddsRealized: OddsBand[] = PHYGITALS_VALUE_BANDS.map((b, i) => ({
      label: b.label,
      pct: total > 0 ? counts[i] / total : 0,
      hit: b.hit,
      minUsd: null,
      maxUsd: null,
    }));
    out.set(key, {
      n,
      pulls24h: g.pulls24h,
      evRealized: g.mults.length ? g.mults.reduce((s, x) => s + x, 0) / g.mults.length : null,
      medianReturn: median(g.mults),
      oddsRealized,
      topUsd: g.topUsd,
      topMint: g.topMint,
    });
  }
  const window =
    pulls > 0
      ? { fromISO: new Date(first).toISOString(), toISO: new Date(last).toISOString(), hours: (last - first) / 3_600_000, pulls }
      : { fromISO: null, toISO: null, hours: null, pulls: 0 };
  return { groups: out, window, queries };
}

/** Phygitals' full chase pools (~60 per pack, named + art + FMV) as prizes.
 *  Archived packs (per /available liveness) are excluded so their pool prizes
 *  don't linger in the finder. */
function phygitalsPrizes(
  chaseBySlug: Map<string, PhygitalsChaseItem[]>,
  catalog: PhygitalsPackDef[],
): GachaPrize[] {
  const out: GachaPrize[] = [];
  for (const p of catalog) {
    for (const c of chaseBySlug.get(p.slug) ?? []) {
      if (!(c.fmv > 0)) continue;
      out.push({
        id: c.id,
        name: c.name,
        image: c.image,
        fmvUsd: c.fmv,
        grade: gradeOf(c.name),
        tier: null,
        traits: null, // Phygitals encodes set/grade/language in the name itself
        packId: `phygitals:${p.slug}`,
        platform: "phygitals",
        platformShort: "PH",
        packName: p.name,
        priceUsd: p.priceUsd,
        category: p.category,
      });
    }
  }
  return out;
}

/** Phygitals published live-odds bands → our OddsBand[] ($ ranges, normalized
 *  %, hit = the band's value floor is at/above the stake). */
function phygitalsStatedBands(o: PhygitalsPackOdds): OddsBand[] {
  const sum = o.bands.reduce((s, b) => s + (b.weight || 0), 0) || 1;
  // low→high value; render rarest (high value) first to match our other bars
  return [...o.bands]
    .sort((a, b) => b.lower - a.lower)
    .map((b) => ({
      label: `$${Math.round(b.lower).toLocaleString()}–${Math.round(b.upper).toLocaleString()}`,
      pct: (b.weight || 0) / sum,
      hit: b.lower >= o.priceUsd, // band entirely at/above what you paid
      minUsd: b.lower,
      maxUsd: b.upper,
    }));
}

function phygitalsPacks(
  chaseBySlug: Map<string, PhygitalsChaseItem[]>,
  realized: Map<string, RealizedGroup>,
  oddsBySlug: Map<string, PhygitalsPackOdds>,
  catalog: PhygitalsPackDef[],
  asOf: string,
): GachaPack[] {
  // `catalog` is every pack /available reports live (enabled, and stocked or
  // still pulling): archived packs never reach it.

  // (category,price) keys shared by >1 catalog pack can't be attributed to one
  // pack from realized data alone → don't attach realized to those.
  const keyCount = new Map<string, number>();
  for (const p of catalog) {
    const k = `${p.category}:${p.priceUsd}`;
    keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  }

  return catalog.map((p): GachaPack => {
    const chase = chaseBySlug.get(p.slug) ?? [];
    const topHits: PackHit[] = chase.slice(0, TOP_HITS).map((c) => ({
      id: c.id,
      name: c.name,
      image: c.image,
      fmvUsd: c.fmv,
      grade: gradeOf(c.name),
    }));
    // By the pack's own slug first; by (category, price) only when no slug claimed
    // the pulls and the key is the pack's alone.
    const key = `${p.category}:${p.priceUsd}`;
    const r = realized.get(`slug:${p.slug}`) ?? (p.category && keyCount.get(key) === 1 ? realized.get(key) : undefined);

    // Phygitals' PUBLISHED odds + EV (captured from /api/vm/available) — stated.
    const o = oddsBySlug.get(p.slug);
    const statedBands = o && o.bands.length ? phygitalsStatedBands(o) : null;
    const hitStated = statedBands ? statedBands.filter((b) => b.hit).reduce((s, b) => s + b.pct, 0) : null;

    return {
      id: `phygitals:${p.slug}`,
      platform: "phygitals",
      platformName: "Phygitals",
      platformShort: "PH",
      chain: "Solana" as Chain,
      category: p.category,
      categoryLabel: catLabel(p.category),
      categoryDerived: false,
      name: p.name,
      image: null,
      priceUsd: p.priceUsd,
      currency: "USDC",
      packType: "graded-single",
      topHitsAvailable: topHits,
      topHitAvailableUsd: topHits[0]?.fmvUsd ?? null,
      poolDepth: chase.length || null,
      oddsStated: statedBands,
      hitOddsStated: hitStated,
      evStated: o && o.priceUsd > 0 ? o.evUsd / o.priceUsd : null,
      evStatedUsd: o ? o.evUsd : null,
      floorUsd: statedBands ? statedBands[statedBands.length - 1]?.minUsd ?? null : null,
      stockCount: null,
      // Real buyback now (captured), not the old assumed 0.9.
      buybackPct: o ? o.buybackPct : 0.9,
      buybackBasis: o ? "stated" : "assumed",
      topHitRealized:
        r && r.topUsd > 0
          ? { id: r.topMint ?? "", name: null, image: null, fmvUsd: r.topUsd, grade: null }
          : null,
      topHitRealizedUsd: r && r.topUsd > 0 ? r.topUsd : null,
      oddsRealized: r && r.n > 0 ? r.oddsRealized : null,
      hitOddsRealized:
        r && r.n > 0 ? r.oddsRealized.filter((b) => b.hit).reduce((s, b) => s + b.pct, 0) : null,
      // Phygitals realized odds ARE the canonical value bands already.
      valueBands: r && r.n > 0 ? r.oddsRealized : null,
      evRealized: r?.evRealized ?? null,
      medianReturn: r?.medianReturn ?? null,
      realizedN: r?.n ?? null,
      realizedWindow: r ? "7d" : null,
      realizedValueBasis: "Phygitals FMV",
      // Prefer realized 24h count; else a 7d→24h estimate from the published feed.
      pulls24h: r?.pulls24h ?? (o ? Math.round(o.pulls7d / 7) : null),
      pulls24hEstimated: r?.pulls24h == null && o != null,
      // Lead with stated odds/EV (published) where we have them — realized is thin.
      evBasis: o ? "stated" : "realized",
      oddsBasis: statedBands ? "stated" : "realized",
      notDirectlyComparable: false,
      asOf,
      sources: {
        advertised: "phygitals-vm-available",
        realized: "phygitals-gacha-pulls",
      },
    };
  });
}

// ─────────────────────────── Collector Crypt ───────────────────────────

const CC_TIERS = [25, 50, 75, 80, 100, 250, 1000];
const CC_HIT_TIERS = new Set(["Epic", "LGND", "SPrT"]);
const CC_TIER_LABEL: Record<string, string> = {
  epic: "Epic",
  rare: "Rare",
  uncommon: "Uncommon",
  common: "Common",
};

/** Compact realized-window label: "14h" under 2 days, else "6d". */
function windowLabel(hours: number | null): string | null {
  if (hours == null || !(hours > 0)) return null;
  return hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
}

/**
 * CC per-pack rows from the native gacha:cc snapshot (preferred path) — stated
 * odds/EV/buyback per machine + realized stats measured from the winners feed.
 * Fully pack-attributable, so these rows compare head-on with Beezie/Phygitals.
 */
function ccPacksNative(ccPacks: CCGachaPack[], asOf: string): GachaPack[] {
  return ccPacks.map((p): GachaPack => {
    const r = p.realized;
    const oddsStated: OddsBand[] = p.oddsStated.map((b) => ({
      label: CC_TIER_LABEL[b.tier] ?? b.tier,
      pct: b.pct,
      hit: b.tier !== "common", // tiers above common start at/above the stake
      minUsd: b.minUsd,
      maxUsd: b.maxUsd,
    }));
    // Realized tier shares; $ bounds come from the stated tier ranges.
    const boundsByTier = new Map(p.oddsStated.map((b) => [b.tier, b]));
    const oddsRealized: OddsBand[] | null =
      r?.odds != null
        ? r.odds.map((o) => ({
            label: CC_TIER_LABEL[o.tier] ?? o.tier,
            pct: o.pct,
            hit: o.tier !== "common",
            minUsd: boundsByTier.get(o.tier)?.minUsd ?? null,
            maxUsd: boundsByTier.get(o.tier)?.maxUsd ?? null,
          }))
        : null;

    return {
      id: `collector-crypt:${p.code}`,
      platform: "collector-crypt",
      platformName: "Collector Crypt",
      platformShort: "CC",
      chain: "Solana" as Chain,
      category: p.category,
      categoryLabel: catLabel(p.category),
      categoryDerived: false, // menuCategory is the vendor's own classification
      name: p.name,
      image: p.image,
      priceUsd: p.priceUsd,
      currency: "USDC",
      packType: p.packType,
      // No advertised prize pool endpoint — the chase ceiling is the realized
      // biggest hit (chaseUsd falls back to it) + the stated epic band max.
      topHitsAvailable: [],
      topHitAvailableUsd: null,
      poolDepth: null,
      oddsStated,
      hitOddsStated: p.hitOddsStated,
      evStated: p.evStatedMultiple,
      evStatedUsd: p.evStatedMultiple != null ? p.evStatedMultiple * p.priceUsd : null,
      floorUsd: boundsByTier.get("common")?.minUsd ?? null,
      stockCount: null,
      buybackPct: p.buybackPct,
      buybackBasis: "stated",
      topHitRealized:
        r?.topHit != null
          ? {
              id: r.topHit.mint,
              name: r.topHit.name,
              image: r.topHit.image,
              fmvUsd: r.topHit.valueUsd,
              grade: gradeOf(r.topHit.name),
            }
          : null,
      topHitRealizedUsd: r?.topHit?.valueUsd ?? null,
      oddsRealized,
      hitOddsRealized: r?.hitOdds ?? null,
      valueBands:
        r?.valueBands != null
          ? r.valueBands.map((b) => ({ label: b.label, pct: b.pct, hit: b.hit, minUsd: null, maxUsd: null }))
          : null,
      evRealized: r?.evMultiple ?? null,
      medianReturn: r?.medianReturn ?? null,
      realizedN: r?.n ?? null,
      realizedWindow: windowLabel(r?.windowHours ?? null),
      realizedValueBasis: "Collector Crypt's insured value",
      pulls24h: r?.pulls24h ?? null,
      pulls24hEstimated: r?.pulls24hEstimated ?? false,
      evBasis: r?.evMultiple != null ? "realized" : "stated",
      oddsBasis: "stated",
      notDirectlyComparable: false,
      asOf,
      sources: { advertised: "cc-gacha-api", realized: "cc-gacha-api" },
    };
  });
}

/**
 * CC's top PULLED cards as prize entries. CC publishes no pool — these are
 * already-won examples of what each machine pays (flagged `pulled`, badged in
 * the UI), which is the only honest way CC can appear in the chase finder.
 */
function ccPrizes(ccPacks: CCGachaPack[]): GachaPrize[] {
  const out: GachaPrize[] = [];
  for (const p of ccPacks) {
    for (const e of p.realized?.examples ?? []) {
      out.push({
        id: e.mint,
        name: e.name,
        image: e.image,
        fmvUsd: e.valueUsd,
        grade: gradeOf(e.name),
        tier: null,
        traits: null,
        pulled: true,
        packId: `collector-crypt:${p.code}`,
        platform: "collector-crypt",
        platformShort: "CC",
        packName: p.name,
        priceUsd: p.priceUsd,
        // 'pop' isn't a game tab — those examples live under Mixed like Beezie.
        category: p.category === "pop" ? null : p.category,
      });
    }
  }
  return out;
}

/** Dune-only fallback shells (platform-grain) — used when gacha:cc is absent. */
function ccPacks(asOf: string): GachaPack[] {
  // Built lazily from the Dune snapshot at call time (see runGachaPacksWarm).
  return CC_TIERS.map((price) => ccPackShell(price, asOf));
}
function ccPackShell(price: number, asOf: string): GachaPack {
  return {
    id: `collector-crypt:${price}`,
    platform: "collector-crypt",
    platformName: "Collector Crypt",
    platformShort: "CC",
    chain: "Solana" as Chain,
    category: null,
    categoryLabel: "Mixed",
    categoryDerived: false,
    name: `$${price} Pack`,
    image: null,
    priceUsd: price,
    currency: "USDC",
    packType: null,
    topHitsAvailable: [],
    topHitAvailableUsd: null,
    poolDepth: null,
    oddsStated: null,
    hitOddsStated: null,
    evStated: null,
    evStatedUsd: null,
    floorUsd: null,
    stockCount: null,
    buybackPct: null,
    buybackBasis: "platform",
    topHitRealized: null,
    topHitRealizedUsd: null,
    oddsRealized: null,
    hitOddsRealized: null,
    valueBands: null,
    evRealized: null,
    medianReturn: null,
    realizedN: null,
    realizedWindow: null,
    pulls24h: null,
    evBasis: "platform",
    oddsBasis: "platform",
    notDirectlyComparable: true,
    asOf,
    sources: { advertised: null, realized: "dune" },
  };
}

export type GachaPacksWarmResult = {
  snapshot?: GachaPacksSnapshot;
  packs: number;
  byPlatform: Record<string, number>;
  topHitMax: number;
  generatedAt: string;
  /** Provenance for the runWarmer freshness row. */
  rowsWritten?: number;
};

export async function runGachaPacksWarm(
  opts: {
    log?: (m: string) => void;
    /** Build only: return the snapshot, write nothing (`--out`). */
    out?: boolean;
  } = {},
): Promise<GachaPacksWarmResult> {
  const log = opts.log ?? (() => {});
  const asOf = new Date().toISOString();
  const packs: GachaPack[] = [];
  const prizes: GachaPrize[] = [];

  // Beezie — advertised catalog + pool prizes.
  try {
    const claws = await fetchBeezieClaws();
    const bp = beeziePacks(claws, asOf);
    packs.push(...bp);
    const bzPrizes = await beeziePrizes(claws, log);
    prizes.push(...bzPrizes);
    const named = bzPrizes.filter((p) => p.name).length;
    log(
      `beezie: ${bp.length} packs (top hit $${Math.round(bp[0]?.topHitAvailableUsd ?? 0).toLocaleString()}) · ${bzPrizes.length} pool prizes (${named} named)`,
    );
  } catch (err) {
    log(`beezie FAILED: ${(err as Error).message}`);
  }

  // Phygitals — every LIVE pack /vm/available reports (stated odds + EV), its
  // advertised chase pool, and the realized join from the spine.
  let phWindow: GachaPacksSnapshot["window"] = { fromISO: null, toISO: null, hours: null, pulls: 0 };
  try {
    const availOdds = await fetchPhygitalsAvailable();
    const catalog = phygitalsCatalog(availOdds);
    const chaseBySlug = new Map<string, PhygitalsChaseItem[]>();
    let chaseFailed = 0;
    // Paced: Phygitals answers 429 after ~25 back-to-back chase reads (measured
    // Oct 7, 30 of 55 refused). One read every CHASE_GAP_MS, and a 429 waits
    // CHASE_RETRY_MS and retries, at most twice.
    for (const p of catalog) {
      let items: PhygitalsChaseItem[] | null = null;
      for (let attempt = 0; attempt < 3 && items == null; attempt++) {
        try {
          items = await fetchPhygitalsChase(p.slug);
        } catch (e) {
          const msg = (e as Error).message;
          if (/429/.test(msg) && attempt < 2) {
            await sleep(CHASE_RETRY_MS);
            continue;
          }
          chaseFailed++;
          log(`  chase ${p.slug} failed: ${msg}`);
          break;
        }
      }
      chaseBySlug.set(p.slug, items ?? []);
      await sleep(CHASE_GAP_MS);
    }
    const t0 = Date.now();
    const realized = await phygitalsRealizedGroups(7, catalog);
    phWindow = realized.window;
    const pp = phygitalsPacks(chaseBySlug, realized.groups, availOdds, catalog, asOf);
    packs.push(...pp);
    const phPrizes = phygitalsPrizes(chaseBySlug, catalog);
    prizes.push(...phPrizes);
    const withRealized = pp.filter((p) => (p.realizedN ?? 0) > 0).length;
    log(
      `phygitals: ${availOdds.size} packs in /vm/available, ${catalog.length} live · ${pp.length} packs (${withRealized} with realized) · ` +
        `${phPrizes.length} chase prizes (${chaseFailed} chase fetches failed) · realized read ${realized.window.pulls.toLocaleString()} pulls / 7d in ${realized.queries} queries, ${((Date.now() - t0) / 1000).toFixed(0)}s`,
    );
  } catch (err) {
    log(`phygitals FAILED (no live catalog, so no Phygitals packs): ${(err as Error).message}`);
  }

  // DYLI — its active boxes: declared EV, odds and buyback (gacha_products), the
  // advertised chase list and named recent pulls (dyli:box-prizes), realized pulls.
  try {
    const products = await readDyliProducts();
    const active = products.filter((p) => p.active);
    const dyPulls = await readDyliPulls(active.map((p) => p.product_id), Date.now() - 7 * 86_400_000);
    const boxPrizes = await readDyliBoxPrizes().catch(() => null);
    const dy = dyliPacks(products, dyPulls.rows, boxPrizes, Date.now(), asOf);
    packs.push(...dy.packs);
    prizes.push(...dy.prizes);
    log(
      `dyli: ${products.length} boxes, ${active.length} active · ${dy.packs.length} packs · ${dyPulls.rows.length.toLocaleString()} pulls / 7d in ${dyPulls.queries} queries · ` +
        `${dy.prizes.length} pool prizes${boxPrizes ? "" : " (no dyli:box-prizes snapshot yet: no pool, no names)"}`,
    );
  } catch (err) {
    log(`dyli FAILED: ${(err as Error).message}`);
  }

  // Renaiss — every machine active in the last 72 h, from renaiss_pulls (7 days).
  try {
    const t0 = Date.now();
    const rn = await readRenaissPackPulls(7);
    const built = renaissPacks(rn.rows, Date.now(), asOf);
    packs.push(...built.packs);
    prizes.push(...built.prizes);
    log(
      `renaiss: ${built.packs.length} packs active in 72h · ${rn.rows.length.toLocaleString()} pulls / 7d in ${rn.queries} queries, ${((Date.now() - t0) / 1000).toFixed(0)}s` +
        `${rn.preMigration ? " (pre-migration: names are machine ids, no images)" : ""} · ${built.prizes.length} named prizes shown, ${built.unnamed.toLocaleString()} unnamed pulls counted, not shown`,
    );
  } catch (err) {
    log(`renaiss FAILED: ${(err as Error).message}`);
  }

  // Courtyard — no pack catalog is published (gachaVenues.ts says why), so no rows.

  // Collector Crypt — native per-pack data (gacha:cc) when warmed; Dune
  // platform-grain shells only as a degraded fallback.
  try {
    const ccSnap = await readCCGacha();
    if (ccSnap && ccSnap.packs.length > 0) {
      const ccRows = ccPacksNative(ccSnap.packs, asOf);
      packs.push(...ccRows);
      const ccEx = ccPrizes(ccSnap.packs);
      prizes.push(...ccEx);
      const withRealized = ccRows.filter((p) => (p.realizedN ?? 0) > 0).length;
      log(
        `collector-crypt: ${ccRows.length} packs (native API · ${withRealized} with realized stats) · ${ccEx.length} pulled examples`,
      );
    } else {
      const dune = await readGachaDune();
      const cc = dune?.platforms?.["collector-crypt"];
      const ccRows = ccPacks(asOf);
      if (cc) {
        const oddsBands: OddsBand[] | null = cc.odds
          ? cc.odds.map((o) => ({
              label: o.tier,
              pct: o.pct,
              hit: CC_HIT_TIERS.has(o.tier),
              minUsd: null,
              maxUsd: null,
            }))
          : null;
        const hitOdds = oddsBands ? oddsBands.filter((b) => b.hit).reduce((s, b) => s + b.pct, 0) : null;
        const byPrice = new Map(cc.byPrice.map((b) => [Math.round(b.price), b]));
        for (const row of ccRows) {
          // Platform-wide rarity odds apply to every CC tier (NOT pack-specific) — flagged.
          row.oddsRealized = oddsBands;
          row.hitOddsRealized = hitOdds;
          // null (unknown), not 0 (definitive "no activity"), when Dune has no such tier.
          row.pulls24h = byPrice.get(row.priceUsd)?.pulls24h ?? null;
        }
      }
      packs.push(...ccRows);
      log(`collector-crypt: ${ccRows.length} tiers (Dune fallback — run warm-cc-gacha for per-pack data)`);
    }
  } catch (err) {
    log(`collector-crypt FAILED: ${(err as Error).message}`);
  }

  // Honest realized window = the span of the Phygitals pulls the realized read
  // actually paged (every pull of the 7 days, not an arbitrary 8,000).
  const win = phWindow;

  packs.sort((a, b) => a.priceUsd - b.priceUsd || a.platform.localeCompare(b.platform));
  prizes.sort((a, b) => b.fmvUsd - a.fmvUsd);
  const snap: GachaPacksSnapshot = { generatedAt: asOf, window: win, packs, prizes };
  if (!opts.out) await writeGachaPacks(snap);

  const byPlatform: Record<string, number> = {};
  for (const p of packs) byPlatform[p.platform] = (byPlatform[p.platform] ?? 0) + 1;
  const topHitMax = packs.reduce((m, p) => Math.max(m, p.topHitAvailableUsd ?? 0), 0);

  // Soft-fail: no packs assembled → throw so the runWarmer wrapper records an
  // error row (health gate) instead of a silent empty catalog.
  if (packs.length === 0) {
    throw new Error("gacha-packs: 0 packs assembled (upstream gacha snapshots empty?)");
  }

  log(`done: ${packs.length} packs ${JSON.stringify(byPlatform)} · top hit $${Math.round(topHitMax).toLocaleString()}`);
  return { snapshot: snap, packs: packs.length, byPlatform, topHitMax, generatedAt: asOf, rowsWritten: packs.length };
}
