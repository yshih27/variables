/**
 * DYLI boxes and Renaiss packs as `GachaPack`s — the two venues the comparison
 * did not read until Oct 7 2026 (brief-backend-gacha-renaiss PR B).
 *
 *   • DYLI — `gacha_products` (its DECLARED EV, odds buckets, buyback rate,
 *     inventory, `active`; written by warm-dyli-boxes) beside its realized pulls
 *     in `gacha_pulls` (DYLI's own FMV mark, no buyer) and the `dyli:box-prizes`
 *     snapshot (each box's advertised chase list, and its recent pulls by name).
 *   • Renaiss — `renaiss_pulls` over 7 days: each machine active in the last 72 h
 *     is a pack. Renaiss publishes NO odds, EV or buyback: those fields are null,
 *     never assumed. Its realized figures (hit share, value back, median) are
 *     measured in RENAISS'S STATED PRIZE VALUE, and `realizedValueBasis` says so
 *     wherever the pack travels. A pull whose prize Renaiss has not named yet (its
 *     V3 packs name prizes when the set sells out) is counted, never shown.
 *
 * Builders are pure over their rows; the readers below them are windowed reads.
 * No pull probability is computed or implied anywhere here.
 */
import { db } from "../../db/client";
import { PHYGITALS_VALUE_BANDS } from "../phygitalsGachaCache";
import type { GachaPack, GachaPrize, OddsBand, PackHit } from "../gachaPacksCache";
import type { DyliBoxPrizesSnapshot } from "../../dyli/boxPrizes";
import type { Chain } from "@/lib/types";
import { parseGrade } from "@/lib/card/grade";

const DAY_MS = 86_400_000;
const TOP_HITS = 12;
export const DYLI_VALUE_BASIS = "DYLI's FMV mark";
export const RENAISS_VALUE_BASIS = "Renaiss's stated prize value";
/** A Renaiss machine with no pull in this long is not a live pack. */
export const RENAISS_ACTIVE_HOURS = 72;
/** Named Renaiss prizes kept per pack for the finder (by stated value). */
const RENAISS_PRIZES_PER_PACK = 24;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Value-back multiples → the canonical five bands every venue's row aligns on. */
export function valueBandsOf(mults: number[]): OddsBand[] | null {
  if (!mults.length) return null;
  const counts = PHYGITALS_VALUE_BANDS.map(() => 0);
  for (const m of mults) {
    const i = PHYGITALS_VALUE_BANDS.findIndex((b) => m >= b.minMult && m < b.maxMult);
    if (i >= 0) counts[i]++;
  }
  return PHYGITALS_VALUE_BANDS.map((b, i) => ({ label: b.label, pct: counts[i] / mults.length, hit: b.hit, minUsd: null, maxUsd: null }));
}

function catLabel(cat: string | null): string {
  if (cat === "pokemon") return "Pokémon";
  if (cat === "one_piece") return "One Piece";
  if (cat === "sports") return "Sports";
  return "Mixed";
}

// ─────────────────────────── DYLI ───────────────────────────

/** A `gacha_products` row for DYLI (warm-dyli-boxes `toProductRow`). */
export type DyliProductRow = {
  product_id: string;
  name: string | null;
  price_usd: number | string | null;
  active: boolean | null;
  odds_stated: {
    declared_expected_value_usd?: number | null;
    declared_fmv_ratio?: number | null;
    declared_buyback_rate?: number | null;
    inventory_count?: number | null;
    brand?: string | null;
    type?: string | null;
    odds_buckets?: { min?: number; max?: number; percent?: number; tier?: string }[];
  } | null;
};

/** One DYLI pull as `gacha_pulls` holds it. */
export type DyliPullRow = { product_id: string; price_usd: number | string | null; prize_value_usd: number | string | null; prize_canonical_id: string | null; pulled_at: string };

