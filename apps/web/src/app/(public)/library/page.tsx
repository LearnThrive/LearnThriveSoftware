import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Container } from "@/components/Container";
import { FaqList } from "@/components/FaqList";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/motion/primitives/Reveal";
import { CatalogueView } from "@/components/library/CatalogueView";
import { heroCopy, LEVELS, LIBRARY_ITEMS, libraryFaqs, priceSummary, SUBJECT_SENTENCE, SUBJECT_TITLES } from "@/components/library/libraryCopy";
import { WaitlistSection } from "@/components/library/WaitlistSection";
import { effectivePhase, subscriptionOffer } from "@/lib/billing/offer";
import { libraryPhase, libraryPrices, libraryShows } from "@/lib/library-config";
import { parseCatalogueQuery, toResourceQuery } from "@/lib/library/catalogue";
import { catalogueStore } from "@/lib/library/server";
import { createMetadata } from "@/lib/metadata";
import styles from "./library.module.css";

// Rendered for each request: the phase (and so the catalogue) is read when the page is asked for, and the catalogue
// follows the address bar (?q=&subject=&level=&type=&page=).
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const store = libraryShows().catalogue ? await catalogueStore() : null;
  const open = store !== null;
  const live = open && libraryPhase() === "live" && (await subscriptionOffer(store)).open;
  return createMetadata({
    title: open ? "The LearnThrive Library" : "The LearnThrive Library: coming soon",
    description: live
      ? "Worksheets, exam-style papers, mark schemes and notes made by LearnThrive. Included for enrolled students, and available to everyone else by subscription."
      : open
      ? "Worksheets, exam-style papers, mark schemes and notes made by LearnThrive. Open to enrolled students; a subscription for everyone else is coming soon."
      : "Worksheets, exam-style papers, mark schemes and notes made by LearnThrive. Coming soon: included for enrolled students, and available to everyone else by subscription.",
    path: "/library",
  });
}

/**
 * The Library overview and catalogue (plan19 phases B2 and D, E). What it says follows the phase the Library is REALLY in:
 * `live` without everything subscriptions need behaves as `enrolled` (lib/billing/offer.ts). Rendered per request.
 * Draft copy for the owners to approve (components/library/libraryCopy.ts).
 */
