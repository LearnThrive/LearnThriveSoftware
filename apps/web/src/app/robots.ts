import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";

/**
 * Everything public is crawlable; the signed-in app, the API, development tools and the closed-portal
 * notice are not (and the app and API also send `X-Robots-Tag: noindex` from next.config.ts, which
 * holds even for a crawler that ignores this file). /og stays crawlable on purpose: social networks
 * fetch the per-page preview cards from there.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api/", "/dev", "/login", "/403", "/portal-opening-soon"],
    },
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
