"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import * as m from "framer-motion/m";
import { AnimatePresence, useReducedMotion } from "framer-motion";
import { subjectOptions, yearGroups } from "@/lib/site";

type FormValues = {
  parentName: string;
  email: string;
  phone: string;
  yearGroup: string;
  subject: string;
  support: string;
  contactMethod: string;
};

type FieldName = keyof FormValues;
type FormErrors = Partial<Record<FieldName, string>>;
type FormStatus = "idle" | "submitting" | "success" | "error";

const initialValues: FormValues = {
  parentName: "",
  email: "",
  phone: "",
  yearGroup: "",
  subject: "",
  support: "",
  contactMethod: "Email",
};

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};

  if (!values.parentName.trim()) {
    errors.parentName = "Enter the parent or guardian's name.";
  }
  if (!values.email.trim()) {
    errors.email = "Enter an email address.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = "Enter a valid email address.";
  }
  if (values.contactMethod === "Phone" && !values.phone.trim()) {
    errors.phone = "Enter a phone number when phone is your preferred contact method.";
  } else if (
    values.phone.trim() &&
    !/^[0-9+()\s-]{7,25}$/.test(values.phone.trim())
  ) {
    errors.phone = "Enter a valid phone number, or leave this field blank.";
  }
  if (!values.yearGroup) {
    errors.yearGroup = "Choose the student's year group.";
  }
  if (!values.subject) {
    errors.subject = "Choose a subject.";
  }
  if (!values.support.trim()) {
    errors.support = "Briefly describe the support you are looking for.";
  } else if (values.support.trim().length < 20) {
    errors.support = "Please add a little more detail (at least 20 characters).";
  }

  return errors;
}

