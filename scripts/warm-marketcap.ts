/**
 * Build per-IP AND per-platform market-cap snapshots from the Postgres `cards` table.
 *
 *   • Collector Crypt: priced by the "Insured Value" trait (cards.insured_value_usd)
 *   • Beezie:          priced by the cheapest active listing (listings snapshot)
 *   • Phygitals:       floor × supply (no per-card valuation exists — see
 *                      processPhygitals); platform-level only, kept out of totals
 *   • Courtyard:       BLOCKED — 0 cards in the `cards` table (the cards gap), so
 *                      neither a per-card sum nor a floor×supply can be computed
 *   • Floor:           min per-token value within the group
 *   • mcap:            sum of per-token values (Phygitals: floor × supply)
 *
 *   npx tsx scripts/warm-marketcap.ts
 *
 * byIp (across platforms) drives the IP pages; byPlatform (per platform, with its IP
 * composition) drives the platform breakdown. byIp is DERIVED from byPlatform so the
 * two can never disagree. Reads the `cards` table (ip_key + insured_value_usd are
 * precomputed) — NOT the local .cache dirs, which don't exist on a fresh CI runner
 * (that was a real bug: on CI the disk scan found 0 cards and wrote an EMPTY mcap).
 * Writes the `marketcap` + `marketcap-history` snapshots, and REFUSES to overwrite
 * with an empty result. Run every 6h (core batch, after warm-listings).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readListings } from "../src/lib/data/listings";
import {
  appendMarketCapHistory,
  writeMarketCap,
  type MarketCapIPEntry,
  type MarketCapPlatformEntry,
  type MarketCapPlatformIP,
} from "../src/lib/data/marketcap";
import { readCardValuations } from "../src/lib/data/cards";
import { readHolders } from "../src/lib/data/holders";
import { PLATFORM_SOURCES } from "../src/lib/data/sources";
import { db } from "../src/lib/db/client";
import { runWarmer } from "../src/lib/db/runWarmer";

type Acc = {
  cards: number;
  cardsValued: number;
  floor: number;
  mcap: number;
  insured: number;
};
type PlatAcc = Acc & { byIp: Map<string, Acc> };

function newAcc(): Acc {
  return { cards: 0, cardsValued: 0, floor: Infinity, mcap: 0, insured: 0 };
}
function accFor(m: Map<string, Acc>, key: string): Acc {
  let acc = m.get(key);
  if (!acc) {
    acc = newAcc();
    m.set(key, acc);
  }
  return acc;
}
function platAccFor(m: Map<string, PlatAcc>, key: string): PlatAcc {
  let acc = m.get(key);
  if (!acc) {
    acc = { ...newAcc(), byIp: new Map() };
    m.set(key, acc);
  }
  return acc;
}

// Defensive upper bound. Anything above this is almost certainly a spam listing
// (we've seen $2 × 10^15 / quadrillion-dollar "joke" prices).
const MAX_PER_TOKEN_USD = 5_000_000;

function addValue(acc: Acc, usd: number) {
  acc.cardsValued += 1;
  acc.mcap += usd;
  if (usd < acc.floor) acc.floor = usd;
}

/**
 * Record one card into both its platform total and its (platform × IP) cell.
 * `value` is the mcap contribution (insured for CC, listing floor for Beezie, 0
 * if unpriced); `insured` is tracked separately (CC only).
 */
function recordCard(
  byPlatform: Map<string, PlatAcc>,
  platform: string,
  ipKey: string,
  value: number,
  insured: number,
) {
  const pAcc = platAccFor(byPlatform, platform);
  const pIpAcc = accFor(pAcc.byIp, ipKey);
  pAcc.cards += 1;
  pIpAcc.cards += 1;
  if (Number.isFinite(value) && value > 0 && value <= MAX_PER_TOKEN_USD) {
    addValue(pAcc, value);
    addValue(pIpAcc, value);
  }
  if (insured > 0) {
    pAcc.insured += insured;
    pIpAcc.insured += insured;
  }
}

