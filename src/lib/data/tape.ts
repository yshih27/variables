import type { TapeItem } from "@/lib/types";
import { TAPE_FIXTURE } from "./tapeFixture";

/**
 * The tape's feed (SHELL_V2 S2).
 *
 * ⚠️ THE REAL BUILDER IS THE BACKEND'S, AND IT HAS NOT LANDED.
 * `docs/roadmap/brief-backend-shell-v2-feeds.md` owns `buildTape()`: cleared
 * sales off `buildSalePanel()`, big pulls off the gacha-hits snapshot (gated),
 * and weekly index closes off `readIndexSeries`. This module is the frontend's
 * side of that contract — the component, the route and the refresh loop are all
 * built against `TapeItem[]` and will pick the real feed up with no edit beyond
 * swapping the body of this function.
 *
 * Until then it returns NOTHING, deliberately: a tape is a claim that these
 * events happened, and shipping placeholder events would be the one thing this
 * component must never do. `TAPE_AVAILABLE` is what the shell reads to decide
 * whether to mount the band at all, so an unwired feed shows no band rather than
 * a permanent "no cleared sales" line on every page.
 *
 * The fixture is DEV-ONLY and doubly gated (never in a production build, and
 * opt-in even in dev) so it cannot reach a reader by accident. It exists to
 * exercise the marquee, the relative times, the 24h cutoff and the empty state.
 */
const FIXTURE_ON =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_TAPE_FIXTURE === "true";

/** Whether there is a feed behind the tape at all. False until the backend lands. */
export const TAPE_AVAILABLE = FIXTURE_ON;

/** Events older than this are not "live" and are never shown as such. */
export const TAPE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Drop anything past the live window, newest first, deduped on id. */
export function normalizeTape(items: TapeItem[], nowMs: number): TapeItem[] {
  const seen = new Set<string>();
  return items
    .filter((it) => {
      const t = Date.parse(it.ts);
      if (!Number.isFinite(t) || nowMs - t > TAPE_MAX_AGE_MS) return false;
      if (seen.has(it.id)) return false;
      seen.add(it.id);
      return true;
    })
    .sort((a, b) => b.ts.localeCompare(a.ts));
}

export async function buildTape(limit = 40): Promise<TapeItem[]> {
  if (!FIXTURE_ON) return [];
  return normalizeTape(TAPE_FIXTURE(), Date.now()).slice(0, limit);
}
