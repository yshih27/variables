import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tcg.market";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Don't crawl the image proxy, internal API routes, or the data-status page.
        disallow: ["/api/", "/status"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