async function processCC(byPlatform: Map<string, PlatAcc>) {
  const cards = await readCardValuations("collector-crypt");
  let valued = 0;
  for (const c of cards) {
    const insured = c.insuredValueUsd ?? 0;
    recordCard(byPlatform, "collector-crypt", c.ipKey, insured, insured);
    if (insured > 0) valued += 1;
  }
  console.log(`→ Collector Crypt: ${cards.length} cards · ${valued} with insured value`);
}

async function processBeezie(byPlatform: Map<string, PlatAcc>) {
  const beezie = PLATFORM_SOURCES.find((p) => p.key === "beezie");
  if (!beezie || beezie.kind !== "rarible") return;
  const listings = await readListings();
  const byItem = listings?.byItem ?? {};
  const cards = await readCardValuations("beezie");
  let priced = 0;
  for (const c of cards) {
    const listing = byItem[`${beezie.collectionId}:${c.tokenId}`];
    const price = listing?.priceUsd ?? 0;
    recordCard(byPlatform, "beezie", c.ipKey, price, 0);
    if (price > 0) priced += 1;
  }
  console.log(`→ Beezie: ${cards.length} cards · ${priced} matched a listing`);
}

/** Phygitals' platform floor (min active listing) as written by warm-phygitals. */
async function readPhygitalsFloorUsd(): Promise<number | null> {
  const { data, error } = await db()
    .from("entity_metrics")
    .select("floor_usd")
    .eq("entity_type", "platform")
    .eq("entity_id", "phygitals")
    .eq("period", "all")
    .maybeSingle();
  if (error) {
    console.warn(`  phygitals floor read failed: ${error.message}`);
    return null;
  }
  const f = (data as { floor_usd?: number } | null)?.floor_usd;
  return typeof f === "number" && Number.isFinite(f) && f > 0 ? f : null;
}

/**
 * Phygitals market cap = floor × supply. Unlike CC (insured value per card) and
 * Beezie (per-listing price), we have NO per-card valuation over Phygitals' full
 * supply — the marketplace crawl only indexes LISTED cards. So we estimate:
 *   • floor  — min active listing (entity_metrics, from warm-phygitals)
 *   • supply — every cNFT the holder scan enumerated (holders snapshot, R5)
 * Recorded at the PLATFORM level only. byIp is left empty on purpose: a blended
 * floor can't be honestly split per-IP, and mixing this floor-estimate into the
 * cross-platform byIp/totals would distort the precise CC+Beezie market cap. So
 * Phygitals gets its own `platform/phygitals/mcap_usd` spine point without moving
 * the headline TOTAL MARKET CAP.
 */
async function processPhygitals(byPlatform: Map<string, PlatAcc>) {
  const [holders, floor] = await Promise.all([readHolders(), readPhygitalsFloorUsd()]);
  const supply = holders?.supply?.["phygitals"] ?? 0;
  if (!(supply > 0) || floor == null) {
    console.log(
      `→ Phygitals: skipped mcap (supply=${supply || "—"}, floor=${floor ?? "—"}) — needs warm-holders(supply) + warm-phygitals(floor)`,
    );
    return;
  }
  const mcap = floor * supply;
  const pAcc = platAccFor(byPlatform, "phygitals");
  pAcc.cards = supply;
  pAcc.cardsValued = supply;
  pAcc.mcap = mcap;
  pAcc.floor = floor;
  // byIp intentionally empty — see doc above.
  console.log(
    `→ Phygitals: floor $${floor.toFixed(2)} × supply ${supply.toLocaleString()} = $${Math.round(mcap).toLocaleString()} mcap (platform-level floor estimate)`,
  );
}

const finalFloor = (floor: number): number => (Number.isFinite(floor) ? floor : 0);

