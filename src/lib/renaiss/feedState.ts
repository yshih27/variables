/**
 * What each Renaiss feed's last WRITING run reached — the one fact the row
 * stores cannot say about themselves.
 *
 * A stored row says how far the store goes; it cannot say whether the run that
 * wrote it read on to the present or stopped at the call ceiling, a rate limit
 * or `--limit`. Two readers need that:
 *   • the daily spine publishes a day only when it is COMPLETE — the newest
 *     stored row is past the day's end AND the last run reached the present
 *     (`lastCompleteDay`); the newest day is a partial and is never published
 *     (INV-8);
 *   • core-volume carries Renaiss's rolling 24h/7d only while its feeds are
 *     current (`feedIsCurrent`); otherwise the board shows "—", never a zero
 *     read off a store that simply stopped filling.
 *
 * Written by the two warmers in apply mode only (a dry run must not advertise
 * a warm that wrote nothing). Kept in the `snapshots` table: no schema change.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";
import type { StopReason } from "./client";

export const RENAISS_FEEDS_KEY = "renaiss-feeds";
export type RenaissFeed = "sales" | "pulls";

export type FeedRunState = {
  /** When the run finished. */
  at: string;
  stoppedBy: StopReason;
  /** The newest row time the store held after the run. */
  newestRowAt: string | null;
  /** When a run last reached the present (carried over from earlier runs). */
  caughtUpAt: string | null;
};
export type RenaissFeedsSnapshot = { generatedAt: string; feeds: Partial<Record<RenaissFeed, FeedRunState>> };

export function readRenaissFeeds(): Promise<RenaissFeedsSnapshot | null> {
  return readSnapshot<RenaissFeedsSnapshot>(RENAISS_FEEDS_KEY);
}

/** The state a finished run leaves — pure, so the rules are testable. */
export function nextFeedState(
  prev: FeedRunState | undefined,
  run: { stoppedBy: StopReason; newestRowAt: string | null },
  now: number = Date.now(),
): FeedRunState {
  const at = new Date(now).toISOString();
  return {
    at,
    stoppedBy: run.stoppedBy,
    newestRowAt: run.newestRowAt ?? prev?.newestRowAt ?? null,
    caughtUpAt: run.stoppedBy === "caught-up" ? at : (prev?.caughtUpAt ?? null),
  };
}

/** Record one feed's run. Read-modify-write; the other feed's entry is kept. */
export async function recordFeedRun(feed: RenaissFeed, run: { stoppedBy: StopReason; newestRowAt: string | null }): Promise<FeedRunState> {
  const cur = (await readRenaissFeeds()) ?? { generatedAt: "", feeds: {} };
  const next = nextFeedState(cur.feeds[feed], run);
  cur.feeds[feed] = next;
  cur.generatedAt = next.at;
  await writeSnapshot(RENAISS_FEEDS_KEY, cur, next.at);
  return next;
}

const DAY_MS = 86_400_000;

/**
 * The newest COMPLETE UTC day (its midnight ISO), or null when none is: the
 * last run must have reached the present, and a day is complete once the
 * newest stored row is past its end — so the day holding that row is the
 * partial one and the day before it is the last complete day.
 */
export function lastCompleteDay(state: FeedRunState | undefined): string | null {
  if (!state || state.stoppedBy !== "caught-up" || !state.newestRowAt) return null;
  const t = Date.parse(state.newestRowAt);
  if (!Number.isFinite(t)) return null;
  const newestDayStart = Math.floor(t / DAY_MS) * DAY_MS;
  return new Date(newestDayStart - DAY_MS).toISOString();
}

/** Two 6h core cycles: past this, a feed's rolling figures are not published. */
export const FEED_CURRENT_MS = 12 * 60 * 60 * 1000;

/** True when the feed reached the present within `maxAgeMs`. */
export function feedIsCurrent(state: FeedRunState | undefined, now: number = Date.now(), maxAgeMs: number = FEED_CURRENT_MS): boolean {
  const t = state?.caughtUpAt ? Date.parse(state.caughtUpAt) : NaN;
  return Number.isFinite(t) && now - t <= maxAgeMs;
}
