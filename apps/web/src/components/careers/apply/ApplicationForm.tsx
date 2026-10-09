"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CheckboxField, fieldId, Honeypot } from "@/components/forms/Fields";
import forms from "@/components/forms/forms.module.css";
import { HumanCheck } from "@/components/forms/HumanCheck";
import { useHumanCheck } from "@/components/forms/useHumanCheck";
import { careersConfig } from "@/lib/careers-config";
import { checkFileBasics, totalProblem, type SupportingDocumentType } from "@/lib/careers-files";
import { emptyApplication, validateApplication, type ApplicationErrors, type ApplicationFields } from "@/lib/careers-validation";
import { currentAgreement } from "@/lib/safeguarding-agreement";
import { siteConfig } from "@/lib/site";
import { AgreementSection } from "../AgreementSection";
import styles from "./apply.module.css";
import { type SupportingItem } from "./FileFields";
import { AboutYou, AvailabilityAndSetup, ExperienceAndResults, TheRole } from "./SectionsAboutToAvailability";
import { SupportingDocuments, YourApplication } from "./SectionsApplicationAndDocuments";
import { errorTarget, SECTION_FIELDS, SECTION_TITLES } from "./types";

/**
 * The tutor application: one scrolling page in eight numbered sections, with a section list that shows what
 * is done. Everything lives in this component's memory and nowhere else: there is no draft saving, no cookie
 * and no browser storage, and the browser's own leave warning appears if there is unsent work. The files and
 * the answers go to /api/careers/apply in one request. See that route for what the server does with them.
 */
export interface ApplicationFormProps {
  roles: ReadonlyArray<{ slug: string; title: string }>;
  initialRole: string;
  /** Today (YYYY-MM-DD), from the server, so server and browser agree on the date input's minimum. */
  today: string;
}

interface Problem {
  id: string;
  message: string;
  section: number;
}

interface ServerFileErrors {
  cv?: string;
  coverLetterFile?: string;
  supporting?: Array<string | null>;
  total?: string;
}

const UNDERSTANDING_REQUIRED = careersConfig.understandingCheck.applications;
const TOTAL_SECTIONS = SECTION_TITLES.length;

function SectionFrame({ n, intro, children }: { n: number; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section} id={`section-${n}`} aria-labelledby={`section-${n}-heading`} tabIndex={-1}>
      <p className={styles.kicker}>
        Section {n} of {TOTAL_SECTIONS}
      </p>
      <h2 id={`section-${n}-heading`}>{SECTION_TITLES[n - 1]}</h2>
      {intro ? <div className={styles.sectionIntro}>{intro}</div> : null}
      {children}
    </section>
  );
}

