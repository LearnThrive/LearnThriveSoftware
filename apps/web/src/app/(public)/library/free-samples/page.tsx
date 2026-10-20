import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Container } from "@/components/Container";
import { ResourceCard } from "@/components/library/CatalogueView";
import { PageHero } from "@/components/PageHero";
import styles from "@/components/library/catalogue.module.css";
import { createMetadata } from "@/lib/metadata";
import { catalogueStore } from "@/lib/library/server";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return createMetadata({ title: "Free samples | LearnThrive Library", description: "Free sample resources from the LearnThrive Library. Sign in with any account to download them.", path: "/library/free-samples" });
}

/** The free-samples area: every published free sample, newest first. Any signed-in account may download these. */
export default async function FreeSamplesPage() {
  const store = await catalogueStore();
  if (!store) notFound();
  const { items, total } = await store.resources.list({ tier: "free_sample", limit: 100 });
  return (
    <>
      <PageHero
        eyebrow="Library"
        title="Free samples"
        intro="A few resources from the Library that anyone with an account can download."
        className="page-hero--legal"
        backdrop={<div className="legal-hero-atmosphere" aria-hidden="true" />}
        breadcrumb={<Breadcrumbs trail={[{ name: "Library", path: "/library" }, { name: "Free samples", path: "/library/free-samples" }]} />}
      />
      <section className="section">
        <Container>
          <p className={styles.summary} role="status">
            {total === 0 ? "There are no free samples yet." : `${total} free ${total === 1 ? "sample" : "samples"}.`}
          </p>
          {items.length > 0 ? (
            <ul className={styles.list} aria-label="Free samples">
              {items.map((resource) => (
                <ResourceCard key={resource.id} resource={resource} />
              ))}
            </ul>
          ) : null}
        </Container>
      </section>
    </>
  );
}
