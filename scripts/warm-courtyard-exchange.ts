/**
 * Courtyard's own exchange → the `secondary_sales` store and the spine.
 *
 * Reads every TradeExecuted on Courtyard's two exchange operators from Polygon
 * (src/lib/courtyard/exchange.ts) and splits them:
 * - **peer-to-peer** trades → `secondary_sales` (source `courtyard:exchange`),
 *   which fetchCourtyardSecondaryScan reads beside the OpenSea trades;
 * - **buyback arbitrage**: a peer-to-peer purchase whose buyer sells the card to
 *   Courtyard's buyback within 24 hours (src/lib/courtyard/arbitrage.ts) is
 *   stored under `courtyard:exchange:arb`: kept for the receipt line, never
 *   resale;
 * - **buybacks** (Courtyard's operations wallet as bidder) → per UTC day, the
 *   spine's `platform / courtyard / outflow_gross_usd`: USDC leaving Courtyard to
 *   players, the outbound leg /economics sets against gacha spend. A day is
 *   written only when the read covers all of it.
 *
 *   npx tsx --env-file=.env.local scripts/warm-courtyard-exchange.ts                  # incremental
 *   npx tsx --env-file=.env.local scripts/warm-courtyard-exchange.ts --from=2026-09-08 # backfill
 *   … --dry   read and report, write nothing
 *
 * Incremental = from the start of yesterday (UTC), or from where the feed last
 * stopped when that is earlier (a stalled feed fills its own gap, up to 7 days),
 * to the newest block less a reorg margin. Writes go out a day's worth of blocks
 * at a time, so a run that dies keeps what it read; every write is idempotent
 * (sale_id = tx:logIndex; spine rows upsert by day).
 *
 * Arbitrage is matched in chain order. The purchases stored in the 24 hours
 * before the read are loaded first, so a buyback read now settles a purchase an
 * earlier batch or run wrote: that row is re-tagged in place. A purchase whose
 * buyback has not happened yet stays resale until a later run reads it.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { blockAtOrAfter, blockTimeMs, fetchExchangeTrades, polygonSafeTip, LOG_CHUNK_BLOCKS } from "../src/lib/courtyard/exchange";
import { ArbitrageMatcher, ARBITRAGE_WINDOW_MS, emptyTally, exchangeSaleId, type DayTally } from "../src/lib/courtyard/arbitrage";
import { readCourtyardExchangeState, writeCourtyardExchangeState } from "../src/lib/courtyard/exchangeState";
import {
  COURTYARD_EXCHANGE_SOURCE,
  markCourtyardArbitrage,
  readStoredSales,
  storedFromCourtyardExchange,
  upsertSecondarySales,
} from "../src/lib/data/salesStore";
import { writeMetricSnapshots, type MetricRow } from "../src/lib/data/metricSnapshots";
import { runWarmer } from "../src/lib/db/runWarmer";

const DAY = 86_400_000;
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? null;
const DRY = process.argv.includes("--dry");
const MAX_GAP_DAYS = 7;
/** Blocks per write batch: ~a day on Polygon (12 requests). */
const BATCH_BLOCKS = LOG_CHUNK_BLOCKS * 12;

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const dayOf = (iso: string) => `${iso.slice(0, 10)}T00:00:00.000Z`;

