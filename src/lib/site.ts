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
 * ⚠️ The fallback is the LIVE domain and must stay that way. It used to read
 * variable.rarible.com (with the second "a") on the reasoning that varible's DNS
 * wasn't up yet. The flip happened, that host went NXDOMAIN, and because
 * NEXT_PUBLIC_SITE_ORIGIN was never set in prod this fallback was the value in
 * use — so every sitemap loc, the robots Host and every og:image pointed at a
 * dead domain. A fallback isn't dead code; it IS production until the env says
 * otherwise. Setting NEXT_PUBLIC_SITE_ORIGIN remains the primary fix.
 */
const FALLBACK_ORIGIN = "https://varible.rarible.com";

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

/**
 * The project's official X (Twitter) account — one definition so the report CTA
 * and the footer nav link stay in lockstep. Confirmed handle; replaces the
 * earlier `/variable` stub.
 */
export const X_URL = "https://x.com/varibletrends";