export function EnquiryForm() {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<FormStatus>("idle");
  const [serverError, setServerError] = useState("");
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const serverErrorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);

  function updateField(name: FieldName, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    if (errors[name] || (name === "contactMethod" && errors.phone)) {
      setErrors((current) => ({
        ...current,
        [name]: undefined,
        ...(name === "contactMethod" && value === "Email"
          ? { phone: undefined }
          : {}),
      }));
    }
    if (status === "error") {
      setStatus("idle");
      setServerError("");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(values);

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setStatus("idle");
      window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }

    setErrors({});
    setStatus("submitting");
    setServerError("");

    try {
      const response = await fetch("/api/enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (response.ok) {
        setStatus("success");
        setValues(initialValues);
        window.requestAnimationFrame(() => successRef.current?.focus());
      } else {
        const data = await response.json().catch(() => null);
        setServerError(
          data?.error ?? "We could not send your enquiry right now. Please try again shortly.",
        );
        setStatus("error");
        window.requestAnimationFrame(() => serverErrorRef.current?.focus());
      }
    } catch {
      setServerError("A network error occurred. Please check your connection and try again.");
      setStatus("error");
      window.requestAnimationFrame(() => serverErrorRef.current?.focus());
    }
  }

  const hasErrors = Object.keys(errors).length > 0;
  const reduceMotion = useReducedMotion();

  // Purely derived, read-only — plan11.md task 11's "animated progress/section indicator". The
  // backend contract is untouched by any of this file's changes: still one <form>, one onSubmit,
  // one POST to /api/enquiry with the same FormValues shape. "Stages" are a visual grouping over
  // fields validate()/handleSubmit() have always used exactly as before, not a real multi-step
  // wizard — every field stays visible and submittable in one go.
  const stage1Complete =
    values.parentName.trim() !== "" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email) &&
    (values.contactMethod !== "Phone" || values.phone.trim() !== "");
  const stage2Complete =
    values.yearGroup !== "" && values.subject !== "" && values.support.trim().length >= 20;

  // initial/animate/exit stay the same {opacity, y} shape regardless of reduceMotion, matching
  // every other Motion usage on this site (see HeroScene.tsx's comment on the same point) — Motion
  // bakes the initial value into SSR'd HTML, and reduceMotion() can read differently between server
  // and a real reduced-motion client's first render, so branching these specific values risks a
  // hydration mismatch. The duration branch below is enough on its own.
  const panelTransition = { duration: reduceMotion ? 0.08 : 0.35 };
  const messageTransition = { duration: reduceMotion ? 0.08 : 0.25 };

  return (
    // initial={false}: this form has no Reveal/whileInView wrapper of its own (the homepage wraps
    // it in one, /book does not), so without this the initial={opacity:0} below would be the
    // SSR'd HTML's actual inline style — invisible until Motion hydrates and animates it in, the
    // same LCP risk this codebase already found and fixed for Reveal (see the (public) layout's
    // <noscript> comment and marketing-motion.spec.ts's "first block after the hero" guard).
    // initial={false} only suppresses the very first mount's enter transition; the later swap to
    // the success panel (only ever triggered post-hydration, by an actual submit) still animates.
    <AnimatePresence mode="wait" initial={false}>
      {status === "success" ? (
        <m.div
          key="success"
          className="form-message form-message--success"
          role="status"
          tabIndex={-1}
          ref={successRef}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={panelTransition}
        >
          {/* A restrained drawn check, not a celebratory animation — plan11.md task 11: "no
              confetti". pathLength is an SVG paint property (a stroke-dash offset under the hood),
              never layout. */}
          <m.svg
            className="form-success-check"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            initial={false}
          >
            <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="1.6" opacity="0.3" />
            <m.path
              d="M7 12.5l3.2 3.2L17 8.5"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: reduceMotion ? 0.08 : 0.5, delay: reduceMotion ? 0 : 0.15 }}
            />
          </m.svg>
          <strong>Your enquiry has been sent.</strong>
          <p>
            Thank you for getting in touch. We will review your enquiry and
            respond as soon as possible.
          </p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => setStatus("idle")}
          >
            <span>Send another enquiry</span>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4 10h11M11 6l4 4-4 4" />
            </svg>
          </button>
        </m.div>
      ) : (
        <m.form
          key="form"
          className="enquiry-form"
          noValidate
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={panelTransition}
        >
          <div className="enquiry-form-progress" aria-hidden="true">
            <div className="enquiry-form-progress-step">
              <span className={`enquiry-form-progress-dot${stage1Complete ? " is-complete" : ""}`} />
              Your details
            </div>
            <div className="enquiry-form-progress-line">
              <span
                className="enquiry-form-progress-fill"
                style={{ transform: stage1Complete ? "scaleX(1)" : "scaleX(0)" }}
              />
            </div>
            <div className="enquiry-form-progress-step">
              <span className={`enquiry-form-progress-dot${stage2Complete ? " is-complete" : ""}`} />
              About the student
            </div>
          </div>

          <AnimatePresence>
            {hasErrors ? (
              <m.div
                key="error-summary"
                className="form-message form-message--error"
                role="alert"
                tabIndex={-1}
                ref={errorSummaryRef}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={messageTransition}
              >
                <strong>Check the highlighted fields.</strong>
                <p>Your enquiry has not been sent yet.</p>
              </m.div>
            ) : null}

            {status === "error" && serverError ? (
              <m.div
                key="server-error"
                className="form-message form-message--error"
                role="alert"
                tabIndex={-1}
                ref={serverErrorRef}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={messageTransition}
              >
                <strong>There was a problem.</strong>
                <p>{serverError}</p>
              </m.div>
            ) : null}
          </AnimatePresence>

          <div className="form-stage">
            <p className="form-stage-heading">Your details</p>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="parent-name">Parent or guardian name</label>
                <input
                  id="parent-name"
                  name="parentName"
                  autoComplete="name"
                  value={values.parentName}
                  onChange={(event) => updateField("parentName", event.target.value)}
                  aria-invalid={Boolean(errors.parentName)}
                  aria-describedby={errors.parentName ? "parent-name-error" : undefined}
                  maxLength={100}
                  required
                />
                {errors.parentName ? (
                  <span className="field-error" id="parent-name-error">
                    {errors.parentName}
                  </span>
                ) : null}
              </div>

              <div className="form-field">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={values.email}
                  onChange={(event) => updateField("email", event.target.value)}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? "email-error" : undefined}
                  maxLength={160}
                  required
                />
                {errors.email ? (
                  <span className="field-error" id="email-error">
                    {errors.email}
                  </span>
                ) : null}
              </div>

              <div className="form-field">
                <label htmlFor="phone">
                  Phone number{" "}
                  <span>
                    {values.contactMethod === "Phone"
                      ? "(required for phone contact)"
                      : "(optional)"}
                  </span>
                </label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={values.phone}
                  onChange={(event) => updateField("phone", event.target.value)}
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errors.phone ? "phone-error" : undefined}
                  maxLength={25}
                  required={values.contactMethod === "Phone"}
                />
                {errors.phone ? (
                  <span className="field-error" id="phone-error">
                    {errors.phone}
                  </span>
                ) : null}
              </div>
            </div>

            <fieldset className="contact-preference">
              <legend>Preferred contact method</legend>
              <div>
                {["Email", "Phone"].map((method) => (
                  <label key={method}>
                    <input
                      type="radio"
                      name="contactMethod"
                      value={method}
                      checked={values.contactMethod === method}
                      onChange={(event) =>
                        updateField("contactMethod", event.target.value)
                      }
                    />
                    <span>{method}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="form-stage">
            <p className="form-stage-heading">About the student</p>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="year-group">Student&apos;s year group</label>
                <select
                  id="year-group"
                  name="yearGroup"
                  value={values.yearGroup}
                  onChange={(event) => updateField("yearGroup", event.target.value)}
                  aria-invalid={Boolean(errors.yearGroup)}
                  aria-describedby={errors.yearGroup ? "year-group-error" : undefined}
                  required
                >
                  <option value="">Select a year group</option>
                  {yearGroups.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
                {errors.yearGroup ? (
                  <span className="field-error" id="year-group-error">
                    {errors.yearGroup}
                  </span>
                ) : null}
              </div>

              <div className="form-field form-field--full">
                <label htmlFor="subject">Subject</label>
                <select
                  id="subject"
                  name="subject"
                  value={values.subject}
                  onChange={(event) => updateField("subject", event.target.value)}
                  aria-invalid={Boolean(errors.subject)}
                  aria-describedby={errors.subject ? "subject-error" : undefined}
                  required
                >
                  <option value="">Select a subject</option>
                  {subjectOptions.map((subject) => (
                    <option key={subject} value={subject}>
                      {subject}
                    </option>
                  ))}
                </select>
                {errors.subject ? (
                  <span className="field-error" id="subject-error">
                    {errors.subject}
                  </span>
                ) : null}
              </div>

              <div className="form-field form-field--full">
                <label htmlFor="support-required">What support are you looking for?</label>
                <textarea
                  id="support-required"
                  name="support"
                  rows={6}
                  value={values.support}
                  onChange={(event) => updateField("support", event.target.value)}
                  aria-invalid={Boolean(errors.support)}
                  aria-describedby={errors.support ? "support-hint support-error" : "support-hint"}
                  maxLength={1000}
                  required
                />
                <span className="field-hint" id="support-hint">
                  Please avoid including sensitive personal or medical information.
                </span>
                {errors.support ? (
                  <span className="field-error" id="support-error">
                    {errors.support}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button
              className="button button--primary"
              type="submit"
              disabled={status === "submitting"}
            >
              <span>
                {status === "submitting" ? "Sending…" : "Send enquiry"}
              </span>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4 10h11M11 6l4 4-4 4" />
              </svg>
            </button>
            <p>
              By submitting this form you agree to our{" "}
              <Link href="/privacy">privacy notice</Link>. Your information will
              only be used to respond to your enquiry.
            </p>
          </div>
        </m.form>
      )}
    </AnimatePresence>
  );
}
