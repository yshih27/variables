import { SITE_ORIGIN } from "@/lib/site";
import { identityHref } from "@/lib/card/identity";
import { CHIP_BOX, type ChipSize, type ChipTheme } from "@/components/price/PriceChip";

/**
 * THE SNIPPETS A VENUE PASTES — built in one place, from the canonical slug.
 *
 * ⚠️ ATTRIBUTION IS PART OF THE SNIPPET, NOT AN OPTION. The badge ships wrapped
 * in a link to the card's page and the chip carries its own `Varible ↗` mark;
 * neither is something a venue has to remember to add, because a number with no
 * way back to its method is a number nobody can check.
 *
 * ⚠️ ALWAYS THE CANONICAL SLUG. The sheet is handed `canonicalSlug` from the
 * price payload, so a reader who arrived on a v4.1 URL still copies the card's
 * one URL — an embed that pinned an old form would be a second URL for one card
 * living on someone else's page for years.
 */

/**
 * ⚠️ THE SNIPPET IS ABSOLUTE, THE PREVIEW IS RELATIVE. A venue pastes the
 * snippet onto its own site, so its URL must name this site in full; the
 * preview renders inside this page, so it loads from the origin the reader is
 * actually on — otherwise a staging or preview deploy shows a broken image and
 * a blank frame while the copied snippet is perfectly correct.
 */
export type ChipSnippets = {
  /** The chip in an iframe, sized to its box. */
  iframe: string;
  /** The badge as an `<img>`, wrapped in the attribution link. */
  badge: string;
  /** The key-free JSON endpoint. */
  api: string;
  /** Where each preview loads from. */
  chipUrl: string;
  badgeUrl: string;
  pageUrl: string;
};

export function chipEmbedPath(slug: string, size: ChipSize, theme: ChipTheme): string {
  const q = new URLSearchParams({ size, ...(theme === "light" ? { theme } : {}) });
  return `/embed/price/${slug}?${q.toString()}`;
}
export const chipEmbedUrl = (slug: string, size: ChipSize, theme: ChipTheme): string =>
  `${SITE_ORIGIN}${chipEmbedPath(slug, size, theme)}`;

export const badgePath = (slug: string, size: ChipSize): string => `/api/public/price/${slug}/badge.svg?size=${size}`;
export const badgeUrl = (slug: string, size: ChipSize): string => `${SITE_ORIGIN}${badgePath(slug, size)}`;

export const priceApiPath = (slug: string): string => `/api/public/price/${slug}`;
export const priceApiUrl = (slug: string): string => `${SITE_ORIGIN}${priceApiPath(slug)}`;

export function chipSnippets(slug: string, size: ChipSize, theme: ChipTheme): ChipSnippets {
  const box = CHIP_BOX[size];
  const chipUrl = chipEmbedUrl(slug, size, theme); // absolute, for the snippet
  const pageUrl = `${SITE_ORIGIN}${identityHref(slug)}`;
  return {
    // The previews load from THIS origin; the snippets name the site in full.
    chipUrl: chipEmbedPath(slug, size, theme),
    badgeUrl: badgePath(slug, size),
    pageUrl,
    iframe:
      `<iframe src="${chipUrl}"\n  width="${box.w}" height="${box.h}" frameborder="0" loading="lazy"\n  title="Varible price"></iframe>`,
    badge: `<a href="${pageUrl}"><img src="${badgeUrl(slug, size)}" alt="Varible price" height="${size === "sm" ? 20 : 28}"></a>`,
    api: priceApiUrl(slug),
  };
}
