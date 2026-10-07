/**
 * Per-venue gacha boards the platform page reads, from whichever snapshot holds
 * each venue's — so the page gates on a board EXISTING, never on a venue key:
 *
 *   • `readVenueMachineBoard(key)`: Collector Crypt's from player analytics
 *     (`player-analytics.machines`), Renaiss's from `machines:renaiss`;
 *   • `readVenuePlayers(key)`: Collector Crypt's and Phygitals' from player
 *     analytics, Renaiss's from `players:renaiss`;
 *   • `readBiggestPulls(key, days)`: the 12 biggest prizes over `days`, for
 *     every venue with a named pull feed, each tagged with the basis of its
 *     value (the venue's own claim, wherever it travels).
 *
 * Every reader returns null for a venue it does not cover — absence, never an
 * empty board or a zero. DYLI's pulls carry no item title yet (PR B stores it),
 * so it has no biggest pulls here.
 */
import { readPlayerAnalytics, type MachineBoard, type PlatformPlayerAnalytics } from "./playerAnalytics";
import { readCCGacha } from "./ccGachaCache";
import { readPhygitalsGacha } from "./phygitalsGachaCache";
import type { GachaBigHit } from "./gachaDuneCache";
import { parseGrade } from "../card/grade";
import { readRenaissBiggestPulls, readRenaissMachineBoard, RENAISS_VALUE_BASIS } from "../renaiss/machines";
import { readRenaissPlayers } from "../renaiss/players";

export type BiggestPull = {
  cardName: string | null;
  /** "PSA 10"; null when the venue's feed names no grade. */
  grade: string | null;
  image: string | null;
  /** The machine or pack it came out of, where the feed names one. */
  machine: string | null;
  valueUsd: number;
  /** What `valueUsd` is: the venue's own claim ("Renaiss's stated prize value"). */
  valueBasis: string;
  pulledAt: string;
};

/** The basis each venue's pull values are in. */
export const PULL_VALUE_BASIS: Record<string, string> = {
  renaiss: RENAISS_VALUE_BASIS,
  "collector-crypt": "Collector Crypt's insured value",
  phygitals: "Phygitals FMV",
};

const DAY_MS = 86_400_000;
const LIMIT = 12;

function fromBigHits(hits: GachaBigHit[], basis: string, days: number, nowMs: number): BiggestPull[] {
  const from = nowMs - days * DAY_MS;
  return hits
    .filter((h) => {
      const t = Date.parse(h.at);
      return Number.isFinite(t) && t >= from && t <= nowMs && h.valueUsd > 0;
    })
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .slice(0, LIMIT)
    .map((h) => ({
      cardName: h.name || null,
      grade: parseGrade(h.name)?.label ?? null,
      image: h.image ?? h.imageFallback ?? null,
      machine: h.pack ?? null,
      valueUsd: h.valueUsd,
      valueBasis: basis,
      pulledAt: h.at,
    }));
}

/** The biggest prizes over `days`, or null for a venue with no named pull feed. Never throws. */
export async function readBiggestPulls(key: string, days = 30, nowMs: number = Date.now()): Promise<BiggestPull[] | null> {
  try {
    if (key === "renaiss") {
      const rows = await readRenaissBiggestPulls(days, nowMs, LIMIT);
      return rows.map((r) => ({ ...r, valueBasis: PULL_VALUE_BASIS.renaiss }));
    }
    if (key === "collector-crypt") {
      const snap = await readCCGacha();
      return snap ? fromBigHits(snap.bigHits ?? [], PULL_VALUE_BASIS[key], days, nowMs) : null;
    }
    if (key === "phygitals") {
      const snap = await readPhygitalsGacha();
      return snap ? fromBigHits(snap.bigHits ?? [], PULL_VALUE_BASIS[key], days, nowMs) : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** A venue's machine board, or null. Never throws. */
export async function readVenueMachineBoard(key: string): Promise<MachineBoard | null> {
  try {
    if (key === "renaiss") return await readRenaissMachineBoard();
    if (key === "collector-crypt") return (await readPlayerAnalytics())?.machines ?? null;
    return null;
  } catch {
    return null;
  }
}

/** A venue's player analytics, or null. Never throws. */
export async function readVenuePlayers(key: string): Promise<PlatformPlayerAnalytics | null> {
  try {
    if (key === "renaiss") return (await readRenaissPlayers())?.platform ?? null;
    return (await readPlayerAnalytics())?.platforms.find((p) => p.platform === key) ?? null;
  } catch {
    return null;
  }
}
