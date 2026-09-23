/**
 * One-off backfill — fill `cards.identity_key` + `cards.identity_slug` from the
 * SAME extractor the sale panel uses.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-card-identity-key.ts            # DRY RUN
 *   npx tsx --env-file=.env.local scripts/backfill-card-identity-key.ts --apply    # writes
 *   npx tsx --env-file=.env.local scripts/backfill-card-identity-key.ts --rewrite  # DRY RUN, every row
 *   npx tsx … --rewrite --apply [--from=<id>]                                      # the v4.2 cutover
 *   npx tsx … --report-names [--out=<dir>]                                         # READ-ONLY: the name fix
 *
 * ⚠️ `--report-names` IS A MEASUREMENT, NEVER A WRITE (it refuses `--apply`).
 * It lists every row whose STORED identity is named after a grade — a name
 * that is, or begins with, a grade label ("PSA 10", "PSA 10 POKEMO": the title
 * fallback cutting a title at the wrong segment) — with its token title, its
 * `card_name` column (expected null on every one), the name the fixed fallback
 * reads and the platform;
 * totals per platform and per IP; the 40 most-sold such identities old → new;
 * and, over EVERY row, what the fixed extractor would re-key — so a key that
 * moves outside the grade-named set is listed, not discovered. Sales come from
 * the persisted sale panel (`SNAPSHOT_LOCAL_DIR` honoured). `--out=<dir>` also
 * writes names-report.md + names-report.json there.
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
import { extractCardIdentity, identityKey, parseIdentityKey } from "../src/lib/data/traits";
import { identitySlug, identityDisplayName } from "../src/lib/card/identity";
import { startsWithGradeLabel } from "../src/lib/card/grade";
import { legacyCardNameFromTokenName } from "../src/lib/card/nameFromTokenName";
import { readSalePanel } from "../src/lib/data/salePanel";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");
const REWRITE = process.argv.includes("--rewrite");
const REPORT_NAMES = process.argv.includes("--report-names");
const ONLY = process.argv.find((a) => a.startsWith("--platform="))?.split("=")[1] ?? null;
const FROM = process.argv.find((a) => a.startsWith("--from="))?.split("=")[1] ?? null;
const OUT = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? null;

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

// ── --report-names: the name fix, measured before anything is written ─────────

type NameRow = {
  platform: string;
  tokenId: string;
  ip: string;
  /** `cards.name` — the token's title. */
  title: string;
  /** `cards.card_name` — expected null on every grade-named row. */
  cardNameColumn: string | null;
  set: string | null;
  number: string | null;
  storedKey: string;
  /** The stored identity's name field (upper-cased, as the key holds it). */
  storedName: string;
  /** What the fixed extractor reads, or null when it cannot recover a name. */
  newName: string | null;
  newKey: string | null;
  newSlug: string | null;
  sales: number;
  sales30d: number;
};

const md = (s: string | null | undefined) => (s ?? "—").replace(/\|/g, "\\|");

