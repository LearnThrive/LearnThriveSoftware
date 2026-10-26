import { createHash } from "node:crypto";
import type { Actor } from "@learnthrive/data/library";
import type { AssistantConfig, StageBudgets } from "./config";
import { effortChoices, EFFORT_LEVELS, hostedProfile, type EffortAsk, type EffortLevel, type HostedModelProfile, type ModelChoiceId, type ModelLabSettings } from "./models";
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
  /** The reasoning effort this turn asks for: "auto" (the question decides, the ordinary behaviour) or the developer's own choice. */
  effort: EffortAsk;
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
  /** The effort options this model's picker offers (auto first). Empty: the model takes none, so no effort picker is shown for it. */
  efforts: Array<{ id: EffortAsk; label: string }>;
}

/** The choices the page may show this actor (empty when it may not choose). The local tutor is listed only when it IS the configured default. */
export function pickerChoices(lab: ModelLab | null, config: AssistantConfig): PickerChoice[] {
  if (!lab?.settings.available) return [];
  const hosted = lab.settings.models.filter((m) => lab.providers.has(m.choice)).map((m) => ({ id: m.choice, label: m.label, description: m.description, efforts: effortChoices(m.efforts) }));
  return lab.settings.local ? [...hosted, { id: "local", label: "Local model", description: `LearnThrive AI's own tutor on this machine (${config.model})`, efforts: [] }] : hosted;
}

export type Selection = { ok: true; target: GenerationTarget } | { ok: false; reason: "model_not_allowed" | "bad_model" | "model_unavailable" | "bad_effort" };

/**
 * The effort a request named, in the vocabulary the endpoints use. Absent, empty or "auto": the question decides, as before. Null: a value
 * that is not a level at all. Whether the CHOSEN model offers it is a separate question (its profile's own list), so a page can never ask one
 * model for another model's settings.
 */
function namedEffort(requested: unknown): EffortAsk | null {
  if (requested === undefined || requested === null || requested === "" || requested === "auto") return "auto";
  if (typeof requested !== "string" || requested.length > 12) return null;
  return EFFORT_LEVELS.includes(requested as EffortLevel) ? (requested as EffortLevel) : null;
}

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
    effort: "auto",
  };
}

/**
 * Resolves a request's `model` field. Absent: the ordinary target, for everyone. Present: the actor must be allowed to choose, and the
 * value must be a choice offered here; anything else is refused (never quietly replaced by another model).
 */
export function resolveSelection(input: {
  requested: unknown;
  /** The reasoning effort the request named (docs/ASSISTANT.md, "Model picker"): absent or "auto" leaves the decision with the question. */
  effort?: unknown;
  actor: Pick<Actor, "role" | "mode" | "studentId">;
  lab: ModelLab | null;
  config: AssistantConfig;
  provider: ChatProvider;
  hosted: boolean;
}): Selection {
  const base = defaultTarget(input.config, input.provider, input.hosted);
  const wanted = namedEffort(input.effort);
  if (wanted === null) return { ok: false, reason: "bad_effort" };
  if (input.requested === undefined || input.requested === null || input.requested === "") {
    // An effort belongs to a picked model: with none, only the ordinary "auto" is meaningful.
    if (wanted !== "auto") return { ok: false, reason: "bad_effort" };
    return { ok: true, target: base };
  }
  if (!mayChooseModel(input.actor, input.lab)) return { ok: false, reason: "model_not_allowed" };
  if (typeof input.requested !== "string" || input.requested.length > 40) return { ok: false, reason: "bad_model" };
  const lab = input.lab!;
  if (input.requested === "local") {
    if (!lab.settings.local) return { ok: false, reason: "bad_model" };
    if (wanted !== "auto") return { ok: false, reason: "bad_effort" };
    return { ok: true, target: { ...base, choice: "local", label: `Local model (${input.config.model})` } };
  }
  const profile = hostedProfile(input.requested);
  if (!profile || !lab.settings.models.some((m) => m.choice === profile.choice)) return { ok: false, reason: "bad_model" };
  if (wanted !== "auto" && !profile.efforts.includes(wanted)) return { ok: false, reason: "bad_effort" };
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
      effort: wanted,
    },
  };
}
