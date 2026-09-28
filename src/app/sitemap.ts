import type { MetadataRoute } from "next";
import { IP_CATALOG } from "@/lib/data/ipCatalog";
import { PLATFORM_SOURCES } from "@/lib/data/sources";
import { GACHA_ENABLED } from "@/lib/flags";
import { SITE_ORIGIN } from "@/lib/site";

/**
 * The sitemap: every static page, every IP page and its sub-pages, every
 * platform page and its sub-pages. Identity, character, set and grade pages
 * (the long tail, ~55K URLs) are bet 4's sitemap index, split by
 * `generateSitemaps`, not this file.
 *
 * ⚠️ NO `lastModified`. It used to be stamped `new Date()` on every entry at
 * every fetch — a claim that every page changed since the crawler's last
 * visit, which is false and which invites a full recrawl each time the sitemap
 * is read. A date this file cannot defend from data is left out; the
 * `changeFrequency` is the honest statement (the pages are re-warmed on a
 * 30-minute to 6-hour cadence).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = SITE_ORIGIN;

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, changeFrequency: "hourly", priority: 1 },
    { url: `${baseUrl}/ips`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${baseUrl}/platforms`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${baseUrl}/stats`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${baseUrl}/economics`, changeFrequency: "hourly", priority: 0.9 },
    // /gacha omitted while the section is gated — don't index a coming-soon page.
    ...(GACHA_ENABLED
      ? [{ url: `${baseUrl}/gacha`, changeFrequency: "hourly" as const, priority: 0.9 }]
      : []),
    { url: `${baseUrl}/methodology`, changeFrequency: "monthly", priority: 0.4 },
  ];

  const ipRoutes: MetadataRoute.Sitemap = IP_CATALOG.flatMap((ip) => [
    { url: `${baseUrl}/ip/${ip.key}`, changeFrequency: "hourly" as const, priority: 0.8 },
    { url: `${baseUrl}/ip/${ip.key}/sets`, changeFrequency: "hourly" as const, priority: 0.6 },
    { url: `${baseUrl}/ip/${ip.key}/grades`, changeFrequency: "hourly" as const, priority: 0.6 },
    { url: `${baseUrl}/ip/${ip.key}/cards`, changeFrequency: "hourly" as const, priority: 0.6 },
  ]);

  const platformRoutes: MetadataRoute.Sitemap = PLATFORM_SOURCES.flatMap((p) => [
    { url: `${baseUrl}/platform/${p.key}`, changeFrequency: "hourly" as const, priority: 0.8 },
    { url: `${baseUrl}/platform/${p.key}/ips`, changeFrequency: "hourly" as const, priority: 0.6 },
    { url: `${baseUrl}/platform/${p.key}/cards`, changeFrequency: "hourly" as const, priority: 0.6 },
    { url: `${baseUrl}/platform/${p.key}/sales`, changeFrequency: "hourly" as const, priority: 0.6 },
  ]);

  return [...staticRoutes, ...ipRoutes, ...platformRoutes];
}
