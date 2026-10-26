import { isPrivateAddress } from "./research/safeUrl";
import { isIP } from "node:net";

/**
 * What LearnThrive AI is genuinely doing while it prepares an answer, as typed events the page can show live and a reopened chat can show again.
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
  /** A sanitised link: http(s) only, no login, no fragment, and only the query parameters a page needs (see `safeSource`). */
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

/** A public web address's host, or null for anything that must never be shown: not http(s), a login in it, a local or internal name, a private address. */
export function publicHost(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || !host.includes(".") || /(^|\.)(localhost|local|internal|lan|corp|home|home\.arpa)$/.test(host)) return null;
  if (isIP(host) && isPrivateAddress(host)) return null;
  return host;
}

/**
 * Query parameters that are never kept in a link: tracking (they change nothing on the page), and anything that could identify a person, a session or
 * a search (a site's own search page carries what was searched for). Matched on the parameter's name, case-insensitively.
 */
const DROPPED_PARAM = /^(utm(_.*)?|fbclid|gclid|dclid|msclkid|mc_[a-z]+|_ga|_gl|ref|referrer|source|campaign|session(id)?|sess|sid|phpsessid|jsessionid|token|access_token|id_token|auth|key|api_?key|apikey|sig|signature|password|pass|pwd|email|e-?mail|user(name)?|login|q|query|search|s|text|term|keywords?)$/i;
/** A value that looks like a credential or an identifier of a person rather than an address on a site. */
const SECRET_VALUE = /@|^[A-Za-z0-9_-]{32,}$|^[a-f0-9]{24,}$/i;
const MAX_LINK = 300;

/**
 * A link safe to show and open: public http(s), no credentials, no fragment, never a local or internal address. Null otherwise.
 *
 * The query string is kept only where it is part of the address of the page (`?id=12`, `?act=3&scene=1`): tracking parameters and anything that
 * could carry a person's details, a session or a search are dropped, as is any value that looks like a token. A link is never cut part-way, because a
 * cut link is a broken one: if it is too long with its query it is given without the query, and if the path alone is too long it points at the site.
 */
export function safeSource(input: { url: string; title?: string; tier?: string; via?: "crawl4ai" | "browser" | "direct" }): ActivitySource | null {
  const host = publicHost(input.url);
  if (!host) return null;
  const url = new URL(input.url);
  const kept = new URLSearchParams();
  for (const [name, value] of url.searchParams) if (!DROPPED_PARAM.test(name) && !SECRET_VALUE.test(value) && value.length <= 64) kept.append(name, value);
  const query = kept.toString();
  const candidates = [`${url.origin}${url.pathname}${query ? `?${query}` : ""}`, `${url.origin}${url.pathname}`, `${url.origin}/`];
  const link = candidates.find((c) => c.length <= MAX_LINK) ?? `${url.origin}/`;
  const title = plainLabel(input.title, 120) || host;
  return { title, host: plainLabel(host, 80), url: link, tier: TIER_WORDS[input.tier ?? ""] ?? (plainLabel(input.tier, 30) || "site"), via: input.via === "direct" ? "direct" : "browser" };
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
/** How a turn ended, kept with its steps so a reopened chat shows a stopped or failed turn as that, not as completed. */
export type ActivityOutcome = "done" | "failed" | "stopped";
const OUTCOMES: ReadonlySet<string> = new Set(["done", "failed", "stopped"]);
const withoutDetail = (step: { detail?: string }) => {
  const copy: Record<string, unknown> = { ...step };
  delete copy.detail;
  return copy;
};
const MAX_STEPS = 24;
const MAX_CHARS = 6000;

/**
 * The record stored with an answer: the finished steps only, bounded, or null if there is nothing worth keeping. `outcome` is stored only when the
 * turn did not complete (a record without one reads as completed, which is also how records written before it existed read).
 */
export function serializeActivity(steps: readonly ActivityStep[], outcome: ActivityOutcome = "done"): string | null {
  const kept = steps
    .filter((s) => s.state !== "running" && s.kind !== "write")
    .slice(0, MAX_STEPS)
    .map((s) => ({ id: s.id, kind: s.kind, state: s.state, label: s.label, ...(s.detail ? { detail: s.detail } : {}), ...(s.source ? { source: s.source } : {}) }));
  if (!worthShowing(kept as ActivityStep[])) return null;
  const head = { v: ACTIVITY_VERSION, ...(outcome !== "done" ? { outcome } : {}) };
  let text = JSON.stringify({ ...head, steps: kept });
  // Over the bound: shed the details first, then the later steps, so a record is always whole JSON.
  if (text.length > MAX_CHARS) text = JSON.stringify({ ...head, steps: kept.map(withoutDetail) });
  while (text.length > MAX_CHARS && kept.length > 1) {
    kept.pop();
    text = JSON.stringify({ ...head, steps: kept.map(withoutDetail) });
  }
  return text.length <= MAX_CHARS ? text : null;
}

/** Reads a stored record back, checking every field again (a stored value is not trusted just because it was written by us). */
export function parseActivity(raw: string | null | undefined): ActivityStep[] {
  return parseActivityRecord(raw).steps;
}

/** As `parseActivity`, with how the turn ended. Anything unreadable is "done": the steps themselves still say which of them failed. */
export function parseActivityRecord(raw: string | null | undefined): { steps: ActivityStep[]; outcome: ActivityOutcome } {
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const stored = (parsed as { outcome?: unknown } | null)?.outcome;
  const outcome: ActivityOutcome = typeof stored === "string" && OUTCOMES.has(stored) ? (stored as ActivityOutcome) : "done";
  const steps = readSteps(parsed);
  return { steps, outcome: steps.length ? outcome : "done" };
}

function readSteps(parsed: unknown): ActivityStep[] {
  const list = (parsed as { steps?: unknown } | null)?.steps;
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
