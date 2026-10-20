/**
 * Phygitals' listings state, as the marketplace warmer last recorded it in
 * `entity_metrics` (platform / phygitals / all).
 *
 * In Oct 2026 Phygitals stopped serving its listings publicly: the API route the
 * warmer read answers 404 ("Cannot GET /api/marketplace/marketplace-listings") and
 * its site now serves listings through its own app, behind bot protection. The
 * last floor was read Oct 17. Its market cap is floor × supply, so without a
 * current floor the figure is withheld, and the platform page says why from this
 * row (`fetchPlatform`'s mcapReason).
 */
import { db } from "../db/client";

export type PhygitalsListingsState = {
  /** The floor the warmer last wrote; null once listings are unavailable. */
  floorUsd: number | null;
  /** When a floor was last read (ISO). While listings are unavailable the warmer
   *  carries it forward in `extra.floor_last_read_at`. */
  floorLastReadAt: string | null;
  /** The error that made listings unavailable, or null when they were read. */
  listingsUnavailable: string | null;
};

/** A floor older than this is never priced into the market cap: the warmer runs
 *  daily, so this allows two missed days before the figure is withheld. */
export const PHYGITALS_FLOOR_MAX_AGE_MS = 72 * 60 * 60 * 1000;

export async function readPhygitalsListingsState(): Promise<PhygitalsListingsState | null> {
  const { data, error } = await db()
    .from("entity_metrics")
    .select("floor_usd, generated_at, extra")
    .eq("entity_type", "platform")
    .eq("entity_id", "phygitals")
    .eq("period", "all")
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { floor_usd?: number | null; generated_at?: string | null; extra?: Record<string, unknown> | null };
  const extra = row.extra ?? {};
  const floor = typeof row.floor_usd === "number" && Number.isFinite(row.floor_usd) && row.floor_usd > 0 ? row.floor_usd : null;
  const carried = typeof extra.floor_last_read_at === "string" ? extra.floor_last_read_at : null;
  return {
    floorUsd: floor,
    floorLastReadAt: floor != null ? (row.generated_at ?? null) : carried,
    listingsUnavailable: typeof extra.listings_unavailable === "string" ? extra.listings_unavailable : null,
  };
}

/** True when the floor was read within PHYGITALS_FLOOR_MAX_AGE_MS. */
export function phygitalsFloorIsCurrent(state: PhygitalsListingsState | null, now: number = Date.now()): boolean {
  if (!state || state.floorUsd == null || !state.floorLastReadAt) return false;
  const t = Date.parse(state.floorLastReadAt);
  return Number.isFinite(t) && now - t <= PHYGITALS_FLOOR_MAX_AGE_MS;
}
