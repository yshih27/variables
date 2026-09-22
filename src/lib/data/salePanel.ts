/**
 * Sale-price panel — the substrate for the constant-quality price index (B1).
 *
 * Row-level sales (tokenId × ts × priceUsd) tagged with {ip, set, grade} from the
 * `cards` table, drawn from every platform's row-level feed:
 *   • Collector Crypt — Dune 7675297 (30d)
 *   • Courtyard       — Rarible activity index, 30d (was Dune 7845248 until 2026-09-22; `cards` is empty for it →
 *                       ip/set/grade fall to "other"/null, so it can't be stratified
 *                       per-IP yet — lands in "other" until traded-mint enrichment)
 *   • Beezie          — its own /activity feed (full history)
 *   • Phygitals       — omitted: no clean row-level secondary feed (its sales API is
 *                       gacha-dominated). Add when a Phygitals secondary query lands.
 *
 * Wash filter: drop self-trades (buyer === seller). Prices are trade-time USD (the
 * feeds normalize already). Winsorization is applied per-cell in the estimator.
 */
import { readSecondarySales } from "./secondarySalesCache";
import { fetchBeezieSales } from "../beezie/market";
import { readCardDims, type CardPlatform } from "./cards";
import { identityKey } from "./traits";
import type { NormalizedSale } from "../rarible/queries";

export type SaleRow = {
  ts: string; // ISO sale time
  tokenId: string;
  priceUsd: number;
  platform: CardPlatform;
  ip: string;
  set: string | null;
  /** Canonical set key — the grouping key for `set:<ip>:<key>` entities. */
  setKey: string | null;
  grade: string;
  /** v3 comparable key — `ip|set|number|name|grade|edition|language`, or null when
   *  the row is too thin to be a comparable (see traits.ts `identityKey`). */
  identity: string | null;
};

/**
 * One sale, before the cards-table dims join.
 *
 * ⚠️ THE SPLIT IS A PERFORMANCE BOUNDARY, NOT A SEMANTIC ONE. Everything that
 * decides whether a row COUNTS — the positive-price check and the self-trade
 * wash drop — happens here, so any caller taking this feed gets the same rows the
 * panel does. Only the descriptive dims (ip/set/grade) are added later.
 */
export type UntaggedSale = {
  ts: string;
  tokenId: string;
  priceUsd: number;
  platform: CardPlatform;
};

/** Apply the wash + price filter to one platform's feed. The ONE copy of that rule. */
function cleanPlatform(platform: CardPlatform, sales: NormalizedSale[], sinceMs?: number): UntaggedSale[] {
  const out: UntaggedSale[] = [];
  for (const s of sales) {
    if (!(s.priceUsd > 0)) continue;
    if (s.buyer && s.seller && s.buyer === s.seller) continue; // self-trade / wash
    if (sinceMs != null) {
      const t = Date.parse(s.date);
      if (!Number.isFinite(t) || t < sinceMs) continue;
    }
    out.push({ ts: s.date, tokenId: s.tokenId, priceUsd: s.priceUsd, platform });
  }
  return out;
}

/**
 * The cross-platform sale feed, filtered but NOT dims-tagged.
 *
 * ⚠️ EXISTS BECAUSE THE DIMS JOIN IS THE EXPENSIVE HALF, BY TWO ORDERS OF
 * MAGNITUDE. Measured: the three feeds together take ~3.5s, while
 * `readCardDims("collector-crypt")` alone takes ~51s for its 131,435 rows. A
 * caller that wants the last day's few dozen sales (the tape) should window here
 * and look up dims for the tokens it actually kept, not pay a full-table join to
 * throw away 99.9% of it.
 *
 * `sinceMs` also shortens the Beezie leg, which is a live `/activity` request.
 */
export async function readSaleFeed(opts: { sinceMs?: number } = {}): Promise<UntaggedSale[]> {
  const { sinceMs } = opts;
  // Beezie's window is derived from `sinceMs` when given (plus a day of slack for
  // clock skew at the boundary), else ~all history for the panel.
  const beezieWindowMs = sinceMs != null ? Math.max(Date.now() - sinceMs, 0) + DAY_MS : 800 * DAY_MS;
  const [cc, cy, bz] = await Promise.all([
    readSecondarySales("collector-crypt").catch(() => [] as NormalizedSale[]),
    readSecondarySales("courtyard").catch(() => [] as NormalizedSale[]),
    fetchBeezieSales(beezieWindowMs).catch(() => [] as NormalizedSale[]),
  ]);
  return [
    ...cleanPlatform("collector-crypt", cc, sinceMs),
    ...cleanPlatform("courtyard", cy, sinceMs),
    ...cleanPlatform("beezie", bz, sinceMs),
  ];
}

