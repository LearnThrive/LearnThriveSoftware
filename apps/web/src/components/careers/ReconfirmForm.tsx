"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { fieldId, Honeypot, RadioGroup, TextField } from "@/components/forms/Fields";
import forms from "@/components/forms/forms.module.css";
import { HumanCheck } from "@/components/forms/HumanCheck";
import { useHumanCheck } from "@/components/forms/useHumanCheck";
import { PhoneContacts } from "@/components/PhoneContacts";
import { careersConfig } from "@/lib/careers-config";
import { CHANGE_CHOICES, emptyReconfirm, validateReconfirm, type ReconfirmErrors, type ReconfirmFields } from "@/lib/reconfirm";
import { currentAgreement } from "@/lib/safeguarding-agreement";
import { siteConfig } from "@/lib/site";
import { AgreementSection } from "./AgreementSection";
import styles from "./apply/apply.module.css";

/**
 * The yearly (and new-version) reconfirmation of the safeguarding agreement, for existing tutors. The same
 * agreement section as the application, a "has anything changed" question, and a typed name that must match
 * the full name given. It has no login, so the owners match each submission against their list of tutors
 * (docs/AGREEMENT_RECONFIRMATION.md). Held in memory only; the browser warns before you leave with unsent work.
 */
const UNDERSTANDING_REQUIRED = careersConfig.understandingCheck.reconfirmation;

