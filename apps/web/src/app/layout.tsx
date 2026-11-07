import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { siteConfig } from "@/lib/site";
import { THEME_COLOURS, THEME_INIT_SCRIPT, THEMES_ENABLED } from "@/lib/theme";
import { JsonLd } from "@/components/seo/JsonLd";
import { webSiteData } from "@/lib/structuredData";
import "./globals.css";
import "./tokens.css";
import "./app-shell.css";
import "./app-components.css";
import "./app-dashboard.css";
import "./app-auth.css";

// ── Fonts: served from this repo, never from Google ──────────────────────────────────────────
// These were `next/font/google` until a main e2e run (2026-11-03) died before the first test:
// `next dev` could not compile this file at all, reporting "next/font/google queries have
// exactly one entry" and "Can't resolve '@vercel/turbopack-next/internal/font/google/font'".
// next/font/google self-hosts the files it serves to the browser, but it *downloads* them from
// fonts.googleapis.com/fonts.gstatic.com on every dev compile and every `next build` (see
// node_modules/next/dist/compiled/@next/font/dist/google/fetch-resource.js), so a Google blip or
// a slow DNS answer is a build failure. The nine .woff2 files in ./fonts remove that dependency:
// no network call at build time or at runtime.
//
// Each file is a complete face, fetched from Google's css2 API with a pre-unicode-range user
// agent, so one file per weight carries every glyph instead of being split into per-subset
// slices. Checked with fontTools against the per-subset files Google serves a modern browser:
// nothing is lost (Bricolage/Public Sans gain 52-71 codepoints, Plex Mono 254), and Plex Mono
// keeps its Cyrillic.
//
// One `src` entry per weight, matching the discrete weights the old setup declared. That keeps
// rendering identical: Google returned ONE variable file for a multi-weight query but still
// declared discrete `font-weight: 600/700/800` faces, so a CSS `font-weight: 650` (this codebase
// uses 650, 750, 620, 730, 720, 560, 550, 450) snapped to a declared step then and snaps now.
// Shipping the variable fonts instead would be fewer bytes but would silently restyle every one
// of those intermediate weights, so it is left as a separate, visually-reviewed change.
//
// What is preloaded, and why. `preload` on next/font/local is one boolean per loader call, applied
// to every file in that call (next/dist/compiled/@next/font/dist/local/loader.js passes the single
// `preload` flag to emitFontFile for each src entry), so the choice is per family, not per weight.
// Measured, with every face declared and nothing preloaded, on /, /about, /contact, /faq, /privacy
// and /subjects: all four Public Sans weights are used by every one of those routes; Bricolage uses
// 700 and 800 but never 600; Plex Mono uses 400 everywhere and 500 only where a palette-style label
// appears. The old next/font/google setup preloaded 85.9 KB (its four latin files). So:
//   Public Sans  preload -> 89.7 KB, 4 files, all four used on every route measured: no waste, and
//                           the critical path stays the size it already was. It is the body text,
//                           so it covers the most pixels on the page.
//   Bricolage    lazy    -> preloading it would cost 100.4 KB for 2 files of 3 actually used.
//   Plex Mono    lazy    -> 75.3 KB for 1 file of 2 actually used, for small eyebrow/label text.
// Preloading all nine would be 263.6 KB, triple the old budget, ~73 KB of it never used on a
// typical route. The two lazy families still paint immediately: `display: swap` plus the
// size-adjust fallback face next/font generates (the `-s` files in the build) means text shows at
// corrected metrics straight away and swaps with little shift, never invisible.

const bricolage = localFont({
  src: [
    { path: "./fonts/BricolageGrotesque-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/BricolageGrotesque-Bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/BricolageGrotesque-ExtraBold.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-bricolage",
  display: "swap",
  preload: false,
});

const publicSans = localFont({
  src: [
    { path: "./fonts/PublicSans-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/PublicSans-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/PublicSans-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/PublicSans-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-public-sans",
  display: "swap",
  preload: true,
});

const ibmPlexMono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexMono-Medium.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-ibm-plex-mono",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: "Personalised Online Tuition | LearnThrive Tuition",
    template: "%s | LearnThrive Tuition",
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  category: "education",
  creator: siteConfig.name,
  publisher: siteConfig.name,
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  // Icons come from the file conventions in this folder (icon.svg, favicon.ico, apple-icon.png), all
  // generated from the vector mark by scripts/make-icons.mjs.
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // One theme-color per scheme (plan15 Wave 3): the browser's own chrome follows the OS scheme.
  // Without the themes flag there is only the light site, so only the light colour.
  themeColor: THEMES_ENABLED
    ? [
        { media: "(prefers-color-scheme: light)", color: THEME_COLOURS.light },
        { media: "(prefers-color-scheme: dark)", color: THEME_COLOURS.dark },
      ]
    : THEME_COLOURS.light,
  // Lets the browser paint native UI (scrollbars, form controls, the canvas behind the page) in
  // the visitor's scheme from the first byte, before any stylesheet loads.
  colorScheme: THEMES_ENABLED ? "light dark" : "light",
};

const organisationData = {
  "@context": "https://schema.org",
  "@type": "EducationalOrganization",
  name: siteConfig.name,
  url: siteConfig.url,
  logo: `${siteConfig.url}/icons/icon-512.png`,
  description: siteConfig.description,
  email: siteConfig.email,
  telephone: siteConfig.phoneContacts.map((contact) => contact.phoneHref),
  sameAs: [siteConfig.social.instagram, siteConfig.social.linkedin],
  contactPoint: siteConfig.phoneContacts.map((contact) => ({
    "@type": "ContactPoint",
    name: contact.name,
    telephone: contact.phoneHref,
    email: siteConfig.email,
    contactType: "customer enquiries",
    availableLanguage: "English",
  })),
};

// Deliberately only the document shell: fonts, global styles, structured data. The two product
// surfaces own their own chrome — marketing pages get PublicShell via the (public) route group,
// authenticated pages get AppShell via (app). Putting SiteHeader/SiteFooter here (as this file
// used to) is what made every dashboard page render the public marketing navbar above it.
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // data-scroll-behavior tells Next.js this document really does opt into `scroll-behavior:
  // smooth` (globals.css, for the marketing pages' in-page anchor links) so it can suspend it for
  // the duration of a route change and restore it afterwards. Without the attribute Next leaves
  // it alone and warns: every dashboard navigation then animated its scroll-to-top, so the new
  // page visibly slid up from wherever the previous one had been scrolled to.
  return (
    <html
      lang="en-GB"
      data-scroll-behavior="smooth"
      data-themes={THEMES_ENABLED ? "on" : undefined}
      // The init script below sets data-theme before React hydrates; React must keep what the DOM
      // says rather than flag it (see node_modules/next/dist/docs/01-app/02-guides/
      // preventing-flash-before-hydration.md). On <html> only.
      suppressHydrationWarning
      className={`${bricolage.variable} ${publicSans.variable} ${ibmPlexMono.variable}`}
    >
      {/* The pre-paint preference script: theme (a no-op unless the themes are on) and motion. */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {children}
        <JsonLd data={webSiteData()} />
        <Script
          id="learnthrive-organisation-data"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organisationData).replace(/</g, "\\u003c"),
          }}
        />
      </body>
    </html>
  );
}
