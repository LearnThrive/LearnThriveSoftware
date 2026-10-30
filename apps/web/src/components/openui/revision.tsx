"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { gradeChoice, gradeShortAnswer, percentage } from "@/lib/openui/quiz";
import { asStrings, partsOf, useHost } from "./host";
import { Rich } from "./Rich";
import styles from "./openui.module.css";

/**
 * The revision components, where "interactive" has to mean something: a quiz is marked here, in the browser, against the answer key the server already
 * checked, with no request to any model. Marking is `lib/openui/quiz.ts` (pure, tested); this file is only how it looks and what the student can press.
 * Every control is a real control with a label, reachable and usable by keyboard, and switched off until the interface has finished arriving.
 */
type Render = { props: Record<string, unknown>; renderNode: (value: unknown) => ReactNode };
const text = (v: unknown): string => (typeof v === "string" ? v : "");

type Question =
  | { kind: "choice"; prompt: string; options: string[]; answer: number; hint: string; explanation: string }
  | { kind: "short"; prompt: string; accepted: string[]; hint: string; explanation: string; unit: string };

interface Result {
  checked: boolean;
  correct: boolean;
  hinted: boolean;
  /** How many times the question was tried. */
  attempts: number;
  chosen: number | null;
  typed: string;
}

const blank = (): Result => ({ checked: false, correct: false, hinted: false, attempts: 0, chosen: null, typed: "" });

function questionsOf(value: unknown): Question[] {
  return partsOf<Record<string, unknown>>(value).flatMap((q): Question[] => {
    if (q.__type === "MultipleChoice") return [{ kind: "choice", prompt: text(q.prompt), options: asStrings(q.options), answer: Number(q.answer), hint: text(q.hint), explanation: text(q.explanation) }];
    if (q.__type === "ShortAnswer") return [{ kind: "short", prompt: text(q.prompt), accepted: asStrings(q.accepted), hint: text(q.hint), explanation: text(q.explanation), unit: text(q.unit) }];
    return [];
  });
}

