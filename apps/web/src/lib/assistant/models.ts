import type { StageBudgets } from "./config";

type Env = Record<string, string | undefined>;

/**
 * The hosted models a developer may choose for a Study Buddy turn (docs/ASSISTANT.md, "Model picker"), and everything that is particular
 * to each of them. Nothing outside the provider layer knows a model's quirks: the service asks for an effort ("off", "low", "medium",
 * "high") and a profile turns that into the request fields its model documents.
 *
 * Both run on NVIDIA's free hosted catalogue (integrate.api.nvidia.com, OpenAI-compatible). That is a DEVELOPMENT ONLY prototype service:
 * config.ts and providers.ts refuse it in production, and the picker is only offered to an administrator on a development server.
 *
 * The page sends a CHOICE id ("deepseek-v4.1-flash"), never a model name: the server maps it to the model through this table, so no
 * request can name an arbitrary model or endpoint.
 */
export type HostedChoiceId = "deepseek-v4.1-flash" | "step-5-preview";
export type ModelChoiceId = "local" | HostedChoiceId;

export type ReasoningEffort = "off" | "low" | "medium" | "high";

export interface HostedModelProfile {
  choice: HostedChoiceId;
  /** NVIDIA's model identifier: what goes in the request's `model` field. */
  model: string;
  label: string;
  description: string;
  /**
   * The context the service plans the history against. Both models accept about a million tokens; a turn is kept far smaller on purpose, so
   * a long chat does not spend the trial allowance re-sending itself.
   */
  contextSize: number;
  /** Tokens for the visible answer. */
  maxOutputTokens: number;
  /** Extra tokens for hidden reasoning, on top of the answer (a reasoning model shares one output count between the two). */
  reasoningTokens: number;
  /** Reasons whatever the request says (no reliable way to switch it off): the reasoning allowance is always added. */
  alwaysReasons: boolean;
  temperature: number;
  topP: number;
  /**
   * The request fields to try for an effort, best first. An endpoint that refuses an optional field (HTTP 400 before any token) is asked
   * again with the next set, and the set that worked is remembered for the rest of the process, so the refusal is paid once, not per turn.
   * The last set is always the plain request.
   */
  reasoningFields(effort: ReasoningEffort): ReadonlyArray<Record<string, unknown>>;
  /** Hosted reasoning models are slower to their first visible word than a resident local model. */
  stages: Partial<StageBudgets>;
}

// DeepSeek V4.1 Flash's model card documents a thinking mode with a numeric reasoning effort from 1 to 100; NVIDIA's own example for the V4
// family sends it through `chat_template_kwargs` ({ thinking, reasoning_effort: "high" }). The numeric form is tried first, the named one second.
const DEEPSEEK_EFFORT: Record<Exclude<ReasoningEffort, "off">, { numeric: number; named: string }> = {
  low: { numeric: 25, named: "low" },
  medium: { numeric: 60, named: "medium" },
  high: { numeric: 90, named: "high" },
};

// Hosted reasoning models: queued at the provider, then reasoning before the answer. The whole turn stays bounded (one absolute deadline).
const HOSTED_STAGES: Partial<StageBudgets> = { firstActivityMs: 90_000, firstAnswerMs: 240_000, idleMs: 90_000, toolRoundMs: 60_000, turnMs: 360_000 };

export const HOSTED_MODELS: readonly HostedModelProfile[] = [
  {
    choice: "deepseek-v4.1-flash",
    model: "deepseek-ai/deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    description: "Advanced reasoning, mathematics and general tutoring",
    contextSize: 65_536,
    maxOutputTokens: 6_144,
    reasoningTokens: 12_000,
    alwaysReasons: false,
    // The model card recommends temperature 1.0 and top_p 0.95.
    temperature: 1.0,
    topP: 0.95,
    reasoningFields: (effort) =>
      effort === "off"
        ? [{ chat_template_kwargs: { thinking: false } }, {}]
        : [
            { chat_template_kwargs: { thinking: true, reasoning_effort: DEEPSEEK_EFFORT[effort].numeric } },
            { chat_template_kwargs: { thinking: true, reasoning_effort: DEEPSEEK_EFFORT[effort].named } },
            {},
          ],
    stages: HOSTED_STAGES,
  },
  {
    choice: "step-5-preview",
    model: "stepfun-ai/step-5-preview",
    label: "Step 5 Preview",
    description: "Complex reasoning, research and detailed explanations",
    contextSize: 65_536,
    maxOutputTokens: 6_144,
    reasoningTokens: 16_000,
    // The documented checkpoint keeps reasoning on even when enable_thinking=false is sent, so that flag is never relied on (or sent).
    alwaysReasons: true,
    // The model card recommends temperature 1.0 and top_p 0.95.
    temperature: 1.0,
    topP: 0.95,
    // StepFun models on NIM accept a named reasoning effort and return the reasoning separately; "off" asks for the least it allows.
    reasoningFields: (effort) => [{ reasoning_effort: effort === "off" ? "low" : effort }, {}],
    stages: HOSTED_STAGES,
  },
];

