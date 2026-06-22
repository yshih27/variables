/**
 * Real-time gacha listener — an always-on worker that keeps the pull spine
 * minutes-fresh instead of 6-hours-fresh.
 *
 *   npm run listen-gacha
 *
 * HOW IT STAYS COMPLETE WITHOUT WEBSOCKETS: Collector Crypt's
 * /api/getAllWinners?count=200 returns the 200 most recent pulls — at the
 * observed ~24 pulls/min that is an ~8-minute buffer, so a 90s poll captures
 * the complete stream with ~5× overlap margin (CC's Ably channels exist but
 * aren't needed). Phygitals' CLAW feed re-serves its recent window on page 1,
 * which the same logic covers. Everything lands in gacha_pulls via the SAME
 * idempotent ingest the 6h warmers use — overlap is free, gaps are covered by
 * the warmers' deeper scans.
 *
 * Also maintains the `gacha:live` snapshot: a rolling window of the freshest
 * hits (with pack names + art) + per-source heartbeats — the low-latency read
 * path for the site and the future alert bot.
 *
 * DEPLOY: any Node 20+ host that can run `npx tsx scripts/listen-gacha.ts`
 * (Railway / Fly / a VPS / even a spare machine). Needs SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY in the environment (.env.local works locally).
 * Safe to run alongside the cron warmers; safe to restart at any time.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import {
  fetchCCGachaCatalog,
  fetchCCRecentWinners,
  type CCWinner,
} from "../src/lib/cc/gacha";
import { fetchPhygitalsClawFeed, type PhygitalsPull } from "../src/lib/phygitals/client";
import { ingestCCPulls } from "../src/lib/data/warmers/ccGacha";
import { ingestPhygitalsPulls } from "../src/lib/data/warmers/phygitalsGacha";
import { writeGachaLive } from "../src/lib/data/gachaLiveCache";
import { recordFreshness } from "../src/lib/db/freshness";
import type { GachaBigHit } from "../src/lib/data/gachaDuneCache";

// Observed live: CC peaks at ~75+ pulls/min (3× its daily average), shrinking
// the count=200 buffer to ~2.5min — 60s polling keeps full capture up to
// ~200 pulls/min.
const POLL_MS = 60_000;
const CATALOG_REFRESH_MS = 60 * 60_000; // machine names/prices move slowly
const LIVE_WINDOW = 50; // hits kept in the gacha:live snapshot
const FRESHNESS_EVERY_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 10 * 60_000;

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

// in-memory dedup so cycle logs say what's actually NEW (DB upsert is
// idempotent regardless); capped so a week-long run doesn't grow unbounded
const seen = new Set<string>();
function markNew(key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  if (seen.size > 50_000) {
    // drop the oldest half (Set iterates in insertion order)
    let i = 0;
    for (const k of seen) {
      seen.delete(k);
      if (++i >= 25_000) break;
    }
  }
  return true;
}

let liveHits: GachaBigHit[] = [];
const sourceBeat: Record<string, string> = {};
let lastFreshnessAt = 0;
let cycles = 0;

function pushLive(hits: GachaBigHit[]): void {
  if (hits.length === 0) return;
  liveHits = [...hits, ...liveHits]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, LIVE_WINDOW);
}

async function flushLive(): Promise<void> {
  const generatedAt = new Date().toISOString();
  await writeGachaLive({ generatedAt, hits: liveHits, sources: { ...sourceBeat } });
  if (Date.now() - lastFreshnessAt > FRESHNESS_EVERY_MS) {
    lastFreshnessAt = Date.now();
    await recordFreshness("gacha-live", {
      status: "ok",
      rowsWritten: liveHits.length,
      durationMs: 0,
      generatedAt,
    }).catch(() => {});
  }
}

// ── Collector Crypt ──
let ccCatalog = new Map<string, { price: number; name: string }>();
let ccCatalogAt = 0;

async function ccCycle(): Promise<number> {
  if (Date.now() - ccCatalogAt > CATALOG_REFRESH_MS) {
    const cat = await fetchCCGachaCatalog();
    ccCatalog = new Map(
      cat.map((m) => [
        m.code,
        {
          price: m.price?.amount || Number(m.code.match(/_(\d+)$/)?.[1] ?? 0),
          name: m.shortName || m.name,
        },
      ]),
    );
    ccCatalogAt = Date.now();
  }
  const winners = await fetchCCRecentWinners(200);
  const fresh = winners.filter((w) => markNew(`cc:${w.mint}:${Date.parse(w.at)}`));
  if (fresh.length) {
    const priceByCode = new Map([...ccCatalog].map(([code, v]) => [code, v.price]));
    await ingestCCPulls(fresh, priceByCode);
    pushLive(
      fresh.map(
        (w: CCWinner): GachaBigHit => ({
          platform: "collector-crypt",
          mint: w.mint,
          name: w.name ?? w.mint.slice(0, 8),
          tier: w.tier ?? "",
          valueUsd: w.valueUsd,
          image: w.image,
          imageFallback: null,
          at: w.at,
          pack: ccCatalog.get(w.packCode)?.name ?? w.packCode,
        }),
      ),
    );
  }
  sourceBeat["collector-crypt"] = new Date().toISOString();
  return fresh.length;
}

// ── Phygitals ──
async function phCycle(): Promise<number> {
  const feed = await fetchPhygitalsClawFeed({ maxPages: 2, log: () => {} });
  const fresh = feed.pulls.filter((p) => markNew(`ph:${p.txid}`));
  if (fresh.length) {
    await ingestPhygitalsPulls(fresh);
    pushLive(
      fresh
        .filter((p) => p.prizeMint && (p.prizeFmvUsd ?? 0) > 0)
        .map(
          (p: PhygitalsPull): GachaBigHit => ({
            platform: "phygitals",
            mint: p.prizeMint!,
            name: p.prizeName ?? p.prizeMint!.slice(0, 8),
            tier: "",
            valueUsd: p.prizeFmvUsd!,
            image: p.prizeImage,
            imageFallback: null,
            at: p.time,
            pack: `$${Math.round(p.pricePaidUsd)} pack`,
          }),
        ),
    );
  }
  sourceBeat["phygitals"] = new Date().toISOString();
  return fresh.length;
}

// ── main loop ──
const backoff: Record<string, number> = { cc: 0, ph: 0 };
const nextAt: Record<string, number> = { cc: 0, ph: 0 };

async function runSource(key: "cc" | "ph", fn: () => Promise<number>, label: string): Promise<number> {
  if (Date.now() < nextAt[key]) return 0;
  try {
    const n = await fn();
    backoff[key] = 0;
    nextAt[key] = Date.now() + POLL_MS;
    return n;
  } catch (err) {
    backoff[key] = Math.min(backoff[key] ? backoff[key] * 2 : POLL_MS, MAX_BACKOFF_MS);
    nextAt[key] = Date.now() + backoff[key];
    log(`${label} FAILED (retry in ${Math.round(backoff[key] / 1000)}s): ${(err as Error).message}`);
    return 0;
  }
}

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
  log("SIGINT — finishing cycle then exiting");
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function main() {
  log(`gacha listener up — poll every ${POLL_MS / 1000}s (CC count=200 + Phygitals CLAW p1-2)`);
  for (;;) {
    if (stopping) break;
    const [ccNew, phNew] = await Promise.all([
      runSource("cc", ccCycle, "collector-crypt"),
      runSource("ph", phCycle, "phygitals"),
    ]);
    if (ccNew || phNew) {
      await flushLive().catch((e) => log(`gacha:live write failed: ${(e as Error).message}`));
      const top = liveHits[0];
      log(
        `+${ccNew} cc · +${phNew} ph → spine (live window ${liveHits.length}${top ? `, latest $${Math.round(top.valueUsd).toLocaleString()} ${top.pack ?? ""}` : ""})`,
      );
    } else if (++cycles % 10 === 0) {
      log("heartbeat — no new pulls");
    }
    // small sleep granularity so SIGINT lands quickly; per-source pacing is in nextAt
    await new Promise((r) => setTimeout(r, 5_000));
  }
  log("listener stopped");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
