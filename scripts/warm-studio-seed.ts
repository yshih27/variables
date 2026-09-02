/**
 * Index Studio seed precompute — the ~30s → sub-second first-paint fix.
 *
 *   npx tsx scripts/warm-studio-seed.ts
 *
 * PURE DERIVATION, like warm-homepage: it reads only what the other warmers
 * already wrote (the metric spine, the index series, the benchmark closes) and
 * makes ZERO external API calls — no Dune, no Helius, no CardOS. It therefore runs
 * in the CORE batch alongside the homepage precompute.
 *
 * WHAT IT WRITES: one `studio-seed:<scope>` snapshot per studio on the site —
 * /ips (market), /platforms (the platform family), and each /platform/[key]. Each
 * holds the scoped picker catalog (metadata only) plus the POINTS for just that
 * scope's default-active series, which is what the page embeds so the chart paints
 * with no client fetch at all.
 *
 * ⚠️ THE CATALOG IS BUILT ONCE, NOT PER SCOPE. Scoping only narrows what the
 * picker OFFERS — every scope reads the same underlying series — so building it
 * seven times would be seven identical passes over the whole spine.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { buildStudioCatalog, inScope, type CatalogItem, type SeriesPoint, type StudioScope } from "../src/lib/studio/catalog";
import { serverChartLoader } from "../src/lib/studio/serverLoader";
import { seedActiveFor, writeStudioSeed, scopeSlug, type StudioSeed } from "../src/lib/studio/seed";
import { PLATFORM_SOURCES } from "../src/lib/data/sources";
import { runWarmer } from "../src/lib/db/runWarmer";

/** Every studio on the site: /ips, /platforms, and one per /platform/[key]. */
function allScopes(): (StudioScope | undefined)[] {
  return [
    undefined, // /ips — the market-wide studio
    { entity: "platform" as const }, // /platforms — the family comparison
    ...PLATFORM_SOURCES.map((p) => ({ entity: "platform" as const, key: p.key })),
  ];
}

/**
 * Reconcile a scope's default-active ids against what the catalog actually holds,
 * in CATALOG order.
 *
 * ⚠️ THIS IS THE COMPONENT'S OWN RULE, RUN AHEAD OF TIME — not a second opinion.
 * Ids with no series are DROPPED (the honest-absence rule: nothing writes
 * platform/phygitals/volume_usd, so Phygitals is not a default line), and the
 * survivors are re-ordered biggest-latest-value first, because the FIRST active id
 * is the chart's "primary" and gets the area fill and the glow. Doing it here is
 * what stops a seeded mount from drawing one order and then visibly reshuffling.
 */
function reconcileActive(scope: StudioScope | undefined, wanted: string[], scoped: CatalogItem[]): string[] {
  const have = new Set(scoped.map((c) => c.id));
  const keep = new Set(wanted.filter((id) => have.has(id)));
  const ordered = scoped.filter((c) => keep.has(c.id)).map((c) => c.id);
  if (ordered.length) return ordered;
  // Nothing survived — open on anything this scope does have rather than an empty
  // plot. Same fallback the component applies.
  if (!scope) return [];
  const prefix = scope.key ? `sp:${scope.entity}:${scope.key}:` : `sp:${scope.entity}:`;
  const own = scoped.find((c) => c.id.startsWith(prefix));
  return own ? [own.id] : [];
}

async function main() {
  const t0 = Date.now();
  const { items, data } = await buildStudioCatalog(serverChartLoader());

  // A hollow catalog must never overwrite a good seed — same guard warm-homepage
  // carries. The readers degrade to empty on DB flakiness (transient Supabase
  // 522s have done exactly this), and a seed with no items would paint an empty
  // studio on every page that embeds it.
  if (items.length < 5) {
    throw new Error(`catalog is hollow (${items.length} items) — upstream reads failed; keeping previous seeds`);
  }
  console.log(`Catalog built in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${items.length} series`);

  const generatedAt = new Date().toISOString();
  let written = 0;
  for (const scope of allScopes()) {
    const scoped = scope ? items.filter((it) => inScope(it.id, scope)) : items;
    const active = reconcileActive(scope, seedActiveFor(scope), scoped);
    const seedData: Record<string, SeriesPoint[]> = {};
    for (const id of active) {
      const pts = data.get(id);
      if (pts?.length) seedData[id] = pts;
    }
    const seed: StudioSeed = { items: scoped, data: seedData, active, generatedAt };
    await writeStudioSeed(scope, seed);
    written++;
    const kb = (JSON.stringify(seed).length / 1024).toFixed(0);
    console.log(
      `  ${scopeSlug(scope).padEnd(26)} ${String(scoped.length).padStart(3)} items · ` +
        `${active.length} default series · ${kb}KB` +
        (active.length ? ` · ${active.join(", ").slice(0, 60)}` : " · (no default series — picker only)"),
    );
  }

  console.log(`\n${written} studio seed(s) written in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { rowsWritten: written };
}

runWarmer("studio-seed", main).catch((e) => {
  console.error(e);
  process.exit(1);
});
