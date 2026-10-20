import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Container } from "@/components/Container";
import { CatalogueView } from "@/components/library/CatalogueView";
import { PageHero } from "@/components/PageHero";
import styles from "@/components/library/catalogue.module.css";
import { createMetadata } from "@/lib/metadata";
import { findBySlug, nameSlug, parseCatalogueQuery, toResourceQuery } from "@/lib/library/catalogue";
import { catalogueStore } from "@/lib/library/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ subject: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const store = await catalogueStore();
  const subject = store ? findBySlug((await store.resources.facets()).subjects, (await params).subject) : null;
  if (!subject) return { title: "Not found | LearnThrive", robots: { index: false, follow: false } };
  return createMetadata({ title: `${subject.value} in the Library | LearnThrive`, description: `Worksheets, papers, mark schemes and notes for ${subject.value}, made by LearnThrive.`, path: `/library/subject/${nameSlug(subject.value)}` });
}

/** One subject: its topics and its resources, filtered like the main catalogue. A subject nobody has published is a 404. */
export default async function SubjectPage({ params, searchParams }: Props) {
  const store = await catalogueStore();
  if (!store) notFound();
  const slug = (await params).subject;
  const subject = findBySlug((await store.resources.facets()).subjects, slug);
  if (!subject) notFound();

  const path = `/library/subject/${slug}`;
  const query = { ...parseCatalogueQuery(await searchParams), subject: subject.value };
  const facets = await store.resources.facets(new Date(), { subject: subject.value });
  const results = await store.resources.list(toResourceQuery(query));

  return (
    <>
      <PageHero
        eyebrow="Library"
        title={subject.value}
        intro={`Worksheets, papers, mark schemes and notes for ${subject.value}, made by LearnThrive.`}
        className="page-hero--legal"
        backdrop={<div className="legal-hero-atmosphere" aria-hidden="true" />}
        breadcrumb={<Breadcrumbs trail={[{ name: "Library", path: "/library" }, { name: subject.value, path }]} />}
      />
      <section className="section">
        <Container>
          {facets.topics.length > 1 ? (
            <nav aria-label={`${subject.value} topics`} className={styles.subjects}>
              <h2>Topics</h2>
              <ul>
                {facets.topics.map((topic) => (
                  <li key={topic.value}>
                    <Link href={`${path}/${nameSlug(topic.value)}`}>
                      {topic.value} <span className={styles.count}>({topic.count})</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <CatalogueView path={path} heading={`All ${subject.value} resources`} query={query} facets={facets} results={results} fixedSubject={subject.value} />
        </Container>
      </section>
    </>
  );
}
