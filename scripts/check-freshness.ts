/**
 * Read-only data-freshness report — the verification harness for the
 * data-reliability work. For every tracked source it prints the honest
 * "as of" from source_freshness (ok / stale / error / untracked) and the age
 * of each raw `snapshots` blob the pages actually read. No writes; safe to
 * run anytime:
 *
 *   npm run check-freshness
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../src/lib/db/client";
import {
  readFreshness,
  freshnessState,
  SOURCE_INTERVALS_MS,
} from "../src/lib/db/freshness";
import { readSnapshot } from "../src/lib/db/snapshots";
import { SALE_PANEL_SNAPSHOT_KEY } from "../src/lib/data/salePanel";
import { IDENTITY_INDEX_SNAPSHOT_KEY, IDENTITY_SLABS_SNAPSHOT_KEY } from "../src/lib/data/identityDetail";
import { CHARACTER_ROLLUPS_SNAPSHOT_KEY } from "../src/lib/data/characterRollups";
import type { HeliusCreditsSnapshot, DuneSpendSnapshot } from "../src/lib/db/runWarmer";
import { queryArchivedStatus } from "../src/lib/dune/client";
import {
  CC_SECONDARY_QUERY_ID,
  COURTYARD_SECONDARY_QUERY_ID,
  GACHA_LIVE_QUERY_ID,
  GACHA_DAILY_QUERY_ID,
  BUYBACK_QUERY_ID,
  CC_BIG_HITS_QUERY_ID,
  CC_ODDS_QUERY_ID,
} from "../src/lib/dune/queryIds";
import { duneUsage } from "../src/lib/dune/client";

// A single warmer run over this many Helius credits is almost certainly a runaway
// crawl (legit heaviest = holders ≈ 285). Flagged in the report; the HARD stop is
// the per-run budget in the Helius client (a breach throws → error → gate red).
const HELIUS_BURN_WARN = 50_000;

// A single warm pulling more than this from Dune means a query lost its time
// window (the Courtyard full-history scan billed ~2.7M datapoints/day for 18
// days before anyone looked). Soft flag here; the client warns at its own budget.
const DUNE_BURN_WARN = 200_000;

function fmtAge(ms: number | null): string {
  if (ms == null) return "—";
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

const ICON: Record<string, string> = { ok: "✓", stale: "⚠", error: "✗", untracked: "·" };

async function main() {
  console.log(`\nData freshness — ${process.env.SUPABASE_URL}\n`);

  // ── source_freshness: the honest per-source "as of" (warmer runs) ──
  const rows = await readFreshness();
  const byId = new Map(rows.map((r) => [r.source, r]));
  const sources = Array.from(
    new Set([...Object.keys(SOURCE_INTERVALS_MS), ...rows.map((r) => r.source)]),
  ).sort();

  const tally = { ok: 0, stale: 0, error: 0, untracked: 0 };
  const stateBySource = new Map<string, string>();
  console.log("SOURCE FRESHNESS (warmer runs)");
  for (const source of sources) {
    const row = byId.get(source);
    const { state, ageMs } = freshnessState(source, row);
    tally[state] += 1;
    stateBySource.set(source, state);
    const rowsTxt = row?.rows_written != null ? `${row.rows_written} rows` : "";
    const errTxt = row?.error ? `· ${row.error.slice(0, 60)}` : "";
    console.log(
      `  ${ICON[state]} ${source.padEnd(20)} ${state.padEnd(10)} ${fmtAge(ageMs).padStart(4)} ago  ${rowsTxt} ${errTxt}`,
    );
  }

  // ── snapshots: the raw blobs the pages actually read ──
  const { data: snaps } = await db()
    .from("snapshots")
    .select("key, generated_at")
    .order("key");
  console.log("\nSNAPSHOT BLOBS (read path)");
  for (const s of snaps ?? []) {
    const ageMs = Date.now() - new Date(s.generated_at as string).getTime();
    console.log(`  ${(s.key as string).padEnd(24)} ${fmtAge(ageMs).padStart(4)} ago`);
  }

  // ── Indices-batch derived blobs — the panel, the identity index (+ slabs)
  //    and the character rollups are written by warm-sale-panel in the SAME run
  //    as price-index, and the identity / character pages read ONLY them. They
  //    record no source_freshness row of their own, so their staleness rule is
  //    price-index's (daily; stale past 2×), applied to the blob's own
  //    generated_at, and a missing blob is as dead as a stale one. Folded into
  //    the gate whenever price-index is required. ──
  const DERIVED = [SALE_PANEL_SNAPSHOT_KEY, IDENTITY_INDEX_SNAPSHOT_KEY, IDENTITY_SLABS_SNAPSHOT_KEY, CHARACTER_ROLLUPS_SNAPSHOT_KEY];
  const derivedDead: string[] = [];
  console.log("\nINDICES-BATCH DERIVED BLOBS (price-index staleness rule)");
  for (const key of DERIVED) {
    const row = (snaps ?? []).find((x) => x.key === key);
    const { state, ageMs } = freshnessState("price-index", row ? { source: key, generated_at: row.generated_at as string, status: "ok", rows_written: null, duration_ms: null, error: null, next_expected_at: null } : undefined);
    if (state !== "ok") derivedDead.push(`${key} (${state})`);
    console.log(`  ${ICON[state]} ${key.padEnd(20)} ${state.padEnd(10)} ${fmtAge(ageMs).padStart(4)} ago`);
  }

  // ── Helius credit burn (per warmer run) — catch a runaway crawl in the report,
  //    not on the invoice. Recorded by runWarmer from the client's credit meter. ──
  const credits = await readSnapshot<HeliusCreditsSnapshot>("helius-credits").catch(() => null);
  const creditEntries = Object.entries(credits?.bySource ?? {}).sort((a, b) => b[1].credits - a[1].credits);
  if (creditEntries.length) {
    console.log("\nHELIUS CREDIT BURN (last run per source)");
    let total = 0;
    for (const [source, { credits: c, at }] of creditEntries) {
      total += c;
      const ageMs = Date.now() - new Date(at).getTime();
      const flag = c >= HELIUS_BURN_WARN ? "  ⚠ RUNAWAY?" : "";
      console.log(`  ${source.padEnd(20)} ~${c.toLocaleString().padStart(9)} cr  ${fmtAge(ageMs).padStart(4)} ago${flag}`);
    }
    console.log(`  ${"TOTAL".padEnd(20)} ~${total.toLocaleString().padStart(9)} cr / cycle`);
  }

  // ── Dune spend — per-warmer export cost from the client's meter, plus the
  //    account's REAL credit usage (free metadata endpoint). Our meter only sees
  //    exports; executions are billed for compute on top, so the account figure
  //    is the one that decides whether we're inside the plan. ──
  const dune = await readSnapshot<DuneSpendSnapshot>("dune-spend").catch(() => null);
  const duneEntries = Object.entries(dune?.bySource ?? {}).sort(
    (a, b) => b[1].datapoints - a[1].datapoints,
  );
  if (duneEntries.length) {
    console.log("\nDUNE EXPORT SPEND (last run per source)");
    let total = 0;
    for (const [source, { datapoints, calls, at }] of duneEntries) {
      total += datapoints;
      const ageMs = Date.now() - new Date(at).getTime();
      const flag = datapoints >= DUNE_BURN_WARN ? "  ⚠ UNWINDOWED QUERY?" : "";
      console.log(
        `  ${source.padEnd(20)} ${datapoints.toLocaleString().padStart(10)} dp  ${String(calls).padStart(3)} calls  ${fmtAge(ageMs).padStart(4)} ago${flag}`,
      );
    }
    console.log(`  ${"TOTAL".padEnd(20)} ${total.toLocaleString().padStart(10)} dp / cycle`);
  }

  // Account truth. Never let a missing/invalid DUNE_API_KEY fail the report.
  try {
    const usage = await duneUsage();
    if (usage) {
      const pct = usage.creditsIncluded > 0 ? (usage.creditsUsed / usage.creditsIncluded) * 100 : 0;
      const over = pct > 100 ? "  ⚠ OVER PLAN" : "";
      console.log(
        `\nDUNE ACCOUNT CREDITS  ${Math.round(usage.creditsUsed).toLocaleString()} / ` +
          `${usage.creditsIncluded.toLocaleString()} included (${pct.toFixed(0)}%)` +
          ` · period ${usage.periodStart ?? "?"} → ${usage.periodEnd ?? "?"}${over}`,
      );
      // The projection: average burn since the period opened, carried to its
      // end. Extra credits are billed, not blocked — the Analyst plan lists
      // $0.016 per credit (dune.com/pricing, read 2026-09-22; override with
      // DUNE_OVERAGE_USD_PER_CREDIT). Printed every run so the cost of the
      // month is never a surprise at the invoice.
      const DAY = 24 * 60 * 60 * 1000;
      const start = usage.periodStart ? Date.parse(usage.periodStart) : NaN;
      const end = usage.periodEnd ? Date.parse(usage.periodEnd) : NaN;
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        const nowMs = Date.now();
        const elapsedDays = Math.max(0.5, (nowMs - start) / DAY);
        const remainingDays = Math.max(0, (end - nowMs) / DAY);
        const burn = usage.creditsUsed / elapsedDays;
        const projected = usage.creditsUsed + burn * remainingDays;
        const overage = Math.max(0, projected - usage.creditsIncluded);
        const rate = Number(process.env.DUNE_OVERAGE_USD_PER_CREDIT ?? 0.016);
        const left = usage.creditsIncluded - usage.creditsUsed;
        const runsOut =
          left <= 0 ? "already past the included credits" : burn > 0 ? `included credits run out ${new Date(nowMs + (left / burn) * DAY).toISOString().slice(0, 10)}` : "no burn";
        console.log(
          `  burn ${burn.toFixed(0)} cr/day over ${elapsedDays.toFixed(1)}d · ${runsOut} · ` +
            `projected ${Math.round(projected).toLocaleString()} by ${usage.periodEnd} → ` +
            (overage > 0 ? `${Math.round(overage).toLocaleString()} extra credits ≈ $${(overage * rate).toFixed(0)} at $${rate}/cr` : "inside the plan"),
        );
      }
    }
  } catch (e) {
    console.log(`\nDUNE ACCOUNT CREDITS  unavailable (${(e as Error).message.slice(0, 60)})`);
  }

  // ── Dune query archive probe — the Aug '26 downgrade ARCHIVED active queries
  //    and the failures only surfaced as downstream 403s (the spine writer died
  //    silently for a week). Probe every fleet query's metadata directly (zero
  //    datapoints billed) so a re-archive is named in the SAME run it happens.
  //    Paused queries (odds, while GACHA_ENABLED is off) warn instead of failing:
  //    nothing breaks today, but an unexpected archive there is the storage-
  //    pressure canary. Probe errors (no key / network) degrade to a note.
  const FLEET: { id: number; name: string; pausedOk?: boolean }[] = [
    { id: CC_SECONDARY_QUERY_ID, name: "cc-secondary" },
    { id: COURTYARD_SECONDARY_QUERY_ID, name: "courtyard-secondary" },
    { id: GACHA_LIVE_QUERY_ID, name: "gacha-live" },
    { id: GACHA_DAILY_QUERY_ID, name: "gacha-daily (spine)" },
    { id: BUYBACK_QUERY_ID, name: "buyback" },
    { id: CC_BIG_HITS_QUERY_ID, name: "cc-big-hits" },
    { id: CC_ODDS_QUERY_ID, name: "cc-odds", pausedOk: true },
  ];
  const archivedFatal: string[] = [];
  try {
    const lines: string[] = [];
    for (const q of FLEET) {
      const archived = await queryArchivedStatus(q.id);
      if (archived && q.pausedOk) lines.push(`  ⚠ ${q.name.padEnd(22)} ${q.id}  ARCHIVED (execution paused — storage-pressure canary)`);
      else if (archived) {
        lines.push(`  ✗ ${q.name.padEnd(22)} ${q.id}  ARCHIVED — executions will 403`);
        archivedFatal.push(`${q.name} (${q.id})`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    console.log(
      `\nDUNE QUERY STATUS  ${FLEET.length - archivedFatal.length}/${FLEET.length} executable` +
        (lines.length ? `\n${lines.join("\n")}` : " · none archived"),
    );
  } catch (e) {
    console.log(`\nDUNE QUERY STATUS  unavailable (${(e as Error).message.slice(0, 60)})`);
  }

  // AF-2: an errored warmer's data is FROZEN — that IS stale. Fold error into the
  // stale count so "0 stale" can never mask a dead warmer. (The failure mode: a
  // warmer that ran-then-errored writes a RECENT source_freshness.generated_at
  // with status="error", so freshnessState returns "error" but the age-based
  // "stale" check — which only runs for non-error rows — never trips. Result was
  // the misleading "18 ok · 0 stale · 3 error" while 3 series sat frozen for days.)
  // The error tally stays visible as the sharper signal; the health gate below
  // hard-fails on any required source in "error".
  const staleTotal = tally.stale + tally.error;
  console.log(
    `\nSUMMARY  ${tally.ok} ok · ${staleTotal} stale (incl. ${tally.error} error) · ${tally.untracked} untracked\n`,
  );

  // ── CI health gate ──────────────────────────────────────────────────────────
  // `--require=a,b,c` makes the process EXIT 1 if any listed source is in "error"
  // state. The warm.yml jobs run this as a final step with the batch's own source
  // list, so a dead warmer turns the GitHub Actions run RED (→ built-in failure
  // notification) instead of failing silently behind `continue-on-error`. Scoped
  // per batch so one schedule's failure doesn't redden an unrelated batch's run.
  const requireArg = process.argv.find((a) => a.startsWith("--require="));
  if (requireArg) {
    const required = requireArg
      .slice("--require=".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // ⚠️ A required source fails the gate when it is error OR stale OR untracked —
    // not just "error". The gate used to test `=== "error"` only, and that is how
    // metric-snapshots sat dead for 6 days behind GREEN runs: a warmer that stops
    // being INVOKED never writes an error row. Its last successful row simply
    // stays put, ages past 2× its interval into "stale", and an error-only gate
    // waves it through. "untracked" (no row at all) is the same failure seen from
    // a cold start. Freshness is the property we actually require, so all three
    // count as dead.
    const DEAD: Record<string, string> = {
      error: "errored",
      stale: "STALE — no fresh run (is the step still scheduled?)",
      untracked: "UNTRACKED — never recorded a run",
    };
    // Archived fleet queries are a gate failure in their own right: executions
    // will 403 on the next warm, so name the breakage NOW rather than letting it
    // surface as a downstream warmer error (the Aug '26 failure mode).
    if (archivedFatal.length) {
      console.error(`✗ HEALTH GATE FAILED — ${archivedFatal.length} active Dune query(ies) ARCHIVED: ${archivedFatal.join(", ")}`);
      console.error("   (unarchive via POST /api/v1/query/{id}/unarchive — see the Dune incident runbook)");
      process.exit(1);
    }
    const dead = required
      .map((s) => [s, stateBySource.get(s) ?? "untracked"] as const)
      .filter(([, state]) => state in DEAD);
    // The derived blobs are what a fresh price-index run must have written.
    if (required.includes("price-index")) for (const d of derivedDead) dead.push([d, "stale"] as const);
    if (dead.length) {
      console.error(`✗ HEALTH GATE FAILED — ${dead.length} required source(s) not fresh:`);
      for (const [source, state] of dead) console.error(`   • ${source.padEnd(20)} ${DEAD[state]}`);
      console.error(`   (see the rows above / /status; this fails the Actions job on purpose)\n`);
      process.exitCode = 1;
    } else {
      console.log(`✓ health gate passed — all ${required.length} required warmers fresh\n`);
    }
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
