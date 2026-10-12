"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CheckboxField, fieldId, Honeypot, RadioGroup, SelectField, TextAreaField, TextField } from "@/components/forms/Fields";
import forms from "@/components/forms/forms.module.css";
import { HumanCheck } from "@/components/forms/HumanCheck";
import { useFocusAfterRender } from "@/components/forms/useFocusAfterRender";
import { useHumanCheck } from "@/components/forms/useHumanCheck";
import {
  ASKED_BY_OPTIONS,
  emptySubjectRequest,
  LEVEL_OPTIONS,
  NOTE_MAX,
  OTHER_MAX,
  OTHER_SUBJECT,
  SUBJECT_REQUEST_OPTIONS,
  validateSubjectRequest,
  type SubjectRequestErrors,
  type SubjectRequestFields,
} from "@/lib/subject-request";
import { siteConfig } from "@/lib/site";
import styles from "./SubjectRequestForm.module.css";

/**
 * "Can't see your subject?": a family asks for a subject LearnThrive does not yet offer. A subject list with an
 * "Other" option that reveals a text box (announced to screen readers, and never stealing focus), a level, who
 * is asking, an optional note, and an optional email address that is used only if the separate box is ticked.
 * No child's name is asked for. Sent to the owners by email (/api/subject-request); nothing is stored.
 */
export function SubjectRequestForm() {
  const [values, setValues] = useState<SubjectRequestFields>(emptySubjectRequest);
  const [attempted, setAttempted] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [serverErrors, setServerErrors] = useState<SubjectRequestErrors>({});
  const [announcement, setAnnouncement] = useState("");
  const [trap, setTrap] = useState("");
  const openedAt = useRef(0);
  const sending = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  // Most visitors to /subjects only read the page, so the check starts when the form is first touched.
  const check = useHumanCheck({ auto: false });
  const focusAfterRender = useFocusAfterRender();

  useEffect(() => {
    openedAt.current = performance.now();
  }, []);

  const isOther = values.subject === OTHER_SUBJECT;

  function set<K extends keyof SubjectRequestFields>(key: K, value: SubjectRequestFields[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setServerErrors({});
  }

  function chooseSubject(subject: string) {
    const becomesOther = subject === OTHER_SUBJECT;
    set("subject", subject);
    // The text box is dropped from the page when another subject is chosen, so its value goes with it.
    if (!becomesOther) set("other", "");
    if (becomesOther !== isOther) setAnnouncement(becomesOther ? "A text box has appeared below: which subject?" : "The text box for another subject has been removed.");
  }

  const fieldErrors = useMemo(() => validateSubjectRequest(values), [values]);
  const merged: SubjectRequestErrors = { ...serverErrors, ...fieldErrors };
  const shown: SubjectRequestErrors = attempted ? merged : {};
  const order: Array<keyof SubjectRequestFields> = ["subject", "other", "level", "askedBy", "note", "email"];
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
      setMessage("The check that you are a person has not finished yet. Please wait a moment, then send again.");
      focusAfterRender(errorRef);
      return;
    }
    sending.current = true;
    setStatus("sending");
    setMessage("");
    try {
      const response = await fetch("/api/subject-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, website: trap, elapsedMs: Math.round(performance.now() - openedAt.current), humanCheck: answer }),
      });
      const data = (await response.json().catch(() => null)) as { success?: boolean; error?: string; errors?: SubjectRequestErrors } | null;
      if (response.ok && data?.success) {
        setStatus("sent");
        focusAfterRender(resultRef);
      } else {
        if (data?.errors) setServerErrors(data.errors);
        setMessage(data?.error ?? "We could not send your request just now. Please try again shortly.");
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
      <div className={`form-message form-message--success ${forms.result}`} role="status" tabIndex={-1} ref={resultRef}>
        <strong>Thank you. Your request has been sent.</strong>
        <p>
          We use requests like yours to decide which subjects to add. We cannot promise that any subject will be added.
          {values.notify ? " As you asked, we will email you only if this subject becomes available." : ""}
        </p>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => {
            setValues(emptySubjectRequest());
            setAttempted(false);
            setStatus("idle");
            openedAt.current = performance.now();
          }}
        >
          <span>Ask for another subject</span>
        </button>
      </div>
    );
  }

  return (
    <form className={styles.form} noValidate onSubmit={onSubmit} onFocus={check.start} aria-label="Request a subject">
      {attempted && problems.length > 0 ? (
        <div className={`form-message form-message--error ${forms.summary}`} role="alert" tabIndex={-1} ref={summaryRef}>
          <strong>{problems.length === 1 ? "There is 1 thing to check." : `There are ${problems.length} things to check.`}</strong>
          <p>Your request has not been sent yet.</p>
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
        </div>
      ) : null}

      <div className={forms.grid}>
        <SelectField
          name="subject"
          label="Subject you would like"
          value={values.subject}
          onChange={chooseSubject}
          error={shown.subject}
          options={[...SUBJECT_REQUEST_OPTIONS, OTHER_SUBJECT]}
          placeholder="Choose a subject"
          hint="We already teach Maths, English, Science and 11+ preparation."
        />
        <SelectField name="level" label="Level" value={values.level} onChange={(v) => set("level", v)} error={shown.level} options={LEVEL_OPTIONS} placeholder="Choose a level" />
        {isOther ? (
          <div className={forms.full}>
            <TextField name="other" label="Which subject?" value={values.other} onChange={(v) => set("other", v)} error={shown.other} maxLength={OTHER_MAX} autoComplete="off" />
          </div>
        ) : null}
        <div className={forms.full}>
          <RadioGroup
            name="askedBy"
            legend="Who is asking?"
            options={ASKED_BY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            value={values.askedBy}
            onChange={(v) => set("askedBy", v)}
            error={shown.askedBy}
            inline
          />
        </div>
        <div className={styles.stack}>
          <TextField
            name="email"
            label="Email address"
            optional
            type="email"
            inputMode="email"
            autoComplete="email"
            hint="We only use it if you tick the box below."
            value={values.email}
            onChange={(v) => set("email", v)}
            error={shown.email}
            maxLength={160}
          />
          <CheckboxField name="notify" checked={values.notify} onChange={(on) => set("notify", on)} label="Email me if this subject becomes available." />
        </div>
        <TextAreaField
          name="note"
          label="Anything else you would like us to know"
          optional
          hint="Please do not include a child’s name or any other personal details."
          value={values.note}
          onChange={(v) => set("note", v)}
          error={shown.note}
          rows={4}
          maxLength={NOTE_MAX}
          counter
        />
      </div>

      <Honeypot id="subject-request-website" value={trap} onChange={setTrap} />
      <div className={styles.actions}>
        <button className="button button--primary" type="submit" disabled={status === "sending" || check.state.status === "unavailable"} aria-busy={status === "sending"}>
          <span>{status === "sending" ? "Sending…" : "Send request"}</span>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 10h11M11 6l4 4-4 4" />
          </svg>
        </button>
        <div id={fieldId("humanCheck")} tabIndex={-1}>
          <HumanCheck check={check} />
        </div>
      </div>
      <p className={`${forms.note} ${styles.privacy}`}>
        Your request is sent to LearnThrive by email and nothing is stored on this website. If you give an email address and tick the box, we use it only to tell
        you if the subject becomes available. See our <Link href="/privacy">privacy notice</Link>. Or email <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.
      </p>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </form>
  );
}