export function Quiz({ props }: Render) {
  const questions = questionsOf(props.questions);
  const title = text(props.title);
  const { enabled, canAsk, ask, maxChars } = useHost();
  const [index, setIndex] = useState(0);
  // Keyed by question number, not a list sized when the quiz first drew: while an interface arrives, its questions arrive one by one.
  const [results, setResults] = useState<Record<number, Result>>({});
  const [finished, setFinished] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  // The first render of the page after "Next" lands on the new question, so a keyboard or screen-reader user is not left on a button that has gone.
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [index, finished]);

  if (!questions.length) return null;
  const q = questions[Math.min(index, questions.length - 1)]!;
  const r = results[index] ?? blank();
  const patch = (change: Partial<Result>) => setResults((all) => ({ ...all, [index]: { ...(all[index] ?? blank()), ...change } }));
  const done = questions.map((_, i) => results[i] ?? blank());
  const score = done.filter((x) => x.checked && x.correct).length;
  const hints = done.filter((x) => x.hinted).length;
  const answered = done.filter((x) => x.checked).length;

  function check() {
    if (r.checked) return;
    const correct = q.kind === "choice" ? gradeChoice(r.chosen, q.answer) : gradeShortAnswer(r.typed, q.accepted).correct;
    patch({ checked: true, correct, attempts: r.attempts + 1 });
  }
  const ready = q.kind === "choice" ? r.chosen !== null : r.typed.trim().length > 0;

  if (finished) {
    const wrong = questions.filter((_, i) => !done[i]!.correct);
    return (
      <section className={styles.quiz} aria-labelledby={`${id}-done`}>
        <h5 ref={heading} tabIndex={-1} id={`${id}-done`} className={styles.heading}>Your score</h5>
        <p className={styles.score} role="status">
          <strong>{score} of {questions.length}</strong> correct ({percentage({ correct: score, total: questions.length })}%)
          {hints ? <span> · hints used on {hints} question{hints === 1 ? "" : "s"}</span> : null}
        </p>
        <ol className={styles.review}>
          {questions.map((x, i) => (
            <li key={i} className={done[i]!.correct ? styles.right : styles.miss}>
              <span className={styles.mark}>{done[i]!.correct ? "Correct" : "Not yet"}</span> <Rich text={x.prompt} />
            </li>
          ))}
        </ol>
        <div className={styles.row}>
          <button type="button" className={styles.primary} onClick={() => { setResults({}); setIndex(0); setFinished(false); }} disabled={!enabled}>Try the quiz again</button>
          {wrong.length ? (
            <button type="button" className={styles.secondary} disabled={!canAsk} onClick={() => ask(`I got these wrong in the quiz, can you explain them to me: ${wrong.map((x) => `"${x.prompt}"`).join("; ")}`.slice(0, maxChars))}>
              Ask LearnThrive AI to explain the ones I missed
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const last = index === questions.length - 1;
  return (
    <section className={styles.quiz} aria-labelledby={`${id}-q`}>
      {title ? <p className={styles.quizTitle}><Rich text={title} /></p> : null}
      <p className={styles.count} role="status">Question {index + 1} of {questions.length} · {answered ? `${score} correct so far` : "none answered yet"}</p>
      <h5 ref={heading} tabIndex={-1} id={`${id}-q`} className={styles.question}><Rich text={q.prompt} /></h5>

      {q.kind === "choice" ? (
        <fieldset className={styles.options} disabled={!enabled || r.checked}>
          <legend className="sr-only">Choose one answer</legend>
          {q.options.map((option, i) => {
            const isAnswer = r.checked && i === q.answer;
            const isMine = r.checked && i === r.chosen;
            return (
              <label key={i} className={`${styles.option} ${isAnswer ? styles.right : ""} ${isMine && !isAnswer ? styles.miss : ""}`}>
                <input type="radio" name={`${id}-${index}`} checked={r.chosen === i} onChange={() => patch({ chosen: i })} />
                <span><Rich text={option} /></span>
                {isAnswer ? <span className={styles.mark}>Correct answer</span> : isMine ? <span className={styles.mark}>Your answer</span> : null}
              </label>
            );
          })}
        </fieldset>
      ) : (
        <div className={styles.shortAnswer}>
          <label htmlFor={`${id}-a${index}`} className="sr-only">Your answer</label>
          <input id={`${id}-a${index}`} type="text" inputMode="text" autoComplete="off" spellCheck={false} maxLength={120} value={r.typed} disabled={!enabled || r.checked} placeholder="Type your answer" onChange={(e) => patch({ typed: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && ready) { e.preventDefault(); check(); } }} />
          {q.unit ? <span className={styles.unit}>{q.unit}</span> : null}
        </div>
      )}

      {!r.checked && q.hint ? (
        <div className={styles.hintRow}>
          <button type="button" className={styles.linkButton} aria-expanded={r.hinted} disabled={!enabled} onClick={() => patch({ hinted: true })}>
            {r.hinted ? "Hint" : "Show a hint"}
          </button>
          {r.hinted ? <span className={styles.hint}><Rich text={q.hint} /></span> : null}
        </div>
      ) : null}

      {r.checked ? (
        <div className={`${styles.feedback} ${r.correct ? styles.right : styles.miss}`} role="status">
          <strong>{r.correct ? "Correct!" : "Not quite."}</strong>
          {!r.correct && q.kind === "short" && q.accepted[0] ? <span> A correct answer is <Rich text={q.accepted[0]} />{q.unit ? ` ${q.unit}` : ""}.</span> : null}
          {q.explanation ? <p><Rich text={q.explanation} /></p> : null}
        </div>
      ) : null}

      <div className={styles.row}>
        {!r.checked ? (
          <button type="button" className={styles.primary} onClick={check} disabled={!enabled || !ready}>Check answer</button>
        ) : (
          <>
            {!r.correct ? <button type="button" className={styles.secondary} disabled={!enabled} onClick={() => patch({ checked: false, chosen: null, typed: "" })}>Try this question again</button> : null}
            <button type="button" className={styles.primary} disabled={!enabled} onClick={() => (last ? setFinished(true) : setIndex(index + 1))}>{last ? "See my score" : "Next question"}</button>
            <button type="button" className={styles.linkButton} disabled={!canAsk} onClick={() => ask(`Can you explain this question to me: "${q.prompt}"${q.kind === "choice" && r.chosen !== null ? ` I chose "${q.options[r.chosen]}".` : r.typed ? ` I answered "${r.typed}".` : ""}`.slice(0, maxChars))}>
              Ask LearnThrive AI to explain
            </button>
          </>
        )}
      </div>
    </section>
  );
}

export function Flashcards({ props }: Render) {
  const cards = partsOf<{ front?: string; back?: string }>(props.cards);
  const title = text(props.title);
  const { enabled } = useHost();
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<ReadonlySet<number>>(new Set());
  if (!cards.length) return null;
  const card = cards[index]!;
  const go = (to: number) => {
    setIndex((to + cards.length) % cards.length);
    setFlipped(false);
  };
  return (
    <section className={styles.flashcards} aria-label={title || "Flashcards"}>
      {title ? <p className={styles.quizTitle}><Rich text={title} /></p> : null}
      <p className={styles.count} role="status">Card {index + 1} of {cards.length} · knew {known.size} of {cards.length}</p>
      <button type="button" className={`${styles.card3d} ${flipped ? styles.flipped : ""}`} aria-pressed={flipped} disabled={!enabled} onClick={() => setFlipped((f) => !f)}>
        <span className={styles.cardSide}>{flipped ? "Answer" : "Question"}</span>
        <span className={styles.cardText}><Rich text={flipped ? card.back : card.front} /></span>
        <span className={styles.cardHint}>{flipped ? "Press to see the question" : "Press to see the answer"}</span>
      </button>
      <div className={styles.row}>
        <button type="button" className={styles.secondary} disabled={!enabled} onClick={() => go(index - 1)}>Previous</button>
        {flipped ? (
          <>
            <button type="button" className={styles.primary} disabled={!enabled} onClick={() => { setKnown((k) => new Set(k).add(index)); go(index + 1); }}>I knew it</button>
            <button type="button" className={styles.secondary} disabled={!enabled} onClick={() => { setKnown((k) => { const n = new Set(k); n.delete(index); return n; }); go(index + 1); }}>Not yet</button>
          </>
        ) : null}
        <button type="button" className={styles.secondary} disabled={!enabled} onClick={() => go(index + 1)}>Next</button>
      </div>
    </section>
  );
}

export function OpenResponse({ props }: Render) {
  const { canAsk, ask, maxChars, enabled } = useHost();
  const [answer, setAnswer] = useState("");
  const [sent, setSent] = useState(false);
  const id = useId();
  const prompt = text(props.prompt);
  const guidance = text(props.guidance);
  const room = Math.max(200, maxChars - prompt.length - 120);
  return (
    <section className={styles.open}>
      <h5 className={styles.question}><Rich text={prompt} /></h5>
      {guidance ? <p className={styles.hint}><Rich text={guidance} /></p> : null}
      <label htmlFor={id} className="sr-only">Your answer in your own words</label>
      <textarea id={id} rows={5} maxLength={room} value={answer} disabled={!enabled || sent} placeholder="Write your answer here" onChange={(e) => setAnswer(e.target.value)} />
      <p className={styles.count}>{answer.length} of {room} characters. LearnThrive AI will give you feedback, not an exam mark.</p>
      <div className={styles.row}>
        <button type="button" className={styles.primary} disabled={!canAsk || sent || answer.trim().length < 3} onClick={() => { ask(`Here is my answer to "${prompt}": ${answer.trim()} Can you give me feedback on it?`); setSent(true); }}>
          {sent ? "Sent for feedback" : "Ask LearnThrive AI for feedback"}
        </button>
        {sent ? <button type="button" className={styles.secondary} onClick={() => setSent(false)}>Write another answer</button> : null}
      </div>
    </section>
  );
}