async function main() {
  const t0 = Date.now();
  const state = await readCourtyardExchangeState().catch(() => null);
  const fromArg = arg("from");
  const yesterday = Math.floor(Date.now() / DAY) * DAY - DAY;
  let fromMs = fromArg ? Date.parse(`${fromArg}T00:00:00Z`) : yesterday;
  if (!fromArg && state) {
    // A feed that stopped before yesterday fills its gap, never more than a week.
    const resume = Math.floor(Date.parse(state.coveredThrough) / DAY) * DAY;
    if (Number.isFinite(resume) && resume < fromMs) fromMs = Math.max(resume, yesterday - MAX_GAP_DAYS * DAY);
  }
  if (!Number.isFinite(fromMs)) throw new Error("--from=YYYY-MM-DD");

  const fromBlock = await blockAtOrAfter(fromMs);
  const toBlock = await polygonSafeTip();
  const toMs = await blockTimeMs(toBlock);
  console.log(`Courtyard exchange: blocks ${fromBlock.toLocaleString()} → ${toBlock.toLocaleString()} (${new Date(fromMs).toISOString()} → ${new Date(toMs).toISOString()})${DRY ? " · DRY RUN" : ""}`);

  // The purchases already stored in the 24 h before this read: a buyback in it
  // may settle one of them.
  const matcher = new ArbitrageMatcher();
  const written = new Set<string>();
  const before = await readStoredSales("courtyard", { sinceMs: fromMs - ARBITRAGE_WINDOW_MS, untilMs: fromMs, source: { only: COURTYARD_EXCHANGE_SOURCE } });
  for (const r of before) {
    const ms = Date.parse(r.sold_at);
    if (!r.buyer) continue;
    matcher.purchase({ id: r.sale_id, bidder: r.buyer, tokenId: r.token_id, ms });
    written.add(r.sale_id);
  }
  console.log(`  ${written.size.toLocaleString()} stored purchase(s) from the 24 h before the read are open for a buyback`);

  // Tallies, not trades: a long backfill reads ~45,000 trades a day. A purchase
  // is classified at the end, because its buyback can come in a later batch.
  const purchases = new Map<string, { day: string; usd: number }>();
  const buybacks = new Map<string, { n: number; usd: number }>();
  const arb = new Set<string>();
  let upserted = 0;
  let retagged = 0;

  for (let a = fromBlock; a <= toBlock; a += BATCH_BLOCKS) {
    const b = Math.min(toBlock, a + BATCH_BLOCKS - 1);
    const batch = await fetchExchangeTrades(a, b);
    const late: string[] = [];
    for (const t of batch) {
      const ms = Date.parse(t.ts);
      if (t.kind === "p2p") {
        const id = exchangeSaleId(t);
        matcher.purchase({ id, bidder: t.bidder, tokenId: t.tokenId, ms });
        purchases.set(id, { day: dayOf(t.ts), usd: t.usd });
      } else {
        const bb = buybacks.get(dayOf(t.ts)) ?? { n: 0, usd: 0 };
        bb.n++;
        bb.usd += t.usd;
        buybacks.set(dayOf(t.ts), bb);
        const hit = matcher.buyback(t.asker, t.tokenId, ms);
        if (hit) {
          arb.add(hit);
          if (written.has(hit)) late.push(hit);
        }
      }
    }
    const p2p = batch.filter((t) => t.kind === "p2p");
    if (!DRY && p2p.length) upserted += await upsertSecondarySales(p2p.map((t) => storedFromCourtyardExchange(t, arb.has(exchangeSaleId(t)))));
    if (!DRY && late.length) retagged += await markCourtyardArbitrage(late);
    for (const t of p2p) written.add(exchangeSaleId(t));
    const lastMs = batch.length ? Date.parse(batch[batch.length - 1].ts) : null;
    if (lastMs != null) matcher.prune(lastMs);
    const batchArb = p2p.filter((t) => arb.has(exchangeSaleId(t))).length;
    console.log(
      `  blocks ${a.toLocaleString()}–${b.toLocaleString()}: ${batch.length.toLocaleString()} trades (${p2p.length.toLocaleString()} peer-to-peer, ${batchArb.toLocaleString()} arbitrage${late.length ? `, ${late.length} earlier purchase(s) re-tagged` : ""}) · ${((Date.now() - t0) / 1000).toFixed(0)}s`,
    );
  }

  const days = new Map<string, DayTally>();
  const dayTally = (day: string) => days.get(day) ?? (days.set(day, emptyTally()), days.get(day)!);
  for (const [id, p] of purchases) {
    const d = dayTally(p.day);
    if (arb.has(id)) {
      d.arbN++;
      d.arbUsd += p.usd;
    } else {
      d.resaleN++;
      d.resaleUsd += p.usd;
    }
  }
  for (const [day, bb] of buybacks) {
    const d = dayTally(day);
    d.buybackN = bb.n;
    d.buybackUsd = bb.usd;
  }

  // Buybacks per COMPLETE day: the read must cover the whole UTC day.
  const rows: MetricRow[] = [];
  for (const [day, d] of [...days.entries()].sort()) {
    const ds = Date.parse(day);
    if (ds < fromMs || ds + DAY > toMs || d.buybackN === 0) continue;
    rows.push({ entity_type: "platform", entity_key: "courtyard", metric: "outflow_gross_usd", value: d.buybackUsd, ts: day });
  }
  if (!DRY && rows.length) await writeMetricSnapshots(rows);

  console.log(`\n| Day | Resale (peer-to-peer) | Arbitrage (left out) | Buybacks | Buyback day written |\n|---|---|---|---|---|`);
  for (const [day, d] of [...days.entries()].sort()) {
    const w = rows.some((r) => r.ts === day);
    console.log(
      `| ${day.slice(0, 10)} | ${d.resaleN.toLocaleString()} · ${usd(d.resaleUsd)} | ${d.arbN.toLocaleString()} · ${usd(d.arbUsd)} | ${d.buybackN ? `${d.buybackN.toLocaleString()} · ${usd(d.buybackUsd)}` : "—"} | ${w ? "yes" : "partial, no"} |`,
    );
  }
  const sum = [...days.values()].reduce(
    (s, d) => ({ rn: s.rn + d.resaleN, ru: s.ru + d.resaleUsd, an: s.an + d.arbN, au: s.au + d.arbUsd, bn: s.bn + d.buybackN, bu: s.bu + d.buybackUsd }),
    { rn: 0, ru: 0, an: 0, au: 0, bn: 0, bu: 0 },
  );
  const share = sum.ru + sum.au > 0 ? ((100 * sum.au) / (sum.ru + sum.au)).toFixed(1) : "0.0";
  console.log(
    `\nPeer-to-peer ${(sum.rn + sum.an).toLocaleString()} trades: resale ${sum.rn.toLocaleString()} ${usd(sum.ru)} · arbitrage ${sum.an.toLocaleString()} ${usd(sum.au)} (${share}% of dollars) · ${upserted.toLocaleString()} rows upserted, ${retagged.toLocaleString()} re-tagged · ${matcher.pending.toLocaleString()} purchase(s) still open · buybacks ${sum.bn.toLocaleString()} ${usd(sum.bu)} (${rows.length} complete days to the spine) · ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );

  if (!DRY) {
    const coveredThrough = new Date(toMs).toISOString();
    const fromIso = new Date(fromMs).toISOString();
    await writeCourtyardExchangeState({
      throughBlock: toBlock,
      coveredThrough,
      coveredFrom: state && state.coveredFrom < fromIso ? state.coveredFrom : fromIso,
      updatedAt: new Date().toISOString(),
    });
  }
  return { rowsWritten: upserted };
}

(DRY ? main() : runWarmer("courtyard-exchange", main)).catch((e) => {
  console.error(e);
  process.exit(1);
});
