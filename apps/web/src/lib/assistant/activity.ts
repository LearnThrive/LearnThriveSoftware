import { isPrivateAddress } from "./research/safeUrl";
import { isIP } from "node:net";

/**
 * What Study Buddy is genuinely doing while it prepares an answer, as typed events the page can show live and a reopened chat can show again.
 *
 * Nothing here is narration. A step exists only because the server started that piece of work: a search that was sent, a page that was fetched, a
 * quotation that was checked, a draft that was rewritten. The labels are short, fixed wording chosen here; a step never carries a search query, a
 * page's text, the model's hidden reasoning or an internal address. The same record that streams to the page is what is stored with the answer.
 */
export type ActivityKind = "analyse" | "document" | "search" | "read" | "verify" | "calculate" | "repair" | "write";
export type StepState = "running" | "done" | "failed";

export interface ActivitySource {
  title: string;
  /** The site, for display ("www.folger.edu"). */
  host: string;
  /** A sanitised link: http(s) only, no login, no query string, no fragment. */
  url: string;
  /** How reliable the kind of site is ("primary text", "reputable education", "revision site"...), as words. */
  tier: string;
  /** Read in a real browser (Crawl4AI) or fetched directly. */
  via: "browser" | "direct";
}

export interface ActivityStep {
  id: string;
  kind: ActivityKind;
  state: StepState;
  label: string;
  detail?: string;
  source?: ActivitySource;
}

export interface ActivityEvent {
  type: "activity";
  step: ActivityStep;
}

const KINDS: ReadonlySet<string> = new Set(["analyse", "document", "search", "read", "verify", "calculate", "repair", "write"]);
const STATES: ReadonlySet<string> = new Set(["running", "done", "failed"]);

/** Plain display text: no markup, no control characters, one line, bounded. */
export function plainLabel(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const TIER_WORDS: Record<string, string> = {
  official_exam: "exam board",
  authoritative_text: "primary text",
  institutional: "institution",
  reputable_education: "education site",
  revision: "revision site",
  general: "general site",
  low: "low-trust site",
};

/** A link safe to show and open: public http(s), no credentials, no query or fragment, never a local or internal address. Null otherwise. */
export function safeSource(input: { url: string; title?: string; tier?: string; via?: "crawl4ai" | "browser" | "direct" }): ActivitySource | null {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || !host.includes(".") || /(^|\.)(localhost|local|internal|lan|corp|home|home\.arpa)$/.test(host)) return null;
  if (isIP(host) && isPrivateAddress(host)) return null;
  const title = plainLabel(input.title, 120) || host;
  return { title, host: plainLabel(host, 80), url: `${url.origin}${url.pathname}`.slice(0, 300), tier: TIER_WORDS[input.tier ?? ""] ?? (plainLabel(input.tier, 30) || "site"), via: input.via === "direct" ? "direct" : "browser" };
}

/**
 * The steps of one turn, in the order they began. Starting or changing a step queues it for the page; `take()` hands over what has not been sent.
 * The log is the single source of truth for the activity of a turn: the page's panel is drawn from these steps and nothing else.
 */
export class ActivityLog {
  readonly steps: ActivityStep[] = [];
  private outbox: ActivityStep[] = [];
  private counter = 0;
  /** Set by whoever is waiting for events, so a step can wake them at once (see `withActivity`). */
  wake: (() => void) | null = null;

  private push(step: ActivityStep): void {
    this.outbox.push({ ...step, ...(step.source ? { source: { ...step.source } } : {}) });
    this.wake?.();
  }

  start(kind: ActivityKind, label: string, detail?: string): string {
    this.counter += 1;
    const step: ActivityStep = { id: `${kind}-${this.counter}`, kind, state: "running", label: plainLabel(label, 90), ...(detail ? { detail: plainLabel(detail, 140) } : {}) };
    this.steps.push(step);
    this.push(step);
    return step.id;
  }

  /** Changes a step. Ignored once it has finished, so a late update cannot reopen a completed step. */
  update(id: string, patch: { label?: string; detail?: string; state?: StepState; source?: ActivitySource | null }): void {
    const step = this.steps.find((s) => s.id === id);
    if (!step || step.state !== "running") return;
    if (patch.label !== undefined) step.label = plainLabel(patch.label, 90);
    if (patch.detail !== undefined) step.detail = plainLabel(patch.detail, 140);
    if (patch.source) step.source = patch.source;
    if (patch.state) step.state = patch.state;
    this.push(step);
  }

  done(id: string, patch: { label?: string; detail?: string; source?: ActivitySource | null } = {}): void {
    this.update(id, { ...patch, state: "done" });
  }

  fail(id: string, detail?: string): void {
    this.update(id, { detail, state: "failed" });
  }

