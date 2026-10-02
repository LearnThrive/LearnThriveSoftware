import type { Metadata } from "next";
import { ogImagePath } from "@/lib/ogPages";
import { siteConfig } from "@/lib/site";

type PageMetadata = {
  title: string;
  description: string;
  path: string;
};

export function createMetadata({
  title,
  description,
  path,
}: PageMetadata): Metadata {
  const canonical = path === "/" ? siteConfig.url : `${siteConfig.url}${path}`;
  // A per-page brand card (app/og/[[...slug]]/route.tsx) rather than one shared image.
  const image = ogImagePath(path);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: siteConfig.name,
      type: "website",
      locale: "en_GB",
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: `${title} — ${siteConfig.name}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
