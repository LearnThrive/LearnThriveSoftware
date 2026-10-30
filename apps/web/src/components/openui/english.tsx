"use client";

import { useState, type ReactNode } from "react";
import { QUOTE_STATUS_LABEL, quoteKey, type QuoteVerification } from "@/lib/openui/format";
import { useHost } from "./host";
import { Rich } from "./Rich";
import styles from "./openui.module.css";

type Render = { props: Record<string, unknown>; renderNode: (value: unknown) => ReactNode };
const text = (v: unknown): string => (typeof v === "string" ? v : "");

const BADGE: Record<QuoteVerification, { icon: string; cls: string }> = {
  VERIFIED_EXACT: { icon: "✓", cls: styles.verified },
  VERIFIED_VARIANT: { icon: "✓", cls: styles.verified },
  UNVERIFIED: { icon: "?", cls: styles.unverified },
  INCORRECT_ATTRIBUTION: { icon: "!", cls: styles.wrong },
  PARAPHRASE: { icon: "≈", cls: styles.wrong },
};

/**
 * A quotation, with what the SERVER found out about it. The badge comes from the check kept with the interface (the research layer read the text of the
 * work and matched the words, the speaker and the place); it is never taken from the model. A quotation with no check is shown as "Not checked", and one
 * that could not be confirmed is "Not verified": neither is ever dressed up as confirmed. Only a quotation that was confirmed offers to be copied.
 */
export function QuoteCard({ props }: Render) {
  const { context } = useHost();
  const quote = text(props.quote);
  const check = context.verifications.find((v) => v.key === quoteKey(quote));
  const badge = check ? BADGE[check.status] : { icon: "–", cls: styles.unverified };
  const label = check ? QUOTE_STATUS_LABEL[check.status] : "Not checked";
  const [copied, setCopied] = useState(false);
  const confirmed = check?.status === "VERIFIED_EXACT" || check?.status === "VERIFIED_VARIANT";
  const speaker = text(props.speaker);
  const location = text(props.location);
  const technique = text(props.technique);
  const note = text(props.note);
  async function copy() {
    try {
      await navigator.clipboard.writeText(`“${quote}” (${text(props.work)}${speaker ? `, ${speaker}` : ""}${location ? `, ${location}` : ""})`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <figure className={`${styles.quote} ${badge.cls}`} data-verification={check?.status ?? "NONE"}>
      <blockquote><Rich text={quote} /></blockquote>
      <figcaption>
        <span className={styles.cite}>
          <cite><Rich text={props.work} /></cite>
          {speaker ? <> · <Rich text={speaker} /></> : null}
          {location ? <> · <Rich text={location} /></> : null}
        </span>
        {technique ? <span className={styles.tag}><Rich text={technique} /></span> : null}
      </figcaption>
      {note ? <p className={styles.quoteNote}><Rich text={note} /></p> : null}
      <p className={styles.badgeRow}>
        <span className={styles.badge}><span aria-hidden="true">{badge.icon}</span> {label}</span>
        <span className={styles.badgeDetail}>{check ? check.detail : "This quotation was not checked against the text."}</span>
      </p>
      {check?.source ? (
        <p className={styles.badgeDetail}>
          Checked against <a href={check.source.url} target="_blank" rel="noreferrer noopener">{check.source.title || check.source.host}<span className="sr-only"> (opens in a new tab)</span></a>
        </p>
      ) : null}
      {confirmed ? (
        <button type="button" className={styles.linkButton} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy this quotation"}
        </button>
      ) : null}
    </figure>
  );
}
