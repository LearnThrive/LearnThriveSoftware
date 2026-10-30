type Env = Record<string, string | undefined>;

/**
 * LearnThrive AI settings, all from the environment. It is OFF in production by default, and fails closed there.
 *
 * During development the ONLY reasoning model is Reflection's Beam, served by Ollama Cloud (https://ollama.com/v1, model `beam`, key in
 * OLLAMA_API_KEY). Nothing here starts a local model: the tutor no longer needs a GPU. Everything that is not generation (safeguarding,
 * research, verification, uploads, voice) is unchanged.
 *
 *   ASSISTANT_ENABLED               kill switch. Development: on unless "false". Production: on only if exactly "true"
 *   ASSISTANT_PROVIDER              ollama_cloud (default, development only), custom (the production slot), or mock (tests)
 *   ASSISTANT_MODEL                 the model name sent to the provider (default `beam`)
 *   OLLAMA_CLOUD_BASE_URL           Ollama Cloud's OpenAI-compatible address (default https://ollama.com/v1). ASSISTANT_BASE_URL is used by `custom`
 *   OLLAMA_API_KEY                  the Ollama Cloud key, read on the server only and never logged or sent to the browser
 *   ASSISTANT_API_KEY               the production provider's key (`custom`). Never logged
 *   ASSISTANT_CONTEXT               context window the history is planned against, tokens (default 32768; Beam itself accepts far more)
 *   ASSISTANT_MAX_OUTPUT_TOKENS     most tokens in one answer (default 4096; the model's hidden thinking has its own extra allowance, ASSISTANT_THINKING_TOKENS)
 *   ASSISTANT_THINKING              off | auto | on | low | medium | high (default auto: only a genuinely hard question may think)
 *   ASSISTANT_DAILY_MESSAGES        messages per account per day (default 40)     ASSISTANT_PER_MINUTE   per minute (default 6)
 *   ASSISTANT_DAILY_TOKEN_BUDGET    completion tokens per account per day (default 40000): the cost cap on a hosted provider
 *   ASSISTANT_CONCURRENCY           answers generated at once on this server (default 2)
 *   ASSISTANT_STAGE_*               the staged budgets (queue, first activity, first answer, idle, tool round, whole turn)
 *   ASSISTANT_MAX_TOOL_ROUNDS       tool round trips allowed in one turn (default 2)
 *   OPENUI_ENABLED                  on (default) | off: let a turn answer with an interactive interface (docs/OPENUI.md)
 *   OPENUI_MAX_REPAIRS              repair attempts for an interface that does not validate (default 1, at most 2)
 *   RESEARCH_PROVIDER               auto (default: Ollama web search when OLLAMA_API_KEY is set, SearXNG otherwise) | ollama | searxng
 *   OLLAMA_WEB_BASE_URL             where Ollama's web_search / web_fetch live (default https://ollama.com)
 *   SEARXNG_BASE_URL / _TIMEOUT_MS / _MAX_RESULTS / _CACHE_TTL_SECONDS   web research through SearXNG (the fallback; docs/RESEARCH.md)
 *   CRAWL4AI_ENABLED / _BASE_URL / _API_TOKEN / _TIMEOUT_MS / _MAX_CONCURRENCY   the self-hosted browser that reads the pages a search finds (falls back to a plain fetch)
 *   RESEARCH_MAX_SEARCHES / _MAX_FETCHES / _FETCH_MAX_BYTES / _PER_MINUTE   the per-answer and per-account limits on that research
 *   ASSISTANT_RETRIEVAL             on | off (default off): search the student's own authorised uploads for relevant chunks. It needs an embedding provider,
 *                                   and none is configured now that the local helper models are gone, so this stays off until a hosted one is chosen
 *   ASSISTANT_IMAGE_*               photo/page long side, pictures per message (Beam reads text only, so pictures are not sent)
 *   ASSISTANT_PRODUCTION_APPROVED   "true" only after plan19 section 6 is complete and recorded. Required in production
 *   ASSISTANT_MINORS_APPROVED       "true" only after the safeguarding lead has approved in writing. Until then it is for adults
 *   ASSISTANT_SAFEGUARDING_EMAIL    where a safeguarding flag goes (the lead's mailbox). Unset: the static reply is still given
 */
export interface StageBudgets {
  /** How long a turn may wait for a generation slot. */
  queueMs: number;
  /** From sending the request to the first chunk of ANY kind (thinking, a tool call or text). */
  firstActivityMs: number;
  /** From sending the request to the first VISIBLE text. */
  firstAnswerMs: number;
  /** The longest silence between events once activity has started. */
  idleMs: number;
  /** One tool execution, including its result validation. */
  toolRoundMs: number;
  /** The whole turn, absolute: tool rounds and retries never reset it. */
  turnMs: number;
}