/** A DYLI brand → a game tab; null when the brand is not one we tab. */
export function dyliCategoryOfBrand(brand: string | null | undefined): string | null {
  const b = (brand ?? "").toLowerCase();
  if (b.includes("pokemon") || b.includes("pokémon")) return "pokemon";
  if (b.includes("one piece")) return "one_piece";
  if (/panini|topps|upper deck|sport|nba|nfl|mlb|fifa/.test(b)) return "sports";
  return null;
}

/** DYLI's declared odds buckets → stated bands (rarest first), `hit` = the bucket floor is at/above the price. */
function dyliStatedBands(buckets: NonNullable<DyliProductRow["odds_stated"]>["odds_buckets"], price: number): OddsBand[] | null {
  const rows = (buckets ?? []).filter((b) => b && Number.isFinite(Number(b.percent)));
  if (!rows.length) return null;
  return [...rows]
    .sort((a, b) => Number(b.min ?? 0) - Number(a.min ?? 0))
    .map((b) => ({
      label: `${b.tier ?? "—"} $${Math.round(Number(b.min ?? 0)).toLocaleString("en-US")}–${Math.round(Number(b.max ?? 0)).toLocaleString("en-US")}`,
      pct: Number(b.percent) / 100,
      hit: Number(b.min ?? 0) >= price,
      minUsd: b.min ?? null,
      maxUsd: b.max ?? null,
    }));
}

/**
 * DYLI's active boxes as packs, pure. Stated: DYLI's declared EV (÷ price), its
 * odds buckets, buyback rate, inventory and the advertised chase list. Realized
 * (7 days, DYLI's FMV mark, with n): value back, median, value bands, the
 * biggest pull named from the box-prizes snapshot.
 */
