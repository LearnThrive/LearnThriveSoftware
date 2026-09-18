import type { MetadataRoute } from "next";
import { siteConfig, subjects } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
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
    "/safeguarding",
  ];

  return routes.map((route) => ({
    url: `${siteConfig.url}${route}`,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route === "/book" ? 0.9 : 0.8,
  }));
}
