import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Container } from "@/components/Container";
import { CatalogueView } from "@/components/library/CatalogueView";
import { PageHero } from "@/components/PageHero";
import { createMetadata } from "@/lib/metadata";
import { findBySlug, nameSlug, parseCatalogueQuery, toResourceQuery } from "@/lib/library/catalogue";
import { catalogueStore } from "@/lib/library/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ subject: string; topic: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function resolve(params: Props["params"]) {
  const store = await catalogueStore();
  if (!store) return null;
  const { subject: subjectSlug, topic: topicSlug } = await params;
  const subject = findBySlug((await store.resources.facets()).subjects, subjectSlug);
  if (!subject) return null;
  const facets = await store.resources.facets(new Date(), { subject: subject.value });
  const topic = findBySlug(facets.topics, topicSlug);
  return topic ? { store, subject: subject.value, topic: topic.value, facets } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await resolve(params);
  if (!found) return { title: "Not found | LearnThrive", robots: { index: false, follow: false } };
  return createMetadata({
    title: `${found.topic}, ${found.subject} | LearnThrive Library`,
    description: `${found.subject}: ${found.topic}. Worksheets, papers, mark schemes and notes made by LearnThrive.`,
    path: `/library/subject/${nameSlug(found.subject)}/${nameSlug(found.topic)}`,
  });
}

/** One topic within one subject. Either part not matching a published resource is a 404. */
export default async function TopicPage({ params, searchParams }: Props) {
  const found = await resolve(params);
  if (!found) notFound();
  const subjectPath = `/library/subject/${nameSlug(found.subject)}`;
  const path = `${subjectPath}/${nameSlug(found.topic)}`;
  const query = { ...parseCatalogueQuery(await searchParams), subject: found.subject, topic: found.topic };
  const results = await found.store.resources.list(toResourceQuery(query));

  return (
    <>
      <PageHero
        eyebrow={`Library · ${found.subject}`}
        title={found.topic}
        intro={`${found.subject}: ${found.topic}, made by LearnThrive.`}
        className="page-hero--legal"
        backdrop={<div className="legal-hero-atmosphere" aria-hidden="true" />}
        breadcrumb={
          <Breadcrumbs
            trail={[
              { name: "Library", path: "/library" },
              { name: found.subject, path: subjectPath },
              { name: found.topic, path },
            ]}
          />
        }
      />
      <section className="section">
        <Container>
          <CatalogueView path={path} heading={`${found.topic} resources`} query={query} facets={found.facets} results={results} fixedSubject={found.subject} />
        </Container>
      </section>
    </>
  );
}
