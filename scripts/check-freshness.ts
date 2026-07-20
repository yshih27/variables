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
import type { HeliusCreditsSnapshot } from "../src/lib/db/runWarmer";

// A single warmer run over this many Helius credits is almost certainly a runaway
// crawl (legit heaviest = holders ≈ 285). Flagged in the report; the HARD stop is
// the per-run budget in the Helius client (a breach throws → error → gate red).
const HELIUS_BURN_WARN = 50_000;

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
    const errored = required.filter((s) => stateBySource.get(s) === "error");
    if (errored.length) {
      console.error(
        `✗ HEALTH GATE FAILED — warmer(s) errored this run: ${errored.join(", ")}\n` +
          `   (see the error rows above / /status; this fails the Actions job on purpose)\n`,
      );
      process.exitCode = 1;
    } else {
      console.log(`✓ health gate passed — all ${required.length} required warmers ok\n`);
    }
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
