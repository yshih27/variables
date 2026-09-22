/**
 * One-off backfill — fill `cards.identity_key` + `cards.identity_slug` from the
 * SAME extractor the sale panel uses.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-card-identity-key.ts            # DRY RUN
 *   npx tsx --env-file=.env.local scripts/backfill-card-identity-key.ts --apply    # writes
 *   npx tsx --env-file=.env.local scripts/backfill-card-identity-key.ts --rewrite  # DRY RUN, every row
 *   npx tsx … --rewrite --apply [--from=<id>]                                      # the v4.2 cutover
 *
 * ⚠️ `--rewrite` IS THE METHOD CUTOVER, NOT A BACKFILL. Default (gap-fill) never
 * touches a row that already carries a key, which is right while the key's
 * DEFINITION is fixed and wrong the moment it changes: after v4.2 every row
 * filled under v4.1 holds a key nothing computes any more, and the column and
 * the panel would disagree about what an identity is — the one thing these two
 * columns exist to prevent. `--rewrite` recomputes every row and writes the ones
 * that actually moved (a row whose key is unchanged is not re-sent). It is
 * keyset-paged and resumable: `--from=<id>` picks up after a given id, and the
 * script prints the id to resume from if it dies mid-run.
 *
 * ⚠️ RUN IT AFTER THE MERGE AND BEFORE THE FIRST v4.2 WARMER RUN. Between the
 * two, readers resolve slugs from the panel (which is rebuilt in the same
 * release) — the column path is only consulted when the column exists, and a
 * stale column would resolve a slug to keys no current panel row carries.
 *
 * ⚠️ REQUIRES supabase/migrations/20260914000001_cards_identity_key.sql TO BE
 * APPLIED for --apply. A dry run needs only the source columns, so it reports
 * what it WOULD write before the migration lands — which is how the PR's numbers
 * were produced. The executor never applies the migration and never runs
 * --apply against production.
 *
 * Computes both columns from `extractCardIdentity` → `identityKey` →
 * `identitySlug` — the same three calls `readAllCardDims` makes for the panel —
 * so the column, the panel and the page cannot disagree about what an identity
 * is. Gap-fill only (a row already carrying a key is never rewritten); keyset-
 * paged on `id`; chunked writes halve on timeout, floor 25.
 *
 * The NOT NULL columns are echoed back unchanged (PR #128's lesson): PostgREST's
 * upsert is INSERT … ON CONFLICT DO UPDATE and Postgres validates the INSERT row
 * before the conflict resolves, so a payload without `platform` fails even
 * though the row exists.
 */
import { db } from "../src/lib/db/client";
import { extractCardIdentity, identityKey } from "../src/lib/data/traits";
import { identitySlug } from "../src/lib/card/identity";

const APPLY = process.argv.includes("--apply");
const REWRITE = process.argv.includes("--rewrite");
const ONLY = process.argv.find((a) => a.startsWith("--platform="))?.split("=")[1] ?? null;
const FROM = process.argv.find((a) => a.startsWith("--from="))?.split("=")[1] ?? null;

const READ_PAGE = 1000;
const WRITE_CHUNK_START = 500;
const WRITE_CHUNK_FLOOR = 25;

type Row = {
  id: string;
  platform: string;
  token_id: string;
  chain: string | null;
  source: string | null;
  name: string | null;
  card_name: string | null;
  set_name: string | null;
  grade_label: string | null;
  year: number | null;
  card_number: string | null;
  ip_key: string | null;
  identity_key?: string | null;
  identity_slug?: string | null;
};
type Update = {
  id: string;
  platform: string;
  token_id: string;
  chain: string | null;
  source: string | null;
  name: string | null;
  /** Null only under --rewrite, when a row that used to carry an identity no
   *  longer computes one. NULL is the honest answer and the column allows it. */
  identity_key: string | null;
  identity_slug: string | null;
};

async function columnsExist(): Promise<boolean> {
  const { error } = await db().from("cards").select("identity_key,identity_slug").limit(1);
  if (!error) return true;
  if (/identity_key|identity_slug/.test(error.message)) return false;
  throw new Error(`cards probe failed: ${error.message}`);
}

async function writeChunk(rows: Update[]): Promise<number> {
  let written = 0;
  let chunk = WRITE_CHUNK_START;
  for (let i = 0; i < rows.length; ) {
    const slice = rows.slice(i, i + chunk);
    const { error } = await db().from("cards").upsert(slice, { onConflict: "id" });
    if (error) {
      if (/timeout|57014|canceling statement/i.test(error.message) && chunk > WRITE_CHUNK_FLOOR) {
        chunk = Math.max(WRITE_CHUNK_FLOOR, Math.floor(chunk / 2));
        console.log(`    ↓ chunk ${chunk} after timeout`);
        continue;
      }
      throw new Error(`identity write failed: ${error.message}`);
    }
    written += slice.length;
    i += slice.length;
  }
  return written;
}

