import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbData, type BreadcrumbItem } from "@/lib/structuredData";

/**
 * The visible breadcrumb trail of a deep page, and its BreadcrumbList structured data from the same
 * array, so what a visitor reads and what a search engine is told can never disagree (plan15 Wave 10
 * section 14.2). The trail passed in excludes Home, which always leads; the last item is the current
 * page and is not a link. Rendered inside the hero (see PageHero's `breadcrumb` prop), so it sits on
 * the hero's own ground and takes its colours from it.
 */
export function Breadcrumbs({ trail }: { trail: readonly BreadcrumbItem[] }) {
  const items = [{ name: "Home", path: "/" }, ...trail];
  return (
    <>
      <JsonLd data={breadcrumbData(trail)} />
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          {items.map((item, index) => {
            const current = index === items.length - 1;
            return (
              <li key={item.path}>
                {current ? (
                  <span aria-current="page">{item.name}</span>
                ) : (
                  <Link href={item.path}>{item.name}</Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
