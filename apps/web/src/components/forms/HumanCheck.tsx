"use client";

import { siteConfig } from "@/lib/site";
import { fieldId } from "./Fields";
import styles from "./forms.module.css";
import type { HumanCheckHandle } from "./useHumanCheck";

/**
 * The visible half of the human check: one status line, announced politely as it changes, and in the
 * fallback a short sum to answer. Sits next to the submit button.
 */
export function HumanCheck({ check, error }: { check: HumanCheckHandle; error?: string }) {
  const { state } = check;
  return (
    <div className={styles.humanCheck}>
      <div role="status" aria-live="polite" className={styles.humanCheck}>
        {state.status === "idle" || state.status === "working" ? (
          <>
            <span className={styles.spinner} aria-hidden="true" />
            <span>Checking that you are a person…</span>
          </>
        ) : null}
        {state.status === "verified" ? (
          <>
            <span className={styles.statusIcon} aria-hidden="true">
              ✓
            </span>
            <span>Checked: you are a person.</span>
          </>
        ) : null}
        {state.status === "failed" ? (
          <>
            <span>We could not run the check.</span>
            <button type="button" className="button button--secondary" onClick={check.renew}>
              <span>Try again</span>
            </button>
          </>
        ) : null}
        {state.status === "unavailable" ? (
          <span>
            The check is not available right now, so the form cannot be sent. Please email{" "}
            <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a> instead.
          </span>
        ) : null}
      </div>
      {state.status === "text" ? (
        <div className={`form-field ${styles.humanCheckText}`}>
          <label htmlFor={fieldId("humanAnswer")}>To show you are a person: {state.question}</label>
          <input
            id={fieldId("humanAnswer")}
            name="humanAnswer"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={check.textAnswer}
            onChange={(event) => check.setTextAnswer(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${fieldId("humanAnswer")}-error` : undefined}
          />
          {error ? (
            <span className="field-error" id={`${fieldId("humanAnswer")}-error`}>
              {error}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