export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const store = libraryShows().catalogue ? await catalogueStore() : null;
  // No backend (production before Supabase is configured) means nothing can be browsed or downloaded, whatever the phase
  // says, so the page stays the coming-soon page: it never claims what is not working.
  const phase = store ? effectivePhase(libraryPhase(), await subscriptionOffer(store)) : "info";
  const prices = libraryPrices();
  const { waitlist } = libraryShows(phase);
  const priceText = priceSummary(prices);
  const copy = heroCopy(phase);

  const query = parseCatalogueQuery(await searchParams);
  const view = store ? { facets: await store.resources.facets(), results: await store.resources.list(toResourceQuery(query)) } : null;

  return (
    <>
      <PageHero
        eyebrow={copy.eyebrow}
        title="The LearnThrive Library"
        intro={copy.intro}
        breadcrumb={<Breadcrumbs trail={[{ name: "Library", path: "/library" }]} />}
        className="page-hero--legal"
        backdrop={<div className="legal-hero-atmosphere" aria-hidden="true" />}
        actions={
          <div className="button-group">
            {view ? (
              <a className="button button--light" href="#catalogue">
                <span>Browse the Library</span>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M4 10h11M11 6l4 4-4 4" />
                </svg>
              </a>
            ) : null}
            {waitlist ? (
              <a className={view ? "button button--text" : "button button--light"} href="#waitlist">
                <span>Join the waitlist</span>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M4 10h11M11 6l4 4-4 4" />
                </svg>
              </a>
            ) : null}
            <a className="button button--text" href="#how-it-works">
              <span>How it will work</span>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4 10h11M11 6l4 4-4 4" />
              </svg>
            </a>
          </div>
        }
        aside={
          <div className="document-card">
            <span>At a glance</span>
            <dl className={styles.facts}>
              <div>
                <dt>Status</dt>
                <dd>{copy.status}</dd>
              </div>
              <div>
                <dt>Enrolled students</dt>
                <dd>Included</dd>
              </div>
              <div>
                <dt>Everyone else</dt>
                <dd>{copy.everyoneElse}</dd>
              </div>
              <div>
                <dt>Price</dt>
                <dd>{priceText}</dd>
              </div>
            </dl>
          </div>
        }
      />

      <section className="section" aria-labelledby="what-heading">
        <Container className={styles.split}>
          {/* The first block after the hero is the explicit opt-out: a reveal would hold it back until the script runs. */}
          <Reveal variant="static" className={styles.prose}>
            <p className="eyebrow">What the Library is</p>
            <h2 id="what-heading">Study material, made by LearnThrive</h2>
            <p>The Library is a collection of worksheets, exam-style papers, mark schemes and notes. LearnThrive makes all of it.</p>
          </Reveal>
          <Reveal variant="static">
            <ul className={styles.items} aria-label="What the Library will hold">
              {LIBRARY_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Reveal>
        </Container>
      </section>

      <section className="section section--tint" aria-labelledby="who-heading">
        <Container>
          <Reveal variant="soft">
            <div className="section-heading section-heading--left section-heading--default">
              <p className="eyebrow">Who it is for</p>
              <h2 id="who-heading">Included for enrolled students</h2>
            </div>
          </Reveal>
          <Reveal variant="soft">
            <div className={styles.audiences}>
              <div className={styles.audience}>
                <h3>Enrolled students</h3>
                <p>The Library is included for students enrolled with LearnThrive.</p>
              </div>
              <div className={styles.audience}>
                <h3>Everyone else</h3>
                <p>Anyone else will be able to pay a subscription for all of it.</p>
                <p>
                  {priceText}.{" "}
                  <Link className="text-link" href="/pricing">
                    See the plan <span aria-hidden="true">→</span>
                  </Link>
                </p>
              </div>
            </div>
          </Reveal>
        </Container>
      </section>

      <section className="section" aria-labelledby="subjects-heading">
        <Container>
          <Reveal variant="soft" className={styles.prose}>
            <p className="eyebrow">Subjects and levels</p>
            <h2 id="subjects-heading">{SUBJECT_SENTENCE}</h2>
            <p>The Library will cover these subjects, {LEVELS}.</p>
            <ul className={styles.subjectList} aria-label="Subjects">
              {SUBJECT_TITLES.map((title) => (
                <li key={title}>{title}</li>
              ))}
            </ul>
            <p className={styles.more}>
              <Link className="text-link" href="/subjects">
                Our subjects <span aria-hidden="true">→</span>
              </Link>
            </p>
          </Reveal>
        </Container>
      </section>

      {view ? (
        <section className="section section--tint">
          <Container>
            <CatalogueView path="/library" heading="Browse and search" query={query} facets={view.facets} results={view.results} />
          </Container>
        </section>
      ) : null}

      <section className={view ? "section" : "section section--tint"} id="how-it-works" aria-labelledby="how-heading">
        <Container>
          <Reveal variant="soft">
            <div className="section-heading section-heading--left section-heading--default">
              <p className="eyebrow">{copy.howEyebrow}</p>
              <h2 id="how-heading">Sign in, browse, download</h2>
            </div>
          </Reveal>
          <Reveal variant="soft">
            <ol className={styles.steps}>
              <li>
                <h3>Sign in</h3>
                <p>Sign in with your account.</p>
              </li>
              <li>
                <h3>Browse</h3>
                <p>Look through the worksheets, papers, mark schemes and notes.</p>
              </li>
              <li>
                <h3>Download</h3>
                <p>Download what you need.</p>
              </li>
            </ol>
            <p className={styles.notYet}>{copy.howNote}</p>
          </Reveal>
        </Container>
      </section>

      <section className="section" aria-labelledby="library-faq-heading">
        <Container>
          <Reveal variant="soft">
            <div className="section-heading section-heading--left section-heading--default">
              <p className="eyebrow">Questions</p>
              <h2 id="library-faq-heading">About the Library</h2>
            </div>
          </Reveal>
          <FaqList items={libraryFaqs(prices, phase)} />
        </Container>
      </section>

      {waitlist ? <WaitlistSection /> : null}
    </>
  );
}
