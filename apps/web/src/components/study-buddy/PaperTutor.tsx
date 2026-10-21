"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileCheck2, X } from "lucide-react";
import { PencilLoader } from "@/components/ui/PencilLoader";
import styles from "./PaperTutor.module.css";

type SolveStatus = "verified" | "checked_reading" | "unchecked" | "failed" | "unsolved";
type Mode = "hybrid" | "filled" | "worked";
interface Job {
  id: string;
  state: "extracting" | "ready" | "solving" | "done" | "failed" | "cancelled";
  questions: { id: string; number: string; page: number; text: string; marks: number | null; fromText: boolean }[];
  progress: { questionId: string; state: "waiting" | "solving" | "done"; status?: SolveStatus }[];
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

/**
 * The Paper Tutor, a strip above the box like voice chat: it reads the paper, lets the student pick the questions and how the
 * answers are written, shows each question as it goes, and ends with a download and a preview. It runs on the server, so the chat
 * stays usable meanwhile; the page only asks how it is going.
 */
export function PaperTutor({
  fileId,
  sessionId,
  fileName,
  onFinished,
  onClose,
}: {
  fileId: string;
  sessionId: string;
  fileName: string;
  /** The summary has been posted into the chat: reload it. */
  onFinished: () => void;
  onClose: () => void;
}) {
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
        body: JSON.stringify({ fileId, sessionId }),
      }).catch(() => null);
      const data = (await response?.json().catch(() => null)) as { job?: Job; error?: string } | null;
      if (!response?.ok || !data?.job) return setError(data?.error ?? "We could not start on that paper. Please try again.");
      setJob(data.job);
    })();
  }, [fileId, sessionId]);

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
    else setError(data?.error ?? "We could not start solving. Please try again.");
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

  return (
    <section className={styles.panel} aria-label="Solve this paper" aria-busy={!job || state === "extracting" || state === "solving"}>
      <header className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <FileCheck2 size={18} />
        </span>
        <div className={styles.headText}>
          <h2 className={styles.title}>Solve this paper</h2>
          <p className={styles.file}>{fileName}</p>
        </div>
        <button type="button" className={styles.close} onClick={() => void cancel()} aria-label={state === "done" || state === "failed" ? "Close" : "Cancel solving this paper"}>
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
            <PencilLoader size="sm" label="Working" /> Working through question {Math.min(done + 1, job!.progress.length)} of {job!.progress.length}…
          </p>
        ) : null}
        {state === "failed" || state === "cancelled" ? <p className={styles.error}>{job?.message}</p> : null}
        {state === "done" ? <p className={styles.line}>Done. The summary is in the chat, and the worked paper is ready to download.</p> : null}
      </div>

      {state === "ready" && job ? (
        job.questions.length === 0 ? (
          <p className={styles.line}>{job.message}</p>
        ) : (
          <div className={styles.choose}>
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
            <div className={styles.actions}>
              <button type="button" className={styles.primary} disabled={chosen.size === 0} onClick={() => void solve()}>
                Solve {chosen.size === job.questions.length ? "all" : chosen.size} question{chosen.size === 1 ? "" : "s"}
              </button>
              <p className={styles.note}>The answers are AI-generated and may contain mistakes. Each one is checked by calculation where it can be, and says when it is not.</p>
            </div>
          </div>
        )
      ) : null}

      {(state === "solving" || state === "done") && job ? (
        <ol className={styles.progress} aria-label="Progress">
          {job.progress.map((p) => (
            <li key={p.questionId} data-state={p.state} data-status={p.status}>
              <span className={styles.qNumber}>Q{numberOf(p.questionId)}</span>
              <span>{p.state === "waiting" ? "Waiting" : p.state === "solving" ? "Solving…" : STATUS[p.status ?? "unsolved"]}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {state === "done" && job?.resultFileId ? (
        <div className={styles.result}>
          <div className={styles.actions}>
            <a className={styles.primary} href={`/api/assistant/files/${job.resultFileId}?download=1`}>
              <Download size={16} aria-hidden="true" /> Download the worked paper
            </a>
            <button type="button" className={styles.secondary} aria-expanded={preview} onClick={() => setPreview((p) => !p)}>
              {preview ? "Hide preview" : "Preview"}
            </button>
          </div>
          {preview ? (
            <figure className={styles.preview}>
              {/* A page of the family's own private result, drawn on request: not for the image optimiser. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/assistant/papers/${job.id}/preview?page=${page}`} alt={`Page ${page} of the worked paper`} />
              <figcaption>
                <button type="button" className={styles.secondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous page
                </button>
                <span>
                  Page {page} of {job.pageCount ?? 1}
                  {job.workedPages.includes(page) ? " (worked solutions)" : ""}
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
