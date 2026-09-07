/**
 * One-off backfill — put the `memo_slug` partner tag back on Collector Crypt
 * pulls we stored without one.
 *
 *   npx tsx scripts/backfill-cc-memo-slug.ts [--per-tier=1000] [--dry-run]
 *
 * WHY THIS IS POSSIBLE AT ALL: `ingestCCPulls` calls the tag "forward-only …
 * cannot be backfilled (the feed serves only a recent stratified window)". That
 * is true of `?count=200`, but NOT of `?perTier=N`: perTier is most-recent-N per
 * (machine × tier), so a large N reaches back to a machine's first pull for every
 * tier under the cap. That is the window this script walks.
 *
 * SAFETY
 *  • Only ever writes a slug the feed actually returned for that pull.
 *  • Only ever touches rows with `memo_slug IS NULL` — a stored tag is never
 *    overwritten, so a slug that has since changed upstream cannot rewrite ours.
 *  • UPDATE, never upsert: this must not be able to invent a pull row.
 *  • Idempotent and resumable by construction — a re-run simply finds fewer
 *    NULLs. Interrupt it at any point and run it again.
 *
 * Zero Dune / Helius / CardOS reads: Postgres + the unauthenticated CC endpoint
 * the warmer already calls.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { fetchCCWinners, type CCWinner } from "../src/lib/cc/gacha";
import { db } from "../src/lib/db/client";

const argOf = (name: string, dflt: number): number => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = hit ? Number(hit.split("=")[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : dflt;
};
const DRY = process.argv.includes("--dry-run");
const PER_TIER = argOf("per-tier", 1000);

/** Read side: PostgREST caps any response at 1000 rows, so keep lookups well under. */
const LOOKUP_CHUNK = 200;
/** Write side: adaptive, halve on timeout, floor 25 — the cc-traits lesson. */
const WRITE_CHUNK_START = 500;
const WRITE_CHUNK_FLOOR = 25;
/**
 * How far a stored `pulled_at` may differ from the feed's for a mint-based match
 * to still be the SAME pull.
 *
 * ⚠️ Load-bearing. `prize_instance_id` is `cc-<mint>` and a mint is NOT unique per
 * pull: Collector Crypt buys cards back and re-wins them, so one mint routinely
 * carries 30+ rows spanning months. Without this bound, "match on mint when the
 * timestamp differs" happily writes a pull from today onto an unrelated row from
 * July. Real clock skew is seconds; anything beyond a few minutes is a different
 * pull and must be left alone.
 */
const SKEW_TOLERANCE_MS = 5 * 60_000;

const pullIdOf = (w: CCWinner) => `collector-crypt:${w.mint}:${Date.parse(w.at)}`;
const instanceIdOf = (w: CCWinner) => `cc-${w.mint}`;

type StoredRow = { pull_id: string; prize_instance_id: string | null; pulled_at: string };

async function chunked<T, R>(items: T[], size: number, fn: (c: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await fn(items.slice(i, i + size))));
  return out;
}

/** Untagged CC rows for these prize instances. Mint is the only join we can make
 *  when the stored timestamp differs from the feed's by clock skew. */
async function fetchUntaggedByInstance(instanceIds: string[]): Promise<Map<string, StoredRow[]>> {
  const rows = await chunked(instanceIds, LOOKUP_CHUNK, async (c) => {
    const { data, error } = await db()
      .from("gacha_pulls")
      .select("pull_id, prize_instance_id, pulled_at")
      .eq("platform_id", "collector-crypt")
      .is("memo_slug", null)
      .in("prize_instance_id", c);
    if (error) throw new Error(`lookup failed: ${error.message}`);
    return (data ?? []) as StoredRow[];
  });
  const byInstance = new Map<string, StoredRow[]>();
  for (const r of rows) {
    if (!r.prize_instance_id) continue;
    const list = byInstance.get(r.prize_instance_id);
    if (list) list.push(r);
    else byInstance.set(r.prize_instance_id, [r]);
  }
  return byInstance;
}

/** Apply one slug to many pull_ids, halving the chunk on timeout. Returns rows
 *  actually updated (the `.is(null)` guard means a racing writer just yields 0). */
async function applySlug(slug: string, pullIds: string[]): Promise<number> {
  let updated = 0;
  let chunk = WRITE_CHUNK_START;
  for (let i = 0; i < pullIds.length; ) {
    const slice = pullIds.slice(i, i + chunk);
    const { data, error } = await db()
      .from("gacha_pulls")
      .update({ memo_slug: slug })
      .in("pull_id", slice)
      .is("memo_slug", null)
      .select("pull_id");
    if (error) {
      const timeout = /timeout|57014|canceling statement/i.test(error.message);
      if (timeout && chunk > WRITE_CHUNK_FLOOR) {
        chunk = Math.max(WRITE_CHUNK_FLOOR, Math.floor(chunk / 2));
        console.log(`    ↓ chunk ${chunk} after timeout`);
        continue; // retry the same offset, smaller
      }
      throw new Error(`update "${slug}" failed: ${error.message}`);
    }
    updated += (data ?? []).length;
    i += slice.length;
  }
  return updated;
}

