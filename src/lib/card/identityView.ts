import type { IdentityDetail, IdentityFloor, IdentityMonthly } from "@/lib/data/identityDetail";
import { identityDisplayName } from "./identity";
import { PLATFORM_META, type CardPlatform } from "./ids";
import { labelFor } from "@/lib/indices/entityLabels";
import { formatCompactUsd } from "@/lib/format";

/**
 * The identity page's READING rules — pure, shared by every zone (header, KPI
 * strip, hero, ladder, share card) so no two of them can disagree about which
 * month is "the" month or whether an ask is a floor.
 *
 * ⚠️ THE MONTHLY PRICE IS THE LATEST COMPLETE MONTH. `monthly` arrives with the
 * running month flagged `partial` — the index's own function returns it, but the
 * index never publishes it. A headline (KPI, tooltip title, share card, CSV)
 * takes `latestCompleteMonthly` and nothing else; the partial month exists only
 * as a hollow point on the canvas with "provisional" written beside it.
 *
 * ⚠️ AN AGGREGATOR ASK IS NOT A FLOOR. The reader hands over the lowest live
 * listing with `vsMonthly` and per-venue `coverage`; the surface decides. Native
 * venue → a floor. Aggregator venue → a floor only when the ask sits within
 * 0.5×–3× the monthly price (measured: a $1.84 Beezie placeholder on a $53 card
 * is 0.03×). Otherwise the KPI reads "—" and the ask is a receipt line, never a
 * headline.
 */

export const FLOOR_VS_MONTHLY_MIN = 0.5;
export const FLOOR_VS_MONTHLY_MAX = 3;

export function latestCompleteMonthly(monthly: IdentityMonthly[]): IdentityMonthly | null {
  for (let i = monthly.length - 1; i >= 0; i--) if (!monthly[i].partial) return monthly[i];
  return null;
}

export function runningMonthly(monthly: IdentityMonthly[]): IdentityMonthly | null {
  return monthly.find((m) => m.partial) ?? null;
}

export type FloorReading = {
  /** True → print the ask as the Floor KPI's headline. */
  headline: boolean;
  /** The listing venue's coverage. */
  source: "native" | "aggregator";
  /** True when any venue with slabs here has aggregator-sourced listings. */
  anyAggregator: boolean;
};

export function readFloor(floor: IdentityFloor): FloorReading | null {
  if (!floor) return null;
  const source = floor.coverage.find((c) => c.platform === floor.platform)?.source ?? "aggregator";
  const plausible =
    floor.vsMonthly != null && floor.vsMonthly >= FLOOR_VS_MONTHLY_MIN && floor.vsMonthly <= FLOOR_VS_MONTHLY_MAX;
  return {
    headline: source === "native" || plausible,
    source,
    anyAggregator: floor.coverage.some((c) => c.source === "aggregator"),
  };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jun" — the month a month-end stamp belongs to. */
export function monthShort(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : MON[d.getUTCMonth()];
}

/** "Jun 2026". */
export function monthLong(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Sep 6" (UTC). */
export function dayShort(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Sep 6, 2026" (UTC). */
export function dayLong(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function venueName(platform: string): string {
  return PLATFORM_META[platform as CardPlatform]?.label ?? platform;
}

/** "Charizard Ex · PSA 10" — the page's title, the crumb's leaf, the share card. */
export function identityTitle(parts: IdentityDetail["parts"]): string {
  return `${identityDisplayName(parts.name)} · ${parts.grade}`;
}

/**
 * "14 slabs · 3 venues · in the market, Pokémon and PSA 10 indices this month"
 * — from `tokens`, the venues that hold them, and `indexMembership` named by the
 * index naming SSOT. "this month" is the index's month: the latest complete one.
 */
export function membershipLine(d: IdentityDetail): string {
  const venues = new Set(d.tokens.map((t) => t.platform)).size;
  const head = `${d.tokens.length} slab${d.tokens.length === 1 ? "" : "s"} · ${venues} venue${venues === 1 ? "" : "s"}`;
  if (!d.indexMembership.length) return `${head} · in no published index this month`;
  const names = d.indexMembership.map((id) => (id === "market:total" ? "market" : labelFor(id).name));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${head} · in the ${list} ${names.length === 1 ? "index" : "indices"} this month`;
}

/** An ask as written: a placeholder is usually a $1.84, and "$2" would hide
 *  exactly what makes it one. Compact from $100 like every other figure. */
export function askText(p: number): string {
  return p < 100 ? `$${p.toFixed(2)}` : formatCompactUsd(p);
}

/**
 * A slab's cert, or null when what the reader carries is not one.
 *
 * ⚠️ MEASURED 2026-09-14: on Collector Crypt the reader's `cert` is the
 * "Serial Number" trait, which CC uses for the CARD NUMBER ("085" on Pikachu
 * #085, "160" on Full Art Pikachu #160); the PSA cert lives in "Grading ID"
 * (130495647). Beezie's "Serial" is the cert (82002734). Until the reader
 * prefers the grading id, a "cert" equal to the card number is not printed as
 * one — a card number captioned as a cert is a wrong claim on every CC row.
 */
export function slabCert(cert: string | null, number: string | null): string | null {
  if (!cert) return null;
  const norm = (v: string) => v.trim().toLowerCase().replace(/^0+(?=\d)/, "");
  if (number && norm(cert) === norm(number)) return null;
  return cert;
}
