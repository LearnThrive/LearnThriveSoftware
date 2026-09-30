import type { Preview } from "@storybook/nextjs-vite";
import { useEffect } from "react";
import { Bricolage_Grotesque, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "../src/app/globals.css";
import "../src/app/app-shell.css";
import "../src/app/app-components.css";
import "../src/app/app-dashboard.css";
import "../src/app/app-auth.css";
import "./preview.css";

// Same three fonts, same weights/variable names as src/app/layout.tsx.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-public-sans",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

const FONT_CLASS = `${bricolage.variable} ${publicSans.variable} ${ibmPlexMono.variable}`;

/**
 * globals.css defines `--font-sans: var(--font-public-sans), …` on `:root`, so that declaration
 * needs `--font-public-sans`/`--font-bricolage`/`--font-ibm-plex-mono` visible on `:root` itself
 * to resolve — a custom property is computed once, at the element where its OWNING rule matches,
 * using only what's visible on that exact element; a descendant redeclaring the variables it
 * references doesn't make an ancestor's already-computed value valid retroactively. Applying the
 * `.variable` classes to a wrapper div nested inside `<body>` (this file's first attempt) left
 * `--font-sans` computing to the guaranteed-invalid value at `:root`/`<html>` — confirmed directly
 * with Playwright (`--font-sans` read as `""` on both `document.body` and the wrapper div itself,
 * while `--font-public-sans` resolved fine on that same div in isolation) — so every element sat
 * on the browser's serif fallback regardless of nesting. Production has no such gap: layout.tsx
 * applies these same classes to `<html>`, the actual `:root` element. This decorator does the
 * same thing a Storybook preview can do — set them on `document.documentElement` directly, once,
 * via a mount effect — rather than reimplementing globals.css's font tokens for Storybook only.
 */
function ApplyProductFonts({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const classes = FONT_CLASS.split(" ").filter(Boolean);
    document.documentElement.classList.add(...classes);
    return () => {
      document.documentElement.classList.remove(...classes);
    };
  }, []);
  return children;
}

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
    },
    a11y: {
      // Every component here ships in the authenticated product behind a login, never previewed
      // stand-alone — failing the build on a violation would block unrelated component work on
      // an unrelated component's accessibility bug. The panel still surfaces every finding.
      test: "todo",
    },
  },
  decorators: [
    (Story) => (
      <ApplyProductFonts>
        {/* `.app-shell`/`.auth-route` is what scopes app-shell.css's focus-ring and heading-colour
            rules (see docs/DESIGN_SYSTEM.md's Colour section) — without it a story's <h1>/<h2>/<h3>
            falls through to globals.css's marketing-site heading colour instead of the app's own
            "inherit the surface" rule, and focus rings show the marketing brand ring instead of
            the app's accent ring. `.app-shell` itself is a sidebar grid layout with no meaning for
            one isolated component, so `sb-app-context` (preview.css) resets just the
            layout-affecting properties — display/min-height/background — and touches no colour,
            token or font. */}
        <div className="app-shell sb-app-context">
          <div className="app-content" style={{ maxWidth: "none" }}>
            <Story />
          </div>
        </div>
      </ApplyProductFonts>
    ),
  ],
};

export default preview;