export function ReconfirmForm() {
  const [values, setValues] = useState<ReconfirmFields>(() => ({ ...emptyReconfirm(), agreementVersion: currentAgreement.version }));
  const [attempted, setAttempted] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [serverErrors, setServerErrors] = useState<ReconfirmErrors>({});
  const [result, setResult] = useState<{ reference: string; changeDeclared: boolean } | null>(null);
  const [trap, setTrap] = useState("");
  const openedAt = useRef(0);
  const sending = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const check = useHumanCheck();

  useEffect(() => {
    openedAt.current = performance.now();
  }, []);

  const set = useCallback(<K extends keyof ReconfirmFields>(key: K, value: ReconfirmFields[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setServerErrors({});
  }, []);

  const fieldErrors = useMemo(() => validateReconfirm(values, { agreement: currentAgreement, understandingRequired: UNDERSTANDING_REQUIRED }), [values]);
  const merged: ReconfirmErrors = { ...serverErrors, ...fieldErrors };
  const shown: ReconfirmErrors = attempted ? merged : {};
  const order: Array<keyof ReconfirmFields> = ["fullName", "email", "change", "agreedParts", "understanding", "typedName"];
  const problems = order.filter((key) => merged[key]).map((key) => ({ key, message: merged[key] as string }));

  const dirty = Boolean(values.fullName || values.email || values.change || values.agreedParts.length || values.typedName || trap);
  useEffect(() => {
    if (!dirty || status === "sent") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, status]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    setAttempted(true);
    if (problems.length > 0) {
      setStatus("idle");
      window.requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    const answer = check.getAnswer();
    if (!answer) {
      setStatus("error");
      setMessage("The check that you are a person has not finished yet. Please wait a moment, then send again.");
      window.requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }

    sending.current = true;
    setStatus("sending");
    setMessage("");
    try {
      const response = await fetch("/api/safeguarding/reconfirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, website: trap, elapsedMs: Math.round(performance.now() - openedAt.current), humanCheck: answer }),
      });
      const data = (await response.json().catch(() => null)) as { success?: boolean; reference?: string; changeDeclared?: boolean; error?: string; errors?: ReconfirmErrors } | null;
      if (response.ok && data?.success && data.reference) {
        setResult({ reference: data.reference, changeDeclared: Boolean(data.changeDeclared) });
        setStatus("sent");
        setValues({ ...emptyReconfirm(), agreementVersion: currentAgreement.version });
        window.requestAnimationFrame(() => resultRef.current?.focus());
      } else {
        if (data?.errors) setServerErrors(data.errors);
        setMessage(data?.error ?? "We could not record your reconfirmation just now. Please try again shortly.");
        setStatus("error");
        window.requestAnimationFrame(() => (data?.errors ? summaryRef : errorRef).current?.focus());
      }
      if (![413, 429, 503].includes(response.status)) check.renew();
    } catch {
      setMessage("A network error occurred. Please check your connection and try again. Nothing has been sent.");
      setStatus("error");
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      sending.current = false;
    }
  }

  if (status === "sent" && result) {
    return (
      <div className={`form-message form-message--success ${forms.result}`} role="status" tabIndex={-1} ref={resultRef}>
        <strong>Thank you. Your reconfirmation has been recorded.</strong>
        <p>
          Your reference is <span className={forms.reference}>{result.reference}</span>. We have emailed you a copy of the record: the version, the name you
          typed and the time it was received.
        </p>
        {result.changeDeclared ? (
          <p>
            <strong>You told us that something has changed.</strong> Please contact the safeguarding lead directly and immediately, on <PhoneContacts /> or at{" "}
            <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.
          </p>
        ) : null}
        <div className={forms.actions}>
          <Link className="text-link" href="/careers/safeguarding-agreement">
            Read the safeguarding agreement <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.sections} noValidate onSubmit={onSubmit} aria-label="Reconfirm the safeguarding agreement">
      <p className={forms.note}>
        Nothing you type is saved: if you leave this page before sending, you will lose it. All fields are required.
      </p>

      {attempted && problems.length > 0 ? (
        <div className={`form-message form-message--error ${forms.summary}`} role="alert" tabIndex={-1} ref={summaryRef}>
          <strong>{problems.length === 1 ? "There is 1 thing to check." : `There are ${problems.length} things to check.`}</strong>
          <p>Your reconfirmation has not been sent yet.</p>
          <ul>
            {problems.map((problem) => (
              <li key={problem.key}>
                <a
                  href={`#${fieldId(problem.key)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    const element = document.getElementById(fieldId(problem.key));
                    element?.scrollIntoView({ block: "center" });
                    element?.focus({ preventScroll: true });
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
          <p>
            You can also contact the safeguarding lead directly at <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.
          </p>
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="reconfirm-you-heading">
        <p className={styles.kicker}>Step 1 of 2</p>
        <h2 id="reconfirm-you-heading">About you</h2>
        <div className={styles.stack}>
          <div className={forms.grid}>
            <TextField name="fullName" label="Full name" value={values.fullName} onChange={(v) => set("fullName", v)} error={shown.fullName} autoComplete="name" maxLength={100} />
            <TextField name="email" label="Email address" type="email" inputMode="email" value={values.email} onChange={(v) => set("email", v)} error={shown.email} autoComplete="email" maxLength={160} />
          </div>
          <RadioGroup
            name="change"
            legend="Has anything changed that could affect your suitability to work with children?"
            stacked
            options={CHANGE_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
            value={values.change}
            onChange={(v) => set("change", v)}
            error={shown.change}
          />
          {values.change === "changed" ? (
            <div className={styles.privateNote} role="note">
              <p>
                <strong>Contact the safeguarding lead directly and immediately.</strong> Call <PhoneContacts /> or email{" "}
                <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>. Do not wait.
              </p>
              <p>You can still send this reconfirmation. It will be marked as a declared change.</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="reconfirm-agreement-heading">
        <p className={styles.kicker}>Step 2 of 2</p>
        <h2 id="reconfirm-agreement-heading">The safeguarding agreement</h2>
        <p className={styles.sectionIntro}>
          Read the whole agreement below, tick each part, and type your full name. The same text is at{" "}
          <Link href="/careers/safeguarding-agreement">its own page</Link>.
        </p>
        <AgreementSection
          agreement={currentAgreement}
          agreedParts={values.agreedParts}
          onAgreedParts={(parts) => set("agreedParts", parts)}
          understandingRequired={UNDERSTANDING_REQUIRED}
          understanding={values.understanding}
          onUnderstanding={(answers) => set("understanding", answers)}
          typedName={values.typedName}
          onTypedName={(name) => set("typedName", name)}
          typedNameLabel="Type your full name to confirm"
          typedNameHint="Use your full name exactly as you gave it above."
          errors={{ agreedParts: shown.agreedParts, understanding: shown.understanding, typedName: shown.typedName }}
        />
        <p className={forms.note}>
          Agreement version {currentAgreement.version}, dated {currentAgreement.dateLabel}.
        </p>
      </section>

      <Honeypot id="reconfirm-website" value={trap} onChange={setTrap} />
      <div id={fieldId("humanCheck")} tabIndex={-1}>
        <HumanCheck check={check} />
      </div>
      <div className={forms.actions}>
        <button className="button button--primary" type="submit" disabled={status === "sending" || check.state.status === "unavailable"} aria-busy={status === "sending"}>
          <span>{status === "sending" ? "Sending…" : "Reconfirm the agreement"}</span>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 10h11M11 6l4 4-4 4" />
          </svg>
        </button>
        <p className={forms.note}>
          This page cannot check who you are, so LearnThrive matches your submission against its list of tutors. Your details are sent to LearnThrive by email
          and nothing is stored on this website.
        </p>
      </div>
    </form>
  );
}