async function main() {
  const t0 = Date.now();
  const byPlatform = new Map<string, PlatAcc>();

  await processBeezie(byPlatform);
  await processCC(byPlatform);
  await processPhygitals(byPlatform);

  // Derive cross-platform byIp from byPlatform (single source of truth). Phygitals
  // contributes a platform-level mcap only (empty byIp), so it doesn't fold into
  // the cross-platform byIp/totals — see processPhygitals.
  const byIpAcc = new Map<string, Acc>();
  for (const pAcc of byPlatform.values()) {
    for (const [ip, ipAcc] of pAcc.byIp) {
      const agg = accFor(byIpAcc, ip);
      agg.cards += ipAcc.cards;
      agg.cardsValued += ipAcc.cardsValued;
      agg.mcap += ipAcc.mcap;
      agg.insured += ipAcc.insured;
      if (ipAcc.floor < agg.floor) agg.floor = ipAcc.floor;
    }
  }

  const snap = {
    generatedAt: new Date().toISOString(),
    byIp: {} as Record<string, MarketCapIPEntry>,
    byPlatform: {} as Record<string, MarketCapPlatformEntry>,
    totals: { mcapUsd: 0, insuredUsd: 0 },
  };

  for (const [ip, acc] of byIpAcc) {
    snap.byIp[ip] = {
      cards: acc.cards,
      cardsValued: acc.cardsValued,
      floorUsd: finalFloor(acc.floor),
      mcapUsd: acc.mcap,
      insuredUsd: acc.insured,
    };
    snap.totals.mcapUsd += acc.mcap;
    snap.totals.insuredUsd += acc.insured;
  }

  for (const [platform, pAcc] of byPlatform) {
    const byIp: Record<string, MarketCapPlatformIP> = {};
    for (const [ip, ipAcc] of pAcc.byIp) {
      byIp[ip] = {
        cards: ipAcc.cards,
        cardsValued: ipAcc.cardsValued,
        floorUsd: finalFloor(ipAcc.floor),
        mcapUsd: ipAcc.mcap,
      };
    }
    snap.byPlatform[platform] = {
      cards: pAcc.cards,
      cardsValued: pAcc.cardsValued,
      floorUsd: finalFloor(pAcc.floor),
      mcapUsd: pAcc.mcap,
      insuredUsd: pAcc.insured,
      byIp,
    };
  }

  // Guard: never overwrite a good snapshot with an empty one. If the cards table
  // is empty/unreachable we'd compute $0 mcap — fail loudly (runWarmer records the
  // error) and leave the prior snapshot intact instead of blanking the homepage.
  const ipCount = Object.keys(snap.byIp).length;
  if (ipCount === 0 || snap.totals.mcapUsd <= 0) {
    throw new Error(
      `marketcap: computed ${ipCount} IPs / $${snap.totals.mcapUsd.toFixed(0)} mcap — refusing to overwrite the snapshot (cards table empty or unreachable?)`,
    );
  }

  await writeMarketCap(snap);
  await appendMarketCapHistory(snap);

  console.log(
    `\nWrote marketcap snapshot in ${((Date.now() - t0) / 1000).toFixed(0)}s · ${ipCount} IPs · $${snap.totals.mcapUsd.toFixed(0)} mcap`,
  );
  console.log("\nPer-platform mcap:");
  for (const [k, v] of Object.entries(snap.byPlatform).sort((a, b) => b[1].mcapUsd - a[1].mcapUsd)) {
    const topIps = Object.entries(v.byIp)
      .sort((a, b) => b[1].mcapUsd - a[1].mcapUsd)
      .slice(0, 3)
      .map(([ip, e]) => `${ip} $${Math.round(e.mcapUsd).toLocaleString()}`)
      .join(", ");
    console.log(`  ${k.padEnd(16)} ${v.cards.toString().padStart(7)} cards · $${Math.round(v.mcapUsd).toLocaleString().padStart(13)} · top: ${topIps}`);
  }
  return { rowsWritten: ipCount };
}

runWarmer("marketcap", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
