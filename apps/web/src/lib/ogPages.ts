import { subjects } from "@/lib/site";

/**
 * What each public page's social-preview image says (plan15 Wave 10 section 14.4). Titles are the
 * pages' own existing titles (their `<title>` / metadata), eyebrows are their own kind-of-page labels;
 * nothing here is new copy. Rendered by app/og/[[...slug]]/route.tsx into a 1200x630 brand card, one
 * per route, statically generated at build time.
 */
export interface OgPage {
  eyebrow: string;
  title: string;
}

export const ogPages: Record<string, OgPage> = {
  "/": { eyebrow: "Online · one-to-one · Y1 to A-Level", title: "Strong foundations. Brighter futures." },
  "/about": { eyebrow: "About us", title: "About Us" },
  "/subjects": { eyebrow: "What we teach", title: "Subjects We Cover" },
  "/book": { eyebrow: "Free consultation", title: "Book a Free Consultation" },
  "/contact": { eyebrow: "Get in touch", title: "Contact" },
  "/faq": { eyebrow: "Questions", title: "Frequently Asked Questions" },
  "/safeguarding": { eyebrow: "Safeguarding", title: "Safeguarding information" },
  "/trust": { eyebrow: "Trust", title: "Trust and policies" },
  "/privacy": { eyebrow: "Privacy", title: "Privacy notice" },
  "/cookies": { eyebrow: "Cookies", title: "Cookie notice" },
  "/terms": { eyebrow: "Terms", title: "Website terms" },
  "/tuition-terms": { eyebrow: "Terms", title: "Tuition terms" },
  "/complaints": { eyebrow: "Complaints", title: "Complaints procedure" },
  "/accessibility": { eyebrow: "Accessibility", title: "Accessibility statement" },
  ...Object.fromEntries(
    subjects.map((subject) => [subject.path, { eyebrow: subject.hero.eyebrow, title: subject.seo.title }] as const),
  ),
};

/** The path a page's OG image lives at: `/og` for the home page, `/og/about` for `/about`. */
export function ogImagePath(path: string): string {
  return path === "/" ? "/og" : `/og${path}`;
}

/** The card for a path, falling back to the home page's. */
export function ogPageFor(path: string): OgPage {
  return ogPages[path] ?? ogPages["/"];
}
