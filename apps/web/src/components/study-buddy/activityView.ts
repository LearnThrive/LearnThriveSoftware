import type { ActivityPhase, ActivityView, PanelStep } from "./ActivityPanel";

/** How a turn's activity changes as the server's events arrive: pure, so the page and the development bench apply them the same way. */

/** Waiting steps the page shows itself (a queue, a model loading). They go as soon as real work or text begins. */
export const WAITING = new Set<string>(["queue", "prepare"]);
export const withoutWaiting = (view: ActivityView): ActivityView => (view.steps.some((s) => WAITING.has(s.kind)) ? { ...view, steps: view.steps.filter((s) => !WAITING.has(s.kind)) } : view);
/** A step arrives, new or an update of an earlier one with the same id. */
export function withStep(view: ActivityView, step: PanelStep): ActivityView {
  const base = WAITING.has(step.kind) ? view : withoutWaiting(view);
  const at = base.steps.findIndex((s) => s.id === step.id);
  return { ...base, steps: at >= 0 ? base.steps.map((s, i) => (i === at ? step : s)) : [...base.steps, step] };
}
/** The turn is over: nothing is left running, and the waiting steps are gone. */
export function settle(view: ActivityView, phase: ActivityPhase): ActivityView {
  return { phase, steps: withoutWaiting(view).steps.map((s) => (s.state === "running" ? { ...s, state: phase === "done" ? "done" : "failed" } : s)) };
}
