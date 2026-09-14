/**
 * One-off backfill — fill `cards.identity_key` + `cards.identity_slug` from the
 * SAME extractor the sale panel uses.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-card-identity-key.ts            # DRY RUN
 *   npx tsx --env-file=.env.local scripts/backfill-card-identity-key.ts --apply    # writes
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
const ONLY = process.argv.find((a) => a.startsWith("--platform="))?.split("=")[1] ?? null;

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
  identity_key: string;
  identity_slug: string;
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
  console.log(`cards identity_key / identity_slug backfill${APPLY ? "" : " (DRY RUN — nothing is written)"}${ONLY ? ` · platform=${ONLY}` : ""}`);
  const hasCols = await columnsExist();
  if (!hasCols) {
    if (APPLY) {
      console.error(`\n✗ cards.identity_key / identity_slug do not exist. Apply supabase/migrations/20260914000001_cards_identity_key.sql first.`);
      process.exit(1);
    }
    console.log(`  (columns not present yet — dry run reports what the backfill would write)`);
  }

  const stats = new Map<string, { scanned: number; filled: number; noIdentity: number; already: number; slugs: Set<string> }>();
  const bump = (p: string) => {
    let s = stats.get(p);
    if (!s) stats.set(p, (s = { scanned: 0, filled: 0, noIdentity: 0, already: 0, slugs: new Set() }));
    return s;
  };
  const base = "id,platform,token_id,chain,source,name,card_name,set_name,grade_label,year,card_number,ip_key";
  let lastId: string | null = null;
  let pending: Update[] = [];
  let written = 0;

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
      if (hasCols && r.identity_key != null && r.identity_slug != null) { s.already++; continue; } // gap-fill only
      const ip = r.ip_key ?? "other";
      const parts = extractCardIdentity({ name: r.name, cardName: r.card_name, set: r.set_name, grade: r.grade_label, year: r.year, cardNumber: r.card_number });
      const key = identityKey(ip, parts);
      const slug = key ? identitySlug(ip, parts) : null;
      if (!key || !slug) { s.noIdentity++; continue; }
      s.filled++;
      s.slugs.add(slug);
      pending.push({ id: r.id, platform: r.platform, token_id: r.token_id, chain: r.chain ?? null, source: r.source ?? null, name: r.name ?? null, identity_key: key, identity_slug: slug });
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

  console.log(`\n\nplatform          scanned   +identity   no identity   already   distinct slugs`);
  for (const [p, s] of [...stats].sort((a, b) => b[1].scanned - a[1].scanned)) {
    console.log(`  ${p.padEnd(16)} ${String(s.scanned).padStart(7)} ${String(s.filled).padStart(11)} ${String(s.noIdentity).padStart(13)} ${String(s.already).padStart(9)} ${String(s.slugs.size).padStart(16)}`);
  }
  console.log(APPLY ? `\nrows written: ${written.toLocaleString()}` : `\nDRY RUN — nothing written.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
