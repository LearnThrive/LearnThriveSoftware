import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            // plan13.md task 11.7: camera=()/microphone=() (empty allowlist) denies the feature to
            // every context, including this site's own top-level pages — not just third-party
            // embeds. That would break the in-app classroom fallback
            // ((classroom)/dashboard/lessons/[id]/classroom, rendered whenever
            // NEXT_PUBLIC_CLASSROOM_URL isn't set to a real external deployment), which calls
            // getUserMedia directly (features/classroom/media.ts). (self) keeps the actual
            // protection — no other origin, and no iframe without an explicit allow attribute,
            // gets camera/mic — while letting this site's own pages that need it keep working.
            // geolocation is never used anywhere in this app, so it stays fully denied.
            key: "Permissions-Policy",
            value: "camera=(self), geolocation=(), microphone=(self)",
          },
        ],
      },
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
    ];
  },
};

export default nextConfig;
