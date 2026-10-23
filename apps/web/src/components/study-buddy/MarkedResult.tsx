"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import styles from "./PaperTutor.module.css";

const KatexMath = dynamic(() => import("./KatexMath"), { ssr: false, loading: () => <span>…</span> });

/** The assessment of one question as the server sends it (lib/paper/jobs.ts AssessmentView). */
export interface MarkedAssessment {
  answerState: "blank" | "unreadable" | "ambiguous" | "answered";
  basis: "scheme" | "provisional" | "none";
  provisional: boolean;
  referenceSource: "printed_text" | "blank_paper" | "marked_page";
  scheme: { status: string; note: string };
  criteria: Array<{ id: string; kind: string; text: string; marks: number | null; source: "scheme" | "provisional"; ref: string; status: "awarded" | "not_awarded" | "review" | "withheld"; reason: string; lines: number[] }>;
  marksAwarded: number | null;
  marksPending: number;
  marksPossible: number | null;
  review: { code: string; why: string } | null;
  uncertain: string[];
  crossedOut: string[];
  corrections: Array<{ field: string; from: string; to: string; by: string; at: string }>;
  missing: string[];
  override: { marks: number | null; note: string; at: string } | null;
}

export interface MarkedItem {
  id: string;
  number: string;
  outcome?: string;
  answer: string;
  note: string;
  studentAnswer?: string;
  studentWorking?: string[];
  feedback?: string;
  estimate?: number | null;
  outOf?: number | null;
  assessment?: MarkedAssessment;
}

const STATE: Record<MarkedAssessment["answerState"], string> = {
  blank: "Nothing was written for this question",
  unreadable: "I could not read the writing",
  ambiguous: "I was not sure how to read part of it",
  answered: "",
};
const CRITERION: Record<"awarded" | "not_awarded" | "review" | "withheld", string> = { awarded: "Earned", not_awarded: "Not earned", review: "Needs a person", withheld: "" };
const SOURCE: Record<MarkedAssessment["referenceSource"], string> = {
  printed_text: "worked out from the printed question",
  blank_paper: "worked out from the blank paper you gave",
  marked_page: "worked out from your page, ignoring the handwriting",
};

/**
 * One marked question: what was read, how it was judged, what is still unknown, and a way to correct the reading. The student can fix a line the AI
 * misread; the question is then checked again against the same answer and criteria and the change is kept as a new version.
 */
export function MarkedResult({ item, jobId, released, onUpdated }: { item: MarkedItem; jobId: string; released: boolean; onUpdated: (job: unknown) => void }) {
  const a = item.assessment;
  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState(item.studentAnswer ?? "");
  const [working, setWorking] = useState((item.studentWorking ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    const lines = working.split("\n").map((l) => l.trim()).filter(Boolean);
    const response = await fetch(`/api/assistant/papers/${jobId}/correct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: item.id, answer: answer.trim(), working: lines }),
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as { job?: unknown; error?: string } | null;
    setBusy(false);
    if (response?.ok && data?.job) {
      setEditing(false);
      onUpdated(data.job);
    } else setError(data?.error ?? "We could not save that. Please try again.");
  }

  return (
    <div className={styles.detail}>
      {a && STATE[a.answerState] ? <p className={styles.note}>{STATE[a.answerState]}.</p> : null}
      {item.studentAnswer ? (
        <p>
          You wrote: <KatexMath tex={item.studentAnswer} display={false} />
        </p>
      ) : null}
      {item.studentWorking?.length ? (
        <ol aria-label="The working as I read it">
          {item.studentWorking.map((line, i) => (
            <li key={i}>
              <KatexMath tex={line} display={false} />
            </li>
          ))}
        </ol>
      ) : null}
      {a?.uncertain.length ? <p className={styles.note}>I was not sure I read this correctly: {a.uncertain.join("; ")}.</p> : null}
      {a?.crossedOut.length ? <p className={styles.note}>Crossed out, so not marked: {a.crossedOut.join("; ")}.</p> : null}
      {item.answer && item.outcome !== "needs_checking" ? (
        <p>
          Checked answer: <KatexMath tex={item.answer} display={false} />
          {a ? <small> ({SOURCE[a.referenceSource]})</small> : null}
        </p>
      ) : null}
      {item.feedback ? <p>{item.feedback}</p> : null}
      {item.note && !item.feedback ? <p className={styles.note}>{item.note}</p> : null}

      {a?.review ? <p className={styles.note}>Needs a person to look: {a.review.why}</p> : null}
      {a?.override ? (
        <p className={styles.note}>
          Reviewed by your tutor{a.override.marks !== null ? `: ${a.override.marks}${item.outOf ? ` out of ${item.outOf}` : ""} marks` : ""}.{a.override.note ? ` ${a.override.note}` : ""}
        </p>
      ) : null}

      {released && a && a.criteria.length > 0 ? (
        <>
          <p className={styles.note}>
            {a.basis === "scheme" ? "Marked against the official mark scheme." : "AI-estimated against a provisional rubric the AI wrote, not an official mark scheme."}
            {a.scheme.note ? ` ${a.scheme.note}` : ""}
          </p>
          <ul aria-label="Marking criteria">
            {a.criteria.map((c) => (
              <li key={c.id}>
                <strong>{CRITERION[c.status]}</strong> ({c.kind}
                {c.marks !== null ? `${c.marks}` : ""}): {c.text}
                {c.reason ? <small> {c.reason}</small> : null}
                {c.lines.length ? <small> (line{c.lines.length === 1 ? "" : "s"} {c.lines.map((n) => n + 1).join(", ")})</small> : null}
                {c.source === "scheme" ? <small> [{c.ref}]</small> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {!released && a ? <p className={styles.note}>Marks are not shown yet: this checker has not been validated against work marked by a qualified person.</p> : null}
      {a?.missing.length ? <p className={styles.note}>Missing evidence: {a.missing.join("; ")}.</p> : null}
      {a?.corrections.length ? <p className={styles.note}>You corrected how I read this {a.corrections.length === 1 ? "once" : `${a.corrections.length} times`}.</p> : null}

      {editing ? (
        <form
          className={styles.correct}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            Your final answer
            <input value={answer} maxLength={300} onChange={(e) => setAnswer(e.target.value)} />
          </label>
          <label>
            Your working, one line each
            <textarea value={working} rows={4} maxLength={3000} onChange={(e) => setWorking(e.target.value)} />
          </label>
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? "Checking again…" : "Save and check again"}
            </button>
            <button type="button" className={styles.secondary} onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : a?.answerState !== "blank" || item.studentAnswer ? (
        <button type="button" className={styles.secondary} onClick={() => setEditing(true)}>
          Correct how I read this
        </button>
      ) : null}
    </div>
  );
}
