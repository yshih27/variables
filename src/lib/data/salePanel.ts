/**
 * Sale-price panel — the substrate for the constant-quality price index (B1).
 *
 * Row-level sales (tokenId × ts × priceUsd) tagged with {ip, set, grade} from the
 * `cards` table, drawn from every venue's FULL resale history in the
 * `secondary_sales` store (salesStore.ts; brief-backend-index-every-venue B2):
 *   • Collector Crypt — the Dune 7675297 rows every core run keeps, plus the
 *                       month-chunked backfill (dune/cc-secondary-history.sql)
 *   • Courtyard       — the Rarible activities every core run keeps, plus its
 *                       backfill (`cards` is empty for it → ip/set/grade fall to
 *                       "other"/null, so it prices no identity yet)
 *   • Beezie          — the /activity rows every core run keeps, plus its backfill;
 *                       the live warm-time /activity request is gone
 *   • Renaiss         — its own index API, from the `renaiss_sales` row store the
 *                       sales warmer fills (full history, hygiene-cleaned); every
 *                       sale carries its cert and card, so its `cards` rows key it
 *   • Phygitals       — omitted: no clean row-level secondary feed (its sales API is
 *                       gacha-dominated). Add when a Phygitals secondary query lands.
 *
 * ⚠️ WHY THE STORE. Until B2 the Collector Crypt and Courtyard legs were a 30-day
 * window every core run overwrote, so a month aged out before the next could be
 * compared with it: every published month from February to August rested on
 * Beezie alone, and every rebuild could revise a published month as its rows
 * slid out. The store keeps them; the index reads the same history every run.
 * `source: "legs"` is the pre-store read, kept for the shadow build only.
 *
 * Wash filter: drop self-trades (buyer === seller). Prices are trade-time USD (the
 * feeds normalize already). Winsorization is applied per-cell in the estimator.
 */
import { readSecondarySales } from "./secondarySalesCache";
import { fetchBeezieSales } from "../beezie/market";
import { readStoreFeed } from "./salesStore";
import { cleanSecondarySales } from "./secondaryHygiene";
import { readRenaissSales } from "../renaiss/sales";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readCardDims, type CardPlatform } from "./cards";
import { identityKey, legacyIdentityKey } from "./traits";
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
  /** v4.2 comparable key — `ip|setKey|number|name|grade|edition|language`, or null
   *  when the row is too thin to be a comparable (see traits.ts `identityKey`). */
  identity: string | null;
  /**
   * The v4.1 key for the same row — present ONLY in a shadow build
   * (`buildSalePanel({ legacyIdentity: true })`), so the re-key's effect on every
   * published level can be measured from one panel instead of two. Stripped by
   * `packSalePanel`, so it never reaches a snapshot.
   */
  legacyIdentity?: string | null;
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

/**
 * ⚠️ A SALE UNDER A DOLLAR IS NOT A PRICE. Measured Oct 7 on the store: 3,056
 * Renaiss sales under $1 (2,918 under $0.05), 2,821 of them in Feb–Mar 2026, on
 * 231 tokens (one card traded 940 times in a month). A PSA 9 identity whose
 * month median is $0.01 turns a step into −99.9%. The floor matches DYLI's dust
 * rule; on the legs it removes 11 Courtyard rows, none of which resolve to an
 * identity, so the published method's levels do not move.
 */
export const PANEL_MIN_PRICE_USD = 1;

