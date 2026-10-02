import type { MetadataRoute } from "next";
import { siteConfig, subjects } from "@/lib/site";

// Every indexable public page. A new public route belongs here and in lib/ogPages.ts; tests/site.test.mjs
// fails if a (public) page folder is missing from this list.
const sitemapRoutes = [
  "",
  "/about",
  "/subjects",
  ...subjects.map((subject) => subject.path),
  "/book",
  "/contact",
  "/faq",
  "/privacy",
  "/cookies",
  "/terms",
  "/tuition-terms",
  "/safeguarding",
  "/trust",
  "/complaints",
  "/accessibility",
];

export default function sitemap(): MetadataRoute.Sitemap {
  // Static: evaluated at build time, so `lastModified` is the date of the deploy that last changed
  // the site, not the date of the request.
  const lastModified = new Date();
  return sitemapRoutes.map((route) => ({
    url: `${siteConfig.url}${route}`,
    lastModified,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route === "/book" ? 0.9 : 0.8,
  }));
}
