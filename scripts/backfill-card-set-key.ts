/**
 * One-off backfill — fill `cards.set_key` from the set-name SSOT.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-card-set-key.ts            # DRY RUN
 *   npx tsx --env-file=.env.local scripts/backfill-card-set-key.ts --apply    # writes
 *
 * ⚠️ REQUIRES supabase/migrations/20260910000001_cards_set_key.sql TO BE APPLIED.
 * There is no DDL path from the app environment (PostgREST only), so the column
 * is added by that migration and this only fills it. The script checks for the
 * column first and exits with the migration name rather than a PostgREST error.
 *
 * Gap-fill only: a row whose `set_key` is already set is never rewritten, so a
 * re-run finds fewer rows and an interrupt loses nothing. Keyset-paged on `id`
 * (see cards.ts — `id` is platform-prefixed with no (platform,id) index, so the
 * whole table is paged and filtered in memory). Chunked writes halve on timeout,
 * floor 25 — the cc-traits lesson.
 *
 * Reads and writes Postgres only: no Dune, Helius or CardOS.
 */
import { db } from "../src/lib/db/client";
import { normalizeSetName } from "../src/lib/card/setName";

const APPLY = process.argv.includes("--apply");
const ONLY_IP = process.argv.find((a) => a.startsWith("--ip="))?.split("=")[1] ?? null;

const READ_PAGE = 1000;
const WRITE_CHUNK_START = 500;
const WRITE_CHUNK_FLOOR = 25;

type Row = { id: string; ip_key: string | null; set_name: string | null; set_key: string | null };
type Update = { id: string; set_key: string };

async function columnExists(): Promise<boolean> {
  const { error } = await db().from("cards").select("set_key").limit(1);
  if (!error) return true;
  if (/set_key/.test(error.message)) return false;
  throw new Error(`cards probe failed: ${error.message}`);
}

async function writeChunk(rows: Update[]): Promise<number> {
  let written = 0;
  let chunk = WRITE_CHUNK_START;
  for (let i = 0; i < rows.length; ) {
    const slice = rows.slice(i, i + chunk);
    // upsert on the PK — every object carries `id`, so this updates in place and
    // cannot insert a phantom card (an id-only row would violate NOT NULLs).
    const { error } = await db().from("cards").upsert(slice, { onConflict: "id" });
    if (error) {
      if (/timeout|57014|canceling statement/i.test(error.message) && chunk > WRITE_CHUNK_FLOOR) {
        chunk = Math.max(WRITE_CHUNK_FLOOR, Math.floor(chunk / 2));
        console.log(`    ↓ chunk ${chunk} after timeout`);
        continue;
      }
      throw new Error(`set_key write failed: ${error.message}`);
    }
    written += slice.length;
    i += slice.length;
  }
  return written;
}

async function main() {
  console.log(`cards.set_key backfill${APPLY ? "" : " (DRY RUN — nothing is written)"}${ONLY_IP ? ` · ip=${ONLY_IP}` : ""}`);
  // A DRY run needs only `set_name`, so it still reports what it WOULD write
  // before the migration is applied — which is how this PR's numbers were
  // produced. Only --apply requires the column.
  const hasColumn = await columnExists();
  if (!hasColumn) {
    if (APPLY) {
      console.error(
        `\n✗ cards.set_key does not exist. Apply supabase/migrations/20260910000001_cards_set_key.sql first ` +
          `(there is no DDL path from this environment).`,
      );
      process.exit(1);
    }
    console.log(`  (cards.set_key not present yet — dry run reports what the backfill would write)`);
  }

  const perIp = new Map<string, { scanned: number; filled: number; junk: number; already: number; keys: Set<string> }>();
  const bump = (ip: string) => {
    let s = perIp.get(ip);
    if (!s) perIp.set(ip, (s = { scanned: 0, filled: 0, junk: 0, already: 0, keys: new Set() }));
    return s;
  };

  let lastId: string | null = null;
  let pending: Update[] = [];
  let written = 0;

  for (;;) {
    let q = db()
      .from("cards")
      .select(hasColumn ? "id,ip_key,set_name,set_key" : "id,ip_key,set_name")
      .order("id", { ascending: true })
      .limit(READ_PAGE);
    if (lastId !== null) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(`set_key read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    if (!rows.length) break;

    for (const r of rows) {
      const ip = r.ip_key ?? "other";
      if (ONLY_IP && ip !== ONLY_IP) continue;
      const s = bump(ip);
      s.scanned++;
      if (hasColumn && r.set_key != null) { s.already++; continue; } // gap-fill only
      const { key } = normalizeSetName(r.set_name);
      if (!key) { s.junk++; continue; } // junk stays NULL — the honest answer
      s.filled++;
      s.keys.add(key);
      pending.push({ id: r.id, set_key: key });
    }

    if (APPLY && pending.length >= 2000) {
      written += await writeChunk(pending);
      pending = [];
      process.stdout.write(`\r  written ${written.toLocaleString()}…`);
    }
    if (rows.length < READ_PAGE) break;
    lastId = rows[rows.length - 1].id;
  }
  if (APPLY && pending.length) written += await writeChunk(pending);

  console.log(`\n\nip                scanned   +set_key   junk→null   already   distinct keys`);
  for (const [ip, s] of [...perIp].sort((a, b) => b[1].scanned - a[1].scanned)) {
    console.log(
      `  ${ip.padEnd(16)} ${String(s.scanned).padStart(7)} ${String(s.filled).padStart(10)} ` +
        `${String(s.junk).padStart(11)} ${String(s.already).padStart(9)} ${String(s.keys.size).padStart(15)}`,
    );
  }
  console.log(APPLY ? `\nrows written: ${written.toLocaleString()}` : `\nDRY RUN — nothing written.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
