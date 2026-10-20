import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Container } from "@/components/Container";
import { CatalogueView } from "@/components/library/CatalogueView";
import { PageHero } from "@/components/PageHero";
import { createMetadata } from "@/lib/metadata";
import { parseCatalogueQuery, toResourceQuery } from "@/lib/library/catalogue";
import { catalogueStore } from "@/lib/library/server";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { ...createMetadata({ title: "Search the Library | LearnThrive", description: "Search the LearnThrive Library.", path: "/library/search" }), robots: { index: false, follow: true } };
}

/** Search on its own page (the icon menu's Search). Results pages are not indexed; the catalogue pages they lead to are. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const store = await catalogueStore();
  if (!store) notFound();
  const query = parseCatalogueQuery(await searchParams);
  const [facets, results] = await Promise.all([store.resources.facets(), store.resources.list(toResourceQuery(query))]);
  return (
    <>
      <PageHero
        eyebrow="Library"
        title="Search the Library"
        intro="Search by words, or narrow by subject, level and type."
        className="page-hero--legal"
        backdrop={<div className="legal-hero-atmosphere" aria-hidden="true" />}
        breadcrumb={<Breadcrumbs trail={[{ name: "Library", path: "/library" }, { name: "Search", path: "/library/search" }]} />}
      />
      <section className="section">
        <Container>
          <CatalogueView path="/library/search" heading="Results" query={query} facets={facets} results={results} />
        </Container>
      </section>
    </>
  );
}
