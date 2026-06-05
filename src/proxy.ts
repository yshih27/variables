import { NextResponse, type NextRequest } from "next/server";
import {
  isValidIpKey,
  isValidPlatformKey,
  isValidCardId,
} from "@/lib/data/validKeys";

/**
 * Why this file exists — fixing soft 404s.
 *
 * The dynamic detail pages (`/ip/[key]`, `/platform/[key]`, `/card/[id]`) call
 * `notFound()` for unknown keys, but they only do so AFTER awaiting their data.
 * Because the app has a global `app/loading.tsx`, that data fetch suspends under
 * a Suspense boundary, which commits a streamed `200 OK` before `notFound()`
 * ever runs. Per Next's "The HTTP contract" (streaming docs), the status can't
 * be changed once streaming starts — so the page renders the not-found UI but
 * with a (wrong) 200 status: a soft 404, bad for SEO/crawlers.
 *
 * `proxy` runs BEFORE rendering, so it can still set a real status. For keys we
 * can cheaply prove are invalid, we rewrite to an unmatched path. Next then
 * serves its genuine 404 (the root `app/not-found.tsx`, which is synchronous and
 * therefore non-streamed → a real `404`). The user keeps the original URL and
 * sees the same on-brand not-found UI — now with the correct status.
 *
 * This leaves `loading.tsx` untouched, so valid pages keep their skeleton.
 */

// Any path with no matching route → Next renders not-found.tsx with a 404.
const NOT_FOUND_PATH = "/_not-found-fallback";

function isInvalidDetailPath(pathname: string): boolean {
  const [root, key] = pathname.split("/").filter(Boolean);
  if (!key) return false; // bare /ip, /platform, /card — let routing decide
  switch (root) {
    case "card":
      return !isValidCardId(key);
    case "ip":
      return !isValidIpKey(key);
    case "platform":
      return !isValidPlatformKey(key);
    default:
      return false;
  }
}

export function proxy(request: NextRequest): NextResponse {
  if (isInvalidDetailPath(request.nextUrl.pathname)) {
    return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Only the dynamic detail routes (and their sub-pages). Note `/ip/:path+`
  // does NOT match the list pages `/ips` or `/platforms`.
  matcher: ["/ip/:path+", "/platform/:path+", "/card/:path+"],
};
