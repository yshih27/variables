/**
 * Resale feeds a venue has stopped serving us, as the core warmer last recorded
 * them (snapshot `resale-feeds`): when each venue's resale was last read, and why
 * it is not read now.
 *
 * Oct 22 2026: Beezie's API began answering automated reads with a Cloudflare
 * challenge (403, cf-mitigated: challenge). Like Phygitals' listings (#226), bot
 * protection is never worked around. From the last read on, Beezie's resale is
 * unknown — not zero — and every surface that would show it says so with the
 * date: the venue tables, its platform page, the IP pages and the Categories
 * table's coverage lines. The daily gate stops requiring the Beezie-only
 * secondary-sales step, and INV-9 does not judge the closed streams.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";
import { CLOUDFLARE_CHALLENGE } from "../beezie/market";
import { formatMonthDayUtc } from "../format";

export const RESALE_FEEDS_KEY = "resale-feeds";

export type ResaleFeedEntry = {
  /** The last successful read (ISO). On a first outage with no recorded read the
   *  newest stored sale stands in: a read always comes after the sales it returns,
   *  so the date can only be early by the gap before that read. */
  lastReadAt: string | null;
  /** Why the feed is not read now (the read's error); null while it is read. */
  unavailable: string | null;
  /** The first failed read of the current outage (ISO). */
  unavailableSince: string | null;
};

export type ResaleFeedsSnapshot = {
  generatedAt: string;
  venues: Record<string, ResaleFeedEntry>;
};

export async function readResaleFeeds(): Promise<ResaleFeedsSnapshot | null> {
  return readSnapshot<ResaleFeedsSnapshot>(RESALE_FEEDS_KEY);
}

export async function writeResaleFeeds(s: ResaleFeedsSnapshot): Promise<void> {
  await writeSnapshot(RESALE_FEEDS_KEY, s, s.generatedAt);
}

export type ReadAttempt =
  | { ok: true; at: string }
  | { ok: false; at: string; error: string; /** used only when no read was recorded */ seedLastReadAt?: string | null };

/** A venue's entry after one read attempt. */
export function nextResaleFeedEntry(prev: ResaleFeedEntry | undefined, attempt: ReadAttempt): ResaleFeedEntry {
  if (attempt.ok) return { lastReadAt: attempt.at, unavailable: null, unavailableSince: null };
  return {
    lastReadAt: prev?.lastReadAt ?? attempt.seedLastReadAt ?? null,
    unavailable: attempt.error,
    unavailableSince: prev?.unavailable ? (prev.unavailableSince ?? attempt.at) : attempt.at,
  };
}

/**
 * A venue whose resale feed is closed: refused by bot protection. A one-off
 * failure (a timeout, a 5xx after retries) is not a closure — the venue simply
 * has no figures for that run, as before. Null when the feed is open.
 */
export function closedResaleFeed(s: ResaleFeedsSnapshot | null | undefined, venue: string): ResaleFeedEntry | null {
  const e = s?.venues?.[venue];
  return e?.unavailable && e.unavailable.includes(CLOUDFLARE_CHALLENGE) ? e : null;
}

/**
 * What a writer does when a venue's live read fails: read our own stored rows
 * when the feed is closed to us (they hold every sale read until it closed), or
 * skip that run's per-venue writes when the failure may pass.
 */
export function onFailedRead(s: ResaleFeedsSnapshot | null | undefined, venue: string): "store" | "skip" {
  return closedResaleFeed(s, venue) ? "store" : "skip";
}

/** "Oct 21" (UTC), month and day kept on one line. */
export function shortUtcDay(iso: string): string {
  return (formatMonthDayUtc(iso) ?? "").replace(" ", "\u00a0");
}

/** "not read since Oct 21" — or "not read" when no read was ever recorded. */
export function notReadSince(e: ResaleFeedEntry): string {
  return e.lastReadAt ? `not read since ${shortUtcDay(e.lastReadAt)}` : "not read";
}

/** The reason, in words, for a venue's closed feed ("its API answers automated reads with a bot challenge"). */
export function closedFeedWhy(e: ResaleFeedEntry): string {
  return e.unavailable?.includes(CLOUDFLARE_CHALLENGE)
    ? "its API answers automated reads with a bot challenge"
    : "its feed refuses our reads";
}
