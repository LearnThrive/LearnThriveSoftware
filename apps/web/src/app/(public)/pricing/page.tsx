import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Container } from "@/components/Container";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/motion/primitives/Reveal";
import { CARD_FEATURES, TERMS_NOTE } from "@/components/library/libraryCopy";
import { WaitlistSection } from "@/components/library/WaitlistSection";
import { PricingCard } from "@/components/ui/PricingCard";
import { checkoutDisclosures } from "@/lib/billing/consumer";
import { subscriptionOffer } from "@/lib/billing/offer";
import { libraryPrices, libraryShows } from "@/lib/library-config";
import { catalogueStore } from "@/lib/library/server";
import { createMetadata } from "@/lib/metadata";
import styles from "./pricing.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const offer = await subscriptionOffer(await catalogueStore());
  return createMetadata(
    offer.open
      ? {
          title: "LearnThrive Library pricing",
          description: "The LearnThrive Library is included for enrolled students. Anyone else can pay a subscription, monthly or yearly, and cancel online at any time.",
          path: "/pricing",
        }
      : {
          title: "LearnThrive Library pricing: coming soon",
          description:
            "The LearnThrive Library is coming soon. It is included for enrolled students, and anyone else will be able to pay a subscription. Join the waitlist.",
          path: "/pricing",
        },
  );
}

const DESCRIPTION = "Included for enrolled students. A subscription for everyone else.";

const CHECKOUT_MESSAGES: Record<string, string> = {
  cancelled: "You left checkout and have not been charged. You can try again whenever you like.",
  unavailable: "Subscriptions are not available right now. Please try again later, or email us.",
  acknowledge: "Please tick the box to confirm you understand before you continue.",
  failed: "We could not start checkout just now. You have not been charged. Please try again shortly.",
  wait: "Too many attempts. Please wait a few minutes and try again.",
};

/**
 * The Library plan. Coming soon (plan19 phase B2) until subscriptions are really open, then the same card live (phase E):
 * the button starts a hosted Stripe Checkout, and everything a customer must know before paying is on the card (price
 * and whether it includes VAT, the billing period, automatic renewal, how to cancel, the refunds line, and the unticked
 * acknowledgement that access starts at once and the 14-day right to cancel is lost). Live needs the phase, Stripe, a
 * VAT decision, the content threshold and approved terms (lib/billing/offer.ts); anything missing and this page stays
 * the coming-soon page. No card detail is ever entered on this site.
 */
export default async function PricingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const offer = await subscriptionOffer(await catalogueStore());
  const { monthly, annual } = libraryPrices();
  const { waitlist } = libraryShows(offer.open ? "live" : "info");
  const raw = (await searchParams).checkout;
  const message = typeof raw === "string" && Object.hasOwn(CHECKOUT_MESSAGES, raw) ? CHECKOUT_MESSAGES[raw] : null;

  const soon =
    monthly && annual
      ? [
          { id: "plan-monthly", title: "LearnThrive Library, paid monthly", price: monthly, period: "month" as const, description: `Monthly subscription. ${DESCRIPTION}` },
          { id: "plan-annual", title: "LearnThrive Library, paid yearly", price: annual, period: "year" as const, description: `Annual subscription. ${DESCRIPTION}` },
        ]
      : [{ id: "plan", title: "LearnThrive Library", price: monthly, period: monthly ? ("month" as const) : undefined, description: DESCRIPTION }];

  return (
    <>
      <PageHero
        eyebrow={offer.open ? "Pricing" : "Pricing · Coming soon"}
        title="Library pricing"
        intro={
          offer.open
            ? "The LearnThrive Library is included for enrolled students. Anyone else can pay a subscription for all of it, monthly or yearly, and cancel online at any time."
            : "The LearnThrive Library is coming soon. Enrolled students will have it included, and anyone else will be able to pay a subscription for all of it."
        }
        breadcrumb={<Breadcrumbs trail={[{ name: "Pricing", path: "/pricing" }]} />}
        className="page-hero--legal"
        backdrop={<div className="legal-hero-atmosphere" aria-hidden="true" />}
      />

      <section className="section" aria-label="The Library plan">
        <Container>
          {message ? (
            <p className={styles.notice} role="status">
              {message}
            </p>
          ) : null}
          {/* The first block after the hero is the explicit opt-out: a reveal would hold it back until the script runs. */}
          <Reveal variant="static">
            <div className={styles.cards}>
              {offer.open
                ? offer.plans.map((plan) => (
                    <PricingCard
                      key={plan.plan}
                      id={`plan-${plan.plan}`}
                      state="live"
                      headingLevel={2}
                      title={plan.plan === "monthly" ? "LearnThrive Library, paid monthly" : "LearnThrive Library, paid yearly"}
                      description={`${plan.plan === "monthly" ? "Monthly" : "Annual"} subscription. ${DESCRIPTION}`}
                      features={CARD_FEATURES}
                      price={plan.price}
                      period={plan.period}
                      checkoutFields={{ plan: plan.plan }}
                      wordingApproved
                      notes={
                        <ul className={styles.disclosures}>
                          {checkoutDisclosures(offer.prices, plan.period, offer.vat).map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      }
                    />
                  ))
                : soon.map((card) => (
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
                Want to know more first?{" "}
                <Link className="text-link" href="/library">
                  Read about the Library <span aria-hidden="true">→</span>
                </Link>
              </p>
              {offer.open ? (
                <p>
                  <Link className="text-link" href="/library/terms">
                    Read the Library terms and content licence <span aria-hidden="true">→</span>
                  </Link>
                </p>
              ) : null}
              {offer.open ? (
                <p>
                  Already subscribed? <Link href="/account">Manage your subscription</Link>. Questions about paying? <Link href="/contact">Get in touch</Link>.
                </p>
              ) : null}
            </div>
          </Reveal>
        </Container>
      </section>

      {waitlist ? <WaitlistSection /> : null}
    </>
  );
}
