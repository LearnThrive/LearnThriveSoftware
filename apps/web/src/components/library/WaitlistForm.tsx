"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore, useEffect, type FormEvent } from "react";
import { CheckboxField, fieldId, Honeypot, TextField } from "@/components/forms/Fields";
import forms from "@/components/forms/forms.module.css";
import { HumanCheck } from "@/components/forms/HumanCheck";
import { useFocusAfterRender } from "@/components/forms/useFocusAfterRender";
import { useHumanCheck } from "@/components/forms/useHumanCheck";
import { libraryConfig } from "@/lib/library-config";
import { emptyWaitlist, validateWaitlist, WAITLIST_CONSENT_LABEL, type WaitlistErrors, type WaitlistFields } from "@/lib/library-waitlist";
import { siteConfig } from "@/lib/site";
import styles from "./WaitlistForm.module.css";
import { WAITLIST_MAILTO } from "./waitlistMailto";

const subscribeNothing = () => () => undefined;

/**
 * Join the Library waitlist: an email address and a separate, unticked box asking to be emailed once, when the
 * Library launches (POST /api/library-waitlist). Nothing is stored in the browser or on the website: the address
 * goes by email to the owners (lib/library-waitlist.ts). The form is drawn only once the page's scripts have run,
 * so without JavaScript there is no form that could put an address into the page's URL; WaitlistSection shows a
 * mailto: fallback in <noscript> instead.
 */
export function WaitlistForm() {
  const ready = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [values, setValues] = useState<WaitlistFields>(emptyWaitlist);
  const [attempted, setAttempted] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [serverErrors, setServerErrors] = useState<WaitlistErrors>({});
  const [trap, setTrap] = useState("");
  const openedAt = useRef(0);
  const sending = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  // Most visitors only read the page, so the check starts when the form is first touched.
  const check = useHumanCheck({ auto: false });
  const focusAfterRender = useFocusAfterRender();

  useEffect(() => {
    openedAt.current = performance.now();
  }, []);

  function set<K extends keyof WaitlistFields>(key: K, value: WaitlistFields[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setServerErrors({});
  }

  const fieldErrors = useMemo(() => validateWaitlist(values), [values]);
  const merged: WaitlistErrors = { ...serverErrors, ...fieldErrors };
  const shown: WaitlistErrors = attempted ? merged : {};
  const order: Array<keyof WaitlistFields> = ["email", "consent"];
  const problems = order.filter((key) => merged[key]).map((key) => ({ key, message: merged[key] as string }));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    setAttempted(true);
    if (problems.length > 0) {
      setStatus("idle");
      focusAfterRender(summaryRef);
      return;
    }
    const answer = check.getAnswer();
    if (!answer) {
      setStatus("error");
      setMessage("The check that you are a person has not finished yet. Please wait a moment, then try again.");
      focusAfterRender(errorRef);
      return;
    }
    sending.current = true;
    setStatus("sending");
    setMessage("");
    setUnavailable(false);
    try {
      const response = await fetch("/api/library-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, website: trap, elapsedMs: Math.round(performance.now() - openedAt.current), humanCheck: answer }),
      });
      const data = (await response.json().catch(() => null)) as { success?: boolean; code?: string; error?: string; errors?: WaitlistErrors } | null;
      if (response.ok && data?.success) {
        setStatus("sent");
        focusAfterRender(resultRef);
      } else {
        if (data?.errors) setServerErrors(data.errors);
        setUnavailable(response.status === 503 || data?.code === "unavailable");
        setMessage(data?.error ?? "We could not add you to the waitlist just now. Please try again shortly.");
        setStatus("error");
        focusAfterRender(data?.errors ? summaryRef : errorRef);
      }
      if (![413, 429, 503].includes(response.status)) check.renew();
    } catch {
      setMessage("A network error occurred. Please check your connection and try again.");
      setStatus("error");
      focusAfterRender(errorRef);
    } finally {
      sending.current = false;
    }
  }

  if (status === "sent") {
    return (
      <div className={`form-message form-message--success ${forms.result}`} role="status" tabIndex={-1} ref={resultRef} data-waitlist-sent="">
        <strong>You are on the waitlist.</strong>
        <p>
          We will email you once, when the Library launches. To be taken off the waitlist, write to <a href={WAITLIST_MAILTO}>{siteConfig.email}</a> and we will
          delete your address.
        </p>
      </div>
    );
  }

  return (
    <form className={styles.form} noValidate hidden={!ready} onSubmit={onSubmit} onFocus={check.start} aria-label="Join the Library waitlist">
      {attempted && problems.length > 0 ? (
        <div className={`form-message form-message--error ${forms.summary}`} role="alert" tabIndex={-1} ref={summaryRef}>
          <strong>{problems.length === 1 ? "There is 1 thing to check." : `There are ${problems.length} things to check.`}</strong>
          <p>You have not been added to the waitlist yet.</p>
          <ul>
            {problems.map((problem) => (
              <li key={problem.key}>
                <a
                  href={`#${fieldId(problem.key)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(fieldId(problem.key))?.focus();
                  }}
                >
                  {problem.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {status === "error" && message ? (
        <div className={`form-message form-message--error ${forms.summary}`} role="alert" tabIndex={-1} ref={errorRef}>
          <strong>There was a problem.</strong>
          <p>{message}</p>
          {unavailable ? (
            <p>
              Prefer email? Write to <a href={WAITLIST_MAILTO}>{siteConfig.email}</a> and ask to be added to the Library waitlist.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={styles.fields}>
        <TextField
          name="email"
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={values.email}
          onChange={(v) => set("email", v)}
          error={shown.email}
          maxLength={libraryConfig.waitlist.emailMaxLength}
        />
        <CheckboxField name="consent" checked={values.consent} onChange={(on) => set("consent", on)} label={WAITLIST_CONSENT_LABEL} error={shown.consent} />
      </div>

      <Honeypot id="library-waitlist-website" value={trap} onChange={setTrap} />
      <div className={styles.actions}>
        <button className="button button--primary" type="submit" disabled={status === "sending" || check.state.status === "unavailable"} aria-busy={status === "sending"}>
          <span>{status === "sending" ? "Joining…" : "Join the waitlist"}</span>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 10h11M11 6l4 4-4 4" />
          </svg>
        </button>
        <div id={fieldId("humanCheck")} tabIndex={-1}>
          <HumanCheck check={check} />
        </div>
      </div>
      <p className={`${forms.note} ${styles.privacy}`}>
        We use your email address only to send you one email when the Library launches. Nothing is stored on this website: your address stays in our mailbox until
        that email has been sent, or for {libraryConfig.waitlist.retentionMonths} months, whichever comes first, and we delete it if you ask. See our{" "}
        <Link href="/privacy">privacy notice</Link>.
      </p>
    </form>
  );
}
