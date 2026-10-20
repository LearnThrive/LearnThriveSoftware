"use client";

import { useState, type FormEvent, type InvalidEvent } from "react";
import styles from "./PricingCard.module.css";

/** The live card's checkout hand-off: the one part of PricingCard that needs the browser. Without
 * JavaScript the native `required` checkbox still blocks the post; with it, the failure is spoken
 * (focus moves to the box, which names the error) instead of a browser bubble. */
export function PricingCardCheckout({
  action,
  fields,
  acknowledgementId,
  describedBy,
  acknowledgement,
  submitLabel,
  submitting,
  disabled,
  onSubmit,
}: {
  action: string;
  fields: Readonly<Record<string, string>>;
  acknowledgementId: string;
  describedBy: string;
  acknowledgement: string;
  submitLabel: string;
  submitting: boolean;
  disabled: boolean;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [missing, setMissing] = useState(false);
  const errorId = `${acknowledgementId}-error`;

  function handleInvalid(event: InvalidEvent<HTMLInputElement>) {
    event.preventDefault();
    setMissing(true);
    event.currentTarget.focus();
  }

  return (
    <form method="post" action={action} className={styles.form} onSubmit={onSubmit} aria-busy={submitting || undefined}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className={styles.acknowledgement} data-invalid={missing || undefined}>
        <label className={styles.acknowledgementLabel} htmlFor={acknowledgementId}>
          <input
            id={acknowledgementId}
            className={styles.checkbox}
            type="checkbox"
            name="acknowledged"
            value="yes"
            required
            defaultChecked={false}
            disabled={disabled}
            aria-invalid={missing || undefined}
            aria-describedby={missing ? errorId : undefined}
            onInvalid={handleInvalid}
            onChange={(event) => event.currentTarget.checked && setMissing(false)}
          />
          <span>{acknowledgement}</span>
        </label>
        {missing && (
          <p id={errorId} className={styles.error}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
              <path d="M10 2 1.5 17h17L10 2Zm-1 6h2v4.5H9V8Zm0 5.8h2V16H9v-2.2Z" fill="currentColor" />
            </svg>
            <span>Tick the box to confirm you understand before you continue.</span>
          </p>
        )}
      </div>
      <button type="submit" className="button button--primary" disabled={disabled || submitting} aria-describedby={describedBy}>
        {submitting ? "Opening checkout…" : submitLabel}
      </button>
      <span role="status" className="sr-only">
        {submitting ? "Opening checkout. Please wait." : ""}
      </span>
    </form>
  );
}
