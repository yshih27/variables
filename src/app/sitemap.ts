import type { MetadataRoute } from "next";
import { IP_CATALOG } from "@/lib/data/ipCatalog";
import { PLATFORM_SOURCES } from "@/lib/data/sources";
import { GACHA_ENABLED } from "@/lib/flags";

/**
 * Dynamic sitemap. Lists every static page + every known IP detail page
 * + every platform detail page (and their sub-routes). Cards aren't here
 * yet — we'll add /card/[id] entries once that route ships.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tcg.market";
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${baseUrl}/ips`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${baseUrl}/platforms`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    // /gacha omitted while the section is gated — don't index a coming-soon page.
    ...(GACHA_ENABLED
      ? [{ url: `${baseUrl}/gacha`, lastModified: now, changeFrequency: "hourly" as const, priority: 0.9 }]
      : []),
    { url: `${baseUrl}/methodology`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
  ];

  const ipRoutes: MetadataRoute.Sitemap = IP_CATALOG.flatMap((ip) => [
    { url: `${baseUrl}/ip/${ip.key}`, lastModified: now, changeFrequency: "hourly" as const, priority: 0.8 },
    { url: `${baseUrl}/ip/${ip.key}/sets`, lastModified: now, changeFrequency: "hourly" as const, priority: 0.6 },
    { url: `${baseUrl}/ip/${ip.key}/grades`, lastModified: now, changeFrequency: "hourly" as const, priority: 0.6 },
    { url: `${baseUrl}/ip/${ip.key}/cards`, lastModified: now, changeFrequency: "hourly" as const, priority: 0.6 },
  ]);

  const platformRoutes: MetadataRoute.Sitemap = PLATFORM_SOURCES.flatMap((p) => [
    { url: `${baseUrl}/platform/${p.key}`, lastModified: now, changeFrequency: "hourly" as const, priority: 0.8 },
    { url: `${baseUrl}/platform/${p.key}/ips`, lastModified: now, changeFrequency: "hourly" as const, priority: 0.6 },
    { url: `${baseUrl}/platform/${p.key}/cards`, lastModified: now, changeFrequency: "hourly" as const, priority: 0.6 },
    { url: `${baseUrl}/platform/${p.key}/sales`, lastModified: now, changeFrequency: "hourly" as const, priority: 0.6 },
  ]);

  return [...staticRoutes, ...ipRoutes, ...platformRoutes];
}
