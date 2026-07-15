/**
 * The site's public origin — ONE definition, consumed by every surface that has
 * to emit an absolute URL: the sitemap, robots, `metadataBase` (which is what
 * makes the per-route OG images resolve absolutely), the API v1 attribution, and
 * the report / confirm / unsubscribe links in outbound email.
 *
 * It used to be `process.env.NEXT_PUBLIC_SITE_URL ?? "https://tcg.market"`,
 * copy-pasted into four files. Moving the domain meant finding all four.
 * Now it's this constant, and the move is a one-line env change.
 *
 * ⚠️ TWO env names are read on purpose. `NEXT_PUBLIC_SITE_ORIGIN` is the name
 * going forward; `NEXT_PUBLIC_SITE_URL` is the one the deploy may already have
 * set, and it is honored so that renaming the variable cannot silently break
 * live unsubscribe links (a List-Unsubscribe that 404s is a compliance problem,
 * not a cosmetic one). Drop the legacy read once the deploy env is confirmed to
 * carry the new name.
 *
 * ⚠️ The value is deliberately NOT flipped to varible.rarible.com — that DNS
 * isn't live. When it is, set NEXT_PUBLIC_SITE_ORIGIN and change nothing here.
 */
const FALLBACK_ORIGIN = "https://variable.rarible.com";

/** Strip any trailing slash so `${SITE_ORIGIN}/report` can't become `//report`. */
function normalizeOrigin(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : FALLBACK_ORIGIN;
}

export const SITE_ORIGIN = normalizeOrigin(
  process.env.NEXT_PUBLIC_SITE_ORIGIN ?? process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK_ORIGIN,
);

/** Absolute URL for a site-relative path, e.g. siteUrl("/report"). */
export function siteUrl(path: string): string {
  return `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}