export const ASSISTANT_DEFAULTS = {
  /** Reflection's Beam, listed by Ollama Cloud's catalogue (https://ollama.com/api/tags) as `beam` with the capabilities completion, thinking and tools. Text in, text out. */
  model: "beam",
  cloudBaseUrl: "https://ollama.com/v1",
  ollamaWebUrl: "https://ollama.com",
  contextSize: 32_768,
  maxOutputTokens: 4096,
  dailyMessages: 40,
  perMinute: 6,
  dailyTokenBudget: 40_000,
  concurrency: 2,
  queueMax: 8,
  maxInputChars: 4000,
  thinking: "auto" as const,
  maxToolRounds: 2,
  // A large reasoning model hosted elsewhere: queued at the provider, then reasoning before the answer. The whole turn stays bounded.
  queueMs: 20_000,
  firstActivityMs: 90_000,
  firstAnswerMs: 240_000,
  idleMs: 90_000,
  toolRoundMs: 60_000,
  turnMs: 360_000,
  retrievalTopK: 4,
  retrievalMinScore: 0.35,
  searxngUrl: "http://127.0.0.1:8888",
  crawl4aiUrl: "http://127.0.0.1:11235",
  // A public development value so the local container and the website agree without setup. Production must set its own.
  crawl4aiDevToken: "learnthrive-development-only-crawl4ai-token",
  thinkingTokens: 1500,
  photoLongSide: 1400,
  renderLongSide: 1200,
  imagesPerMessage: 3,
  openuiRepairs: 1,
} as const;

export type ThinkingPolicy = "off" | "auto" | "on" | "low" | "medium" | "high";
const THINKING: readonly ThinkingPolicy[] = ["off", "auto", "on", "low", "medium", "high"];

export type ProviderId = "ollama_cloud" | "custom" | "mock";

export interface RetrievalConfig {
  enabled: boolean;
  topK: number;
  minScore: number;
}

export type ResearchProviderChoice = "auto" | "ollama" | "searxng";

export interface ResearchConfig {
  /** Which search provider leads. `auto`: Ollama's web search when OLLAMA_API_KEY is set, SearXNG otherwise. The other is the fallback. */
  provider: ResearchProviderChoice;
  /** Where Ollama's web_search and web_fetch are. */
  ollamaBaseUrl: string;
  /** Where SearXNG runs. If nothing answers, the answer says what could not be checked. */
  baseUrl: string;
  timeoutMs: number;
  maxResults: number;
  cacheTtlSeconds: number;
  maxSearches: number;
  maxFetches: number;
  fetchMaxBytes: number;
  perMinute: number;
}

export interface CrawlerConfig {
  enabled: boolean;
  baseUrl: string;
  /** Server-side only. Never logged, never sent to the browser. */
  token: string;
  timeoutMs: number;
  maxConcurrency: number;
}

export interface ImageConfig {
  photoLongSide: number;
  renderLongSide: number;
  perMessage: number;
}

export interface OpenUiConfig {
  /** A turn may answer with an interactive interface. Off: every answer is plain text. */
  enabled: boolean;
  /** How many times an interface that did not validate is sent back to the model with its errors (0 to 2). */
  maxRepairs: number;
}

export interface AssistantConfig {
  enabled: boolean;
  production: boolean;
  providers: ProviderId[];
  model: string;
  /** Beam reads text only. Always null: nothing is sent to a vision model. */
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
  thinking: ThinkingPolicy;
  /** Extra output tokens allowed for thinking, ON TOP of the answer's budget, so a hard question still gets its answer. */
  thinkingTokens: number;
  stages: StageBudgets;
  maxToolRounds: number;
  retrieval: RetrievalConfig;
  research: ResearchConfig;
  crawler: CrawlerConfig;
  images: ImageConfig;
  openui: OpenUiConfig;
  productionApproved: boolean;
  minorsApproved: boolean;
  safeguardingEmail: string | null;
}

const pick = (v: string | undefined) => v?.trim() || undefined;

function whole(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value?.trim());
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function ratio(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value?.trim());
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** on / off with a default, so a typo leaves the shipped behaviour rather than silently switching a role on. */
function toggle(value: string | undefined, fallback: boolean): boolean {
  const v = value?.trim().toLowerCase();
  if (v === "on" || v === "true" || v === "1") return true;
  if (v === "off" || v === "false" || v === "0") return false;
  return fallback;
}

