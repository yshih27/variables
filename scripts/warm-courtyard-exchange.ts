/**
 * Courtyard's own exchange → the `secondary_sales` store and the spine.
 *
 * Reads every TradeExecuted on Courtyard's two exchange operators from Polygon
 * (src/lib/courtyard/exchange.ts) and splits them:
 * - **peer-to-peer** trades → `secondary_sales` (source `courtyard:exchange`),
 *   which fetchCourtyardSecondaryScan reads beside the OpenSea trades;
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
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { blockAtOrAfter, blockTimeMs, fetchExchangeTrades, polygonSafeTip, LOG_CHUNK_BLOCKS, type ExchangeTrade } from "../src/lib/courtyard/exchange";
import { readCourtyardExchangeState, writeCourtyardExchangeState } from "../src/lib/courtyard/exchangeState";
import { storedFromCourtyardExchange, upsertSecondarySales } from "../src/lib/data/salesStore";
import { writeMetricSnapshots, type MetricRow } from "../src/lib/data/metricSnapshots";
import { runWarmer } from "../src/lib/db/runWarmer";

const DAY = 86_400_000;
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? null;
const DRY = process.argv.includes("--dry");
const MAX_GAP_DAYS = 7;
/** Blocks per write batch: ~a day on Polygon (12 requests). */
const BATCH_BLOCKS = LOG_CHUNK_BLOCKS * 12;

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

  let p2pN = 0;
  let p2pUsd = 0;
  let bbN = 0;
  let bbUsd = 0;
  const buybackByDay = new Map<string, { usd: number; n: number }>();
  const p2pByDay = new Map<string, { usd: number; n: number }>();
  let written = 0;

  for (let a = fromBlock; a <= toBlock; a += BATCH_BLOCKS) {
    const b = Math.min(toBlock, a + BATCH_BLOCKS - 1);
    const trades: ExchangeTrade[] = await fetchExchangeTrades(a, b);
    const p2p = trades.filter((t) => t.kind === "p2p");
    for (const t of trades) {
      const m = t.kind === "p2p" ? p2pByDay : buybackByDay;
      const d = m.get(dayOf(t.ts)) ?? { usd: 0, n: 0 };
      d.usd += t.usd;
      d.n++;
      m.set(dayOf(t.ts), d);
      if (t.kind === "p2p") {
        p2pN++;
        p2pUsd += t.usd;
      } else {
        bbN++;
        bbUsd += t.usd;
      }
    }
    if (!DRY && p2p.length) written += await upsertSecondarySales(p2p.map(storedFromCourtyardExchange));
    console.log(`  blocks ${a.toLocaleString()}–${b.toLocaleString()}: ${trades.length.toLocaleString()} trades (${p2p.length.toLocaleString()} peer-to-peer) · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }

  // Buybacks per COMPLETE day: the read must cover the whole UTC day.
  const rows: MetricRow[] = [];
  for (const [day, v] of [...buybackByDay.entries()].sort()) {
    const ds = Date.parse(day);
    if (ds < fromMs || ds + DAY > toMs) continue;
    rows.push({ entity_type: "platform", entity_key: "courtyard", metric: "outflow_gross_usd", value: v.usd, ts: day });
  }
  if (!DRY && rows.length) await writeMetricSnapshots(rows);

  console.log(`\n| Day | Peer-to-peer | Buybacks | Buyback day written |\n|---|---|---|---|`);
  for (const day of [...new Set([...p2pByDay.keys(), ...buybackByDay.keys()])].sort()) {
    const p = p2pByDay.get(day);
    const bb = buybackByDay.get(day);
    const w = rows.some((r) => r.ts === day);
    console.log(`| ${day.slice(0, 10)} | ${p ? `${p.n.toLocaleString()} · $${Math.round(p.usd).toLocaleString()}` : "—"} | ${bb ? `${bb.n.toLocaleString()} · $${Math.round(bb.usd).toLocaleString()}` : "—"} | ${w ? "yes" : "partial, no"} |`);
  }
  console.log(`\nPeer-to-peer ${p2pN.toLocaleString()} trades $${Math.round(p2pUsd).toLocaleString()} (${written.toLocaleString()} rows upserted) · buybacks ${bbN.toLocaleString()} $${Math.round(bbUsd).toLocaleString()} (${rows.length} complete days to the spine) · ${((Date.now() - t0) / 1000).toFixed(0)}s`);

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
  return { rowsWritten: written };
}

(DRY ? main() : runWarmer("courtyard-exchange", main)).catch((e) => {
  console.error(e);
  process.exit(1);
});