export function dyliPacks(products: DyliProductRow[], pulls: DyliPullRow[], prizes: DyliBoxPrizesSnapshot | null, nowMs: number, asOf: string): { packs: GachaPack[]; prizes: GachaPrize[] } {
  const byProduct = new Map<string, DyliPullRow[]>();
  for (const p of pulls) {
    const arr = byProduct.get(p.product_id);
    if (arr) arr.push(p);
    else byProduct.set(p.product_id, [p]);
  }
  const packs: GachaPack[] = [];
  const pool: GachaPrize[] = [];
  for (const prod of products) {
    if (!prod.active) continue;
    const price = Number(prod.price_usd);
    if (!(price > 0)) continue;
    const boxId = prod.product_id.replace(/^dyli:/, "");
    const o = prod.odds_stated ?? {};
    const box = prizes?.boxes[boxId] ?? null;
    const category = dyliCategoryOfBrand(box?.brand ?? o.brand ?? null);
    const rows = byProduct.get(prod.product_id) ?? [];
    const valued = rows.filter((r) => Number(r.prize_value_usd) > 0);
    const mults = valued.map((r) => Number(r.prize_value_usd) / price);
    const n = mults.length;
    const evRealized = n ? mults.reduce((s, x) => s + x, 0) / n : null;
    const bands = valueBandsOf(mults);
    const top = valued.reduce<DyliPullRow | null>((m, r) => (!m || Number(r.prize_value_usd) > Number(m.prize_value_usd) ? r : m), null);
    const topCollectible = top?.prize_canonical_id?.match(/collectible:(\d+)$/)?.[1];
    const topNamed = topCollectible ? box?.recent.find((x) => String(x.collectibleId) === topCollectible) : undefined;
    const chase: PackHit[] = (box?.chase ?? []).slice(0, TOP_HITS).map((c) => ({ id: String(c.productId ?? c.name), name: c.name, image: c.image, fmvUsd: c.fmvUsd, grade: parseGrade(c.name)?.label ?? null }));
    const statedBands = dyliStatedBands(o.odds_buckets, price);
    const declaredEv = o.declared_expected_value_usd != null ? Number(o.declared_expected_value_usd) : null;
    const id = `dyli:${boxId}`;
    packs.push({
      id,
      platform: "dyli",
      platformName: "DYLI",
      platformShort: "DY",
      chain: "Abstract" as Chain,
      category,
      categoryLabel: catLabel(category),
      categoryDerived: true, // from the box's brand, not a category DYLI assigns
      name: prod.name ?? box?.name ?? id,
      image: box?.image ?? null,
      priceUsd: price,
      currency: "USD",
      packType: /pack/i.test(box?.type ?? o.type ?? "") ? "sealed" : null,
      topHitsAvailable: chase,
      topHitAvailableUsd: chase[0]?.fmvUsd ?? null,
      poolDepth: box ? box.chase.length || null : null,
      oddsStated: statedBands,
      hitOddsStated: statedBands ? statedBands.filter((b) => b.hit).reduce((s, b) => s + b.pct, 0) : null,
      evStated: declaredEv != null && declaredEv > 0 ? declaredEv / price : null,
      evStatedUsd: declaredEv,
      floorUsd: null,
      stockCount: o.inventory_count != null ? Number(o.inventory_count) : null,
      buybackPct: o.declared_buyback_rate != null ? Number(o.declared_buyback_rate) : null,
      buybackBasis: "stated",
      topHitRealized: top
        ? { id: top.prize_canonical_id ?? "", name: topNamed?.title ?? null, image: topNamed?.image ?? null, fmvUsd: Number(top.prize_value_usd), grade: parseGrade(topNamed?.title ?? null)?.label ?? null }
        : null,
      topHitRealizedUsd: top ? Number(top.prize_value_usd) : null,
      oddsRealized: bands,
      hitOddsRealized: bands ? bands.filter((b) => b.hit).reduce((s, b) => s + b.pct, 0) : null,
      valueBands: bands,
      evRealized,
      medianReturn: median(mults),
      realizedN: n || null,
      realizedWindow: rows.length ? "7d" : null,
      realizedValueBasis: DYLI_VALUE_BASIS,
      pulls24h: rows.filter((r) => Date.parse(r.pulled_at) >= nowMs - DAY_MS).length,
      pulls7d: rows.length,
      evBasis: n >= 10 ? "realized" : declaredEv != null ? "stated" : "realized",
      oddsBasis: statedBands ? "stated" : "realized",
      notDirectlyComparable: false,
      asOf,
      sources: { advertised: "dyli:/boxes", realized: "dyli:/boxes/history" },
    });
    for (const c of box?.chase ?? []) {
      pool.push({
        id: String(c.productId ?? c.name),
        name: c.name,
        image: c.image,
        fmvUsd: c.fmvUsd,
        grade: parseGrade(c.name)?.label ?? null,
        tier: null,
        traits: null,
        valueBasis: DYLI_VALUE_BASIS,
        packId: id,
        platform: "dyli",
        platformShort: "DY",
        packName: prod.name ?? box?.name ?? id,
        priceUsd: price,
        category,
      });
    }
  }
  return { packs, prizes: pool };
}

/** DYLI's box catalog rows from `gacha_products`. */
export async function readDyliProducts(): Promise<DyliProductRow[]> {
  const { data, error } = await db().from("gacha_products").select("product_id, name, price_usd, active, odds_stated").eq("platform_id", "dyli");
  if (error) throw new Error(`[gacha_products] dyli read failed: ${error.message}`);
  return (data ?? []) as DyliProductRow[];
}

/** DYLI pulls since `sinceMs`, per box over the (product_id, pulled_at) index. */
export async function readDyliPulls(productIds: string[], sinceMs: number): Promise<{ rows: DyliPullRow[]; queries: number }> {
  const PAGE = 1000;
  const rows: DyliPullRow[] = [];
  let queries = 0;
  for (const pid of productIds) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db()
        .from("gacha_pulls")
        .select("product_id, price_usd, prize_value_usd, prize_canonical_id, pulled_at")
        .eq("product_id", pid)
        .gte("pulled_at", new Date(sinceMs).toISOString())
        .order("pulled_at", { ascending: true })
        .range(from, from + PAGE - 1);
      queries++;
      if (error) throw new Error(`[gacha_pulls] dyli read failed (${pid}): ${error.message}`);
      rows.push(...((data ?? []) as DyliPullRow[]));
      if ((data ?? []).length < PAGE) break;
    }
  }
  return { rows, queries };
}

