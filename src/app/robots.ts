import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = SITE_ORIGIN;
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
