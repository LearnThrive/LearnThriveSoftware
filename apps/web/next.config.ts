import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/securityHeaders";
import { siteConfig } from "./src/lib/site";

const nextConfig: NextConfig = {
  // A second dev server in the same folder (the e2e run for the Library phases) needs its own build folder: Next locks
  // the first. Unset, nothing changes.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
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