/** Apply the wash + price filter to one platform's feed. The ONE copy of that rule. */
function cleanPlatform(platform: CardPlatform, sales: NormalizedSale[], sinceMs?: number): UntaggedSale[] {
  const out: UntaggedSale[] = [];
  for (const s of sales) {
    if (!(s.priceUsd >= PANEL_MIN_PRICE_USD)) continue;
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
 * `sinceMs` also shortens the Beezie leg, which is a live `/activity` request
 * on the "legs" source (the default; see PanelSource).
 */
export async function readSaleFeed(opts: { sinceMs?: number; source?: PanelSource; strict?: boolean } = {}): Promise<UntaggedSale[]> {
  const { sinceMs } = opts;
  if (opts.source === "store") {
    // Hygiene at read, as today: Collector Crypt and Courtyard through
    // cleanSecondarySales (the pass runCoreWarm applied to their snapshot rows),
    // Beezie through cleanPlatform's self-trade drop alone, as its live fetch was.
    //
    // ⚠️ A STORE READ FAILS THE BUILD; IT NEVER DEGRADES TO EMPTY. The store is
    // every venue's whole history: an empty leg would not be a quieter month, it
    // would re-derive the published chain without that venue and overwrite it.
    // Throwing leaves the previous blob standing, which is the honest state.
    //
    // Renaiss has its own row store (`renaiss_sales`, full history since its
    // first sale, hygiene applied in readRenaissSales): the store build reads it
    // like the others, and a failed read fails the build the same way.
    const [cc, cy, bz, rn] = await Promise.all([
      readStoreFeed("collector-crypt", { sinceMs }).then((r) => cleanSecondarySales(r).sales),
      readStoreFeed("courtyard", { sinceMs }).then((r) => cleanSecondarySales(r).sales),
      readStoreFeed("beezie", { sinceMs }),
      readRenaissForStore(sinceMs),
    ]);
    const problem = storeHistoryProblem(bz, sinceMs);
    if (problem) throw new Error(problem);
    return [
      ...cleanPlatform("collector-crypt", cc, sinceMs),
      ...cleanPlatform("courtyard", cy, sinceMs),
      ...cleanPlatform("beezie", bz, sinceMs),
      ...cleanPlatform("renaiss", rn, sinceMs),
    ];
  }
  // Beezie's window is derived from `sinceMs` when given (plus a day of slack for
  // clock skew at the boundary), else ~all history for the panel.
  const beezieWindowMs = sinceMs != null ? Math.max(Date.now() - sinceMs, 0) + DAY_MS : 800 * DAY_MS;
  // A request-path caller (the tape) takes a shorter feed over none; the index
  // build (`strict`) must not: see buildSalePanel. A venue held out of the panel
  // (PANEL_VENUES_PENDING_RESTATEMENT) stays lenient even under `strict`: the
  // index does not read it, so its failure must not stop a close. It turns
  // strict the day its restatement lands and it leaves that set.
  const leg = (venue: CardPlatform, p: Promise<NormalizedSale[]>): Promise<NormalizedSale[]> =>
    opts.strict && !PANEL_VENUES_PENDING_RESTATEMENT.has(venue)
      ? p.catch((e: unknown) => {
          throw new Error(`sale panel: the ${venue} leg failed (${e instanceof Error ? e.message : String(e)}); nothing was written, the previous index stands`);
        })
      : p.catch(() => [] as NormalizedSale[]);
  const [cc, cy, bz, rn] = await Promise.all([
    leg("collector-crypt", readSecondarySales("collector-crypt")),
    leg("courtyard", readSecondarySales("courtyard")),
    leg("beezie", fetchBeezieSales(beezieWindowMs)),
    // The row store, never the API: no request path reads Renaiss's API.
    leg("renaiss", readRenaissSales({ sinceMs }).then((r) => r.sales)),
  ]);
  if (opts.strict && !bz.length) {
    throw new Error("sale panel: Beezie's /activity returned no sales; nothing was written, the previous index stands");
  }
  return [
    ...cleanPlatform("collector-crypt", cc, sinceMs),
    ...cleanPlatform("courtyard", cy, sinceMs),
    ...cleanPlatform("beezie", bz, sinceMs),
    ...cleanPlatform("renaiss", rn, sinceMs),
  ];
}

const DAY_MS = 86_400_000;

/** The local verification file for Renaiss under SALES_STORE_LOCAL_DIR: a NormalizedSale[] as readRenaissSales returns it. */
export const RENAISS_LOCAL_FILE = "renaiss_sales.json";

/**
 * Renaiss for the store build: its own row store (`renaiss_sales`, read through
 * readRenaissSales with its hygiene). Under SALES_STORE_LOCAL_DIR (local
 * verification and the tests) the whole store build is local, Renaiss
 * included: `<dir>/renaiss_sales.json` when present, never Postgres. A local
 * dir without the file builds with no Renaiss sales and SAYS so, so a local
 * shadow can never drop a venue silently.
 */
async function readRenaissForStore(sinceMs?: number): Promise<NormalizedSale[]> {
  const dir = process.env.SALES_STORE_LOCAL_DIR;
  if (!dir) return (await readRenaissSales({ sinceMs })).sales;
  const file = join(dir, RENAISS_LOCAL_FILE);
  if (!existsSync(file)) {
    console.warn(`[sale panel] local store: no ${file}; this build reads no Renaiss sales`);
    return [];
  }
  const all = JSON.parse(readFileSync(file, "utf8")) as NormalizedSale[];
  return sinceMs == null ? all : all.filter((s) => Date.parse(s.date) >= sinceMs);
}

/**
 * How deep the store's Beezie history must reach before the index may read it.
 * Every month the index has published rests on Beezie (brief, measured Sep 30),
 * so a store whose Beezie rows start inside the last 60 days is one the history
 * backfill has not run on yet.
 */
export const STORE_MIN_BEEZIE_HISTORY_DAYS = 60;

/**
 * The cutover guard, pure: why the store cannot feed the panel yet, or null.
 * ⚠️ ORDER: migration → seed → `backfill-secondary-sales --platform=beezie
 * --apply` → this reads the store. Merged before the backfill, the index would
 * rebuild on 30 days of Beezie and withhold every month it has published.
 */
export function storeHistoryProblem(beezie: NormalizedSale[], sinceMs?: number, nowMs: number = Date.now()): string | null {
  if (sinceMs != null) return null; // a windowed read asks for less history on purpose
  const oldest = beezie.reduce((m, s) => Math.min(m, Date.parse(s.date)), Infinity);
  if (oldest <= nowMs - STORE_MIN_BEEZIE_HISTORY_DAYS * DAY_MS) return null;
  return (
    `secondary_sales holds ${beezie.length ? `Beezie only from ${new Date(oldest).toISOString().slice(0, 10)}` : "no Beezie rows"}: ` +
    `run \`npx tsx scripts/backfill-secondary-sales.ts --platform=beezie --apply\` before the index reads the store. Nothing was written; the previous index stands.`
  );
}

/**
 * Where the sales come from. "store": every venue's full history in
 * `secondary_sales` — what the PANEL reads (`buildSalePanel`'s default).
 * "legs": the pre-store read (the 30-day snapshot for Collector Crypt and
 * Courtyard, Beezie's live /activity) — `readSaleFeed`'s default, because its
 * other callers (the tape, the grade/set panel) read a recent window on a
 * request path, where the store would add a Postgres read and Beezie's live
 * request is what keeps them current; and what `warm-sale-panel
 * --shadow-venues` builds the "before" index on.
 */
export type PanelSource = "store" | "legs";

/** Tag one platform's cleaned sales with cards-table dims. */
async function tagPlatform(platform: CardPlatform, sales: UntaggedSale[], legacy: boolean): Promise<SaleRow[]> {
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
      ...(legacy ? { legacyIdentity: d?.identity ? legacyIdentityKey(d.ip ?? "other", d.identity) : null } : {}),
    };
  });
}

