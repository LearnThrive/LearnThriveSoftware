import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LearnThrive Tuition",
    short_name: "LearnThrive",
    description:
      "Personalised online tuition in Maths, English and Science, plus 11+ preparation.",
    start_url: "/",
    display: "standalone",
    background_color: "#fbf8f2",
    theme_color: "#0e2a47",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
