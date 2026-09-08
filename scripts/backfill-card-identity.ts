/**
 * One-off backfill — populate the `cards` identity columns (`year`,
 * `card_number`, `grader`, `grade_num`) from the extractors in traits.ts.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-card-identity.ts [--apply (omit for a dry run)] [--platform=beezie]
 *
 * These four columns exist and are NULL on every row (measured 2026-09-08:
 * beezie 0/9,942, collector-crypt 0/131,435). The parts are already present in
 * `name` / `card_name` / `set_name` / `grade_label` — they were simply never
 * split out — so this reads no external service: Postgres in, Postgres out.
 *
 * Idempotent and resumable by construction: it only writes rows whose target
 * columns are still NULL and whose extractor produced something, so a re-run
 * finds fewer rows and an interrupted run loses nothing. Keyset-paged on `id`
 * (see cards.ts — `id` is platform-prefixed and there is no (platform,id) index,
 * so a per-platform keyset scan cannot be index-served; we page the whole table
 * and filter in memory).
 *
 * Chunked writes with the cc-traits lesson: halve on timeout, floor 25.
 */
import { db } from "../src/lib/db/client";
import { extractCardIdentity } from "../src/lib/data/traits";
import { parseGradeLabel } from "../src/lib/card/grade";

// Safe by default: this script writes ~128K rows. It only writes with an explicit
// --apply; anything else is a dry run that prints what it would do.
const DRY = !process.argv.includes("--apply");
const ONLY = process.argv.find((a) => a.startsWith("--platform="))?.split("=")[1] ?? null;

const READ_PAGE = 1000;
const WRITE_CHUNK_START = 500;
const WRITE_CHUNK_FLOOR = 25;

type Row = {
  id: string;
  platform: string;
  name: string | null;
  card_name: string | null;
  set_name: string | null;
  grade_label: string | null;
  year: number | null;
  card_number: string | null;
  grader: string | null;
  grade_num: number | null;
};

type Update = { id: string; year?: number; card_number?: string; grader?: string; grade_num?: number };

/** Write one chunk, halving on timeout. Returns rows written. */
async function writeChunk(rows: Update[]): Promise<number> {
  let written = 0;
  let chunk = WRITE_CHUNK_START;
  for (let i = 0; i < rows.length; ) {
    const slice = rows.slice(i, i + chunk);
    // upsert on the PK: every object carries `id`, so this updates in place and
    // cannot insert a phantom card (a row with only an id would violate NOT NULLs).
    const { error } = await db().from("cards").upsert(slice, { onConflict: "id" });
    if (error) {
      const timeout = /timeout|57014|canceling statement/i.test(error.message);
      if (timeout && chunk > WRITE_CHUNK_FLOOR) {
        chunk = Math.max(WRITE_CHUNK_FLOOR, Math.floor(chunk / 2));
        console.log(`    ↓ chunk ${chunk} after timeout`);
        continue;
      }
      throw new Error(`backfill write failed: ${error.message}`);
    }
    written += slice.length;
    i += slice.length;
  }
  return written;
}

async function main() {
  console.log(`cards identity backfill${DRY ? " (DRY RUN — nothing is written)" : ""}${ONLY ? ` · platform=${ONLY}` : ""}`);
  const stats = new Map<string, { scanned: number; year: number; number: number; grader: number; grade: number; queued: number }>();
  const bump = (p: string) => {
    let s = stats.get(p);
    if (!s) stats.set(p, (s = { scanned: 0, year: 0, number: 0, grader: 0, grade: 0, queued: 0 }));
    return s;
  };

  let lastId: string | null = null;
  let pending: Update[] = [];
  let written = 0;

  for (;;) {
    let q = db()
      .from("cards")
      .select("id,platform,name,card_name,set_name,grade_label,year,card_number,grader,grade_num")
      .order("id", { ascending: true })
      .limit(READ_PAGE);
    if (lastId !== null) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(`backfill read failed: ${error.message}`);
    const rows = (data ?? []) as Row[];
    if (!rows.length) break;

    for (const r of rows) {
      if (ONLY && r.platform !== ONLY) continue;
      const s = bump(r.platform);
      s.scanned++;
      const parts = extractCardIdentity({
        name: r.name,
        cardName: r.card_name,
        set: r.set_name,
        grade: r.grade_label,
        year: r.year,
        cardNumber: r.card_number,
      });
      const g = parseGradeLabel(r.grade_label);
      const u: Update = { id: r.id };
      let any = false;
      // Never overwrite a value that is already there — this fills gaps only.
      if (r.year == null && parts.year != null) { u.year = parts.year; s.year++; any = true; }
      if (r.card_number == null && parts.number != null) { u.card_number = parts.number; s.number++; any = true; }
      if (r.grader == null && g?.grader) { u.grader = g.grader; s.grader++; any = true; }
      if (r.grade_num == null && g?.grade != null) { u.grade_num = g.grade; s.grade++; any = true; }
      if (any) { pending.push(u); s.queued++; }
    }

    if (!DRY && pending.length >= 2000) {
      written += await writeChunk(pending);
      pending = [];
      process.stdout.write(`\r  written ${written.toLocaleString()}…`);
    }
    if (rows.length < READ_PAGE) break;
    lastId = rows[rows.length - 1].id;
  }
  if (!DRY && pending.length) written += await writeChunk(pending);

  console.log(`\n\nplatform          scanned    +year  +number  +grader  +grade_num   rows to write`);
  for (const [p, s] of [...stats].sort((a, b) => b[1].scanned - a[1].scanned)) {
    console.log(
      `  ${p.padEnd(16)} ${String(s.scanned).padStart(7)} ${String(s.year).padStart(8)} ${String(s.number).padStart(8)} ` +
        `${String(s.grader).padStart(8)} ${String(s.grade).padStart(11)} ${String(s.queued).padStart(15)}`,
    );
  }
  console.log(DRY ? `\nDRY RUN — nothing written.` : `\nrows written: ${written.toLocaleString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
