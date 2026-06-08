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
  console.log("SOURCE FRESHNESS (warmer runs)");
  for (const source of sources) {
    const row = byId.get(source);
    const { state, ageMs } = freshnessState(source, row);
    tally[state] += 1;
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

  console.log(
    `\nSUMMARY  ${tally.ok} ok · ${tally.stale} stale · ${tally.error} error · ${tally.untracked} untracked\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
