"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, FileText, Globe, Calculator, Info, PenLine, Search, ShieldCheck, Square, Wrench, BookOpen, Hourglass } from "lucide-react";
import type { ActivityStep } from "@/lib/assistant/activity";
import styles from "./activity.module.css";

/**
 * What Study Buddy is doing for an answer, drawn from the real steps the server reports, inside the answer's own message. While it works it is the one
 * visible indicator (a small ring and the current step); when it has finished it folds into a single row that can be opened again to see which
 * sources were read and what was checked. It never shows the model's reasoning, only work that was done.
 *
 * It is not a live region: the page has one polite announcer, so a screen reader hears a short phrase when a new kind of work begins, not every step.
 */
export type ActivityPhase = "running" | "done" | "failed" | "stopped";

/** Steps the page itself adds while it waits (the queue, the model loading); they come from server events too, and vanish when the work starts. */
export type PanelStep = Omit<ActivityStep, "kind"> & { kind: ActivityStep["kind"] | "queue" | "prepare" };

export interface ActivityView {
  steps: PanelStep[];
  phase: ActivityPhase;
}

const ICONS: Record<PanelStep["kind"], typeof Search> = {
  analyse: BookOpen,
  document: FileText,
  search: Search,
  read: Globe,
  verify: ShieldCheck,
  calculate: Calculator,
  repair: Wrench,
  write: PenLine,
  queue: Hourglass,
  prepare: Hourglass,
};

/** Work that is research or checking: if none of it happened, a finished answer shows no panel at all. */
const NOTABLE = new Set(["document", "search", "read", "verify", "calculate", "repair"]);
export const hasNotableWork = (steps: readonly PanelStep[]): boolean => steps.some((s) => NOTABLE.has(s.kind));

/** The summary row's words, and whether the work really completed ("ok") or only partly ("limited": sources could not be reached). */
export function headline(view: ActivityView): { text: string; tone: "ok" | "limited" } {
  const text = headlineText(view);
  return { text, tone: text === "Sources could not be reached" ? "limited" : "ok" };
}

function headlineText(view: ActivityView): string {
  const real = view.steps.filter((s) => s.kind !== "write" || view.phase === "running");
  if (view.phase === "running") {
    const current = [...view.steps].reverse().find((s) => s.state === "running");
    return current ? `${current.label}…` : "Working through it…";
  }
  if (view.phase === "stopped") return "Stopped";
  if (view.phase === "failed") return hasNotableWork(view.steps) ? "Could not finish checking" : "Could not finish";
  // "Completed" is said only when it is true: at least one source was actually read, or a calculation check ran.
  const sourcesRead = real.some((s) => s.kind === "read" && s.state === "done");
  const attemptedSources = real.some((s) => s.kind === "search" || s.kind === "read");
  if (sourcesRead) return "Research and verification completed";
  if (attemptedSources) return "Sources could not be reached";
  if (real.some((s) => s.kind === "calculate" || s.kind === "verify")) return "Checks completed";
  return "Looked at what you sent";
}

export function ActivityPanel({ view }: { view: ActivityView }) {
  const listId = useId();
  const running = view.phase === "running";
  const [open, setOpen] = useState(running);
  const wasRunning = useRef(running);
  // Finishing folds the panel into its summary row. Opening it afterwards is the student's choice and is kept.
  useEffect(() => {
    if (wasRunning.current && !running) setOpen(false);
    wasRunning.current = running;
  }, [running]);

  const sources = view.steps.filter((s) => s.source).length;
  const shown = view.steps.filter((s) => running || s.kind !== "write");
  const summary = headline(view);
  const Icon = running ? null : view.phase === "failed" ? AlertCircle : view.phase === "stopped" ? Square : summary.tone === "limited" ? Info : Check;

  return (
    <section className={styles.panel} data-phase={view.phase} data-tone={summary.tone} aria-label="What LearnThrive AI did for this answer">
      <button type="button" className={styles.head} aria-expanded={shown.length > 0 ? open : undefined} disabled={shown.length === 0} aria-controls={listId} onClick={() => setOpen((v) => !v)}>
        <span className={styles.badge} aria-hidden="true">
          {Icon ? <Icon size={14} /> : <span className={styles.ring} />}
        </span>
        <span className={styles.title}>{summary.text}</span>
        {!running && sources > 0 ? <span className={styles.count}>{sources} source{sources === 1 ? "" : "s"}</span> : null}
        {shown.length > 0 ? <ChevronDown size={16} className={styles.chevron} aria-hidden="true" data-open={open} /> : null}
      </button>
      <div id={listId} className={styles.body} hidden={!open || shown.length === 0}>
        <ol className={styles.steps} aria-label="Steps">
          {shown.map((s) => {
            const StepIcon = ICONS[s.kind];
            return (
              <li key={s.id} className={styles.step} data-state={s.state}>
                <span className={styles.mark} aria-hidden="true">
                  {s.state === "done" ? <Check size={13} /> : s.state === "failed" ? <AlertCircle size={13} /> : <span className={styles.dot} />}
                </span>
                <span className={styles.text}>
                  <span className={styles.label}>
                    <StepIcon size={13} aria-hidden="true" className={styles.kind} />
                    {s.source ? (
                      <a className={styles.link} href={s.source.url} target="_blank" rel="noopener noreferrer">
                        {s.source.title}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      s.label
                    )}
                    <span className="sr-only">{s.state === "done" ? ", done" : s.state === "failed" ? ", did not work" : ", in progress"}</span>
                  </span>
                  {s.source ? (
                    <span className={styles.detail}>
                      {s.source.host} · {s.source.tier}
                      {s.source.via === "browser" ? " · read in a browser" : ""}
                    </span>
                  ) : s.detail ? (
                    <span className={styles.detail}>{s.detail}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