async function reportNames(): Promise<void> {
  if (APPLY) {
    console.error("✗ --report-names is read-only; it cannot be combined with --apply.");
    process.exit(1);
  }
  if (!(await columnsExist())) {
    console.error("✗ --report-names reads the STORED identity (cards.identity_key); the column does not exist here.");
    process.exit(1);
  }
  const t0 = Date.now();

  // Sales per token from the persisted panel — keyed by token, so the count is
  // the same whichever identity scheme the panel was built under.
  const panel = await readSalePanel();
  const d30 = Date.now() - 30 * 86_400_000;
  const sales = new Map<string, { all: number; d30: number }>();
  for (const r of panel?.rows ?? []) {
    const k = `${r.platform}:${r.tokenId}`;
    const cur = sales.get(k) ?? { all: 0, d30: 0 };
    cur.all += 1;
    if (Date.parse(r.ts) >= d30) cur.d30 += 1;
    sales.set(k, cur);
  }

  const graded: NameRow[] = [];
  /** stored key → the new keys its rows compute (null = no identity any more). */
  const fate = new Map<string, Set<string | null>>();
  /** new key → the stored keys it gathers (null = rows that had none). */
  const origin = new Map<string, Set<string | null>>();
  const rowCounts = { scanned: 0, unchanged: 0, rekeyed: 0, gained: 0, lost: 0, neither: 0 };
  const otherChanges: { platform: string; title: string; storedName: string; newName: string | null }[] = [];
  const gained = new Map<string, { rows: number; examples: string[] }>();
  const base = "id,platform,token_id,name,card_name,set_name,grade_label,year,card_number,ip_key,identity_key,identity_slug";
  let lastId: string | null = null;
  for (;;) {
    let q = db().from("cards").select(base).order("id", { ascending: true }).limit(READ_PAGE);
    if (lastId !== null) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(`cards read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    if (!rows.length) break;
    for (const r of rows) {
      if (ONLY && r.platform !== ONLY) continue;
      rowCounts.scanned++;
      const ip = r.ip_key ?? "other";
      const parts = extractCardIdentity({ name: r.name, cardName: r.card_name, set: r.set_name, grade: r.grade_label, year: r.year, cardNumber: r.card_number });
      const newKey = identityKey(ip, parts);
      const storedKey = r.identity_key ?? null;
      if (storedKey) (fate.get(storedKey) ?? fate.set(storedKey, new Set()).get(storedKey)!).add(newKey);
      if (newKey) (origin.get(newKey) ?? origin.set(newKey, new Set()).get(newKey)!).add(storedKey);

      if (storedKey && newKey) rowCounts[storedKey === newKey ? "unchanged" : "rekeyed"]++;
      else if (storedKey) rowCounts.lost++;
      else if (newKey) rowCounts.gained++;
      else rowCounts.neither++;

      const storedName = parseIdentityKey(storedKey)?.parts.cardName ?? null;
      const tok = sales.get(`${r.platform}:${r.token_id}`) ?? { all: 0, d30: 0 };
      if (storedKey && storedName && startsWithGradeLabel(storedName)) {
        graded.push({
          platform: r.platform,
          tokenId: r.token_id,
          ip,
          title: r.name ?? "",
          cardNameColumn: r.card_name ?? null,
          set: r.set_name ?? null,
          number: r.card_number ?? null,
          storedKey,
          storedName,
          newName: parts.cardName,
          newKey,
          newSlug: newKey ? identitySlug(ip, parts) : null,
          sales: tok.all,
          sales30d: tok.d30,
        });
      } else if (storedKey && storedKey !== newKey && otherChanges.length < 60) {
        otherChanges.push({ platform: r.platform, title: r.name ?? "", storedName: storedName ?? "", newName: parts.cardName });
      } else if (!storedKey && newKey) {
        const g = gained.get(r.platform) ?? { rows: 0, examples: [] };
        g.rows++;
        if (g.examples.length < 8) g.examples.push(`${r.name ?? ""} → ${parts.cardName}`);
        gained.set(r.platform, g);
      }
    }
    if (rows.length < READ_PAGE) break;
    lastId = rows[rows.length - 1].id;
  }

  // ── identity-level accounting ──
  let keyUnchanged = 0, keyRenamed = 0, keySplit = 0, keyDropped = 0;
  for (const [k, outs] of fate) {
    if (outs.size === 1 && outs.has(k)) keyUnchanged++;
    else if (outs.size === 1 && outs.has(null)) keyDropped++;
    else if ([...outs].filter(Boolean).length > 1) keySplit++;
    else keyRenamed++;
  }
  let newKeys = 0, newKeysFromNothing = 0, newKeysMerging = 0;
  for (const [k, ins] of origin) {
    if (ins.size === 1 && ins.has(k)) continue;
    newKeys++;
    if (ins.size === 1 && ins.has(null)) newKeysFromNothing++;
    if ([...ins].filter(Boolean).length > 1) newKeysMerging++;
  }

  // ── the grade-named rows ──
  const idsOf = (rs: NameRow[]) => new Set(rs.map((r) => r.storedKey)).size;
  const tally = (by: (r: NameRow) => string) => {
    const m = new Map<string, NameRow[]>();
    for (const r of graded) (m.get(by(r)) ?? m.set(by(r), []).get(by(r))!).push(r);
    return [...m].sort((a, b) => idsOf(b[1]) - idsOf(a[1]) || b[1].length - a[1].length);
  };
  const recovered = (rs: NameRow[]) => rs.filter((r) => r.newKey).length;
  const colNull = graded.filter((r) => !r.cardNameColumn?.trim()).length;
  const legacyAgrees = graded.filter((r) => (legacyCardNameFromTokenName(r.title) ?? "").toUpperCase() === r.storedName).length;

  const byIdentity = new Map<string, NameRow[]>();
  for (const r of graded) (byIdentity.get(r.storedKey) ?? byIdentity.set(r.storedKey, []).get(r.storedKey)!).push(r);
  const identities = [...byIdentity].map(([key, rs]) => ({
    key,
    ip: rs[0].ip,
    platform: [...new Set(rs.map((r) => r.platform))].join(", "),
    oldName: rs[0].storedName,
    newNames: [...new Set(rs.map((r) => r.newName ?? "∅ (unrecovered)"))],
    /** Distinct identities the old one becomes — by KEY (names are compared upper-cased). */
    newKeys: [...new Set(rs.map((r) => r.newKey ?? "∅"))],
    newSlugs: [...new Set(rs.map((r) => r.newSlug).filter(Boolean))] as string[],
    slabs: rs.length,
    sales: rs.reduce((a, r) => a + r.sales, 0),
    sales30d: rs.reduce((a, r) => a + r.sales30d, 0),
    title: rs[0].title,
  }));
  identities.sort((a, b) => b.sales - a.sales || b.sales30d - a.sales30d || b.slabs - a.slabs || a.key.localeCompare(b.key));
  const splitIds = identities.filter((i) => i.newKeys.length > 1);
  // A renamed identity may land on a key that ALREADY existed — the same card,
  // traded elsewhere under its real name. Its sales now pool with that one.
  const joinsExisting = new Set(graded.filter((r) => r.newKey && fate.has(r.newKey)).map((r) => r.newKey));
  const unrecovered = graded.filter((r) => !r.newKey);

  const lines: string[] = [];
  const out = (s = "") => lines.push(s);
  out(`## Card names: what the fixed title fallback reads`);
  out();
  out(`Scanned ${rowCounts.scanned.toLocaleString()} \`cards\` rows${ONLY ? ` (platform ${ONLY})` : ""}; sale panel ${panel ? `${panel.rows.length.toLocaleString()} rows, generated ${panel.generatedAt}` : "UNAVAILABLE — sales columns read 0"}.`);
  out();
  out(`**${idsOf(graded).toLocaleString()} identities (${graded.length.toLocaleString()} slabs) are stored under a name that is, or begins with, a grade label.** ` +
    `\`card_name\` is null on ${colNull.toLocaleString()} of ${graded.length.toLocaleString()} rows; the pre-fix fallback reproduces the stored name on ${legacyAgrees.toLocaleString()}. ` +
    `The fixed fallback recovers a name for ${recovered(graded).toLocaleString()} rows (${new Set(graded.filter((r) => r.newKey).map((r) => r.storedKey)).size.toLocaleString()} identities); ` +
    `${unrecovered.length.toLocaleString()} rows stay nameless and leave the pool.`);
  out();
  out(`| platform | identities | slabs | recovered slabs | unrecovered slabs |`);
  out(`| --- | ---: | ---: | ---: | ---: |`);
  for (const [p, rs] of tally((r) => r.platform)) out(`| ${p} | ${idsOf(rs)} | ${rs.length} | ${recovered(rs)} | ${rs.length - recovered(rs)} |`);
  out();
  out(`| IP | identities | slabs | recovered slabs | distinct new identities |`);
  out(`| --- | ---: | ---: | ---: | ---: |`);
  for (const [ip, rs] of tally((r) => r.ip)) out(`| ${ip} | ${idsOf(rs)} | ${rs.length} | ${recovered(rs)} | ${new Set(rs.map((r) => r.newKey).filter(Boolean)).size} |`);
  out();
  out(`### The 40 most-sold grade-named identities, old → new`);
  out();
  out(`| # | IP | old name | new name | sales (30d) | slabs | token title |`);
  out(`| ---: | --- | --- | --- | ---: | ---: | --- |`);
  identities.slice(0, 40).forEach((i, n) =>
    out(`| ${n + 1} | ${i.ip} | ${md(identityDisplayName(i.oldName))} | ${md(i.newNames.join(" / "))} | ${i.sales} (${i.sales30d}) | ${i.slabs} | ${md(i.title)} |`),
  );
  out();
  out(`**One old identity, several cards:** ${splitIds.length} grade-named identities gathered tokens whose titles name different cards under one set, number and grade (a base card and its parallel, or one card spelled two ways); the fix gives each its own key.`);
  for (const i of splitIds.slice(0, 16)) out(`- \`${i.key}\` → ${i.newNames.map((n) => `"${n}"`).join(", ")}`);
  out();
  out(`**Renamed onto an identity that already existed:** ${joinsExisting.size} — the same card was already keyed under its real name (another token, another venue); these sales now pool with it.`);
  out();
  if (unrecovered.length) {
    out(`**Unrecovered (${unrecovered.length} slabs, ${idsOf(unrecovered)} identities)** — the set string is not a prefix of the title, or nothing follows it; null, never a guess:`);
    out();
    out("```");
    for (const r of unrecovered.slice(0, 40)) out(`${r.platform.padEnd(16)} set=${JSON.stringify(r.set)}  ${r.title}`);
    out("```");
    out();
  }
  out(`### Every row, re-keyed by the fixed extractor (stored column → recomputed)`);
  out();
  out(`Rows: ${rowCounts.unchanged.toLocaleString()} unchanged · ${rowCounts.rekeyed.toLocaleString()} re-keyed · ${rowCounts.gained.toLocaleString()} gain an identity · ${rowCounts.lost.toLocaleString()} lose one · ${rowCounts.neither.toLocaleString()} had none and still have none.`);
  out();
  out(`Identities (stored keys): ${fate.size.toLocaleString()} — ${keyUnchanged.toLocaleString()} unchanged · ${keyRenamed.toLocaleString()} re-keyed to one new key · ${keySplit.toLocaleString()} split across several · ${keyDropped.toLocaleString()} left with no identity. ` +
    `New keys that did not exist: ${newKeys.toLocaleString()} (${newKeysFromNothing.toLocaleString()} from rows that had no identity, ${newKeysMerging.toLocaleString()} gathering more than one old key).`);
  out();
  out(`Re-keyed rows whose stored name did NOT begin with a grade label: ${otherChanges.length}${otherChanges.length >= 60 ? "+" : ""}.`);
  if (otherChanges.length) {
    out();
    out("```");
    for (const c of otherChanges.slice(0, 40)) out(`${c.platform.padEnd(16)} ${JSON.stringify(c.storedName)} → ${JSON.stringify(c.newName)}   ${c.title}`);
    out("```");
  }
  out();
  out(`Rows that gain an identity (they had none): ${[...gained].map(([p, g]) => `${p} ${g.rows.toLocaleString()}`).join(" · ") || "none"}.`);
  for (const [p, g] of gained) {
    out();
    out(`${p}:`);
    out("```");
    for (const e of g.examples) out(e);
    out("```");
  }
  out();
  out(`_${((Date.now() - t0) / 1000).toFixed(0)} s, read-only._`);

  const text = lines.join("\n");
  console.log(text);
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "names-report.md"), text);
    writeFileSync(
      join(OUT, "names-report.json"),
      JSON.stringify({ rowCounts, identities: { stored: fate.size, unchanged: keyUnchanged, renamed: keyRenamed, split: keySplit, dropped: keyDropped, newKeys, newKeysFromNothing, newKeysMerging }, graded, otherChanges, gained: Object.fromEntries(gained) }, null, 2),
    );
    console.log(`\nwrote ${join(OUT, "names-report.md")} + names-report.json`);
  }
}

(REPORT_NAMES ? reportNames() : main()).catch((e) => {
  console.error(e);
  if (!REPORT_NAMES) console.error(`\n✗ stopped. Re-run with --from=<the last id printed above> to resume where this left off.`);
  process.exit(1);
});
