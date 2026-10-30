import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/securityHeaders";
import { siteConfig } from "./src/lib/site";

const nextConfig: NextConfig = {
  // A second dev server in the same folder (the e2e run for the Library phases) needs its own build folder: Next locks
  // the first. Unset, nothing changes.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // LearnThrive AI's document reader: a native module (@napi-rs/canvas loads a platform binary) and pdf.js, which loads its own worker
  // and font data at run time. Bundling breaks both, so the server requires them from node_modules as they are.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "jpeg-js", "pngjs"],
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders({
          production: process.env.NODE_ENV === "production",
          classroomUrl: process.env.NEXT_PUBLIC_CLASSROOM_URL,
          cspReportOnly: process.env.CSP_REPORT_ONLY === "1",
          // Read when the server starts: hosted Stripe pages are form targets only while subscriptions are on.
          billing: process.env.LIBRARY_PHASE?.trim().toLowerCase() === "live",
        }),
      },
      // The signed-in app and the API are never search results, whatever the portal flag says.
      ...["/login", "/403", "/account/:path*", "/dashboard/:path*", "/api/:path*"].map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
    ];
  },
  async redirects() {
    return [
      {
        source: "/our-tutors",
        destination: "/about",
        permanent: true,
      },
      {
        source: "/ourTutors",
        destination: "/about",
        permanent: true,
      },
      // LearnThrive AI used to live at /library/study-buddy; keep old links and bookmarks working.
      {
        source: "/library/study-buddy",
        destination: "/library/ai",
        permanent: true,
      },
      // One canonical host: the bare domain goes to www (siteConfig.url), path and query kept.
      {
        source: "/:path*",
        has: [{ type: "host" as const, value: new URL(siteConfig.url).hostname.replace(/^www\./, "") }],
        destination: `${siteConfig.url}/:path*`,
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
