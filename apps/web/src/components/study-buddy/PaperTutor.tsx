"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Download, FileCheck2, X } from "lucide-react";
import { PencilLoader } from "@/components/ui/PencilLoader";
import styles from "./PaperTutor.module.css";

const KatexMath = dynamic(() => import("./KatexMath"), { ssr: false, loading: () => <span>…</span> });

type SolveStatus = "verified" | "checked_reading" | "unchecked" | "failed" | "unsolved";
type Outcome = "correct" | "partly" | "incorrect" | "needs_checking" | "no_answer";
type Mode = "hybrid" | "filled" | "worked";
export type PaperKind = "solve" | "mark";
interface Result {
  id: string;
  number: string;
  status: SolveStatus;
  outcome?: Outcome;
  answer: string;
  steps: { say?: string; math?: string }[];
  note: string;
  studentAnswer?: string;
  feedback?: string;
  estimate?: number | null;
  outOf?: number | null;
}
interface Job {
  id: string;
  kind: PaperKind;
  state: "extracting" | "ready" | "solving" | "done" | "failed" | "cancelled";
  questions: { id: string; number: string; page: number; text: string; marks: number | null; fromText: boolean }[];
  progress: { questionId: string; state: "waiting" | "solving" | "done"; status?: SolveStatus; outcome?: Outcome }[];
  results: Result[];
  resultFileId: string | null;
  pageCount: number | null;
  workedPages: number[];
  message: string | null;
}

const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: "hybrid", label: "Answers and working", hint: "Short working on the paper, the full method on extra pages" },
  { mode: "filled", label: "Answers on the paper", hint: "Each answer written in its space" },
  { mode: "worked", label: "Worked solutions", hint: "The full method on extra pages; the paper is left as it is" },
];

const STATUS: Record<SolveStatus, string> = {
  verified: "Checked by calculation",
  checked_reading: "Checked against the AI's reading",
  unchecked: "Not checked: look over it",
  failed: "Not confidently solved",
  unsolved: "Not confidently solved",
};

const OUTCOME: Record<Outcome, string> = {
  correct: "Correct",
  partly: "Partly right",
  incorrect: "Not right",
  needs_checking: "Needs checking",
  no_answer: "No answer found",
};

/**
 * The Paper Tutor, a strip above the box like voice chat: it reads the paper, lets the student pick the questions (and, for solving,
 * how the answers are written), shows each question as it goes, and ends with a download, a preview and a list of the questions to
 * open one by one. It runs on the server, so the chat stays usable meanwhile; the page only asks how it is going. "mark" is the same
 * panel for checking the student's own completed paper, where every mark is labelled as the AI's estimate.
 */
