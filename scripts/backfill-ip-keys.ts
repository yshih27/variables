/**
 * Recompute the derived `ip_key` for every card from its ALREADY-STORED name +
 * attributes, using the current ipCatalog. Pure DB pass — no network, no metadata
 * re-fetch — so it's the cheap way to propagate an ipCatalog change (e.g. a newly
 * promoted IP like Azuki / Moonbirds / Pudgy in R7) without waiting for the weekly
 * warm-cc-traits crawl to rewrite the rows.
 *
 * Uses the SAME hint set as cardRowFromMeta (src/lib/data/cards.ts): the card name
 * plus every attribute value. Only rows whose ip_key actually changes are written.
 *
 *   npx tsx scripts/backfill-ip-keys.ts            # dry run (report only)
 *   npx tsx scripts/backfill-ip-keys.ts --apply    # write the changes
 *   npx tsx scripts/backfill-ip-keys.ts --apply --platform collector-crypt
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../src/lib/db/client";
import { classifyIP } from "../src/lib/data/ipCatalog";

// Only the platforms whose ip_key is derived by classifyIP([name,...attributes])
// in cardRowFromMeta. Phygitals sets ip_key DIRECTLY from its marketplace API
// category (warm-phygitals.ts) — its stored card attributes don't carry that
// signal, so recomputing from them would WRONGLY demote e.g. pokemon→other.
// Courtyard has 0 cards (the cards gap). Override with --platform if ever needed.
const PLATFORMS = ["collector-crypt", "beezie"] as const;

function ipKeyFromRow(name: string | null, attributes: unknown): string {
  const attrs = Array.isArray(attributes) ? (attributes as Array<{ value?: unknown }>) : [];
  const hints = [name, ...attrs.map((a) => (a?.value == null ? "" : String(a.value)))].filter(
    (v): v is string => Boolean(v),
  );
  return classifyIP(hints).key;
}

async function backfillPlatform(platform: string, apply: boolean) {
  const PAGE = 1000;
  let lastId: string | null = null;
  let scanned = 0;
  const transitions = new Map<string, number>(); // "from→to" → count
  const updates: { id: string; ip_key: string }[] = [];

  for (;;) {
    let q = db()
      .from("cards")
      .select("id,name,attributes,ip_key")
      .eq("platform", platform)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (lastId !== null) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(`[backfill] read ${platform} failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      scanned++;
      const cur = (r.ip_key as string) ?? "other";
      const next = ipKeyFromRow(r.name as string | null, r.attributes);
      // Only ever PROMOTE (→ a real IP). Never demote a card to "other": a row
      // classified by a richer signal than its stored attributes (e.g. an API
      // category) must not be regressed just because this recompute can't see it.
      if (next !== cur && next !== "other") {
        transitions.set(`${cur}→${next}`, (transitions.get(`${cur}→${next}`) ?? 0) + 1);
        updates.push({ id: r.id as string, ip_key: next });
      }
    }
    if (rows.length < PAGE) break;
    lastId = rows[rows.length - 1].id as string;
  }

  console.log(`\n${platform}: scanned ${scanned}, ${updates.length} ip_key changes`);
  for (const [t, n] of [...transitions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${t.padEnd(28)} ${n}`);
  }

  if (apply && updates.length) {
    // Group by target ip_key and UPDATE only that column for the matching ids.
    // `.update()` (not upsert) guarantees no other column is ever touched, and
    // grouping keeps this to a handful of queries instead of one-per-row.
    const byTarget = new Map<string, string[]>();
    for (const u of updates) {
      const arr = byTarget.get(u.ip_key);
      if (arr) arr.push(u.id);
      else byTarget.set(u.ip_key, [u.id]);
    }
    const CHUNK = 300; // keep the in(...) id list under URL limits
    for (const [key, ids] of byTarget) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { error } = await db()
          .from("cards")
          .update({ ip_key: key })
          .in("id", ids.slice(i, i + CHUNK));
        if (error) throw new Error(`[backfill] write ${platform}→${key} failed: ${error.message}`);
      }
    }
    console.log(`  ✓ applied ${updates.length} updates`);
  }
  return updates.length;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pi = process.argv.indexOf("--platform");
  const only = pi >= 0 ? process.argv[pi + 1] : null;
  const targets = only ? [only] : [...PLATFORMS];
  console.log(apply ? "APPLYING ip_key backfill" : "DRY RUN (pass --apply to write)");
  let total = 0;
  for (const p of targets) total += await backfillPlatform(p, apply);
  console.log(`\n${apply ? "applied" : "would change"} ${total} rows total`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
