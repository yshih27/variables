/**
 * THE PRICE BADGE — an SVG a venue drops in an `<img>` and gets a real number.
 *
 *   <img src="https://varible.rarible.com/api/public/price/pokemon/151/6/charizard-ex/psa-10/badge.svg?size=md">
 *
 * ⚠️ AN EMBED MUST NEVER SHOW AN INVENTED NUMBER. This is the surface with the
 * least context around it — no page, no tooltip, no method line, often on
 * somebody else's site — so every fallback here is a DOWNGRADE, never a
 * substitute: with no monthly price it says so and shows the last SALE with its
 * date; with no sale at all it says "no sale yet" and counts slabs. A floor is
 * never printed (an ask is not a price), and an unknown slug renders nothing at
 * all — the route 404s instead of drawing a blank badge that looks authoritative.
 *
 * ⚠️ SYSTEM FONT STACKS ONLY. An `<img>`-loaded SVG is its own document: it does
 * not inherit the host page's CSS and it cannot fetch an external font (no
 * network, no @font-face that would resolve). A webfont here renders as the
 * fallback anyway, at the wrong width, so the geometry is measured against the
 * stack that actually paints.
 *
 * ⚠️ WIDTHS ARE COMPUTED, NOT GUESSED — AND PER FACE. Nothing can measure text
 * server-side, so the badge grows to fit its own string from an average advance
 * per character. One advance for all three faces was not enough: bold letter-
 * spaced caps, bold monospace digits and regular sans lowercase are three
 * different widths, and a single 0.55em estimate rendered "VARIBLE$43.00· Aug"
 * — the word touching the figure and the separator swallowed. Each face now
 * carries its own advance, biased slightly WIDE on purpose: too wide is a few
 * pixels of black, too narrow is text on top of text.
 */

/** Brand pair, and the only two colours here (src/app/globals.css --color-yellow). */
const LIME = "#bfef01";
const BLACK = "#000000";
const DIM = "#9aa0a6";

import { formatCompactUsd } from "@/lib/format";

export type BadgeSize = "sm" | "md";
export const BADGE_SIZES: readonly BadgeSize[] = ["sm", "md"];

type Metrics = {
  height: number;
  padX: number;
  wordSize: number; // "VARIBLE"
  wordTrack: number; // letter-spacing
  valueSize: number;
  metaSize: number;
  /** Space after the wordmark, and between the figure and its qualifiers. */
  gap: number;
  small: number;
};

/** Advance per character ÷ font size, per face. Biased wide (see the header). */
const ADVANCE = {
  /** Bold caps, letter-spaced — the wordmark. */
  word: 0.68,
  /** Bold monospace — the figure. Most system mono stacks are 0.6em fixed. */
  mono: 0.62,
  /** Regular sans, mixed case — the month, the count, the qualifier. */
  sans: 0.54,
} as const;

const METRICS: Record<BadgeSize, Metrics> = {
  sm: { height: 20, padX: 7, wordSize: 8, wordTrack: 0.6, valueSize: 11, metaSize: 9, gap: 8, small: 5 },
  md: { height: 28, padX: 10, wordSize: 10, wordTrack: 0.8, valueSize: 15, metaSize: 11, gap: 11, small: 7 },
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The figure, spelled exactly as the identity page spells it.
 *
 * ⚠️ NOT A LOCAL COPY OF THE RULE. The badge and the page print the same price;
 * two compact-formatters would eventually print it two ways ("$12.4K" here,
 * "$12,450" there) and the embed would look like a different number from the
 * one the card's own page shows. Under $100 the cents are kept — a $1.84
 * placeholder must not round to "$2", which is the whole reason `askText`
 * exists on the page.
 */
export function badgeUsd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "$0";
  // The site's one compact rule (cents only under a dollar): the badge sits
  // beside the chip and the identity page, which print "$43" — a "$43.00"
  // beside them read as a different number (measured on the sheet, Sep 23).
  return formatCompactUsd(v);
}

/** "Aug" from a "2026-08" month. */
function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return m >= 1 && m <= 12 ? MON[m - 1] : month;
}

/** "Sep 9" (UTC) from an ISO timestamp. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * What the badge says, in the order it is allowed to say it:
 *   price      →  `$323 · Aug · 5 sales`
 *   no price   →  `last sale $255 · Sep 9`
 *   no sale    →  `no sale yet · 14 slabs`
 * `prefix` is the qualifier that must sit BEFORE the figure, so a last sale can
 * never be read as the reference price.
 */
