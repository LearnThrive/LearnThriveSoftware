import { createHash } from "node:crypto";
import type { Actor } from "@learnthrive/data/library";
import type { AssistantConfig, StageBudgets } from "./config";
import { hostedProfile, type HostedModelProfile, type ModelChoiceId, type ModelLabSettings } from "./models";
import type { ChatProvider } from "./types";

/**
 * Who may choose the model for a turn, and what a choice resolves to (docs/ASSISTANT.md, "Model picker").
 *
 * The picker is for private evaluation by the people who build LearnThrive, not for students: it is offered only on a development server,
 * only with an NVIDIA key and at least one model enabled, and only to an ADMINISTRATOR acting as themselves (never a learner, a guardian, a
 * tutor, or anyone viewing as a learner). The page hiding it proves nothing: every chat request that names a model is checked here, on the
 * server, and refused unless all of that holds. A request can only name a CHOICE from the table in models.ts; no model name or endpoint
 * ever comes from the request.
 */
export interface GenerationTarget {
  /** The choice that was made, or null for an ordinary turn (no picker). */
  choice: ModelChoiceId | null;
  /** Shown as "Answered by …" in the developer's view. Null for an ordinary turn. */
  label: string | null;
  provider: ChatProvider;
  /** The model the service names for warm-up and capability checks; null: the provider's own. */
  model: string | null;
  visionModel: string | null;
  contextSize: number;
  maxOutputTokens: number;
  /** The reasoning allowance added to the answer's when the turn may reason. */
  thinkingTokens: number;
  /** Charged against the hosted (per-token) budgets. */
  hosted: boolean;
  /** Stage budgets that differ for this target (a hosted reasoning model is slower to its first word). */
  stages: Partial<StageBudgets>;
  profile: HostedModelProfile | null;
  /** Uploaded files may be sent to this target. */
  uploads: boolean;
  /** Per-account daily limits for a picked hosted model (every request counts: a tool round or a repair is a request). Null: the ordinary limits. */
  quota: { tokens: number; requests: number } | null;
}

/** Everything the picker needs at run time: the settings and one provider per enabled hosted model (built once, at start-up). */
export interface ModelLab {
  settings: ModelLabSettings;
  providers: ReadonlyMap<string, ChatProvider>;
}

/** May this actor choose the model? Server side, on every request. */
export function mayChooseModel(actor: Pick<Actor, "role" | "mode" | "studentId">, lab: Pick<ModelLab, "settings"> | null): boolean {
  return Boolean(lab?.settings.available) && actor.role === "ADMIN" && actor.mode === "staff" && actor.studentId === null;
}

/**
 * A short, stable, opaque key for this account's saved choice in the browser, so two people who share a browser never inherit each other's
 * choice. It reveals nothing about the account.
 */
export function pickerScope(profileId: string): string {
  return createHash("sha256").update(`learnthrive-model-picker|${profileId}`).digest("hex").slice(0, 16);
}

export interface PickerChoice {
  id: ModelChoiceId;
  label: string;
  description: string;
}

/** The choices the page may show this actor (empty when it may not choose). The local tutor is listed only when it IS the configured default. */
export function pickerChoices(lab: ModelLab | null, config: AssistantConfig): PickerChoice[] {
  if (!lab?.settings.available) return [];
  const hosted = lab.settings.models.filter((m) => lab.providers.has(m.choice)).map((m) => ({ id: m.choice, label: m.label, description: m.description }));
  return lab.settings.local ? [...hosted, { id: "local", label: "Local model", description: `Study Buddy's own tutor on this machine (${config.model})` }] : hosted;
}

export type Selection = { ok: true; target: GenerationTarget } | { ok: false; reason: "model_not_allowed" | "bad_model" | "model_unavailable" };

/** The ordinary target: the configured provider, its configured limits, no label. Unchanged behaviour for everyone who cannot choose. */
export function defaultTarget(config: AssistantConfig, provider: ChatProvider, hosted: boolean): GenerationTarget {
  return {
    choice: null,
    label: null,
    provider,
    model: config.model,
    visionModel: config.visionModel,
    contextSize: config.contextSize,
    maxOutputTokens: config.maxOutputTokens,
    thinkingTokens: config.thinkingTokens,
    hosted,
    stages: {},
    profile: null,
    uploads: true,
    quota: null,
  };
}

/**
 * Resolves a request's `model` field. Absent: the ordinary target, for everyone. Present: the actor must be allowed to choose, and the
 * value must be a choice offered here; anything else is refused (never quietly replaced by another model).
 */
export function resolveSelection(input: {
  requested: unknown;
  actor: Pick<Actor, "role" | "mode" | "studentId">;
  lab: ModelLab | null;
  config: AssistantConfig;
  provider: ChatProvider;
  hosted: boolean;
}): Selection {
  const base = defaultTarget(input.config, input.provider, input.hosted);
  if (input.requested === undefined || input.requested === null || input.requested === "") return { ok: true, target: base };
  if (!mayChooseModel(input.actor, input.lab)) return { ok: false, reason: "model_not_allowed" };
  if (typeof input.requested !== "string" || input.requested.length > 40) return { ok: false, reason: "bad_model" };
  const lab = input.lab!;
  if (input.requested === "local") {
    if (!lab.settings.local) return { ok: false, reason: "bad_model" };
    return { ok: true, target: { ...base, choice: "local", label: `Local model (${input.config.model})` } };
  }
  const profile = hostedProfile(input.requested);
  if (!profile || !lab.settings.models.some((m) => m.choice === profile.choice)) return { ok: false, reason: "bad_model" };
  const provider = lab.providers.get(profile.choice);
  if (!provider) return { ok: false, reason: "model_unavailable" };
  return {
    ok: true,
    target: {
      choice: profile.choice,
      label: profile.label,
      provider,
      model: profile.model,
      visionModel: profile.model,
      contextSize: profile.contextSize,
      maxOutputTokens: profile.maxOutputTokens,
      thinkingTokens: lab.settings.reasoningTokens ?? profile.reasoningTokens,
      hosted: true,
      stages: profile.stages,
      profile,
      uploads: lab.settings.uploads,
      quota: { tokens: lab.settings.dailyTokens, requests: lab.settings.dailyRequests },
    },
  };
}
