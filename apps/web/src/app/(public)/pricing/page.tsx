import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Container } from "@/components/Container";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/motion/primitives/Reveal";
import { CARD_FEATURES, TERMS_NOTE } from "@/components/library/libraryCopy";
import { WaitlistSection } from "@/components/library/WaitlistSection";
import { PricingCard } from "@/components/ui/PricingCard";
import { libraryPrices, libraryShows } from "@/lib/library-config";
import { createMetadata } from "@/lib/metadata";
import styles from "./pricing.module.css";

export const metadata: Metadata = createMetadata({
  title: "LearnThrive Library pricing: coming soon",
  description:
    "The LearnThrive Library is coming soon. It is included for enrolled students, and anyone else will be able to pay a subscription. Join the waitlist.",
  path: "/pricing",
});

const DESCRIPTION = "Included for enrolled students. A subscription for everyone else.";

/**
 * The Library plan, in its coming-soon state (plan19 phase B2): the PricingCard with no checkout, the honest note, and
 * the waitlist the card's button lands on. A price is shown only if the owners set one (lib/library-config.ts); with
 * both set there are two cards, otherwise one. No payment, pre-order or deposit of any kind. Static: read at build time.
 * When billing exists (phase E) the same card goes live here. Draft copy for the owners to approve.
 */
export default function PricingPage() {
  const { monthly, annual } = libraryPrices();
  const { waitlist } = libraryShows();
  const cards =
    monthly && annual
      ? [
          { id: "plan-monthly", title: "LearnThrive Library, paid monthly", price: monthly, period: "month" as const, description: `Monthly subscription. ${DESCRIPTION}` },
          { id: "plan-annual", title: "LearnThrive Library, paid yearly", price: annual, period: "year" as const, description: `Annual subscription. ${DESCRIPTION}` },
        ]
      : [{ id: "plan", title: "LearnThrive Library", price: monthly, period: monthly ? ("month" as const) : undefined, description: DESCRIPTION }];

  return (
    <>
      <PageHero
        eyebrow="Pricing · Coming soon"
        title="Library pricing"
        intro="The LearnThrive Library is coming soon. Enrolled students will have it included, and anyone else will be able to pay a subscription for all of it."
        breadcrumb={<Breadcrumbs trail={[{ name: "Pricing", path: "/pricing" }]} />}
        className="page-hero--legal"
        backdrop={<div className="legal-hero-atmosphere" aria-hidden="true" />}
      />

      <section className="section" aria-label="The Library plan">
        <Container>
          {/* The first block after the hero is the explicit opt-out: a reveal would hold it back until the script runs. */}
          <Reveal variant="static">
            <div className={styles.cards}>
              {cards.map((card) => (
                <PricingCard
                  key={card.id}
                  id={card.id}
                  state="coming-soon"
                  headingLevel={2}
                  title={card.title}
                  description={card.description}
                  features={CARD_FEATURES}
                  price={card.price}
                  period={card.period}
                  waitlistHref="#waitlist"
                  notes={
                    <>
                      <p>{TERMS_NOTE}</p>
                      <p>You cannot pay for anything yet, and joining the waitlist costs nothing.</p>
                    </>
                  }
                />
              ))}
            </div>
            <div className={styles.after}>
              <p>
                Want to know more first? <Link className="text-link" href="/library">Read about the Library <span aria-hidden="true">→</span></Link>
              </p>
            </div>
          </Reveal>
        </Container>
      </section>

      {waitlist ? <WaitlistSection /> : null}
    </>
  );
}