  /** Ends every step still running (the turn is over), as done or failed. */
  closeAll(state: "done" | "failed"): void {
    for (const s of this.steps) if (s.state === "running") this.update(s.id, { state });
  }

  take(): ActivityStep[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  get hasPending(): boolean {
    return this.outbox.length > 0;
  }
}

/** Sends what is queued as events. For use between awaits in a generator. */
export function* drainActivity(log: ActivityLog): Generator<ActivityEvent, void, void> {
  for (const step of log.take()) yield { type: "activity", step };
}

/**
 * Runs slow work and yields its activity events WHILE it runs, not after: the page sees the search begin, the pages being read and the checks as they
 * happen. The work's result is the generator's return value; an error it throws is rethrown here once the queued events have been sent.
 */
export async function* withActivity<T>(log: ActivityLog, work: () => Promise<T>): AsyncGenerator<ActivityEvent, T, void> {
  let settled = false;
  let value: T | undefined;
  let problem: unknown;
  let failed = false;
  const run = work().then(
    (v) => {
      value = v;
    },
    (e) => {
      failed = true;
      problem = e;
    },
  );
  void run.finally(() => {
    settled = true;
    log.wake?.();
  });
  try {
    for (;;) {
      for (const step of log.take()) yield { type: "activity", step };
      if (settled) break;
      await new Promise<void>((resolve) => {
        log.wake = resolve;
        if (log.hasPending || settled) resolve();
      });
      log.wake = null;
    }
  } finally {
    log.wake = null;
  }
  await run;
  for (const step of log.take()) yield { type: "activity", step };
  if (failed) throw problem;
  return value as T;
}

/** Steps worth keeping and showing after the answer: real work, not the bookkeeping of writing it. */
const NOTABLE: ReadonlySet<string> = new Set(["document", "search", "read", "verify", "calculate", "repair"]);
export const worthShowing = (steps: readonly ActivityStep[]): boolean => steps.some((s) => NOTABLE.has(s.kind));

export const ACTIVITY_VERSION = 1;
const withoutDetail = (step: { detail?: string }) => {
  const copy: Record<string, unknown> = { ...step };
  delete copy.detail;
  return copy;
};
const MAX_STEPS = 24;
const MAX_CHARS = 6000;

/** The record stored with an answer: the finished steps only, bounded, or null if there is nothing worth keeping. */
export function serializeActivity(steps: readonly ActivityStep[]): string | null {
  const kept = steps
    .filter((s) => s.state !== "running" && s.kind !== "write")
    .slice(0, MAX_STEPS)
    .map((s) => ({ id: s.id, kind: s.kind, state: s.state, label: s.label, ...(s.detail ? { detail: s.detail } : {}), ...(s.source ? { source: s.source } : {}) }));
  if (!worthShowing(kept as ActivityStep[])) return null;
  let text = JSON.stringify({ v: ACTIVITY_VERSION, steps: kept });
  // Over the bound: shed the details first, then the later steps, so a record is always whole JSON.
  if (text.length > MAX_CHARS) text = JSON.stringify({ v: ACTIVITY_VERSION, steps: kept.map(withoutDetail) });
  while (text.length > MAX_CHARS && kept.length > 1) {
    kept.pop();
    text = JSON.stringify({ v: ACTIVITY_VERSION, steps: kept.map(withoutDetail) });
  }
  return text.length <= MAX_CHARS ? text : null;
}

/** Reads a stored record back, checking every field again (a stored value is not trusted just because it was written by us). */
export function parseActivity(raw: string | null | undefined): ActivityStep[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (parsed as { steps?: unknown })?.steps;
  if (!Array.isArray(list)) return [];
  const out: ActivityStep[] = [];
  for (const item of list.slice(0, MAX_STEPS)) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    if (typeof s.id !== "string" || !KINDS.has(String(s.kind)) || !STATES.has(String(s.state))) continue;
    const label = plainLabel(s.label, 90);
    if (!label) continue;
    const src = s.source && typeof s.source === "object" ? (s.source as Record<string, unknown>) : null;
    const source = src && typeof src.url === "string" ? safeSource({ url: src.url, title: typeof src.title === "string" ? src.title : "", tier: typeof src.tier === "string" ? src.tier : "", via: src.via === "direct" ? "direct" : "browser" }) : null;
    out.push({ id: plainLabel(s.id, 30), kind: s.kind as ActivityKind, state: s.state === "running" ? "done" : (s.state as StepState), label, ...(typeof s.detail === "string" && s.detail ? { detail: plainLabel(s.detail, 140) } : {}), ...(source ? { source: { ...source, tier: plainLabel(src?.tier, 30) || source.tier } } : {}) });
  }
  return out;
}