/**
 * Venues the LEGS build keeps OUT of the panel: the method as published up to
 * v4.2, and the shadow build's "before" (`warm-sale-panel --shadow-venues`).
 * The STORE build (v4.3, the panel's default) reads every venue, Renaiss
 * included, so Collector Crypt's and Courtyard's histories and Renaiss join the
 * index in ONE restatement with ONE method-ledger entry, which the shadow
 * measures against exactly this set.
 *
 * ⚠️ RENAISS RESTATES THE PUBLISHED INDEX. Its backfill (Oct 5 2026, 18,304
 * sales since Jan 9) nearly doubles the panel (21,523 → 39,459 sales), and most
 * of it is January to April. Measured on a local --out build that day: the base
 * month moves from February to January, three set indices start publishing, and
 * the published September close moves from 151.2 to 129.2 on V-MKT (149.3 →
 * 126.6 on V-PKM), with May to August 21 to 29 points lower.
 *
 * The tape and the grade/set feeds read `readSaleFeed` (legs) directly and keep
 * Renaiss in them; Renaiss's volumes come from its own row stores.
 */
export const PANEL_VENUES_PENDING_RESTATEMENT: ReadonlySet<CardPlatform> = new Set<CardPlatform>(["renaiss"]);

/**
 * Build the full cross-platform sale-price panel, from the store by default.
 * On the store a failed read, or a Beezie history the backfill has not filled,
 * THROWS (readSaleFeed): the warmer then writes nothing. On "legs" (the shadow
 * build's "before") a failing feed degrades to an empty contribution, as it
 * always has — unless `strict`.
 *
 * ⚠️ `strict` IS THE INDEX BUILD'S (warm-sale-panel). Measured Oct 1: one live
 * Beezie /activity request failed, the leg degraded to empty, and the index
 * built on the rest published NO month for market:total, ip:pokemon or
 * category:tcg, because every published step rests on Beezie. The warmer would
 * have overwritten the blob with that. It now throws instead, and the previous
 * blob stands until the next run. The store path throws on its own.
 */
export async function buildSalePanel(opts: { legacyIdentity?: boolean; source?: PanelSource; strict?: boolean } = {}): Promise<SaleRow[]> {
  const source = opts.source ?? "store";
  // Every venue comes from rows runCoreWarm (and the backfill) already stored:
  // no Dune read, no live request. Only warmers/core touches Dune for these feeds.
  // The hold applies to the legs build only (the method before v4.3; see
  // PANEL_VENUES_PENDING_RESTATEMENT): the store build reads every venue.
  const feed = (await readSaleFeed({ source, strict: opts.strict })).filter(
    (s) => source === "store" || !PANEL_VENUES_PENDING_RESTATEMENT.has(s.platform),
  );
  const byPlatform = new Map<CardPlatform, UntaggedSale[]>();
  for (const s of feed) {
    const cur = byPlatform.get(s.platform);
    if (cur) cur.push(s);
    else byPlatform.set(s.platform, [s]);
  }
  const tagged = await Promise.all(
    [...byPlatform].map(([platform, sales]) => tagPlatform(platform, sales, opts.legacyIdentity === true)),
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
  // ⚠️ THE SHADOW KEY NEVER REACHES A SNAPSHOT. `legacyIdentity` exists for the
  // duration of one re-key report; persisted, it would be a second identity
  // scheme sitting in the panel every reader inflates.
  const rows = snap.rows.map((r) => {
    if (r.legacyIdentity === undefined) return r;
    const copy = { ...r };
    delete copy.legacyIdentity;
    return copy;
  });
  return { __gz__: gzipSync(Buffer.from(JSON.stringify({ ...snap, rows }))).toString("base64") };
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