async function main() {
  console.log(`CC memo_slug backfill — perTier=${PER_TIER}${DRY ? " (DRY RUN)" : ""}`);

  const winners = await fetchCCWinners(PER_TIER);
  const tagged = winners.filter((w) => w.memoSlug);
  console.log(
    `feed: ${winners.length.toLocaleString()} pulls, ${tagged.length.toLocaleString()} carry a slug ` +
      `(${((tagged.length / Math.max(winners.length, 1)) * 100).toFixed(1)}%)`,
  );

  // How far back the feed actually let us reach, per machine.
  const reach = new Map<string, { oldest: string; newest: string; n: number }>();
  for (const w of winners) {
    const r = reach.get(w.packCode);
    if (!r) reach.set(w.packCode, { oldest: w.at, newest: w.at, n: 1 });
    else {
      if (w.at < r.oldest) r.oldest = w.at;
      if (w.at > r.newest) r.newest = w.at;
      r.n++;
    }
  }

  // One lookup for every distinct prize instance the feed returned; it answers
  // both the exact-id and the clock-skew question in a single pass.
  const instanceIds = [...new Set(tagged.map(instanceIdOf))];
  console.log(`looking up ${instanceIds.length.toLocaleString()} prize instances in gacha_pulls…`);
  const untagged = await fetchUntaggedByInstance(instanceIds);
  console.log(`  ${untagged.size.toLocaleString()} instance(s) have at least one untagged row`);

  // Resolve each tagged pull to a stored row: exact pull_id first, then mint.
  const bySlug = new Map<string, string[]>();
  const perMachine = new Map<string, { exact: number; skew: number }>();
  let exact = 0;
  let skew = 0;
  let ambiguous = 0;
  let absent = 0;
  const claimed = new Set<string>();

  for (const w of tagged) {
    const rows = untagged.get(instanceIdOf(w));
    if (!rows || !rows.length) {
      absent++; // already tagged, or the pull is not in our spine at all
      continue;
    }
    const want = pullIdOf(w);
    let target = rows.find((r) => r.pull_id === want)?.pull_id;
    let isSkew = false;
    if (!target) {
      // Clock skew: same mint, timestamp off by a little. Bounded by
      // SKEW_TOLERANCE_MS because a mint recurs across months of unrelated pulls,
      // and required to be UNAMBIGUOUS — if two candidate rows sit inside the
      // tolerance we cannot say which pull the slug belongs to, and a wrong tag
      // is worse than no tag.
      const want_ms = Date.parse(w.at);
      const near = rows.filter(
        (r) =>
          !claimed.has(r.pull_id) &&
          Math.abs(Date.parse(r.pulled_at) - want_ms) <= SKEW_TOLERANCE_MS,
      );
      if (near.length === 1) {
        target = near[0].pull_id;
        isSkew = true;
      } else {
        if (near.length > 1) ambiguous++;
        else absent++; // no row for THIS pull; the mint's other rows are other pulls
        continue;
      }
    }
    if (claimed.has(target)) continue;
    claimed.add(target);
    const slug = w.memoSlug as string;
    const list = bySlug.get(slug);
    if (list) list.push(target);
    else bySlug.set(slug, [target]);
    const pm = perMachine.get(w.packCode) ?? { exact: 0, skew: 0 };
    if (isSkew) {
      skew++;
      pm.skew++;
    } else {
      exact++;
      pm.exact++;
    }
    perMachine.set(w.packCode, pm);
  }

  console.log(
    `\nmatched ${(exact + skew).toLocaleString()} untagged row(s): ${exact.toLocaleString()} by pull_id, ` +
      `${skew.toLocaleString()} by mint (clock skew) · ${ambiguous.toLocaleString()} ambiguous skipped · ` +
      `${absent.toLocaleString()} already tagged or absent`,
  );

  console.log(`\nslug            rows to write`);
  for (const [slug, ids] of [...bySlug].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${slug.padEnd(14)} ${String(ids.length).padStart(9)}`);
  }

  let written = 0;
  if (DRY) {
    console.log(`\nDRY RUN — nothing written.`);
  } else {
    console.log(`\nwriting…`);
    for (const [slug, ids] of [...bySlug].sort((a, b) => b[1].length - a[1].length)) {
      const n = await applySlug(slug, ids);
      written += n;
      console.log(`  ${slug.padEnd(14)} ${String(n).padStart(9)} updated`);
    }
  }

  console.log(`\nper machine (matched rows) — feed reach`);
  const machines = [...perMachine].sort((a, b) => b[1].exact + b[1].skew - (a[1].exact + a[1].skew));
  for (const [code, m] of machines.slice(0, 20)) {
    const r = reach.get(code);
    console.log(
      `  ${code.padEnd(18)} ${String(m.exact + m.skew).padStart(7)} rows (${m.skew} skew) · ` +
        `feed back to ${r ? r.oldest.slice(0, 16).replace("T", " ") : "—"} (${r?.n ?? 0} pulls)`,
    );
  }
  if (machines.length > 20) console.log(`  … ${machines.length - 20} more machine(s)`);

  console.log(`\nrows updated: ${written.toLocaleString()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
