/**
 * Which venues each per-IP figure covers, in words — built from the same list and
 * snapshots the figures are computed from, so a coverage line can never name a
 * venue its figure doesn't read, or leave out one it does:
 *   • resale (24h/7d volume, trades, cards, wallets, avg trade — live values and
 *     the spine's daily per-IP series alike): IP_RESALE_VENUES, less any whose
 *     feed this snapshot did not read (named, with its last read: Beezie's API
 *     has answered automated reads with a bot challenge since Oct 22 2026);
 *   • market cap and its card counts: the venues with a per-IP entry in the
 *     marketcap snapshot (Renaiss joins only while its stated value clears its
 *     coverage floor; Phygitals and DYLI are valued at venue level only);
 *   • holders: the venues the holder scan writes per IP.
 * Venues are listed in registry order (PLATFORM_SOURCES) everywhere.
 */
import { IP_RESALE_VENUES, PLATFORM_SOURCES } from "./sources";
import { MCAP_BASIS, type MarketCapSnapshot } from "./marketcap";
import type { HoldersSnapshot } from "./holders";
import { shortUtcDay } from "./resaleFeedState";

const ORDER = PLATFORM_SOURCES.map((p) => p.key as string);
const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);
const ordered = (keys: Iterable<string>) => [...new Set(keys)].sort((a, b) => rank(a) - rank(b));

export const venueName = (key: string) => PLATFORM_SOURCES.find((p) => p.key === key)?.name ?? key;

/** "A" · "A and B" · "A, B and C". */
export function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const names = (keys: string[]) => andList(keys.map(venueName));

/** The venues whose resale reaches per-IP figures, in registry order. */
export const ipResaleVenues = (): string[] => ordered(IP_RESALE_VENUES);

/** Venues whose cards enter per-IP market cap in this snapshot (any per-IP entry). */
export function ipMcapVenues(mcap: MarketCapSnapshot | null): string[] {
  return ordered(
    Object.entries(mcap?.byPlatform ?? {})
      .filter(([, p]) => Object.keys(p.byIp ?? {}).length > 0)
      .map(([k]) => k),
  );
}

/** Venues whose wallets per-IP holders count: every venue the holder scan wrote per IP. */
export function ipHolderVenues(h: HoldersSnapshot | null): string[] {
  const keys = new Set<string>();
  for (const e of Object.values(h?.byIp ?? {})) for (const k of Object.keys(e.perPlatform ?? {})) keys.add(k);
  return ordered(keys);
}

const BASIS_WORDS: Record<string, string> = {
  appraisal: "insured value",
  floor: "lowest listing",
  stated: "stated value",
};

/** "Beezie lowest listing, Collector Crypt insured value" — each venue with its basis. */
export function mcapBasisList(venues: string[]): string {
  return venues.map((v) => `${venueName(v)} ${BASIS_WORDS[MCAP_BASIS[v]] ?? "value"}`).join(", ");
}

export type IpCoverage = {
  /** Per-IP resale venues read in this snapshot. */
  resale: string[];
  mcap: string[];
  holders: string[];
  /** Per-IP resale venues NOT read in this snapshot, each with its last read
   *  (ISO) when one is recorded. Absent on payloads written before Oct 22 2026. */
  notRead?: { venue: string; lastReadAt: string | null }[];
};

/**
 * `read` = which venues' resale this snapshot actually read (a venue with a
 * secondary entry in core-volume) and each venue's last recorded read. Without
 * it every per-IP resale venue is taken as read.
 */
export function ipCoverage(
  mcap: MarketCapSnapshot | null,
  holders: HoldersSnapshot | null,
  read?: { venues: string[]; lastReadAt: (venue: string) => string | null },
): IpCoverage {
  const all = ipResaleVenues();
  const readSet = read ? new Set(read.venues) : null;
  return {
    resale: readSet ? all.filter((v) => readSet.has(v)) : all,
    mcap: ipMcapVenues(mcap),
    holders: ipHolderVenues(holders),
    notRead: readSet ? all.filter((v) => !readSet.has(v)).map((v) => ({ venue: v, lastReadAt: read!.lastReadAt(v) })) : [],
  };
}

/** "Collector Crypt resale (Beezie not read since Oct 21)". */
export function resaleWords(c: IpCoverage): string {
  const read = c.resale.length ? `${names(c.resale)} resale` : "no resale read";
  const missing = (c.notRead ?? []).map((n) => `${venueName(n.venue)} not read${n.lastReadAt ? ` since ${shortUtcDay(n.lastReadAt)}` : ""}`);
  return missing.length ? `${read} (${missing.join("; ")})` : read;
}

/** IP rail: the venues behind its 24h figures and its market cap. */
export function railCoverageLine(c: IpCoverage): string {
  const cap = c.mcap.length ? mcapBasisList(c.mcap) : "no venue valued by IP";
  return `24h figures: ${resaleWords(c)} · market cap: ${cap}`;
}

/** IP page, By Platform: which venues each column covers. */
export function byPlatformCoverageLine(c: IpCoverage): string {
  const parts = [`24h vol, trades and avg trade: ${resaleWords(c)}`];
  if (c.mcap.length) parts.push(`cards and market cap: ${names(c.mcap)}`);
  if (c.holders.length) parts.push(`holders: wallets on ${names(c.holders)}`);
  return parts.join(" · ");
}

/**
 * Categories table: what every per-IP column covers, and which venues' resale
 * counts only in venue totals (`resaleVenues` = the venues with a resale feed now).
 */
export function ipTableCoverageLine(c: IpCoverage, resaleVenues: string[]): string {
  const parts = [`per IP: volume, cards, buyers and avg trade count ${resaleWords(c)}`];
  if (c.mcap.length) parts.push(`market cap: ${mcapBasisList(c.mcap)}`);
  if (c.holders.length) parts.push(`holders: wallets on ${names(c.holders)}`);
  const elsewhere = ordered(resaleVenues.filter((v) => !c.resale.includes(v)));
  if (elsewhere.length) parts.push(`${names(elsewhere)} resale counts in venue totals only`);
  return parts.join(" · ");
}