export function PaperTutor({
  fileId,
  sessionId,
  fileName,
  kind = "solve",
  schemeFileId,
  onFinished,
  onClose,
}: {
  fileId: string;
  sessionId: string;
  fileName: string;
  kind?: PaperKind;
  /** A mark scheme uploaded to the same chat (marking only). */
  schemeFileId?: string;
  /** The summary has been posted into the chat: reload it. */
  onFinished: () => void;
  onClose: () => void;
}) {
  const marking = kind === "mark";
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>("hybrid");
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState(false);
  const finished = useRef(false);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  });

  // Starting a job counts against the day's papers, so it happens once per panel (an effect can run twice in development), and
  // the panel is keyed by the file, so another paper gets a fresh one.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const response = await fetch("/api/assistant/papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, sessionId, kind, ...(schemeFileId ? { schemeFileId } : {}) }),
      }).catch(() => null);
      const data = (await response?.json().catch(() => null)) as { job?: Job; error?: string } | null;
      if (!response?.ok || !data?.job) return setError(data?.error ?? "We could not start on that paper. Please try again.");
      setJob(data.job);
    })();
  }, [fileId, sessionId, kind, schemeFileId]);

  const id = job?.id;
  const state = job?.state;
  useEffect(() => {
    if (!id || (state !== "extracting" && state !== "solving")) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/assistant/papers/${id}`, { cache: "no-store" }).catch(() => null);
      const data = (await response?.json().catch(() => null)) as { job?: Job; error?: string } | null;
      if (data?.job) {
        const next = data.job;
        setJob(next);
        if (next.state === "ready") setChosen(new Set(next.questions.map((q) => q.id)));
        if (next.state === "done" && !finished.current) {
          finished.current = true;
          onFinishedRef.current();
        }
      } else if (response) setError(data?.error ?? "We lost track of that paper. Please start again.");
    }, 1500);
    return () => clearInterval(timer);
  }, [id, state]);

  async function solve() {
    if (!job) return;
    setError("");
    const response = await fetch(`/api/assistant/papers/${job.id}/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, questionIds: [...chosen] }),
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as { job?: Job; error?: string } | null;
    if (response?.ok && data?.job) setJob(data.job);
    else setError(data?.error ?? (marking ? "We could not start checking. Please try again." : "We could not start solving. Please try again."));
  }

  async function cancel() {
    if (job && (job.state === "extracting" || job.state === "solving" || job.state === "ready"))
      await fetch(`/api/assistant/papers/${job.id}`, { method: "DELETE" }).catch(() => null);
    onClose();
  }

  const toggle = (q: string) =>
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(q)) next.delete(q);
      else next.add(q);
      return next;
    });
  const done = job?.progress.filter((p) => p.state === "done").length ?? 0;
  const numberOf = (q: string) => job?.questions.find((x) => x.id === q)?.number ?? q;
  const title = marking ? "Check my completed paper" : "Solve this paper";

  return (
    <section className={styles.panel} aria-label={title} aria-busy={!job || state === "extracting" || state === "solving"}>
      <header className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <FileCheck2 size={18} />
        </span>
        <div className={styles.headText}>
          <h2 className={styles.title}>{title}</h2>
          <p className={styles.file}>{fileName}</p>
        </div>
        <button type="button" className={styles.close} onClick={() => void cancel()} aria-label={state === "done" || state === "failed" ? "Close" : marking ? "Cancel checking this paper" : "Cancel solving this paper"}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div className={styles.body} role="status" aria-live="polite">
        {error ? <p className={styles.error}>{error}</p> : null}
        {!error && (!job || state === "extracting") ? (
          <p className={styles.line}>
            <PencilLoader size="sm" label="Working" /> Reading the paper and finding the questions…
          </p>
        ) : null}
        {state === "solving" ? (
          <p className={styles.line}>
            <PencilLoader size="sm" label="Working" /> {marking ? "Checking" : "Working through"} question {Math.min(done + 1, job!.progress.length)} of {job!.progress.length}…
          </p>
        ) : null}
        {state === "failed" || state === "cancelled" ? <p className={styles.error}>{job?.message}</p> : null}
        {state === "done" ? (
          <p className={styles.line}>{marking ? "Done. The feedback is in the chat, and the checked paper is ready to download. The marks are the AI's estimates, not official marks." : "Done. The summary is in the chat, and the worked paper is ready to download."}</p>
        ) : null}
      </div>

      {state === "ready" && job ? (
        job.questions.length === 0 ? (
          <p className={styles.line}>{job.message}</p>
        ) : (
          <div className={styles.choose}>
            {job.message ? <p className={styles.note}>{job.message}</p> : null}
            <fieldset className={styles.questions}>
              <legend>Questions found ({job.questions.length})</legend>
              <ul>
                {job.questions.map((q) => (
                  <li key={q.id}>
                    <label>
                      <input type="checkbox" checked={chosen.has(q.id)} onChange={() => toggle(q.id)} />
                      <span className={styles.qNumber}>Q{q.number}</span>
                      <span className={styles.qText}>{q.text}</span>
                      {q.marks ? <span className={styles.tag}>{q.marks} marks</span> : null}
                      {!q.fromText ? <span className={styles.tag}>read from a picture</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            {marking ? null : (
              <fieldset className={styles.modes}>
                <legend>How to write the answers</legend>
                {MODES.map((m) => (
                  <label key={m.mode} className={styles.mode}>
                    <input type="radio" name="paper-mode" checked={mode === m.mode} onChange={() => setMode(m.mode)} />
                    <span>
                      <strong>{m.label}</strong>
                      <small>{m.hint}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <div className={styles.actions}>
              <button type="button" className={styles.primary} disabled={chosen.size === 0} onClick={() => void solve()}>
                {marking ? "Check" : "Solve"} {chosen.size === job.questions.length ? "all" : chosen.size} question{chosen.size === 1 ? "" : "s"}
              </button>
              <p className={styles.note}>
                {marking
                  ? "Marks are the AI's estimates, never official marks, and only where the paper prints them. If your writing cannot be read or an answer cannot be checked by calculation, it is marked \"needs checking\", not wrong."
                  : "The answers are AI-generated and may contain mistakes. Each one is checked by calculation where it can be, and says when it is not."}
              </p>
            </div>
          </div>
        )
      ) : null}

      {(state === "solving" || state === "done") && job ? (
        <ol className={styles.progress} aria-label="Progress">
          {job.progress.map((p) => (
            <li key={p.questionId} data-state={p.state} data-status={p.status} data-outcome={p.outcome}>
              <span className={styles.qNumber}>Q{numberOf(p.questionId)}</span>
              <span>{p.state === "waiting" ? "Waiting" : p.state === "solving" ? (marking ? "Checking…" : "Solving…") : p.outcome ? OUTCOME[p.outcome] : STATUS[p.status ?? "unsolved"]}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {state === "done" && job?.results.length ? (
        <div className={styles.results} aria-label="Questions">
          {job.results.map((r) => (
            <details key={r.id} className={styles.question}>
              <summary>
                <span className={styles.qNumber}>Q{r.number}</span>
                <span>{r.outcome ? OUTCOME[r.outcome] : STATUS[r.status]}</span>
                {r.estimate !== null && r.estimate !== undefined && r.outOf ? <span className={styles.tag}>AI-estimated {r.estimate}/{r.outOf}</span> : null}
              </summary>
              <div className={styles.detail}>
                {r.studentAnswer ? (
                  <p>
                    You wrote: <KatexMath tex={r.studentAnswer} display={false} />
                  </p>
                ) : null}
                {r.answer && r.outcome !== "needs_checking" ? (
                  <p>
                    {marking ? "Checked answer" : "Answer"}: <KatexMath tex={r.answer} display={false} />
                  </p>
                ) : null}
                {r.feedback ? <p>{r.feedback}</p> : null}
                {!marking && r.steps.length ? (
                  <ol>
                    {r.steps.map((s, i) => (
                      <li key={i}>
                        {s.say ? <span>{s.say} </span> : null}
                        {s.math ? <KatexMath tex={s.math} display={false} /> : null}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {r.note ? <p className={styles.note}>{r.note}</p> : null}
              </div>
            </details>
          ))}
        </div>
      ) : null}

      {state === "done" && job?.resultFileId ? (
        <div className={styles.result}>
          <div className={styles.actions}>
            <a className={styles.primary} href={`/api/assistant/files/${job.resultFileId}?download=1`}>
              <Download size={16} aria-hidden="true" /> {marking ? "Download the checked paper" : "Download the worked paper"}
            </a>
            <button type="button" className={styles.secondary} aria-expanded={preview} onClick={() => setPreview((p) => !p)}>
              {preview ? "Hide preview" : "Preview"}
            </button>
          </div>
          {preview ? (
            <figure className={styles.preview}>
              {/* A page of the family's own private result, drawn on request: not for the image optimiser. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/assistant/papers/${job.id}/preview?page=${page}`} alt={`Page ${page} of the ${marking ? "checked" : "worked"} paper`} />
              <figcaption>
                <button type="button" className={styles.secondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous page
                </button>
                <span>
                  Page {page} of {job.pageCount ?? 1}
                  {job.workedPages.includes(page) ? (marking ? " (feedback)" : " (worked solutions)") : ""}
                </span>
                <button type="button" className={styles.secondary} disabled={page >= (job.pageCount ?? 1)} onClick={() => setPage(page + 1)}>
                  Next page
                </button>
              </figcaption>
            </figure>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
