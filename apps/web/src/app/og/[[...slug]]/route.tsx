import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/site";
import { ogPageFor, ogPages } from "@/lib/ogPages";

/**
 * Per-page Open Graph / social-preview images (plan15 Wave 10 section 14.4): a brand card — navy field,
 * a mint rule, the page's own eyebrow and title, the wordmark — replacing the single static
 * og-image.png. One route handler for every public page, statically generated at build time from the
 * same table (lib/ogPages.ts) the sitemap-style listing uses, so a new page that is added to the table
 * gets a card and one that is not falls back to the home card instead of a 404.
 *
 * It uses `next/og`'s built-in sans-serif: satori (the renderer) accepts only TTF/OTF/WOFF, and the
 * site's own fonts ship as WOFF2 through next/font. Shipping a TTF of the heading face for this one
 * purpose is a possible later refinement; the card is deliberately simple so that it reads well in the
 * default face. The OG image is always the light/brand look, in both themes.
 */
export const dynamic = "force-static";

export function generateStaticParams() {
  return [{ slug: [] as string[] }, ...Object.keys(ogPages).filter((p) => p !== "/").map((p) => ({ slug: p.split("/").filter(Boolean) }))];
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  const page = ogPageFor(`/${slug.join("/")}`);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #0e2a47 0%, #0a1f36 70%, #075345 130%)",
          color: "#f2f7fa",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 56, height: 6, borderRadius: 3, background: "#8ed2ad" }} />
          <div style={{ fontSize: 26, letterSpacing: 4, textTransform: "uppercase", color: "#8ed2ad" }}>{page.eyebrow}</div>
        </div>
        <div style={{ display: "flex", fontSize: page.title.length > 34 ? 72 : 88, lineHeight: 1.05, letterSpacing: -2, maxWidth: 1000 }}>
          {page.title}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, fontSize: 40 }}>
          <div style={{ display: "flex" }}>
            <span style={{ color: "#f2f7fa" }}>Learn</span>
            <span style={{ color: "#8ed2ad" }}>Thrive</span>
          </div>
          <span style={{ fontSize: 22, letterSpacing: 6, textTransform: "uppercase", color: "rgba(242,247,250,0.7)" }}>Tuition</span>
          <span style={{ marginLeft: "auto", fontSize: 24, color: "rgba(242,247,250,0.7)" }}>{siteConfig.url.replace("https://", "")}</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
