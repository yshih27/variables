/**
 * An alert, in words — ONE renderer behind the email digest and the Telegram
 * message, so the two channels cannot say different things.
 *
 * ⚠️ FIGURES ONLY FROM THE PAYLOAD, EACH WITH ITS WINDOW AND SOURCE. Nothing
 * here computes a figure: every price, ratio, percentage and date printed is a
 * field of the event's payload, formatted (render.test.ts asserts it on the
 * rendered text). A receipt line, never a banner.
 *
 * ⚠️ BEEZIE'S MACHINE IS "THE CLAW". A Beezie line never says gacha; an IP's
 * volume line says it is resale only (packs carry no IP).
 */
import { formatCompactUsd } from "@/lib/format";
import { askText, dayShort, monthLong, venueName } from "@/lib/card/identityView";
import type { AlertEvent, Digest, FiredEvent } from "./signals";

/** "12.4%" with its direction as a word-free arrow. */
export const pctText = (p: number) => `${p >= 0 ? "▲" : "▼"} ${Math.abs(p).toFixed(1)}%`;
/** A threshold as written: "$1,000". */
export const thresholdUsd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
/** "3.2×" */
export const multipleText = (m: number) => `${m.toFixed(1)}×`;
/** "Sep 24, 06:00 UTC" */
export function dayTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${dayShort(iso)}, ${d.toISOString().slice(11, 16)} UTC`;
}
const referenceText = (r: { priceUsd: number; month: string; n?: number }) =>
  `${askText(r.priceUsd)} reference (${monthLong(r.month)}${r.n != null ? `, ${r.n} sales` : ""})`;

/** The pack-spend word for a venue: Beezie's machine is the Claw. */
export const packWord = (platformKey: string) => (platformKey === "beezie" ? "the Claw" : "gacha");

/** One event → one line of plain text. */
export function eventLine(e: AlertEvent): string {
  const label = e.entity.label;
  switch (e.kind) {
    case "floor": {
      const p = e.payload;
      const ref = p.reference ? ` Against a ${referenceText(p.reference)}.` : "";
      const src = ` Cheapest plausible ask, listings as of ${dayTime(p.source.listingsAsOf)}.`;
      if (p.change === "moved" && p.from && p.to && p.pct != null)
        return `${label}: floor ${pctText(p.pct)} to ${askText(p.to.priceUsd)} on ${venueName(p.to.venue)} (was ${askText(p.from.priceUsd)} on ${venueName(p.from.venue)}, ${dayShort(p.from.at)}).${ref}${src}`;
      if (p.change === "appeared" && p.to)
        return `${label}: a floor appeared at ${askText(p.to.priceUsd)} on ${venueName(p.to.venue)}.${ref}${src}`;
      if (p.change === "disappeared" && p.from)
        return `${label}: no plausible ask left (the floor was ${askText(p.from.priceUsd)} on ${venueName(p.from.venue)}, ${dayShort(p.from.at)}).${ref}${src}`;
      return `${label}: floor changed.${src}`;
    }
    case "volume": {
      const p = e.payload;
      const split =
        p.packsUsd == null
          ? "resale only; packs carry no IP"
          : `resale ${formatCompactUsd(p.resaleUsd)}, ${packWord(e.entity.key)} ${formatCompactUsd(p.packsUsd)}`;
      return (
        `${label}: ${formatCompactUsd(p.totalUsd)} on ${dayShort(p.day)} UTC, ${multipleText(p.multiple)} the ${formatCompactUsd(p.meanUsd)} daily mean of ` +
        `${dayShort(p.window.from)} to ${dayShort(p.window.to)} (${split}). Source-complete days, Varible spine.`
      );
    }
    case "clear": {
      const p = e.payload;
      const more = p.more ? ` Plus ${p.more} more.` : "";
      const src = ` Secondary-sales store as of ${dayTime(p.source.storeAsOf)}.`;
      if (p.rule.kind === "reference") {
        const rule = p.rule;
        const sales = p.sales
          .map((s, i) => `${askText(s.priceUsd)} on ${venueName(s.venue)}, ${dayTime(s.ts)} (${multipleText(p.multiples![i])} the reference)`)
          .join("; ");
        return `${label}: sold for ${sales}. Against a ${referenceText(rule.reference)}.${more}${src}`;
      }
      const sales = p.sales.map((s) => `${s.name ?? s.cardId} for ${askText(s.priceUsd)} on ${venueName(s.venue)}, ${dayTime(s.ts)}`).join("; ");
      return `${label}: ${sales}. Sales at or above ${thresholdUsd(p.rule.minUsd)}.${more}${src}`;
    }
    case "listing": {
      const p = e.payload;
      const basis =
        p.basis?.kind === "reference"
          ? `the ${askText(p.basis.priceUsd)} reference (${monthLong(p.basis.month)})`
          : p.basis?.kind === "last-sale"
            ? `the ${askText(p.basis.priceUsd)} last sale (${dayShort(p.basis.ts)})`
            : null;
      const asks = p.listings
        .map((l) =>
          l.plausible && l.vsReference != null && basis
            ? `${askText(l.priceUsd)} on ${venueName(l.venue)}, ${l.vsReference.toFixed(2)}× ${basis}`
            : basis
              ? `an unverified ask of ${askText(l.priceUsd)} on ${venueName(l.venue)}, outside the page's band around ${basis}`
              : `an unverified ask of ${askText(l.priceUsd)} on ${venueName(l.venue)}, with no reference to judge it by`,
        )
        .join("; ");
      const n = p.listings.length;
      return `${label}: ${n} new listing${n === 1 ? "" : "s"}: ${asks}. Listings as of ${dayTime(p.source.listingsAsOf)}.`;
    }
  }
}

/** The short form of an event, for a subject line. */
export function eventHeadline(e: AlertEvent): string {
  const label = e.entity.label;
  switch (e.kind) {
    case "floor":
      return e.payload.change === "moved" && e.payload.pct != null
        ? `${label} floor ${pctText(e.payload.pct)}`
        : e.payload.change === "appeared"
          ? `${label} has a floor again`
          : `${label} has no plausible ask`;
    case "volume":
      return `${label} volume ${multipleText(e.payload.multiple)} its daily mean`;
    case "clear":
      return `${label} sale at ${askText(e.payload.sales[0].priceUsd)}`;
    case "listing":
      return `${label} new listing${e.payload.listings.length === 1 ? "" : "s"}`;
  }
}

/** "3 alerts: Beezie volume 2.4× its daily mean" — the count and the biggest move. */
export function digestSubject(d: Digest): string {
  const n = d.events.length;
  return `${n} alert${n === 1 ? "" : "s"}: ${eventHeadline(d.events[0])}`;
}

/** The digest as plain text — the Telegram message and the email's text part. */
export function digestText(d: Digest, links: { hrefOf: (e: FiredEvent) => string; manageUrl: string }): string {
  return (
    `${digestSubject(d)}\n\n` +
    d.events.map((e) => `• ${eventLine(e)}\n  ${links.hrefOf(e)}`).join("\n\n") +
    `\n\nManage alerts: ${links.manageUrl}`
  );
}