// ─────────────────────────── Renaiss ───────────────────────────

/** One Renaiss pull, as the pack builder reads it. */
export type RenaissPackPull = {
  pull_id: string;
  kind: string;
  product_id: string;
  machine_name: string | null;
  price_usd: number | string | null;
  pulled_at: string;
  prize_instance_id: string | null;
  prize_canonical_id: string | null;
  prize_value_usd: number | string | null;
  prize_card_name: string | null;
  prize_grade_label: string | null;
  prize_image_url: string | null;
};

/**
 * Renaiss's machines active in the last RENAISS_ACTIVE_HOURS as packs, pure.
 * Pulls and spend are CHECKOUT rows; price is the newest checkout's. Realized,
 * over checkouts carrying a stated value: hit share (stated value ≥ price paid),
 * value back (Σ stated ÷ Σ paid), median and bands, all in Renaiss's stated
 * prize value. The category is the game most of its named prizes key to (≥ 80%),
 * else Mixed.
 */
export function renaissPacks(pulls: RenaissPackPull[], nowMs: number, asOf: string): { packs: GachaPack[]; prizes: GachaPrize[]; unnamed: number } {
  const byMachine = new Map<string, RenaissPackPull[]>();
  for (const p of pulls) {
    const arr = byMachine.get(p.product_id);
    if (arr) arr.push(p);
    else byMachine.set(p.product_id, [p]);
  }
  const packs: GachaPack[] = [];
  const prizes: GachaPrize[] = [];
  let unnamed = 0;
  for (const [machine, rows] of byMachine) {
    const times = rows.map((r) => Date.parse(r.pulled_at)).filter(Number.isFinite);
    const last = times.length ? Math.max(...times) : -Infinity;
    if (last < nowMs - RENAISS_ACTIVE_HOURS * 3_600_000) continue;
    const checkouts = rows.filter((r) => r.kind === "checkout" && Number(r.price_usd) > 0);
    if (!checkouts.length) continue;
    const newest = checkouts.reduce((m, r) => (Date.parse(r.pulled_at) > Date.parse(m.pulled_at) ? r : m));
    const price = Number(newest.price_usd);
    const name = rows.map((r) => r.machine_name?.trim()).find(Boolean) ?? machine;
    const valued = checkouts.filter((r) => Number(r.prize_value_usd) > 0);
    const paid = valued.reduce((s, r) => s + Number(r.price_usd), 0);
    const stated = valued.reduce((s, r) => s + Number(r.prize_value_usd), 0);
    const mults = valued.map((r) => Number(r.prize_value_usd) / Number(r.price_usd));
    const hits = valued.filter((r) => Number(r.prize_value_usd) >= Number(r.price_usd)).length;
    const n = valued.length;
    const bands = valueBandsOf(mults);
    const ips = new Map<string, number>();
    for (const r of rows) {
      const ip = r.prize_canonical_id?.split("|")[0];
      if (ip) ips.set(ip, (ips.get(ip) ?? 0) + 1);
    }
    const namedCount = [...ips.values()].reduce((a, b) => a + b, 0);
    const [topIp, topIpN] = [...ips.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    const category = topIp && namedCount > 0 && topIpN / namedCount >= 0.8 && ["pokemon", "one_piece"].includes(topIp) ? topIp : null;
    const named = rows.filter((r) => r.prize_card_name && Number(r.prize_value_usd) > 0);
    unnamed += rows.filter((r) => !r.prize_card_name).length;
    const best = [...named].sort((a, b) => Number(b.prize_value_usd) - Number(a.prize_value_usd));
    const top = best[0] ?? null;
    const id = `renaiss:${machine}`;
    packs.push({
      id,
      platform: "renaiss",
      platformName: "Renaiss",
      platformShort: "RN",
      chain: "BNB Chain" as Chain,
      category,
      categoryLabel: catLabel(category),
      categoryDerived: true, // from its prizes' identity keys, not a category Renaiss assigns
      name,
      image: null,
      priceUsd: price,
      currency: "USDT",
      packType: "graded-single",
      // Renaiss publishes no pool, no odds, no EV and no buyback: null, never assumed.
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
      buybackBasis: "stated",
      topHitRealized: top
        ? { id: top.prize_instance_id ?? "", name: top.prize_card_name, image: top.prize_image_url, fmvUsd: Number(top.prize_value_usd), grade: top.prize_grade_label }
        : null,
      topHitRealizedUsd: top ? Number(top.prize_value_usd) : null,
      oddsRealized: bands,
      hitOddsRealized: n ? hits / n : null,
      valueBands: bands,
      evRealized: paid > 0 ? stated / paid : null,
      medianReturn: median(mults),
      realizedN: n || null,
      realizedWindow: "7d",
      realizedValueBasis: RENAISS_VALUE_BASIS,
      pulls24h: checkouts.filter((r) => Date.parse(r.pulled_at) >= nowMs - DAY_MS).length,
      pulls7d: checkouts.length,
      evBasis: "realized",
      oddsBasis: "realized",
      notDirectlyComparable: false,
      asOf,
      sources: { advertised: null, realized: "renaiss:/v1/gacha/pulls" },
    });
    for (const r of best.slice(0, RENAISS_PRIZES_PER_PACK)) {
      prizes.push({
        id: r.prize_instance_id ?? r.pull_id,
        name: r.prize_card_name,
        image: r.prize_image_url,
        fmvUsd: Number(r.prize_value_usd),
        grade: r.prize_grade_label,
        tier: null,
        traits: null,
        pulled: true,
        pulledAt: new Date(r.pulled_at).toISOString(),
        valueBasis: RENAISS_VALUE_BASIS,
        packId: id,
        platform: "renaiss",
        platformShort: "RN",
        packName: name,
        priceUsd: price,
        category,
      });
    }
  }
  return { packs, prizes, unnamed };
}

const RN_COLUMNS = "pull_id, kind, product_id, machine_name, price_usd, pulled_at, prize_instance_id, prize_canonical_id, prize_value_usd, prize_card_name, prize_grade_label, prize_image_url";
const RN_COLUMNS_PRE = "pull_id, kind, product_id, price_usd, pulled_at, prize_instance_id, prize_canonical_id, prize_value_usd, prize_card_name, prize_grade_label";

/**
 * Renaiss pulls over the last `days`, one UTC day per query over the
 * `pulled_at` index. Before migration 20261007000001 (machine_name,
 * prize_image_url) the two columns are absent: names fall back to machine ids
 * and prizes carry no image.
 */
export async function readRenaissPackPulls(days: number, nowMs: number = Date.now()): Promise<{ rows: RenaissPackPull[]; queries: number; preMigration: boolean }> {
  const PAGE = 1000;
  const rows: RenaissPackPull[] = [];
  let queries = 0;
  let cols = RN_COLUMNS;
  let preMigration = false;
  const start = nowMs - days * DAY_MS;
  for (let d = Math.floor(start / DAY_MS) * DAY_MS; d < nowMs; d += DAY_MS) {
    const from = new Date(Math.max(d, start)).toISOString();
    const to = new Date(Math.min(d + DAY_MS, nowMs)).toISOString();
    for (let off = 0; ; off += PAGE) {
      const q = () => db().from("renaiss_pulls").select(cols).gte("pulled_at", from).lt("pulled_at", to).order("pull_id", { ascending: true }).range(off, off + PAGE - 1);
      let { data, error } = await q();
      queries++;
      if (error && !preMigration && /machine_name|prize_image_url/.test(error.message)) {
        preMigration = true;
        cols = RN_COLUMNS_PRE;
        ({ data, error } = await q());
        queries++;
      }
      if (error) throw new Error(`[renaiss_pulls] pack read failed: ${error.message}`);
      for (const r of (data ?? []) as unknown as RenaissPackPull[]) rows.push({ ...r, machine_name: r.machine_name ?? null, prize_image_url: r.prize_image_url ?? null });
      if ((data ?? []).length < PAGE) break;
    }
  }
  return { rows, queries, preMigration };
}
