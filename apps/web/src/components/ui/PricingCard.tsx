// From Uiverse.io by emmanuelh-dev
// Converted from UI Components/Sub.html: Tailwind classes, the "$25 /mo" and "Starter" placeholders, the
// `nline-flex` typo and the dangling aria-describedby are gone (plan19.md section 7).
import { useId, type FormEvent, type ReactNode } from "react";
import { ACKNOWLEDGEMENT, COOLING_OFF_DRAFT } from "@/lib/billing/consumer";
import { PricingCardCheckout } from "./PricingCardCheckout";
import styles from "./PricingCard.module.css";

export type PricingCardState = "coming-soon" | "live";

export interface PricingCardProps {
  state: PricingCardState;
  /** Coming soon: the product name, "LearnThrive Library". Never an invented plan name. */
  title: string;
  /** One short factual line under the title. */
  description?: string;
  /** Only owner-confirmed facts, supplied by the caller. */
  features: readonly string[];
  /** Display text such as "£9.99". Coming soon: absent, null or blank shows "Price announced at launch". Live: required. */
  price?: string | null;
  /** Shown after the price ("per month" / "per year"). Live: required (the billing period is a mandatory disclosure). */
  period?: "month" | "year";
  /** Coming soon: the button is a link to this href. */
  waitlistHref?: string;
  /** Live: the button submits a POST form to this action. */
  checkoutAction?: string;
  /** Live: hidden inputs, for example { plan: "monthly" }. */
  checkoutFields?: Readonly<Record<string, string>>;
  /** Coming soon: replaces the built-in honest note (the plan's wording shows when this is omitted). Live: extra disclosures. */
  notes?: ReactNode;
  /** Heading element for the title. Default 3. */
  headingLevel?: 2 | 3;
  id?: string;
  /** Optional extras. Live: the submit button's label, a working state, a disabled state and a hook that runs
   * once the form is valid (call `event.preventDefault()` to stop the post, for a bench or a test). */
  submitLabel?: string;
  submitting?: boolean;
  disabled?: boolean;
  onCheckout?: (event: FormEvent<HTMLFormElement>) => void;
  /** Live: the owners and a solicitor have approved the wording (LIBRARY_TERMS_APPROVED). Until then it is labelled as a draft. */
  wordingApproved?: boolean;
}

/** Plan19 phase B2 wording, shown on a coming-soon card unless the caller supplies its own note. */
const COMING_SOON_NOTE =
  "Terms, price, renewal and cancellation details will be shown in full before anyone pays. No payment is taken now.";

function Check() {
  return (
    <svg className={styles.tick} viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="m4 10.5 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PricingCard({
  state,
  title,
  description,
  features,
  price,
  period,
  waitlistHref = "#waitlist",
  checkoutAction = "/api/billing/create-checkout",
  checkoutFields = {},
  notes,
  headingLevel = 3,
  id,
  submitLabel = "Continue to checkout",
  submitting = false,
  disabled = false,
  onCheckout,
  wordingApproved = false,
}: PricingCardProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const priceId = `${uid}-price`;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const shownPrice = price?.trim() || null;
  // A payment form is never shown without a price and a billing period: a "live" card missing either falls back to coming soon.
  const live = state === "live" && Boolean(shownPrice) && Boolean(period);
  const periodText = period === "year" ? "per year" : period === "month" ? "per month" : null;

  return (
    <section id={id} className={styles.card} aria-labelledby={titleId} data-pricing-card={live ? "live" : "coming-soon"}>
      <header className={styles.header}>
        {!live && <p className={styles.label}>Coming soon</p>}
        <Heading id={titleId} className={styles.title}>
          {title}
        </Heading>
        {description && <p className={styles.description}>{description}</p>}
      </header>

      {features.length > 0 && (
        <ul className={styles.features}>
          {features.map((feature) => (
            <li key={feature}>
              <Check />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      )}

      <p id={priceId} className={styles.price} data-pricing-price>
        {shownPrice ? (
          <>
            <span className={styles.amount}>{shownPrice}</span>
            {periodText && <span className={styles.period}> {periodText}</span>}
          </>
        ) : (
          <span className={styles.unannounced}>Price announced at launch</span>
        )}
      </p>

      {live ? (
        <>
          <ul className={styles.terms}>
            <li>Renews automatically every {period} until you cancel.</li>
            <li>You can cancel online, in your account.</li>
          </ul>
          {wordingApproved ? (
            <div className={styles.notes}>
              <p>{COOLING_OFF_DRAFT}</p>
            </div>
          ) : (
            <div className={styles.draft} data-pricing-draft>
              <p className={styles.draftLabel}>Draft wording for legal review</p>
              <p>{COOLING_OFF_DRAFT}</p>
            </div>
          )}
          <PricingCardCheckout
            action={checkoutAction}
            fields={checkoutFields}
            acknowledgementId={`${uid}-ack`}
            describedBy={`${titleId} ${priceId}`}
            acknowledgement={ACKNOWLEDGEMENT}
            submitLabel={submitLabel}
            submitting={submitting}
            disabled={disabled}
            onSubmit={onCheckout}
          />
        </>
      ) : (
        <a className={`button button--primary ${styles.cta}`} href={waitlistHref} aria-describedby={titleId}>
          Join the waitlist
        </a>
      )}

      {live ? notes && <div className={styles.notes}>{notes}</div> : <div className={styles.notes}>{notes ?? <p>{COMING_SOON_NOTE}</p>}</div>}
    </section>
  );
}
