/**
 * Image URL normalization + optional proxying.
 *
 * Usage: `<img src={proxyImg(card.image)} alt="" />`
 *
 * Two distinct problems this solves:
 *
 * 1. **Beezie `original-N.jpg` 403s.** The on-chain metadata stores image
 *    URLs like `…/0/original-2.jpg`. Those resolution-variant paths return
 *    HTTP 403 from Beezie's CDN. Only the base `…/0/original.jpg` serves
 *    (200, with `access-control-allow-origin: *` + `content-type:
 *    image/jpeg`). The browser's ORB was blocking the 403 *error* body from
 *    rendering as an image — it was never a CORP problem. So we just rewrite
 *    the URL to the working variant and serve it DIRECTLY (no proxy hop —
 *    the corrected URL already allows cross-origin embedding).
 *
 * 2. **Genuinely CORP-blocked hosts.** For any host that really does send a
 *    restrictive `Cross-Origin-Resource-Policy`, route through `/api/img`
 *    (see PROXY_HOSTS). None today, but the mechanism is here.
 *
 * - Leaves null / undefined / data: URLs and same-origin paths alone.
 */

/**
 * Hosts that must be routed through the /api/img proxy.
 * Arweave serves NFT art as `application/octet-stream` (often after a 302
 * from the apex to a `<hash>.arweave.net` sandbox) — the browser's ORB then
 * blocks it. The proxy follows the redirect, sniffs the real image type, and
 * re-serves with proper headers.
 */
const PROXY_HOSTS = new Set<string>([
  "arweave.net",
]);

/** Hosts proxied by domain suffix (covers unbounded subdomains). */
const PROXY_SUFFIXES = [".arweave.net"];

function needsProxy(hostname: string): boolean {
  if (PROXY_HOSTS.has(hostname)) return true;
  return PROXY_SUFFIXES.some((sfx) => hostname.endsWith(sfx));
}

/** Strip the resolution-variant suffix from a Beezie image path. */
function normalizeBeezieUrl(src: string): string {
  // …/0/original-2.jpg → …/0/original.jpg  (and -1, -3, etc.)
  return src.replace(/\/original-\d+\.(jpe?g|png|webp|avif)(\?|$)/i, "/original.$1$2");
}

export function proxyImg(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  if (src.startsWith("data:") || src.startsWith("/")) return src;

  let u: URL;
  try {
    u = new URL(src);
  } catch {
    // Not a parseable URL — hand back as-is and let the browser try.
    return src;
  }

  // Fix 1: Beezie resolution-variant 403s.
  if (u.hostname === "images.beezie.com") {
    return normalizeBeezieUrl(src);
  }

  // Fix 2: route ORB-blocked hosts (raw arweave, etc.) through the proxy.
  if (needsProxy(u.hostname)) {
    return `/api/img?url=${encodeURIComponent(src)}`;
  }

  return src;
}