async function main() {
  console.log(
    `cards identity_key / identity_slug ${REWRITE ? "REWRITE (every row recomputed)" : "backfill (gap-fill)"}` +
      `${APPLY ? "" : " (DRY RUN — nothing is written)"}${ONLY ? ` · platform=${ONLY}` : ""}${FROM ? ` · resuming after id ${FROM}` : ""}`,
  );
  const hasCols = await columnsExist();
  if (!hasCols) {
    if (APPLY) {
      console.error(`\n✗ cards.identity_key / identity_slug do not exist. Apply supabase/migrations/20260914000001_cards_identity_key.sql first.`);
      process.exit(1);
    }
    console.log(`  (columns not present yet — dry run reports what the backfill would write)`);
  }

  const stats = new Map<string, { scanned: number; filled: number; noIdentity: number; already: number; changed: number; cleared: number; slugs: Set<string> }>();
  const bump = (p: string) => {
    let s = stats.get(p);
    if (!s) stats.set(p, (s = { scanned: 0, filled: 0, noIdentity: 0, already: 0, changed: 0, cleared: 0, slugs: new Set() }));
    return s;
  };
  const base = "id,platform,token_id,chain,source,name,card_name,set_name,grade_label,year,card_number,ip_key";
  let lastId: string | null = FROM;
  let pending: Update[] = [];
  let written = 0;
  /** The id everything up to is done — what a resume would pass to --from. */
  let doneThrough: string | null = FROM;

  for (;;) {
    let q = db().from("cards").select(hasCols ? `${base},identity_key,identity_slug` : base).order("id", { ascending: true }).limit(READ_PAGE);
    if (lastId !== null) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(`identity read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    if (!rows.length) break;

    for (const r of rows) {
      if (ONLY && r.platform !== ONLY) continue;
      const s = bump(r.platform);
      s.scanned++;
      const stored = { key: r.identity_key ?? null, slug: r.identity_slug ?? null };
      // Gap-fill skips a row that already carries one. A REWRITE cannot: the
      // key's definition changed, so "already has one" says nothing about
      // whether it has the RIGHT one.
      if (!REWRITE && hasCols && stored.key != null && stored.slug != null) { s.already++; continue; }
      const ip = r.ip_key ?? "other";
      const parts = extractCardIdentity({ name: r.name, cardName: r.card_name, set: r.set_name, grade: r.grade_label, year: r.year, cardNumber: r.card_number });
      const key = identityKey(ip, parts);
      const slug = key ? identitySlug(ip, parts) : null;
      if (!key || !slug) {
        s.noIdentity++;
        // A row that HELD an identity and no longer computes one is cleared —
        // leaving the old string behind would keep a key nothing can produce.
        if (!REWRITE || !hasCols || (stored.key == null && stored.slug == null)) continue;
        s.cleared++;
        pending.push({ id: r.id, platform: r.platform, token_id: r.token_id, chain: r.chain ?? null, source: r.source ?? null, name: r.name ?? null, identity_key: null, identity_slug: null });
        continue;
      }
      s.slugs.add(slug);
      if (REWRITE && hasCols && stored.key === key && stored.slug === slug) { s.already++; continue; } // unchanged — not re-sent
      if (stored.key == null && stored.slug == null) s.filled++;
      else s.changed++;
      pending.push({ id: r.id, platform: r.platform, token_id: r.token_id, chain: r.chain ?? null, source: r.source ?? null, name: r.name ?? null, identity_key: key, identity_slug: slug });
    }

    if (APPLY && pending.length >= 2000) {
      written += await writeChunk(pending);
      pending = [];
      process.stdout.write(`\r  written ${written.toLocaleString()}… (resume after id ${doneThrough ?? "—"})`);
    }
    if (rows.length < READ_PAGE) break;
    lastId = rows[rows.length - 1].id;
    // Only advance the resume mark once this page's writes are flushed.
    if (!APPLY || !pending.length) doneThrough = lastId;
  }
  if (APPLY && pending.length) written += await writeChunk(pending);

  const totals = [...stats.values()].reduce((a, s) => ({ scanned: a.scanned + s.scanned, filled: a.filled + s.filled, changed: a.changed + s.changed, cleared: a.cleared + s.cleared, noIdentity: a.noIdentity + s.noIdentity, already: a.already + s.already }), { scanned: 0, filled: 0, changed: 0, cleared: 0, noIdentity: 0, already: 0 });
  console.log(`\n\nplatform          scanned   +identity   re-keyed   cleared   no identity   unchanged   distinct slugs`);
  for (const [p, s] of [...stats].sort((a, b) => b[1].scanned - a[1].scanned)) {
    console.log(
      `  ${p.padEnd(16)} ${String(s.scanned).padStart(7)} ${String(s.filled).padStart(11)} ${String(s.changed).padStart(10)} ${String(s.cleared).padStart(9)} ` +
        `${String(s.noIdentity).padStart(13)} ${String(s.already).padStart(11)} ${String(s.slugs.size).padStart(16)}`,
    );
  }
  console.log(
    `  ${"ALL".padEnd(16)} ${String(totals.scanned).padStart(7)} ${String(totals.filled).padStart(11)} ${String(totals.changed).padStart(10)} ${String(totals.cleared).padStart(9)} ` +
      `${String(totals.noIdentity).padStart(13)} ${String(totals.already).padStart(11)}`,
  );
  console.log(APPLY ? `\nrows written: ${written.toLocaleString()}` : `\nDRY RUN — nothing written (${(totals.filled + totals.changed + totals.cleared).toLocaleString()} rows would be).`);
  return doneThrough;
}

main().catch((e) => {
  console.error(e);
  console.error(`\n✗ stopped. Re-run with --from=<the last id printed above> to resume where this left off.`);
  process.exit(1);
});