const DAY_MS = 86_400_000;

/** Tag one platform's cleaned sales with cards-table dims. */
async function tagPlatform(platform: CardPlatform, sales: UntaggedSale[]): Promise<SaleRow[]> {
  const dims = await readCardDims(platform);
  return sales.map((s) => {
    const d = dims.get(s.tokenId);
    return {
      ts: s.ts,
      tokenId: s.tokenId,
      priceUsd: s.priceUsd,
      platform,
      ip: d?.ip ?? "other",
      set: d?.set ?? null,
      setKey: d?.setKey ?? null,
      grade: d?.grade ?? "Ungraded",
      identity: d?.identity ? identityKey(d.ip ?? "other", d.identity) : null,
    };
  });
}

/**
 * Build the full cross-platform sale-price panel. A failing feed degrades to an
 * empty contribution (logged by the caller via the returned counts) rather than
 * sinking the whole panel.
 */
export async function buildSalePanel(): Promise<SaleRow[]> {
  // CC + Courtyard come from the secondary-sales store runCoreWarm writes — the
  // same cleaned rows the old direct Dune reads returned, without re-buying the
  // export (~5.6 cr each). Only warmers/core touches Dune for these feeds now.
  const feed = await readSaleFeed();
  const byPlatform = new Map<CardPlatform, UntaggedSale[]>();
  for (const s of feed) {
    const cur = byPlatform.get(s.platform);
    if (cur) cur.push(s);
    else byPlatform.set(s.platform, [s]);
  }
  const tagged = await Promise.all(
    [...byPlatform].map(([platform, sales]) => tagPlatform(platform, sales)),
  );
  return tagged.flat();
}

// ── the PERSISTED panel ──────────────────────────────────────────────────────

/**
 * The sale panel as a snapshot, so no request path ever builds it.
 *
 * ⚠️ WHY. `buildSalePanel` is a 90–220 s job (the dims join over ~152K cards is
 * the expensive half), and the identity reader and the palette's identity
 * group both need the panel. Building it on a request path meant the first
 * read after every deploy paid that in full — 222 s in the orchestrator's
 * probe — and every deploy resets the cache. So the indices batch
 * (warm-sale-panel) writes the panel it has already built, and readers
 * inflate it in well under a second.
 *
 * Gzip-wrapped with the same `{ __gz__ }` convention as the listings blob:
 * ~21K rows of JSON exceed what a plain jsonb upsert survives through PostgREST
 * (statement_timeout). Readers accept the wrapped form only — there is no legacy
 * unwrapped `sale-panel`, so nothing to auto-detect.
 */
import { gzipSync, gunzipSync } from "node:zlib";
import { readSnapshot, writeSnapshot } from "@/lib/db/snapshots";

export const SALE_PANEL_SNAPSHOT_KEY = "sale-panel";

export type SalePanelSnapshot = { generatedAt: string; rows: SaleRow[] };
type GzWrapper = { __gz__: string };

function isGz(p: unknown): p is GzWrapper {
  return !!p && typeof p === "object" && typeof (p as { __gz__?: unknown }).__gz__ === "string";
}

/** The wrapped payload the warmer stores — exported so `--out` writes the exact
 *  bytes `readSalePanel` expects (SNAPSHOT_LOCAL_DIR serves them verbatim). */
export function packSalePanel(snap: SalePanelSnapshot): GzWrapper {
  return { __gz__: gzipSync(Buffer.from(JSON.stringify(snap))).toString("base64") };
}

/** The persisted panel, or null when none has been written yet. Never throws. */
export async function readSalePanel(): Promise<SalePanelSnapshot | null> {
  const raw = await readSnapshot<GzWrapper>(SALE_PANEL_SNAPSHOT_KEY);
  if (!raw || !isGz(raw)) return null;
  try {
    const snap = JSON.parse(gunzipSync(Buffer.from(raw.__gz__, "base64")).toString()) as SalePanelSnapshot;
    return Array.isArray(snap?.rows) ? snap : null;
  } catch (e) {
    console.warn(`[sale-panel] snapshot unreadable: ${(e as Error).message}`);
    return null;
  }
}

export async function writeSalePanel(snap: SalePanelSnapshot): Promise<void> {
  await writeSnapshot(SALE_PANEL_SNAPSHOT_KEY, packSalePanel(snap), snap.generatedAt);
}
