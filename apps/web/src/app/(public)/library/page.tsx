import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Container } from "@/components/Container";
import { FaqList } from "@/components/FaqList";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/motion/primitives/Reveal";
import { LEVELS, LIBRARY_ITEMS, libraryFaqs, priceSummary, SUBJECT_SENTENCE, SUBJECT_TITLES, TERMS_NOTE } from "@/components/library/libraryCopy";
import { WaitlistSection } from "@/components/library/WaitlistSection";
import { libraryPrices, libraryShows } from "@/lib/library-config";
import { createMetadata } from "@/lib/metadata";
import styles from "./library.module.css";

export const metadata: Metadata = createMetadata({
  title: "The LearnThrive Library: coming soon",
  description:
    "Worksheets, exam-style papers, mark schemes and notes made by LearnThrive. Coming soon: included for enrolled students, and available to everyone else by subscription.",
  path: "/library",
});

/**
 * The Library information page (plan19 phase B2). Until the later phases exist (sign-in, downloads, billing), every
 * LIBRARY_PHASE shows this coming-soon content (lib/library-config.ts: libraryShows). Static: the phase and any price
 * are read when the site is built. Draft copy for the owners to approve (components/library/libraryCopy.ts).
 */
export default function LibraryPage() {
  const prices = libraryPrices();
  const { waitlist } = libraryShows();
  const priceText = priceSummary(prices);

  return (
    <>
      <PageHero
        eyebrow="Library · Coming soon"
        title="The LearnThrive Library"
        intro="Worksheets, exam-style papers, mark schemes and notes, all made by LearnThrive. The Library is coming soon."
        breadcrumb={<Breadcrumbs trail={[{ name: "Library", path: "/library" }]} />}
        className="page-hero--legal"
        backdrop={<div className="legal-hero-atmosphere" aria-hidden="true" />}
        actions={
          <div className="button-group">
            {waitlist ? (
              <a className="button button--light" href="#waitlist">
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
                <dd>Coming soon</dd>
              </div>
              <div>
                <dt>Enrolled students</dt>
                <dd>Included</dd>
              </div>
              <div>
                <dt>Everyone else</dt>
                <dd>By subscription</dd>
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

      <section className="section section--tint" id="how-it-works" aria-labelledby="how-heading">
        <Container>
          <Reveal variant="soft">
            <div className="section-heading section-heading--left section-heading--default">
              <p className="eyebrow">How it will work</p>
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
            <p className={styles.notYet}>None of this is open yet. {TERMS_NOTE}</p>
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
          <FaqList items={libraryFaqs(prices)} />
        </Container>
      </section>

      {waitlist ? <WaitlistSection /> : null}
    </>
  );
}
