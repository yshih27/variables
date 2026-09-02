/**
 * The studio SEED bundle — what a page embeds so the chart paints without a
 * single client fetch.
 *
 * The studio used to open by firing ~30 same-origin requests (one index probe per
 * registry entry, the benchmark call, eleven spine-family bulk reads) and holding
 * "Loading market data…" until all of them returned. Cold, that measured ~30s.
 * The data behind every one of those calls is already sitting in snapshots the
 * warmers wrote, so a page render can hand it to the component directly.
 *
 * ⚠️ THE SEED IS THE DEFAULT VIEW, NOT THE CATALOG. It carries the picker's item
 * list (metadata only — ids, names, colours) plus the POINTS for just the series
 * the default view draws. Embedding every series' points would put megabytes into
 * the HTML to paint five lines. Everything else arrives after paint, in one call
 * to /api/internal/chart/bundle.
 */
import { readSnapshot, writeSnapshot } from "@/lib/db/snapshots";
import {
  DEFAULT_ACTIVE,
  scopedDefaultActive,
  type CatalogItem,
  type SeriesPoint,
  type StudioScope,
} from "./catalog";

/** Snapshot key for one scope. Mirrors the studio's own page tag. */
export function studioSeedKey(scope?: StudioScope): string {
  return `studio-seed:${scopeSlug(scope)}`;
}

/** "market" (/ips) · "platform" (/platforms) · "platform:<key>". */
export function scopeSlug(scope?: StudioScope): string {
  if (!scope) return "market";
  return scope.key ? `${scope.entity}:${scope.key}` : scope.entity;
}

export type StudioSeed = {
  /** The scoped picker catalog — metadata only, no points. */
  items: CatalogItem[];
  /** Points for the default-active ids ONLY. Plain object: a Map does not survive
   *  JSON, and this crosses both a snapshot row and the server→client prop boundary. */
  data: Record<string, SeriesPoint[]>;
  /** The ids `data` covers, in the order the studio should draw them — already
   *  reconciled against what exists, so the component does not repeat that work. */
  active: string[];
  /** When the warmer built it. Surfaces as the studio's own "as of", and lets a
   *  page decline a seed so stale it would paint yesterday's chart. */
  generatedAt: string;
};

/** Default-active ids for a scope — the one definition both sides use. */
export function seedActiveFor(scope?: StudioScope): string[] {
  return scope ? scopedDefaultActive(scope) : DEFAULT_ACTIVE;
}

export function readStudioSeed(scope?: StudioScope): Promise<StudioSeed | null> {
  // Never throws: a missing or unreadable seed must degrade to the old
  // fetch-on-mount path, not blank the page.
  return readSnapshot<StudioSeed>(studioSeedKey(scope)).catch(() => null);
}

export function writeStudioSeed(scope: StudioScope | undefined, seed: StudioSeed): Promise<void> {
  return writeSnapshot(studioSeedKey(scope), seed, seed.generatedAt);
}
