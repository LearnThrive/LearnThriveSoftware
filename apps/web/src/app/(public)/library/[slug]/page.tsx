import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { canAccess } from "@learnthrive/data/library";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Container } from "@/components/Container";
import { DownloadPanel, downloadMessage, type DownloadView } from "@/components/library/DownloadPanel";
import { PageHero } from "@/components/PageHero";
import styles from "@/components/library/catalogue.module.css";
import { currentSession } from "@/lib/account/pages";
import { createMetadata } from "@/lib/metadata";
import { nameSlug } from "@/lib/library/catalogue";
import { catalogueStore } from "@/lib/library/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const store = await catalogueStore();
  const resource = store ? await store.resources.getBySlug((await params).slug) : null;
  if (!resource) return { title: "Not found | LearnThrive", robots: { index: false, follow: false } };
  return createMetadata({ title: `${resource.title} | LearnThrive Library`, description: resource.description || `${resource.subject}, ${resource.level}: ${resource.title}.`, path: `/library/${resource.slug}` });
}

/**
 * A resource: the public listing (title, description, facts, who made it) and a gated download. Anyone can read this
 * page; only the download needs an account, and the route behind the button decides (canAccess). Reading the session
 * sets no cookie.
 */
export default async function ResourcePage({ params, searchParams }: Props) {
  const store = await catalogueStore();
  if (!store) notFound();
  const { slug } = await params;
  const resource = await store.resources.getBySlug(slug);
  if (!resource) notFound();

  const { rt, state } = await currentSession();
  if (state.status === "refresh_needed") redirect(`/api/account/refresh?next=${encodeURIComponent(`/library/${slug}`)}`);
  let view: DownloadView = { kind: "signed_out" };
  if (rt && state.status === "ok") {
    const account = await rt.store.accounts.getAccount(state.user.id);
    if (account) {
      const clientId = account.clientId;
      const facts = clientId ? await rt.store.access.facts(clientId) : { enrolled: false, subscription: false, adminGrant: false };
      const files = await rt.store.resources.files(resource.id);
      view = { kind: "decided", decision: canAccess(account, resource, facts, new Date()), hasFile: files.length > 0 };
    }
  }

  const published = resource.publishedAt ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(resource.publishedAt) : null;

  return (
    <>
      <PageHero
        eyebrow={`${resource.subject} · ${resource.level}`}
        title={resource.title}
        intro={resource.description || `A ${resource.resourceType} for ${resource.subject}, ${resource.level}.`}
        className="page-hero--legal"
        backdrop={<div className="legal-hero-atmosphere" aria-hidden="true" />}
        breadcrumb={
          <Breadcrumbs
            trail={[
              { name: "Library", path: "/library" },
              { name: resource.subject, path: `/library/subject/${nameSlug(resource.subject)}` },
              { name: resource.title, path: `/library/${resource.slug}` },
            ]}
          />
        }
      />
      <section className="section">
        <Container>
          <div className={styles.detail}>
            <DownloadPanel slug={resource.slug} free={resource.accessTier === "free_sample"} view={view} message={downloadMessage((await searchParams).download)} />
            <dl className={styles.facts} aria-label="About this resource">
              <dt>Subject</dt>
              <dd>{resource.subject}</dd>
              <dt>Level</dt>
              <dd>{resource.level}</dd>
              <dt>Type</dt>
              <dd>{resource.resourceType}</dd>
              <dt>Topic</dt>
              <dd>{resource.topic}</dd>
              {resource.examBoard ? (
                <>
                  <dt>Exam board</dt>
                  <dd>{resource.examBoard}</dd>
                </>
              ) : null}
              {resource.yearGroup ? (
                <>
                  <dt>Year group</dt>
                  <dd>{resource.yearGroup}</dd>
                </>
              ) : null}
              <dt>Access</dt>
              <dd>{resource.accessTier === "free_sample" ? "Free sample (any signed-in account)" : "Enrolled students and members"}</dd>
              <dt>Made by</dt>
              <dd>{resource.authorship}</dd>
              <dt>Version</dt>
              <dd>{resource.version}</dd>
              {published ? (
                <>
                  <dt>Published</dt>
                  <dd>{published}</dd>
                </>
              ) : null}
            </dl>
          </div>
        </Container>
      </section>
    </>
  );
}
