import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { PricingCard } from "@/components/ui/PricingCard";
import styles from "./bench.module.css";

export const metadata: Metadata = {
  title: "PricingCard | UI components | LearnThrive",
  robots: { index: false, follow: false },
};

const NOTE =
  "Terms, price, renewal and cancellation details will be shown in full before anyone pays. No payment is taken now.";
const FEATURES = [
  "Worksheets written by LearnThrive tutors",
  "Exam-style papers and mark schemes",
  "Included free for enrolled students",
];

/**
 * A development-only bench for PricingCard (plan19.md section 7). Every state on one page with stable ids.
 * The live cards post to a dev address that does not exist; the spec stops the post before it leaves the browser.
 */
export default function DevPricingCardPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const live = { state: "live" as const, title: "LearnThrive Library", features: FEATURES, checkoutAction: "/dev/ui-components/pricing-card/checkout" };

  return (
    <MotionRuntime>
      <main id="main-content" className={styles.page}>
        <h1>PricingCard</h1>
        <p>Development only. Every state of the card, with sample text and sample prices.</p>
        <div className={styles.grid}>
          <div id="coming-soon">
            <PricingCard
              state="coming-soon"
              title="LearnThrive Library"
              description="Worksheets, papers and notes written by LearnThrive."
              features={FEATURES}
              notes={NOTE}
            />
          </div>
          <div id="coming-soon-price">
            <PricingCard state="coming-soon" title="LearnThrive Library" features={FEATURES} price="£9.99" period="month" />
          </div>
          <div id="live-fallback">
            {/* A "live" card without a billing period must fall back to coming soon: no form, no checkout. */}
            <PricingCard {...live} price="£9.99" />
          </div>
          <div id="live-monthly">
            <PricingCard {...live} description="Sample monthly price." price="£9.99" period="month" checkoutFields={{ plan: "monthly" }} notes="Extra disclosure for the live state." />
          </div>
          <div id="live-annual">
            <PricingCard {...live} description="Sample annual price." price="£99" period="year" checkoutFields={{ plan: "annual" }} />
          </div>
          <div id="live-submitting">
            <PricingCard {...live} price="£9.99" period="month" checkoutFields={{ plan: "monthly" }} submitting />
          </div>
          <div id="live-disabled">
            <PricingCard {...live} price="£9.99" period="month" checkoutFields={{ plan: "monthly" }} disabled />
          </div>
        </div>
        <section id="waitlist" className={styles.target} aria-labelledby="waitlist-heading">
          <h2 id="waitlist-heading">Waitlist target</h2>
          <label htmlFor="waitlist-email">Email address</label>
          <input id="waitlist-email" type="email" autoComplete="email" />
        </section>
      </main>
    </MotionRuntime>
  );
}