export function ApplicationForm({ roles, initialRole, today }: ApplicationFormProps) {
  const [values, setValues] = useState<ApplicationFields>(() => ({ ...emptyApplication(initialRole), agreementVersion: currentAgreement.version }));
  const [cv, setCv] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [docs, setDocs] = useState<SupportingItem[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [serverErrors, setServerErrors] = useState<ApplicationErrors>({});
  const [serverFiles, setServerFiles] = useState<ServerFileErrors>({});
  const [result, setResult] = useState<{ reference: string; role: string } | null>(null);
  const [trap, setTrap] = useState("");
  const [live, setLive] = useState("");
  const openedAt = useRef(0);
  const sending = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const check = useHumanCheck();

  useEffect(() => {
    openedAt.current = performance.now();
  }, []);

  const announce = useCallback((text: string) => setLive(text), []);
  const clearServer = useCallback(() => {
    setServerErrors({});
    setServerFiles({});
  }, []);

  const set = useCallback(
    <K extends keyof ApplicationFields>(key: K, value: ApplicationFields[K]) => {
      setValues((current) => ({ ...current, [key]: value }));
      clearServer();
    },
    [clearServer],
  );

  // ── What is wrong, live ────────────────────────────────────────────────────────────────────────
  const fieldErrors = useMemo(
    () => validateApplication(values, { agreement: currentAgreement, today, understandingRequired: UNDERSTANDING_REQUIRED }),
    [values, today],
  );

  const files = useMemo(() => {
    const cvProblem = cv ? checkFileBasics("cv", cv.name, cv.size)?.message : undefined;
    const coverProblem = coverFile ? checkFileBasics("coverLetterFile", coverFile.name, coverFile.size)?.message : undefined;
    const docProblems: Record<string, string> = {};
    for (const item of docs) {
      const basic = checkFileBasics("supporting", item.file.name, item.file.size)?.message;
      if (basic) docProblems[item.id] = basic;
      else if (!item.type) docProblems[item.id] = "Choose what type of document this is.";
    }
    const sizes = [cv, coverFile, ...docs.map((item) => item.file)].filter((file): file is File => Boolean(file)).map((file) => file.size);
    return { cvProblem, coverProblem, docProblems, total: sizes.reduce((sum, size) => sum + size, 0), totalProblem: totalProblem(sizes)?.message };
  }, [cv, coverFile, docs]);

  const problems = useMemo<Problem[]>(() => {
    const list: Problem[] = [];
    const merged: ApplicationErrors = { ...serverErrors, ...fieldErrors };
    for (let n = 1; n <= TOTAL_SECTIONS; n += 1) {
      for (const key of SECTION_FIELDS[n]) {
        const text = merged[key];
        if (text) list.push({ id: errorTarget(key), message: text, section: n });
      }
      if (n === 5) {
        const cvText = !cv ? "Attach your CV." : (files.cvProblem ?? serverFiles.cv);
        if (cvText) list.push({ id: fieldId("cv"), message: `CV: ${cvText}`, section: 5 });
        const coverText = files.coverProblem ?? serverFiles.coverLetterFile;
        if (coverText) list.push({ id: fieldId("coverLetterFile"), message: `Cover letter file: ${coverText}`, section: 5 });
      }
      if (n === 6) {
        docs.forEach((item, index) => {
          const text = files.docProblems[item.id] ?? serverFiles.supporting?.[index];
          if (text) list.push({ id: fieldId(`docType-${item.id}`), message: `${item.file.name}: ${text}`, section: 6 });
        });
        const total = files.totalProblem ?? serverFiles.total;
        if (total) list.push({ id: fieldId("supporting"), message: total, section: 6 });
      }
    }
    return list;
  }, [fieldErrors, serverErrors, files, serverFiles, cv, coverFile, docs]);

  const shown = attempted ? { ...serverErrors, ...fieldErrors } : {};
  const sectionState = (n: number): "complete" | "attention" | "todo" | "optional" => {
    const has = problems.some((problem) => problem.section === n);
    if (n === 6) return has ? (attempted ? "attention" : "todo") : docs.length > 0 ? "complete" : "optional";
    if (has) return attempted ? "attention" : "todo";
    return n === 8 ? "todo" : "complete";
  };
  const STATE_LABEL = { complete: "Complete", attention: "Needs attention", todo: "To do", optional: "Optional" } as const;

  // ── Unsent work: the browser's leave warning ───────────────────────────────────────────────────
  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify({ ...emptyApplication(initialRole), agreementVersion: currentAgreement.version }) || Boolean(cv || coverFile || docs.length || trap),
    [values, cv, coverFile, docs, trap, initialRole],
  );
  useEffect(() => {
    if (!dirty || status === "sent") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    // A link inside the site does not unload the page, so the browser would say nothing: ask the same question.
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.protocol === "mailto:" || url.protocol === "tel:") return;
      if (url.origin === window.location.origin && url.pathname === window.location.pathname) return;
      if (!window.confirm("You have not sent your application yet. If you leave this page, what you have typed will be lost. Leave anyway?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, status]);

  // ── Sending ────────────────────────────────────────────────────────────────────────────────────
  const focusTarget = (id: string) => {
    const element = document.getElementById(id);
    element?.scrollIntoView({ block: "center" });
    element?.focus({ preventScroll: true });
  };

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
    const form = new FormData();
    form.append(
      "payload",
      JSON.stringify({
        ...values,
        website: trap,
        elapsedMs: Math.round(performance.now() - openedAt.current),
        humanCheck: answer,
        documentTypes: docs.map((item) => item.type as SupportingDocumentType),
      }),
    );
    if (cv) form.append("cv", cv, cv.name);
    if (coverFile) form.append("coverLetterFile", coverFile, coverFile.name);
    docs.forEach((item, index) => form.append(`support-${index}`, item.file, item.file.name));

    try {
      const response = await fetch("/api/careers/apply", { method: "POST", body: form });
      const data = (await response.json().catch(() => null)) as { success?: boolean; reference?: string; role?: string; error?: string; errors?: ApplicationErrors; fileErrors?: ServerFileErrors } | null;
      if (response.ok && data?.success && data.reference) {
        setResult({ reference: data.reference, role: data.role ?? "" });
        setStatus("sent");
        // Nothing is kept: clear the answers and files from memory as well.
        setValues(emptyApplication());
        setCv(null);
        setCoverFile(null);
        setDocs([]);
        window.requestAnimationFrame(() => resultRef.current?.focus());
      } else {
        if (data?.errors) setServerErrors(data.errors);
        if (data?.fileErrors) setServerFiles(data.fileErrors);
        setMessage(data?.error ?? "We could not send your application just now. Please try again shortly.");
        setStatus("error");
        window.requestAnimationFrame(() => (data?.errors || data?.fileErrors ? summaryRef : errorRef).current?.focus());
      }
      if (![413, 429, 503].includes(response.status)) check.renew();
    } catch {
      setMessage("A network error occurred. Please check your connection and try again. Your application has not been sent.");
      setStatus("error");
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      sending.current = false;
    }
  }

  if (status === "sent" && result) {
    return (
      <div className={`form-message form-message--success ${forms.result}`} role="status" tabIndex={-1} ref={resultRef}>
        <strong>Your application has been sent.</strong>
        <p>
          Thank you. We have emailed you a confirmation. Your reference is <span className={forms.reference}>{result.reference}</span>
          {result.role ? <> for {result.role}</> : null}. Please keep it: quote it if you write to us about your application.
        </p>
        <p>{careersConfig.responseTime}</p>
        <p>
          You agreed to version {currentAgreement.version} of the safeguarding agreement. If you are offered work you will also sign the tutor agreement, which
          includes the same expectations.
        </p>
        <div className={forms.actions}>
          <Link className="button button--primary" href="/careers">
            <span>Back to careers</span>
          </Link>
          <Link className="text-link" href="/careers/safeguarding-agreement">
            Read the safeguarding agreement <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    );
  }

  const docErrorsById = { ...files.docProblems };
  docs.forEach((item, index) => {
    const text = serverFiles.supporting?.[index];
    if (text && !docErrorsById[item.id]) docErrorsById[item.id] = text;
  });
  const reviewOk = problems.length === 0;

  return (
    <div className={styles.layout}>
      <nav className={styles.nav} aria-label="Application sections">
        <p className={styles.navTitle}>Your application</p>
        <ol className={styles.navList}>
          {SECTION_TITLES.map((title, index) => {
            const n = index + 1;
            const state = sectionState(n);
            return (
              <li key={title}>
                <a className={styles.navLink} href={`#section-${n}`} data-state={state}>
                  <span className={styles.navNumber} aria-hidden="true">
                    {state === "complete" ? "✓" : n}
                  </span>
                  <span className={styles.navLabel}>
                    <span>
                      <span className="sr-only">Section {n}: </span>
                      {title}
                    </span>
                    <small>{STATE_LABEL[state]}</small>
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>

      <form className={styles.sections} noValidate onSubmit={onSubmit} aria-label="Tutor application">
        <p className={forms.note}>
          One page, in eight sections. All fields are required unless marked optional. Nothing you type is saved: if you leave this page before sending,
          you will lose it.
        </p>

        {attempted && problems.length > 0 ? (
          <div className={`form-message form-message--error ${forms.summary}`} role="alert" tabIndex={-1} ref={summaryRef}>
            <strong>
              {problems.length === 1 ? "There is 1 thing to check." : `There are ${problems.length} things to check.`}
            </strong>
            <p>Your application has not been sent yet.</p>
            <ul>
              {problems.map((problem) => (
                <li key={`${problem.id}-${problem.message}`}>
                  <a
                    href={`#${problem.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      focusTarget(problem.id);
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
              You can also apply by email at <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.
            </p>
          </div>
        ) : null}

        <div className={styles.sections}>
          <SectionFrame n={1}>
            <AboutYou values={values} set={set} errors={shown} />
          </SectionFrame>

          <SectionFrame n={2}>
            <TheRole values={values} set={set} errors={shown} roles={roles} />
          </SectionFrame>

          <SectionFrame n={3}>
            <ExperienceAndResults values={values} set={set} errors={shown} />
          </SectionFrame>

          <SectionFrame n={4}>
            <AvailabilityAndSetup values={values} set={set} errors={shown} today={today} />
          </SectionFrame>

          <SectionFrame n={5}>
            <YourApplication
              values={values}
              set={set}
              errors={shown}
              cv={cv}
              coverFile={coverFile}
              cvError={attempted ? (!cv ? "Attach your CV." : (files.cvProblem ?? serverFiles.cv)) : files.cvProblem}
              coverError={files.coverProblem ?? serverFiles.coverLetterFile}
              onCv={(file) => {
                setCv(file);
                clearServer();
              }}
              onCover={(file) => {
                setCoverFile(file);
                clearServer();
              }}
              announce={announce}
            />
          </SectionFrame>

          <SectionFrame n={6}>
            <SupportingDocuments
              items={docs}
              errors={attempted ? docErrorsById : Object.fromEntries(Object.entries(docErrorsById).filter(([id]) => docs.find((item) => item.id === id)?.type))}
              totalBytes={files.total}
              totalError={files.totalProblem ?? serverFiles.total}
              onAdd={(file) => {
                setDocs((current) => (current.length >= careersConfig.limits.supporting.maxFiles ? current : [...current, { id: `${Date.now().toString(36)}${current.length}`, file, type: "" }]));
                clearServer();
              }}
              onRemove={(id) => {
                setDocs((current) => current.filter((item) => item.id !== id));
                clearServer();
              }}
              onType={(id, type) => setDocs((current) => current.map((item) => (item.id === id ? { ...item, type } : item)))}
              announce={announce}
            />
          </SectionFrame>

          <SectionFrame
            n={7}
            intro={
              <p>
                This is required. Read the whole agreement below (it is also at <Link href="/careers/safeguarding-agreement">its own page</Link>), tick each part,
                answer six short questions, and type your full name.
              </p>
            }
          >
            <AgreementSection
              agreement={currentAgreement}
              agreedParts={values.agreedParts}
              onAgreedParts={(parts) => set("agreedParts", parts)}
              understandingRequired={UNDERSTANDING_REQUIRED}
              understanding={values.understanding}
              onUnderstanding={(answers) => set("understanding", answers)}
              typedName={values.typedName}
              onTypedName={(name) => set("typedName", name)}
              typedNameLabel="Type your full name to agree"
              typedNameHint="This is your confirmation that you have read and agree to every part. Use your first and last name exactly as in Section 1."
              errors={{ agreedParts: shown.agreedParts, understanding: shown.understanding, typedName: shown.typedName }}
            />
            <p className={forms.note}>Agreement version {currentAgreement.version}, dated {currentAgreement.dateLabel}.</p>
          </SectionFrame>

          <SectionFrame n={8}>
            <div className={styles.stack}>
              <div className={styles.review} aria-live="polite">
                <h3>Before you send</h3>
                {reviewOk ? (
                  <p className={styles.reviewOk}>Every section is complete.</p>
                ) : (
                  <>
                    <p>Still to do:</p>
                    <ul>
                      {problems.map((problem) => (
                        <li key={`${problem.id}-${problem.message}`}>
                          <a
                            href={`#${problem.id}`}
                            onClick={(event) => {
                              event.preventDefault();
                              focusTarget(problem.id);
                            }}
                          >
                            Section {problem.section}: {problem.message}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <p>
                  Files chosen: {[cv ? "CV" : null, coverFile ? "cover letter" : null, docs.length ? `${docs.length} supporting document${docs.length === 1 ? "" : "s"}` : null].filter(Boolean).join(", ") || "none yet"}.
                </p>
              </div>

              <CheckboxField name="declAccurate" checked={values.declAccurate} onChange={(on) => set("declAccurate", on)} error={shown.declAccurate} label="The information I have given is accurate and complete, and I have not left out anything relevant to my suitability to work with children." />
              <CheckboxField
                name="declDbs"
                checked={values.declDbs}
                onChange={(on) => set("declDbs", on)}
                error={shown.declDbs}
                label="I agree to an Enhanced DBS check including the Children’s Barred List, carried out by LearnThrive if I am offered a place. LearnThrive pays for it unless I already hold a suitable certificate or choose to pay for my own check."
              />
              <CheckboxField name="declSelfEmployed" checked={values.declSelfEmployed} onChange={(on) => set("declSelfEmployed", on)} error={shown.declSelfEmployed} label="I understand that tutors are self-employed, and that any start is subject to the checks described." />
              <CheckboxField
                name="declPrivacy"
                checked={values.declPrivacy}
                onChange={(on) => set("declPrivacy", on)}
                error={shown.declPrivacy}
                label={
                  <>
                    I have read the{" "}
                    <Link href="/careers/privacy" target="_blank" rel="noopener">
                      applicant privacy notice<span className="sr-only"> (opens in a new tab)</span>
                    </Link>
                    .
                  </>
                }
              />
              {careersConfig.talentPool.enabled ? (
                <CheckboxField
                  name="talentPool"
                  checked={values.talentPool}
                  onChange={(on) => set("talentPool", on)}
                  label={`Optional: please keep my application in mind for future roles, for up to ${careersConfig.talentPool.retentionMonths} months after a decision. I can withdraw this at any time.`}
                />
              ) : null}

              <Honeypot id="application-website" value={trap} onChange={setTrap} />

              <div id={fieldId("humanCheck")} tabIndex={-1}>
                <HumanCheck check={check} />
              </div>
              <div className={forms.actions}>
                <button className="button button--primary" type="submit" disabled={status === "sending" || check.state.status === "unavailable"} aria-busy={status === "sending"}>
                  <span>{status === "sending" ? "Sending…" : "Send my application"}</span>
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M4 10h11M11 6l4 4-4 4" />
                  </svg>
                </button>
                <p className={forms.note}>
                  Your answers and files are sent to LearnThrive by email, and nothing is stored on this website. {careersConfig.responseTime}
                </p>
              </div>
            </div>
          </SectionFrame>
        </div>
      </form>

      <div className="sr-only" role="status" aria-live="polite">
        {live}
      </div>
    </div>
  );
}
