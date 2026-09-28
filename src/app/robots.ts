import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site";

/**
 * robots.txt — what a crawler may fetch, and which crawlers may fetch at all.
 *
 * ⚠️ THIS FILE IS A COST CONTROL AS MUCH AS AN SEO ONE. In September 2026 the
 * project was paused by Vercel for the cycle: ~657K function invocations
 * (≈25K a day, far above human traffic) walked the 55K per-request identity
 * and card pages and blew three Hobby meters at once (Active CPU 10h25m of 4h,
 * Fast Origin Transfer 15 GB of 10, ISR Writes 205K of 200K). Every rule here
 * removes a class of fetch that produced cost and no reader:
 *
 *   · `/api/` and `/status`          — the data routes and the freshness page
 *                                      (never the product; unchanged).
 *   · `/search`                      — per-request, one render per query
 *                                      string; nothing there is not on a page.
 *   · `/vault/`                      — a wallet's statement: `noindex` already,
 *                                      and the one page that must never be an
 *                                      index of who holds what. The door at
 *                                      `/vault` stays crawlable.
 *   · `/alerts`, `/watchlist`        — a reader's own state (a tokenised
 *                                      manage link; a localStorage list).
 *   · `/*?`                          — any query-string variant. The site has
 *                                      no page whose content is keyed on a
 *                                      query string (`/search` is above; the
 *                                      report landings and `?utm_` links are
 *                                      the same page again), so a crawl of
 *                                      them is a duplicate render.
 *
 * The named agents below are BULK crawlers: model-training and AI-index
 * crawlers, and SEO-tool crawlers, which fetch every URL they can find on a
 * schedule of their own and send no reader back. They are told to fetch
 * nothing. The on-demand fetchers that answer one person's question
 * (`ChatGPT-User`, `Claude-User`, `Perplexity-User`) are NOT listed: those
 * arrive once, when someone asks, and denying them denies that person a
 * Varible answer. Search engines proper (Googlebot, Bingbot, DuckDuckBot,
 * Applebot) keep the default rule — bet 4 is built on them.
 *
 * `Crawl-delay` is deliberately absent: Google ignores it and Bing would
 * throttle the very indexing the long tail needs.
 */

/** Model-training and AI-index crawlers, by the user-agent each vendor documents. */
const AI_BULK_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-SearchBot",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "PerplexityBot",
  "Amazonbot",
  "meta-externalagent",
  "FacebookBot",
  "cohere-ai",
  "Diffbot",
  "omgili",
  "omgilibot",
  "YouBot",
  "ImagesiftBot",
  "Ai2Bot",
  "DuckAssistBot",
  "PetalBot",
  "Timpibot",
];

/** SEO-tool crawlers: backlink and rank indexes that walk whole sites. */
const SEO_TOOL_CRAWLERS = ["AhrefsBot", "SemrushBot", "MJ12bot", "DotBot", "BLEXBot", "DataForSeoBot"];

export default function robots(): MetadataRoute.Robots {
  const baseUrl = SITE_ORIGIN;
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/status", "/search", "/vault/", "/alerts", "/watchlist", "/*?"],
      },
      { userAgent: AI_BULK_CRAWLERS, disallow: "/" },
      { userAgent: SEO_TOOL_CRAWLERS, disallow: "/" },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
