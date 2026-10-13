/**
 * How far the Courtyard exchange feed has read (scripts/warm-courtyard-exchange.ts).
 *
 * Readers use it two ways: the spine's zero-fill stops at `coveredThrough` (a day
 * after it is not yet scanned, so it must not be finalised), and the core warm
 * keeps the previous Courtyard entry rather than publish an OpenSea-only 24h
 * while the feed is stale.
 */
import { readSnapshot, writeSnapshot } from "../db/snapshots";

export const COURTYARD_EXCHANGE_STATE_KEY = "courtyard-exchange";

/** A feed older than this is not current: its rows stop short of the present. */
export const COURTYARD_EXCHANGE_MAX_AGE_MS = 12 * 3_600_000;

export type CourtyardExchangeState = {
  /** The last block read, inclusive. */
  throughBlock: number;
  /** That block's time, ISO UTC: everything before it has been read. */
  coveredThrough: string;
  /** The earliest time the stored rows reach back to (the first backfill's start). */
  coveredFrom: string;
  updatedAt: string;
};

export function readCourtyardExchangeState(): Promise<CourtyardExchangeState | null> {
  return readSnapshot<CourtyardExchangeState>(COURTYARD_EXCHANGE_STATE_KEY);
}

export function writeCourtyardExchangeState(s: CourtyardExchangeState): Promise<void> {
  return writeSnapshot(COURTYARD_EXCHANGE_STATE_KEY, s, s.updatedAt);
}

/** True when the feed reached within COURTYARD_EXCHANGE_MAX_AGE_MS of `nowMs`. */
export function exchangeFeedIsCurrent(s: CourtyardExchangeState | null, nowMs = Date.now()): boolean {
  if (!s) return false;
  const t = Date.parse(s.coveredThrough);
  return Number.isFinite(t) && nowMs - t <= COURTYARD_EXCHANGE_MAX_AGE_MS;
}
