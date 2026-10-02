import { isValidElement, type ReactNode } from "react";
import { siteConfig } from "@/lib/site";

/**
 * Builders for the site's schema.org JSON-LD (plan15 Wave 10 section 14.4). Pure functions returning
 * plain objects; <JsonLd> (components/seo/JsonLd.tsx) renders them. The existing EducationalOrganization
 * block in app/layout.tsx is extended here, not duplicated: WebSite, BreadcrumbList and FAQPage are the
 * additions. No self-serving Review/AggregateRating markup, ever: the testimonials are real, but marking
 * a business up with its own reviews is against search engines' guidelines and not what this is for.
 */
const CONTEXT = "https://schema.org";

export function webSiteData() {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    name: siteConfig.name,
    url: siteConfig.url,
    inLanguage: "en-GB",
    publisher: { "@type": "EducationalOrganization", name: siteConfig.name, url: siteConfig.url },
  };
}

export interface BreadcrumbItem {
  name: string;
  /** Absolute path starting with "/" ("/" is Home). */
  path: string;
}

/** A BreadcrumbList for a deep page. The trail always starts at Home. */
export function breadcrumbData(trail: readonly BreadcrumbItem[]) {
  const items = [{ name: "Home", path: "/" }, ...trail];
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.path === "/" ? siteConfig.url : `${siteConfig.url}${item.path}`,
    })),
  };
}

/**
 * The visible text of a React node (a FAQ answer may be a string or a little JSX), flattened to a
 * single space-separated string. FAQPage markup must match the answer the page shows.
 */
export function nodeToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeToText(node.props.children);
  return "";
}

export interface FaqLike {
  question: string;
  answer: ReactNode;
}

/** FAQPage for a list of questions. Questions whose answer has no text are left out. */
export function faqPageData(items: readonly FaqLike[]) {
  return {
    "@context": CONTEXT,
    "@type": "FAQPage",
    mainEntity: items
      .map((item) => ({ question: item.question, text: nodeToText(item.answer) }))
      .filter((item) => item.text.length > 0)
      .map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.text },
      })),
  };
}

/** JSON for a <script type="application/ld+json">: `<` is escaped so content can never close the tag. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
