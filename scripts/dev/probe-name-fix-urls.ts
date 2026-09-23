/**
 * The old grade-named URLs, through the REAL reader: do they still answer, and
 * do they say they are not the card's URL?
 *
 *   SNAPSHOT_LOCAL_DIR=<out> npx tsx --env-file=.env.local scripts/dev/probe-name-fix-urls.ts [--all]
 *   npx tsx --env-file=.env.local scripts/dev/probe-name-fix-urls.ts --all      # after the cutover warm
 *
 * Every slug in the identity index whose NAME segment begins with a grade label
 * ("…/eb01-061/psa-10/psa-10") can only be an alias the name fix registered —
 * no current identity is named after a grade. For each (the first 60, or all
 * with --all) this runs `readIdentityDetail` — the uncached core the page, the
 * price chip and `/api/v1/price` all sit on — and checks that it resolves, that
 * the identity it resolves to has a real name, and that its canonical URL is a
 * different one (so the price API answers `canonical: false`, computed exactly
 * as referencePrice.ts does). Then it reads the canonical URL too, which must
 * answer as itself.
 *
 * Read-only: the reader reads snapshots (local with SNAPSHOT_LOCAL_DIR) and the
 * `cards` rows of the slabs it shows. Exits 1 on any failure.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readIdentityDetail, listIdentityIndex } from "../../src/lib/data/identityDetail";
import { parseIdentityKey } from "../../src/lib/data/traits";
import { identitySlug } from "../../src/lib/card/identity";
import { startsWithGradeLabel } from "../../src/lib/card/grade";

const ALL = process.argv.includes("--all");

async function main() {
  const idx = await listIdentityIndex();
  const old = [...idx.bySlug.keys()].filter((slug) => startsWithGradeLabel(slug.split("/")[3]?.replace(/-/g, " ") ?? "")).sort();
  const sample = ALL ? old : old.slice(0, 60);
  console.log(`\n${old.length} slugs in the index are named after a grade (aliases the name fix registered); reading ${sample.length} through readIdentityDetail\n`);

  let ok = 0;
  const bad: string[] = [];
  for (const slug of sample) {
    const d = await readIdentityDetail(slug);
    if (!d) { bad.push(`${slug}: does not resolve`); continue; }
    const pk = parseIdentityKey(d.key);
    const canonicalSlug = (pk ? identitySlug(pk.ip, pk.parts) : null) ?? d.slug;
    const canonical = d.slug === canonicalSlug; // referencePrice.ts, verbatim
    if (!pk || startsWithGradeLabel(pk.parts.cardName)) { bad.push(`${slug}: resolves to a grade-named key ${d.key}`); continue; }
    if (canonical) { bad.push(`${slug}: answers as its own canonical URL`); continue; }
    const c = await readIdentityDetail(canonicalSlug);
    if (!c || c.key !== d.key) { bad.push(`${slug}: canonical ${canonicalSlug} does not answer as the same identity`); continue; }
    ok++;
    if (ok <= 8) {
      console.log(`  ✓ /i/${slug}\n      → ${d.parts.displayName} · canonical: false · canonicalSlug ${canonicalSlug} · ${d.sales.length} sales · ${d.tokens.length} slabs${d.fragments.length ? ` · ${d.fragments.length} other card(s) behind this URL` : ""}`);
    }
  }
  console.log(`\n${ok} of ${sample.length} answer, name a real card and report canonical: false${bad.length ? ` · ${bad.length} FAILED` : ""}`);
  for (const b of bad.slice(0, 30)) console.log(`  ✗ ${b}`);
  if (bad.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