export const hostedProfile = (choice: string): HostedModelProfile | null => HOSTED_MODELS.find((m) => m.choice === choice) ?? null;
export const profileForModel = (model: string): HostedModelProfile | null => HOSTED_MODELS.find((m) => m.model === model) ?? null;

/** The display name for a stored `generated_by` ("nim:deepseek-ai/deepseek-v4.1-flash", "ollama:bonsai-2:9b"), for the "Answered by" line. */
export function modelLabel(generatedBy: string | null | undefined): string | null {
  if (!generatedBy) return null;
  const at = generatedBy.indexOf(":");
  const provider = at > 0 ? generatedBy.slice(0, at) : "";
  const model = at > 0 ? generatedBy.slice(at + 1) : generatedBy;
  const hosted = profileForModel(model);
  if (hosted) return hosted.label;
  if (provider === "ollama") return `Local model (${model})`;
  return model || null;
}

export interface ModelLabSettings {
  /** The picker can be offered at all on this server (development, a key, at least one model enabled, not switched off). */
  available: boolean;
  /** The hosted models enabled here, in the order the page lists them. */
  models: readonly HostedModelProfile[];
  /** Whether the configured local tutor may also be chosen (only when the default provider IS the local one). */
  local: boolean;
  /** Completion tokens (answer plus reasoning) per account per day across the hosted models. */
  dailyTokens: number;
  /** Hosted requests per account per day (every request counts: a repair or a tool round is a request). */
  dailyRequests: number;
  /** Uploaded files may be sent to the hosted models. Off by default: NVIDIA's trial is not cleared for real student material. */
  uploads: boolean;
  /** Overrides the profiles' reasoning allowance (tokens), when set. */
  reasoningTokens: number | null;
}

const whole = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number(value?.trim());
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/**
 *   ASSISTANT_NIM_MODELS              the hosted models the picker offers: NVIDIA ids from HOSTED_MODELS, comma separated. Unset or empty: the picker is off
 *   ASSISTANT_MODEL_PICKER            off: hide the picker even when models are listed (default on where it is allowed)
 *   ASSISTANT_NIM_DAILY_TOKENS        completion tokens per account per day across the hosted models (default 600000)
 *   ASSISTANT_NIM_DAILY_REQUESTS      hosted requests per account per day (default 300)
 *   ASSISTANT_NIM_UPLOADS             on: allow uploaded files to be sent to the hosted models (default off; synthetic test files only)
 *   ASSISTANT_NIM_REASONING_TOKENS    the reasoning allowance for every hosted model, tokens (default: each profile's own)
 *   NVIDIA_API_KEY                    the key; server side only, never sent to the page or logged
 *
 * Production never offers it, whatever these say.
 */
export function modelLabSettings(env: Env = process.env, defaultProviders: readonly string[] = []): ModelLabSettings {
  const production = env.NODE_ENV === "production";
  const listed = (env.ASSISTANT_NIM_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // Only models in the table: an unknown id is ignored, never passed through.
  const models = HOSTED_MODELS.filter((m) => listed.includes(m.model) || listed.includes(m.choice));
  const switchedOff = ["off", "false", "0"].includes((env.ASSISTANT_MODEL_PICKER ?? "").trim().toLowerCase());
  const key = Boolean(env.NVIDIA_API_KEY?.trim());
  const uploads = ["on", "true", "1"].includes((env.ASSISTANT_NIM_UPLOADS ?? "").trim().toLowerCase());
  const reasoning = env.ASSISTANT_NIM_REASONING_TOKENS?.trim() ? whole(env.ASSISTANT_NIM_REASONING_TOKENS, -1, 0, 64_000) : -1;
  return {
    available: !production && !switchedOff && key && models.length > 0,
    models,
    local: defaultProviders[0] === "ollama",
    dailyTokens: whole(env.ASSISTANT_NIM_DAILY_TOKENS, 600_000, 1_000, 50_000_000),
    dailyRequests: whole(env.ASSISTANT_NIM_DAILY_REQUESTS, 300, 1, 10_000),
    uploads,
    reasoningTokens: reasoning >= 0 ? reasoning : null,
  };
}
