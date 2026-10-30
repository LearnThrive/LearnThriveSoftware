import { buildInterfaceMessage, type InterfaceContext } from "@/lib/openui/format";
import { repairInstruction, validateInterface, type Issue } from "@/lib/openui/validate";
import { sourcesRead, verifyQuotes } from "@/lib/openui/verification";
import { drainActivity, type ActivityLog } from "./activity";
import { OutputGuard } from "./moderation";
import { hasCitations, stripCitations } from "./research/citations";
import type { ResearchSession } from "./research/verify";
import type { ChatEvent } from "./service";
import type { ProviderMessage, StreamChunk, StreamOptions } from "./types";

/**
 * Turning a request for an interactive interface into one the student may see.
 *
 *   1. Beam writes an OpenUI program (a small declarative description built from the approved components; never code). It streams to the page, which draws
 *      it as it arrives with every control switched off, so nothing can be used before it has been checked.
 *   2. When it is complete the server VALIDATES it (lib/openui/validate.ts): it must parse against the library, stay small, contain nothing that could run,
 *      and be true where truth can be checked (formulas, answer keys, balanced equations, probabilities that add to one).
 *   3. If it is not valid, the problems are sent back to the model ONCE (OPENUI_MAX_REPAIRS, at most two): the draft is discarded on the page and the
 *      corrected program streams in its place. There is no loop: after the last repair a program that still fails is thrown away.
 *   4. The quotations in it are checked against the real text by the research layer's own checker, and the result is stored WITH the interface, apart
 *      from what the model wrote. "Verified" is the server's word, never the model's.
 *   5. The finished interface is stored and sent as one `final` event. If it could not be made, the page is told to drop the draft (`discard`) and the caller
 *      answers in ordinary text, saying so.
 *
 * Every request goes through `generate`, so a repair is counted and charged exactly like the first one. Nothing the student typed, nor the model said, is logged.
 */
export interface InterfaceRun {
  messages: ProviderMessage[];
  generate: (prompt: readonly ProviderMessage[], options: StreamOptions) => AsyncIterable<StreamChunk>;
  charge: (completionTokens: number) => Promise<void>;
  /** Everything but the prompt: the model, limits, timeouts, signal and reasoning effort for a request. */
  options: () => StreamOptions;
  activity: ActivityLog;
  research: ResearchSession | null;
  extracts: readonly string[];
  maxRepairs: number;
  signal: AbortSignal;
}

export type InterfaceOutcome =
  | { ok: true; content: string; repairs: number; firstDraft: Issue[]; components: number; quotes: number }
  | { ok: false; reason: "invalid" | "blocked" | "empty"; repairs: number; issues: Issue[] };

export async function* runInterface(run: InterfaceRun): AsyncGenerator<ChatEvent, InterfaceOutcome> {
  const { activity } = run;
  const step = activity.start("write", "Building the interactive version");
  yield* drainActivity(activity);
  let prompt: ProviderMessage[] = run.messages;
  let firstDraft: Issue[] = [];
  let issues: Issue[] = [];
  let repairs = 0;
  let fixing: string | null = null;

  for (let attempt = 0; attempt <= run.maxRepairs; attempt += 1) {
    if (run.signal.aborted) break;
    yield { type: "ui", phase: "start" };
    const guard = new OutputGuard();
    let raw = "";
    let thinking = false;
    for await (const chunk of run.generate(prompt, run.options())) {
      if (chunk.type === "activity") {
        if (chunk.kind === "thinking" && !thinking) {
          thinking = true;
          activity.update(step, { label: "Working out the interactive version" });
          yield* drainActivity(activity);
        }
        continue;
      }
      if (chunk.type === "text") {
        const safe = guard.push(chunk.text);
        if (safe) {
          raw += safe;
          yield { type: "ui", phase: "chunk", text: safe };
        }
        if (guard.stoppedFor) break;
        continue;
      }
      if (chunk.type === "done") await run.charge(chunk.usage.completionTokens);
    }
    if (!guard.stoppedFor) {
      // What the guard was still holding at the end (the last line, usually) goes to the page too, so what streamed is exactly what is checked and kept.
      const rest = guard.finish();
      if (rest) {
        raw += rest;
        yield { type: "ui", phase: "chunk", text: rest };
      }
    }
    if (guard.stoppedFor) {
      yield { type: "ui", phase: "discard" };
      activity.fail(step, "stopped by the safety check");
      yield* drainActivity(activity);
      return { ok: false, reason: "blocked", repairs, issues: [] };
    }

    // The model's own citation markers are bookkeeping for the text path; they have no place in an interface.
    const draft = hasCitations(raw) ? stripCitations(raw) : raw;
    const checking = activity.start("verify", attempt === 0 ? "Checking the interface" : "Checking the corrected interface");
    yield* drainActivity(activity);
    const checked = validateInterface(draft);
    issues = checked.issues;
    if (attempt === 0) firstDraft = checked.issues;

    if (checked.ok) {
      if (fixing) activity.done(fixing, { detail: "fixed, and checked again" });
      activity.done(checking, { detail: `${checked.components} parts checked` });
      let context: InterfaceContext = { v: 1, verifications: [], sources: [] };
      if (checked.quotes.length) {
        const looking = activity.start("verify", "Checking the quotations against the text", `${checked.quotes.length} to check`);
        yield* drainActivity(activity);
        const verifications = await verifyQuotes(run.research, checked.quotes, run.extracts);
        const good = verifications.filter((v) => v.status === "VERIFIED_EXACT" || v.status === "VERIFIED_VARIANT").length;
        activity.done(looking, { detail: `${good} of ${verifications.length} confirmed in the text` });
        context = { v: 1, verifications, sources: sourcesRead(run.research) };
      } else context = { v: 1, verifications: [], sources: sourcesRead(run.research) };
      activity.done(step, { label: "Built the interactive version", ...(repairs ? { detail: "corrected once after checking" } : {}) });
      yield* drainActivity(activity);
      const content = buildInterfaceMessage(checked.program, context);
      yield { type: "ui", phase: "final", content };
      return { ok: true, content, repairs, firstDraft, components: checked.components, quotes: checked.quotes.length };
    }

    activity.fail(checking, `${checked.issues.length} problem${checked.issues.length === 1 ? "" : "s"} found`);
    yield* drainActivity(activity);
    // The draft is shown to nobody as finished: the page drops it, and a corrected one replaces it, if there is a repair left to spend.
    yield { type: "ui", phase: "discard" };
    if (attempt === run.maxRepairs || run.signal.aborted) break;
    repairs += 1;
    fixing = activity.start("repair", "Correcting the interface", "sent back with what was wrong");
    yield* drainActivity(activity);
    prompt = [...run.messages, { role: "assistant", content: draft || "(nothing)" }, { role: "user", content: repairInstruction(checked.issues) }];
  }

  if (fixing) activity.fail(fixing, "still not valid");
  activity.fail(step, "could not be built");
  yield* drainActivity(activity);
  return { ok: false, reason: issues.length ? "invalid" : "empty", repairs, issues };
}
