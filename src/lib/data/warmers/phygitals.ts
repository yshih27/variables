/**
 * Phygitals marketplace warmer — lights up a platform we previously had no
 * marketplace data for. Fetches api.phygitals.com/marketplace-listings PER
 * CATEGORY (the API classifies server-side; there's no category field in the
 * per-item metadata), then for each card →
 *   • upserts into `cards` (instances) with name/image/ip/grade/set/fmv
 *   • upserts its active listing into `listings` (cheapest per mint = floor)
 *   • writes platform headline stats to entity_metrics
 *
 * The metadata is [{key,value}] (NOT trait_type) and carries a TCGPlayer ID —
 * kept in `attributes` as the cross-platform match key for the Phase-2 matcher.
 * Gacha aggregates stay on Dune.
 */
import {
  fetchPhygitalsListings,
  fetchPhygitalsSales,
  type PhygitalsListing,
} from "../../phygitals/client";
import { db } from "../../db/client";

// API category string → our ip_key. Pokémon (~87%) + One Piece (~3.5%) cover
// ~90% of Phygitals; extend as we confirm more category strings.
const CATEGORIES: { api: string; ip: string }[] = [
  { api: "Pokemon", ip: "pokemon" },
  { api: "One Piece", ip: "one_piece" },
];

function usd(raw?: string | null): number | null {
  if (raw == null) return null;
  const n = Number(raw) / 1e6;
  return Number.isFinite(n) ? n : null;
}

function metaMap(metadata: unknown): Record<string, string> {
  const m: Record<string, string> = {};
  if (Array.isArray(metadata)) {
    for (const e of metadata as { key?: unknown; value?: unknown }[]) {
      if (e && e.key != null && e.value != null) m[String(e.key)] = String(e.value);
    }
  }
  return m;
}

function parseGrade(g?: string): { grader: string | null; num: number | null; label: string } {
  if (!g || /ungraded|raw/i.test(g)) return { grader: null, num: null, label: "Ungraded" };
  const grader = g.match(/[A-Za-z]+/)?.[0] ?? null;
  const nm = g.match(/(\d+(?:\.\d+)?)/);
  return { grader, num: nm ? parseFloat(nm[1]) : null, label: g };
}

export type PhygitalsWarmResult = {
  cards: number;
  listings: number;
  floorUsd: number | null;
  totalVolumeUsd: number;
  activeListings: number;
};

export async function runPhygitalsWarm(
  opts: { maxPages?: number; itemsPerPage?: number; log?: (m: string) => void } = {},
): Promise<PhygitalsWarmResult> {
  const log = opts.log ?? (() => {});
  const itemsPerPage = opts.itemsPerPage ?? 100;
  const maxPages = opts.maxPages ?? 80; // per category
  const PAGE_DELAY_MS = 150; // polite gap between listing pages (avoid 429s)
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const cardById = new Map<string, Record<string, unknown>>();
  const listingById = new Map<string, Record<string, unknown>>();
  let floorUsd: number | null = null;
  let hadError = false; // a page failed mid-crawl → write the partial we have

  for (const { api, ip } of CATEGORIES) {
    let total = 0;
    for (let page = 1; page <= maxPages; page++) {
      let listings: PhygitalsListing[];
      try {
        const r = await fetchPhygitalsListings(page, itemsPerPage, { category: [api] });
        listings = r.listings;
        total = r.total;
      } catch (err) {
        // A page failing (rate-limited past its retries) must not sink the run —
        // keep the cheapest-first listings already collected (floor stays correct)
        // and move on. A true total failure is caught below + by runWarmer.
        hadError = true;
        log(`  ${api}: stopped at page ${page} — ${(err as Error).message}`);
        break;
      }
      if (listings.length === 0) break;
      for (const l of listings) {
        const mint = l.address;
        if (!mint) continue;
        const id = `pg-${mint}`;
        const priceUsd = usd(l.price);
        if (priceUsd != null && (floorUsd == null || priceUsd < floorUsd)) floorUsd = priceUsd;
        if (cardById.has(id)) continue; // first (cheapest) wins

        const m = metaMap(l.metadata);
        const gr = parseGrade(m["Grade"]);
        cardById.set(id, {
          id,
          platform: "phygitals",
          token_id: mint,
          chain: "Solana",
          token_standard: l.token_standard ?? "CNFT",
          name: l.name ?? m["Title"] ?? null,
          card_name: m["Name"] ?? l.name ?? null,
          ip_key: ip,
          category: ip,
          set_name: m["Set"] ?? null,
          card_number: m["Number"] ?? null,
          grader: gr.grader,
          grade: m["Grade"] ?? null,
          grade_num: gr.num,
          grade_label: gr.label,
          year: m["Set Release Date"] ? parseInt(m["Set Release Date"], 10) || null : null,
          image: l.image ?? null,
          fmv_usd: usd(l.altFmv) ?? priceUsd,
          attributes: l.metadata ?? null, // keeps TCGPlayer ID etc. for the matcher
          source: "phygitals-api",
        });
        if (priceUsd != null) {
          listingById.set(`phygitals:${mint}`, {
            listing_id: `phygitals:${mint}`,
            platform_id: "phygitals",
            instance_id: id,
            category_id: ip,
            price_usd: priceUsd,
            currency: l.currency ?? null,
            venue: l.marketplace ?? null,
            status: "active",
            source: "phygitals-api",
          });
        }
      }
      if (total && page * itemsPerPage >= total) break;
      await sleep(PAGE_DELAY_MS);
    }
    log(`  ${api}: ${total} listed${hadError ? " (partial)" : ""} (cumulative cards ${cardById.size})`);
  }

  const cardRows = [...cardById.values()];
  const listingRows = [...listingById.values()];
  if (cardRows.length === 0) {
    // Collected nothing — surface it (runWarmer records an error row) instead of
    // silently writing an empty "ok" snapshot. This is the bug that hid a 21-day
    // outage: the warmer threw before recording, so it read "stale", not "error".
    throw new Error(`Phygitals: no listings collected${hadError ? " (rate-limited)" : ""}`);
  }
  const CHUNK = 500;
  for (let i = 0; i < cardRows.length; i += CHUNK) {
    const { error } = await db().from("cards").upsert(cardRows.slice(i, i + CHUNK));
    if (error) throw new Error(`cards upsert: ${error.message}`);
  }
  for (let i = 0; i < listingRows.length; i += CHUNK) {
    const { error } = await db().from("listings").upsert(listingRows.slice(i, i + CHUNK));
    if (error) throw new Error(`listings upsert: ${error.message}`);
  }

  const { totalVolume, totalActiveListingsCount } = await fetchPhygitalsSales(0);
  const totalVolumeUsd = totalVolume / 1e6;
  await db()
    .from("entity_metrics")
    .upsert({
      entity_type: "platform",
      entity_id: "phygitals",
      period: "all",
      vol_usd: totalVolumeUsd,
      floor_usd: floorUsd,
      extra: { active_listings: totalActiveListingsCount, cards_indexed: cardRows.length },
      generated_at: new Date().toISOString(),
      source: "phygitals-api",
    });
  const result: PhygitalsWarmResult = {
    cards: cardRows.length,
    listings: listingRows.length,
    floorUsd,
    totalVolumeUsd,
    activeListings: totalActiveListingsCount,
  };
  log(
    `done: ${result.cards} cards, ${result.listings} listings, floor $${floorUsd?.toFixed(2) ?? "—"}, vol $${Math.round(totalVolumeUsd).toLocaleString()}, ${totalActiveListingsCount.toLocaleString()} active`,
  );
  return result;
}
