/**
 * NOTHING, DELIBERATELY — the loading state for `/embed/*`.
 *
 * ⚠️ AN EMBED MUST NOT FLASH SOMEBODY ELSE'S SKELETON. Without this, the root
 * `loading.tsx` streams the site's own page skeleton — a nav bar and a
 * 1760px-wide grid of pulsing blocks — into a 420×120 iframe on a venue's
 * listing page while the data resolves. The chip is a fixed box that must be
 * right at rest: an empty frame for the moment before it, then the numbers, and
 * no layout shift either way.
 *
 * The root skeleton stays exactly as it is for every page a reader visits
 * directly; this only bares the routes that render inside someone else's page.
 */
export default function EmbedLoading() {
  return null;
}