function stageBudgets(env: Env): StageBudgets {
  return {
    queueMs: whole(env.ASSISTANT_STAGE_QUEUE_MS, ASSISTANT_DEFAULTS.queueMs, 0, 600_000),
    // Independent on purpose: a provider arms both timers, and whichever comes first ends the wait.
    firstActivityMs: whole(env.ASSISTANT_STAGE_FIRST_ACTIVITY_MS, ASSISTANT_DEFAULTS.firstActivityMs, 1_000, 900_000),
    firstAnswerMs: whole(env.ASSISTANT_STAGE_FIRST_ANSWER_MS, ASSISTANT_DEFAULTS.firstAnswerMs, 1_000, 900_000),
    idleMs: whole(env.ASSISTANT_STAGE_IDLE_MS, ASSISTANT_DEFAULTS.idleMs, 1_000, 600_000),
    toolRoundMs: whole(env.ASSISTANT_STAGE_TOOL_MS, ASSISTANT_DEFAULTS.toolRoundMs, 1_000, 600_000),
    turnMs: whole(env.ASSISTANT_STAGE_TURN_MS, ASSISTANT_DEFAULTS.turnMs, 5_000, 1_800_000),
  };
}

const RESEARCH_PROVIDERS: readonly ResearchProviderChoice[] = ["auto", "ollama", "searxng"];

export function assistantConfig(env: Env = process.env): AssistantConfig {
  const production = env.NODE_ENV === "production";
  const asked = (pick(env.ASSISTANT_PROVIDER) ?? "ollama_cloud").toLowerCase().split(",").map((p) => p.trim());
  const providers = asked.filter((p): p is ProviderId => p === "ollama_cloud" || p === "custom" || p === "mock");
  const flag = pick(env.ASSISTANT_ENABLED);
  const thinking = (pick(env.ASSISTANT_THINKING)?.toLowerCase() ?? ASSISTANT_DEFAULTS.thinking) as ThinkingPolicy;
  const researchProvider = (pick(env.RESEARCH_PROVIDER)?.toLowerCase() ?? "auto") as ResearchProviderChoice;
  // One provider only: a comma list used to be an ordered fallback chain across models, and a different model answering in place of the chosen one is exactly
  // what this setup no longer does. More than one entry is treated as a mistake and leaves the assistant closed.
  const single = providers.length === asked.length && providers.length === 1;
  return {
    enabled: production ? flag === "true" : flag !== "false",
    production,
    providers: single ? providers : [],
    model: pick(env.ASSISTANT_MODEL) ?? ASSISTANT_DEFAULTS.model,
    visionModel: null,
    baseUrl: pick(env.ASSISTANT_BASE_URL) ?? null,
    contextSize: whole(env.ASSISTANT_CONTEXT, ASSISTANT_DEFAULTS.contextSize, 1024, 1_000_000),
    maxOutputTokens: whole(env.ASSISTANT_MAX_OUTPUT_TOKENS, ASSISTANT_DEFAULTS.maxOutputTokens, 16, 16384),
    maxInputChars: ASSISTANT_DEFAULTS.maxInputChars,
    dailyMessages: whole(env.ASSISTANT_DAILY_MESSAGES, ASSISTANT_DEFAULTS.dailyMessages, 1, 1000),
    perMinute: whole(env.ASSISTANT_PER_MINUTE, ASSISTANT_DEFAULTS.perMinute, 1, 60),
    dailyTokenBudget: whole(env.ASSISTANT_DAILY_TOKEN_BUDGET, ASSISTANT_DEFAULTS.dailyTokenBudget, 100, 10_000_000),
    concurrency: whole(env.ASSISTANT_CONCURRENCY, ASSISTANT_DEFAULTS.concurrency, 1, 16),
    queueMax: ASSISTANT_DEFAULTS.queueMax,
    thinking: THINKING.includes(thinking) ? thinking : ASSISTANT_DEFAULTS.thinking,
    thinkingTokens: whole(env.ASSISTANT_THINKING_TOKENS, ASSISTANT_DEFAULTS.thinkingTokens, 0, 8192),
    stages: stageBudgets(env),
    maxToolRounds: whole(env.ASSISTANT_MAX_TOOL_ROUNDS, ASSISTANT_DEFAULTS.maxToolRounds, 0, 4),
    retrieval: {
      // Off unless asked for, and it needs an embedding provider that is no longer configured (see the header).
      enabled: toggle(env.ASSISTANT_RETRIEVAL, false),
      topK: whole(env.ASSISTANT_RETRIEVAL_TOP_K, ASSISTANT_DEFAULTS.retrievalTopK, 1, 12),
      minScore: ratio(env.ASSISTANT_RETRIEVAL_MIN_SCORE, ASSISTANT_DEFAULTS.retrievalMinScore, 0, 1),
    },
    research: {
      provider: RESEARCH_PROVIDERS.includes(researchProvider) ? researchProvider : "auto",
      ollamaBaseUrl: pick(env.OLLAMA_WEB_BASE_URL) ?? ASSISTANT_DEFAULTS.ollamaWebUrl,
      baseUrl: pick(env.SEARXNG_BASE_URL) ?? ASSISTANT_DEFAULTS.searxngUrl,
      timeoutMs: whole(env.SEARXNG_TIMEOUT_MS, 8000, 500, 60_000),
      maxResults: whole(env.SEARXNG_MAX_RESULTS, 8, 1, 20),
      cacheTtlSeconds: whole(env.SEARXNG_CACHE_TTL_SECONDS, 3600, 0, 86_400),
      maxSearches: whole(env.RESEARCH_MAX_SEARCHES, 5, 0, 10),
      maxFetches: whole(env.RESEARCH_MAX_FETCHES, 5, 0, 10),
      fetchMaxBytes: whole(env.RESEARCH_FETCH_MAX_BYTES, 1_500_000, 50_000, 10_000_000),
      perMinute: whole(env.RESEARCH_PER_MINUTE, 10, 1, 120),
    },
    crawler: {
      // On by default. In production it needs a token that was set on purpose: the development token is public, so it is not accepted there.
      enabled: toggle(env.CRAWL4AI_ENABLED, true) && !(production && !pick(env.CRAWL4AI_API_TOKEN)),
      baseUrl: pick(env.CRAWL4AI_BASE_URL) ?? ASSISTANT_DEFAULTS.crawl4aiUrl,
      token: pick(env.CRAWL4AI_API_TOKEN) ?? ASSISTANT_DEFAULTS.crawl4aiDevToken,
      timeoutMs: whole(env.CRAWL4AI_TIMEOUT_MS, 15_000, 2_000, 120_000),
      maxConcurrency: whole(env.CRAWL4AI_MAX_CONCURRENCY, 2, 1, 8),
    },
    images: {
      photoLongSide: whole(env.ASSISTANT_PHOTO_LONG_SIDE, ASSISTANT_DEFAULTS.photoLongSide, 512, 2400),
      renderLongSide: whole(env.ASSISTANT_PAGE_LONG_SIDE, ASSISTANT_DEFAULTS.renderLongSide, 512, 2400),
      perMessage: whole(env.ASSISTANT_IMAGES_PER_MESSAGE, ASSISTANT_DEFAULTS.imagesPerMessage, 1, 6),
    },
    openui: {
      enabled: toggle(env.OPENUI_ENABLED, true),
      maxRepairs: whole(env.OPENUI_MAX_REPAIRS, ASSISTANT_DEFAULTS.openuiRepairs, 0, 2),
    },
    productionApproved: pick(env.ASSISTANT_PRODUCTION_APPROVED) === "true",
    minorsApproved: pick(env.ASSISTANT_MINORS_APPROVED) === "true",
    safeguardingEmail: pick(env.ASSISTANT_SAFEGUARDING_EMAIL) ?? null,
  };
}