export type BadgeCopy = { prefix: string; value: string; meta: string; kind: "price" | "last-sale" | "none" };

/**
 * The fallback ladder. ONE function so the route, a test and any future surface
 * agree about what a badge with no price is allowed to claim.
 */
export function badgeCopy(p: {
  price: { month: string; priceUsd: number; n: number } | null;
  lastSale: { ts: string; priceUsd: number } | null;
  slabs: number;
}): BadgeCopy {
  if (p.price) {
    return {
      prefix: "",
      value: badgeUsd(p.price.priceUsd),
      meta: `${monthLabel(p.price.month)} · ${p.price.n} sale${p.price.n === 1 ? "" : "s"}`,
      kind: "price",
    };
  }
  if (p.lastSale) {
    return { prefix: "last sale", value: badgeUsd(p.lastSale.priceUsd), meta: dayLabel(p.lastSale.ts), kind: "last-sale" };
  }
  return { prefix: "", value: "no sale yet", meta: `${p.slabs} slab${p.slabs === 1 ? "" : "s"}`, kind: "none" };
}

/**
 * The badge. Deterministic: same payload, same bytes — so a CDN can hold it for
 * the full 30 minutes without two viewers seeing different widths.
 */
export function renderPriceBadge(
  p: { name: string; grade: string; price: { month: string; priceUsd: number; n: number } | null; lastSale: { ts: string; priceUsd: number } | null; slabs: number },
  size: BadgeSize,
): string {
  const m = METRICS[size];
  const copy = badgeCopy(p);
  const word = "VARIBLE";
  const metaText = copy.meta ? `· ${copy.meta}` : "";
  // ⚠️ A FIGURE IS MONO, A STATE IS NOT. "no sale yet" set in the same bold
  // monospace as a price reads as a headline number at a glance, which is the
  // one thing this fallback exists to avoid saying.
  const isFigure = copy.kind !== "none";
  const wordW = word.length * m.wordSize * ADVANCE.word + (word.length - 1) * m.wordTrack;
  const prefixW = copy.prefix.length * m.metaSize * ADVANCE.sans;
  const valueW = copy.value.length * m.valueSize * (isFigure ? ADVANCE.mono : ADVANCE.sans);
  const metaW = metaText.length * m.metaSize * ADVANCE.sans;
  const width = Math.ceil(m.padX * 2 + wordW + m.gap + prefixW + (copy.prefix ? m.small : 0) + valueW + (metaText ? m.small + metaW : 0));
  const mid = m.height / 2;
  const xWord = m.padX;
  const xPrefix = xWord + wordW + m.gap;
  const xValue = xPrefix + (copy.prefix ? prefixW + m.small : 0);
  const xMeta = xValue + valueW + m.small;
  const title = `${p.name} · ${p.grade} — ${copy.prefix ? `${copy.prefix} ` : ""}${copy.value}${copy.meta ? ` · ${copy.meta}` : ""} (Varible)`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${m.height}" viewBox="0 0 ${width} ${m.height}" role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)}</title>`,
    `<rect width="${width}" height="${m.height}" fill="${BLACK}"/>`,
    `<text x="${xWord.toFixed(1)}" y="${mid}" dominant-baseline="central" font-family="${FONT}" font-size="${m.wordSize}" font-weight="700" letter-spacing="${m.wordTrack}" fill="${LIME}">${word}</text>`,
    copy.prefix ? `<text x="${xPrefix.toFixed(1)}" y="${mid}" dominant-baseline="central" font-family="${FONT}" font-size="${m.metaSize}" fill="${DIM}">${esc(copy.prefix)}</text>` : "",
    `<text x="${xValue.toFixed(1)}" y="${mid}" dominant-baseline="central" font-family="${isFigure ? MONO : FONT}" font-size="${isFigure ? m.valueSize : m.metaSize}" font-weight="600" fill="${isFigure ? "#ffffff" : DIM}">${esc(copy.value)}</text>`,
    metaText ? `<text x="${xMeta.toFixed(1)}" y="${mid}" dominant-baseline="central" font-family="${FONT}" font-size="${m.metaSize}" fill="${DIM}">${esc(metaText)}</text>` : "",
    `</svg>`,
  ].join("");
}
