type Env = Record<string, string | undefined>;

/**
 * Study Buddy settings, all from the environment (plan19 phase F). It is OFF in production by default, and fails closed there.
 *
 *   ASSISTANT_ENABLED               kill switch. Development: on unless "false". Production: on only if exactly "true"
 *   ASSISTANT_PROVIDER              ollama (default), nim, custom, or mock (tests); a comma list is an ordered fallback chain (development only)
 *   ASSISTANT_MODEL                 text model          ASSISTANT_VISION_MODEL   model for images (may be the same)
 *   ASSISTANT_BASE_URL              the provider's address (Ollama default http://127.0.0.1:11434)
 *   ASSISTANT_API_KEY               the production provider's key (`custom`). NVIDIA_API_KEY is read for `nim`. Never logged
 *   ASSISTANT_CONTEXT               context window to ask for, tokens (default 8192)
 *   ASSISTANT_MAX_OUTPUT_TOKENS     most tokens in one answer (default 700)
 *   ASSISTANT_DAILY_MESSAGES        messages per account per day (default 40)     ASSISTANT_PER_MINUTE   per minute (default 6)
 *   ASSISTANT_DAILY_TOKEN_BUDGET    hosted providers only: completion tokens per account per day (default 40000); the cost cap
 *   ASSISTANT_CONCURRENCY           answers generated at once on this server (default 1: one local GPU)
 *   ASSISTANT_PRODUCTION_APPROVED   "true" only after plan19 section 6 is complete and recorded. Required in production
 *   ASSISTANT_MINORS_APPROVED       "true" only after the safeguarding lead has approved in writing. Until then it is for adults
 *   ASSISTANT_SAFEGUARDING_EMAIL    where a safeguarding flag goes (the lead's mailbox). Unset: the static reply is still given
 */
export const ASSISTANT_DEFAULTS = {
  model: "qwen3.5:9b",
  contextSize: 8192,
  maxOutputTokens: 700,
  dailyMessages: 40,
  perMinute: 6,
  dailyTokenBudget: 40_000,
  concurrency: 1,
  queueMax: 4,
  maxInputChars: 4000,
  firstTokenTimeoutMs: 45_000,
  totalTimeoutMs: 120_000,
} as const;

export type ProviderId = "ollama" | "nim" | "custom" | "mock";

export interface AssistantConfig {
  enabled: boolean;
  production: boolean;
  providers: ProviderId[];
  model: string;
  visionModel: string | null;
  baseUrl: string | null;
  contextSize: number;
  maxOutputTokens: number;
  maxInputChars: number;
  dailyMessages: number;
  perMinute: number;
  dailyTokenBudget: number;
  concurrency: number;
  queueMax: number;
  firstTokenTimeoutMs: number;
  totalTimeoutMs: number;
  productionApproved: boolean;
  minorsApproved: boolean;
  safeguardingEmail: string | null;
}

const pick = (v: string | undefined) => v?.trim() || undefined;

function whole(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value?.trim());
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function assistantConfig(env: Env = process.env): AssistantConfig {
  const production = env.NODE_ENV === "production";
  const asked = (pick(env.ASSISTANT_PROVIDER) ?? "ollama").toLowerCase().split(",").map((p) => p.trim());
  const providers = asked.filter((p): p is ProviderId => p === "ollama" || p === "nim" || p === "custom" || p === "mock");
  const flag = pick(env.ASSISTANT_ENABLED);
  return {
    enabled: production ? flag === "true" : flag !== "false",
    production,
    providers: providers.length === asked.length ? providers : [],
    model: pick(env.ASSISTANT_MODEL) ?? ASSISTANT_DEFAULTS.model,
    visionModel: pick(env.ASSISTANT_VISION_MODEL) ?? null,
    baseUrl: pick(env.ASSISTANT_BASE_URL) ?? null,
    contextSize: whole(env.ASSISTANT_CONTEXT, ASSISTANT_DEFAULTS.contextSize, 1024, 131072),
    maxOutputTokens: whole(env.ASSISTANT_MAX_OUTPUT_TOKENS, ASSISTANT_DEFAULTS.maxOutputTokens, 16, 4096),
    maxInputChars: ASSISTANT_DEFAULTS.maxInputChars,
    dailyMessages: whole(env.ASSISTANT_DAILY_MESSAGES, ASSISTANT_DEFAULTS.dailyMessages, 1, 1000),
    perMinute: whole(env.ASSISTANT_PER_MINUTE, ASSISTANT_DEFAULTS.perMinute, 1, 60),
    dailyTokenBudget: whole(env.ASSISTANT_DAILY_TOKEN_BUDGET, ASSISTANT_DEFAULTS.dailyTokenBudget, 100, 10_000_000),
    concurrency: whole(env.ASSISTANT_CONCURRENCY, ASSISTANT_DEFAULTS.concurrency, 1, 16),
    queueMax: ASSISTANT_DEFAULTS.queueMax,
    firstTokenTimeoutMs: ASSISTANT_DEFAULTS.firstTokenTimeoutMs,
    totalTimeoutMs: ASSISTANT_DEFAULTS.totalTimeoutMs,
    productionApproved: pick(env.ASSISTANT_PRODUCTION_APPROVED) === "true",
    minorsApproved: pick(env.ASSISTANT_MINORS_APPROVED) === "true",
    safeguardingEmail: pick(env.ASSISTANT_SAFEGUARDING_EMAIL) ?? null,
  };
}

export type Closed = "disabled" | "production_not_approved" | "production_provider" | "no_provider" | "no_backend";

/**
 * Whether the assistant may run at all, and the first reason it may not. In production it needs the switch, the recorded
 * approval and a `custom` provider with a key: Ollama (a laptop) and NIM's free catalogue are development only and never
 * qualify (plan19 sections 1 and 6).
 */
export function assistantAvailability(config: AssistantConfig, env: Env = process.env, backend = true): { open: true } | { open: false; reason: Closed } {
  if (!config.enabled) return { open: false, reason: "disabled" };
  if (!backend) return { open: false, reason: "no_backend" };
  if (config.providers.length === 0) return { open: false, reason: "no_provider" };
  if (config.production) {
    if (!config.productionApproved) return { open: false, reason: "production_not_approved" };
    if (config.providers.some((p) => p !== "custom") || !config.baseUrl || !pick(env.ASSISTANT_API_KEY)) return { open: false, reason: "production_provider" };
  }
  return { open: true };
}