export type Closed = "disabled" | "production_not_approved" | "production_provider" | "no_provider" | "no_backend";

/**
 * Whether the assistant may run at all, and the first reason it may not. In production it needs the switch, the recorded
 * approval and a `custom` provider with a key: Ollama Cloud's development access never qualifies (plan19 sections 1 and 6).
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

/** The Paper Tutor's own switch, inside the assistant's: development on unless PAPER_TUTOR_ENABLED=false, production only if exactly "true". */
export function paperTutorEnabled(env: Env = process.env): boolean {
  const flag = env.PAPER_TUTOR_ENABLED?.trim();
  return env.NODE_ENV === "production" ? flag === "true" : flag !== "false";
}

/**
 * Marking a student's own completed paper. Not yet measured on real marked scripts or real handwriting, so it is opt-in everywhere:
 * on only if PAPER_MARKER_ENABLED is exactly "true" (and only where the Paper Tutor itself is on).
 */
export function paperMarkerEnabled(env: Env = process.env): boolean {
  return paperTutorEnabled(env) && env.PAPER_MARKER_ENABLED?.trim() === "true";
}

/**
 * Whether marking shows numeric marks (per-criterion awards, estimates and totals). Automatic marking has not been validated against work marked by a
 * qualified person, so the marks are behind their own release flag: development on unless PAPER_MARKS_RELEASED=false, production only if exactly "true".
 * Off, the work is still read, checked and given feedback; no mark is shown.
 */
export function paperMarksReleased(env: Env = process.env): boolean {
  const flag = env.PAPER_MARKS_RELEASED?.trim();
  return env.NODE_ENV === "production" ? flag === "true" : flag !== "false";
}
