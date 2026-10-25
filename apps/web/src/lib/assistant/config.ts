type Env = Record<string, string | undefined>;

/**
 * Study Buddy settings, all from the environment (plan19 phase F, refreshed by the three-model brief). It is OFF in production
 * by default, and fails closed there.
 *
 * Tutor, embeddings and decisions are three separate settings groups because they are three separate models, on two separate
 * local endpoints (the GPU tutor on 11434, the CPU helpers on 11435). Nothing here is a server-process setting: OLLAMA_* values
 * belong to `scripts/ollama-local.mjs`, because changing them in `.env.local` does not reconfigure a running Ollama.
 *
 *   ASSISTANT_ENABLED               kill switch. Development: on unless "false". Production: on only if exactly "true"
 *   ASSISTANT_PROVIDER              ollama (default), nim, custom, or mock (tests); a comma list is an ordered fallback chain (development only)
 *   ASSISTANT_MODEL                 tutor model          ASSISTANT_VISION_MODEL   model for images (may be the same)
 *   ASSISTANT_BASE_URL              the provider's address (Ollama default http://127.0.0.1:11434)
 *   ASSISTANT_API_KEY               the production provider's key (`custom`). NVIDIA_API_KEY is read for `nim`. Never logged
 *   ASSISTANT_CONTEXT               context window to ask for, tokens (default 8192: the instructions, the history, a picture and an answer of up to 4096 tokens must all fit)
 *   ASSISTANT_MAX_OUTPUT_TOKENS     most tokens in one answer (default 4096: about 3000 words of plain English, still over 2000 for maths written in LaTeX; the model's hidden thinking has its own extra allowance, ASSISTANT_THINKING_TOKENS)
 *   ASSISTANT_KEEP_ALIVE            how long the tutor stays resident between questions (default 30m)
 *   ASSISTANT_THINKING              off | auto | on | low | medium | high (default auto: only a genuinely hard question may think)
 *   ASSISTANT_DAILY_MESSAGES        messages per account per day (default 40)     ASSISTANT_PER_MINUTE   per minute (default 6)
 *   ASSISTANT_DAILY_TOKEN_BUDGET    hosted providers only: completion tokens per account per day (default 40000); the cost cap
 *   ASSISTANT_CONCURRENCY           answers generated at once on this server (default 1: one local GPU)
 *   ASSISTANT_STAGE_*               the staged budgets (queue, load, first activity, first answer, idle, tool round, whole turn)
 *   ASSISTANT_MAX_TOOL_ROUNDS       tool round trips allowed in one turn (default 2)
 *   SEARXNG_BASE_URL / _TIMEOUT_MS / _MAX_RESULTS / _CACHE_TTL_SECONDS   web research through SearXNG, which is always on (default http://127.0.0.1:8888; docs/RESEARCH.md)
 *   CRAWL4AI_ENABLED / _BASE_URL / _API_TOKEN / _TIMEOUT_MS / _MAX_CONCURRENCY   the self-hosted browser that reads the pages SearXNG finds (on by default; falls back to a plain fetch)
 *   RESEARCH_MAX_SEARCHES / _MAX_FETCHES / _FETCH_MAX_BYTES / _PER_MINUTE   the per-answer and per-account limits on that research
 *   ASSISTANT_RETRIEVAL             on (default) | off: search the student's own authorised uploads for relevant chunks
 *   ASSISTANT_RETRIEVAL_TOP_K       chunks given to the tutor (default 4)   ASSISTANT_RETRIEVAL_MIN_SCORE   default 0.35
 *   ASSISTANT_EMBED_MODEL / _BASE_URL / _KEEP_ALIVE / _BATCH   the embedding role (CPU helper by default)
 *   ASSISTANT_DECISION_MODEL / _BASE_URL / _KEEP_ALIVE / _TIMEOUT_MS / _MIN_CONFIDENCE / _MIN_MARGIN / ASSISTANT_DECISION   the routing role
 *   ASSISTANT_THINKING_TOKENS       extra output tokens for thinking, on top of the answer's budget (default 600)
 *   ASSISTANT_IMAGE_*               photo/page long side, pictures per message: the measured image budget
 *   ASSISTANT_VRAM_HEADROOM_MIB     the headroom target the benchmark checks (default 1536: brief section 5); not a runtime limit
 *   ASSISTANT_PRODUCTION_APPROVED   "true" only after plan19 section 6 is complete and recorded. Required in production
 *   ASSISTANT_MINORS_APPROVED       "true" only after the safeguarding lead has approved in writing. Until then it is for adults
 *   ASSISTANT_SAFEGUARDING_EMAIL    where a safeguarding flag goes (the lead's mailbox). Unset: the static reply is still given
 */
export interface StageBudgets {
  /** How long a turn may wait for a generation slot. */
  queueMs: number;
  /** How long the model may take to become resident before the turn starts (only when a warm-up is needed). */
  loadMs: number;
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
  // The candidate profile from the brief (section 12), pending the benchmark in docs/OLLAMA_THREE_MODEL.md.
  model: "bonsai-2:9b",
  contextSize: 8192,
  maxOutputTokens: 4096,
  dailyMessages: 40,
  perMinute: 6,
  dailyTokenBudget: 40_000,
  concurrency: 1,
  queueMax: 4,
  maxInputChars: 4000,
  keepAlive: "30m",
  thinking: "auto" as const,
  maxToolRounds: 2,
  queueMs: 20_000,
  loadMs: 180_000,
  firstActivityMs: 60_000,
  firstAnswerMs: 45_000,
  idleMs: 30_000,
  toolRoundMs: 60_000,
  turnMs: 180_000,
  // A photo adds reading time; these are still a whole turn, not a reset per chunk.
  imageFirstActivityMs: 90_000,
  imageFirstAnswerMs: 90_000,
  imageIdleMs: 45_000,
  imageTurnMs: 240_000,
  retrievalTopK: 4,
  retrievalMinScore: 0.35,
  embedModel: "embeddinggemma-2:270m-q8_0-text",
  helperBaseUrl: "http://127.0.0.1:11435",
  searxngUrl: "http://127.0.0.1:8888",
  crawl4aiUrl: "http://127.0.0.1:11235",
  // A public development value so the local container and the website agree without setup. Production must set its own.
  crawl4aiDevToken: "learnthrive-development-only-crawl4ai-token",
  embedKeepAlive: "10m",
  embedBatch: 8,
  decisionModel: "laya:421m-typed-decisions-bf16",
  decisionKeepAlive: "10m",
  decisionTimeoutMs: 4_000,
  // Measured on this laptop (docs/OLLAMA_BENCHMARK.md): five-way calibrated probabilities top out near 0.3-0.5, so a floor of
  // 0.55 abstains on everything. The margin over the runner-up is the honest discriminator; below either, routing is deterministic.
  decisionMinConfidence: 0.3,
  decisionMinMargin: 0.12,
  thinkingTokens: 1500,
  photoLongSide: 1400,
  renderLongSide: 1200,
  imagesPerMessage: 3,
  vramHeadroomMiB: 1536,
} as const;

export type ThinkingPolicy = "off" | "auto" | "on" | "low" | "medium" | "high";
const THINKING: readonly ThinkingPolicy[] = ["off", "auto", "on", "low", "medium", "high"];

export type ProviderId = "ollama" | "nim" | "custom" | "mock";

export interface EmbeddingConfig {
  model: string;
  baseUrl: string;
  keepAlive: string;
  batch: number;
}

export interface RetrievalConfig {
  enabled: boolean;
  topK: number;
  minScore: number;
  embedding: EmbeddingConfig;
}

export interface DecisionConfig {
  enabled: boolean;
  model: string;
  baseUrl: string;
  keepAlive: string;
  timeoutMs: number;
  /** The floor for the chosen option's own probability. */
  minConfidence: number;
  /** The floor for (top probability - runner-up): a five-way tie is not a decision. */
  minMargin: number;
}

export interface ResearchConfig {
  /** Where SearXNG runs. Research is always on; if nothing answers there, the answer says what could not be checked. */
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
  keepAlive: string;
  thinking: ThinkingPolicy;
  /** Extra output tokens allowed for thinking, ON TOP of the answer's budget, so a hard question still gets its answer. */
  thinkingTokens: number;
  stages: { text: StageBudgets; image: StageBudgets };
  maxToolRounds: number;
  retrieval: RetrievalConfig;
  decision: DecisionConfig;
  research: ResearchConfig;
  crawler: CrawlerConfig;
  images: ImageConfig;
  vramHeadroomMiB: number;
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

function stageBudgets(env: Env, kind: "text" | "image"): StageBudgets {
  const image = kind === "image";
  const firstActivity = whole(env.ASSISTANT_STAGE_FIRST_ACTIVITY_MS, image ? ASSISTANT_DEFAULTS.imageFirstActivityMs : ASSISTANT_DEFAULTS.firstActivityMs, 1_000, 900_000);
  // The owner's earlier picture variables still work as the image first-answer and whole-turn budgets (documented as deprecated).
  const firstAnswer = whole(
    image ? env.ASSISTANT_STAGE_FIRST_ANSWER_IMAGE_MS ?? env.ASSISTANT_PICTURE_FIRST_TOKEN_MS : env.ASSISTANT_STAGE_FIRST_ANSWER_MS,
    image ? ASSISTANT_DEFAULTS.imageFirstAnswerMs : ASSISTANT_DEFAULTS.firstAnswerMs,
    1_000,
    900_000,
  );
  return {
    queueMs: whole(env.ASSISTANT_STAGE_QUEUE_MS, ASSISTANT_DEFAULTS.queueMs, 0, 600_000),
    loadMs: whole(env.ASSISTANT_STAGE_LOAD_MS, ASSISTANT_DEFAULTS.loadMs, 5_000, 1_800_000),
    // Independent on purpose: a provider arms both timers, and whichever comes first ends the wait. Neither value silently
    // overrides the other (a deprecated alias therefore still means what it says).
    firstActivityMs: firstActivity,
    firstAnswerMs: firstAnswer,
    idleMs: whole(image ? env.ASSISTANT_STAGE_IDLE_IMAGE_MS : env.ASSISTANT_STAGE_IDLE_MS, image ? ASSISTANT_DEFAULTS.imageIdleMs : ASSISTANT_DEFAULTS.idleMs, 1_000, 600_000),
    toolRoundMs: whole(env.ASSISTANT_STAGE_TOOL_MS, ASSISTANT_DEFAULTS.toolRoundMs, 1_000, 600_000),
    turnMs: whole(
      image ? env.ASSISTANT_STAGE_TURN_IMAGE_MS ?? env.ASSISTANT_PICTURE_TOTAL_MS : env.ASSISTANT_STAGE_TURN_MS,
      image ? ASSISTANT_DEFAULTS.imageTurnMs : ASSISTANT_DEFAULTS.turnMs,
      5_000,
      1_800_000,
    ),
  };
}

export function assistantConfig(env: Env = process.env): AssistantConfig {
  const production = env.NODE_ENV === "production";
  const asked = (pick(env.ASSISTANT_PROVIDER) ?? "ollama").toLowerCase().split(",").map((p) => p.trim());
  const providers = asked.filter((p): p is ProviderId => p === "ollama" || p === "nim" || p === "custom" || p === "mock");
  const flag = pick(env.ASSISTANT_ENABLED);
  const thinking = (pick(env.ASSISTANT_THINKING)?.toLowerCase() ?? ASSISTANT_DEFAULTS.thinking) as ThinkingPolicy;
  const helper = pick(env.ASSISTANT_HELPER_BASE_URL) ?? ASSISTANT_DEFAULTS.helperBaseUrl;
  return {
    enabled: production ? flag === "true" : flag !== "false",
    production,
    providers: providers.length === asked.length ? providers : [],
    model: pick(env.ASSISTANT_MODEL) ?? ASSISTANT_DEFAULTS.model,
    visionModel: pick(env.ASSISTANT_VISION_MODEL) ?? null,
    baseUrl: pick(env.ASSISTANT_BASE_URL) ?? null,
    contextSize: whole(env.ASSISTANT_CONTEXT, ASSISTANT_DEFAULTS.contextSize, 1024, 131072),
    maxOutputTokens: whole(env.ASSISTANT_MAX_OUTPUT_TOKENS, ASSISTANT_DEFAULTS.maxOutputTokens, 16, 8192),
    maxInputChars: ASSISTANT_DEFAULTS.maxInputChars,
    dailyMessages: whole(env.ASSISTANT_DAILY_MESSAGES, ASSISTANT_DEFAULTS.dailyMessages, 1, 1000),
    perMinute: whole(env.ASSISTANT_PER_MINUTE, ASSISTANT_DEFAULTS.perMinute, 1, 60),
    dailyTokenBudget: whole(env.ASSISTANT_DAILY_TOKEN_BUDGET, ASSISTANT_DEFAULTS.dailyTokenBudget, 100, 10_000_000),
    concurrency: whole(env.ASSISTANT_CONCURRENCY, ASSISTANT_DEFAULTS.concurrency, 1, 16),
    queueMax: ASSISTANT_DEFAULTS.queueMax,
    keepAlive: pick(env.ASSISTANT_KEEP_ALIVE) ?? ASSISTANT_DEFAULTS.keepAlive,
    thinking: THINKING.includes(thinking) ? thinking : ASSISTANT_DEFAULTS.thinking,
    thinkingTokens: whole(env.ASSISTANT_THINKING_TOKENS, ASSISTANT_DEFAULTS.thinkingTokens, 0, 4096),
    stages: { text: stageBudgets(env, "text"), image: stageBudgets(env, "image") },
    maxToolRounds: whole(env.ASSISTANT_MAX_TOOL_ROUNDS, ASSISTANT_DEFAULTS.maxToolRounds, 0, 4),
    retrieval: {
      enabled: toggle(env.ASSISTANT_RETRIEVAL, true),
      topK: whole(env.ASSISTANT_RETRIEVAL_TOP_K, ASSISTANT_DEFAULTS.retrievalTopK, 1, 12),
      minScore: ratio(env.ASSISTANT_RETRIEVAL_MIN_SCORE, ASSISTANT_DEFAULTS.retrievalMinScore, 0, 1),
      embedding: {
        model: pick(env.ASSISTANT_EMBED_MODEL) ?? ASSISTANT_DEFAULTS.embedModel,
        baseUrl: pick(env.ASSISTANT_EMBED_BASE_URL) ?? helper,
        keepAlive: pick(env.ASSISTANT_EMBED_KEEP_ALIVE) ?? ASSISTANT_DEFAULTS.embedKeepAlive,
        batch: whole(env.ASSISTANT_EMBED_BATCH, ASSISTANT_DEFAULTS.embedBatch, 1, 32),
      },
    },
    decision: {
      // The router is a helper: enabled in development, never in production (the local profile is development only anyway).
      enabled: !production && toggle(env.ASSISTANT_DECISION, true),
      model: pick(env.ASSISTANT_DECISION_MODEL) ?? ASSISTANT_DEFAULTS.decisionModel,
      baseUrl: pick(env.ASSISTANT_DECISION_BASE_URL) ?? helper,
      keepAlive: pick(env.ASSISTANT_DECISION_KEEP_ALIVE) ?? ASSISTANT_DEFAULTS.decisionKeepAlive,
      timeoutMs: whole(env.ASSISTANT_DECISION_TIMEOUT_MS, ASSISTANT_DEFAULTS.decisionTimeoutMs, 500, 30_000),
      minConfidence: ratio(env.ASSISTANT_DECISION_MIN_CONFIDENCE, ASSISTANT_DEFAULTS.decisionMinConfidence, 0, 1),
      minMargin: ratio(env.ASSISTANT_DECISION_MIN_MARGIN, ASSISTANT_DEFAULTS.decisionMinMargin, 0, 1),
    },
    research: {
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
    vramHeadroomMiB: whole(env.ASSISTANT_VRAM_HEADROOM_MIB, ASSISTANT_DEFAULTS.vramHeadroomMiB, 256, 8192),
    productionApproved: pick(env.ASSISTANT_PRODUCTION_APPROVED) === "true",
    minorsApproved: pick(env.ASSISTANT_MINORS_APPROVED) === "true",
    safeguardingEmail: pick(env.ASSISTANT_SAFEGUARDING_EMAIL) ?? null,
  };
}

/** The staged budgets for a turn, chosen by whether it carries a picture. */
export const stageBudgetsFor = (config: AssistantConfig, hasPictures: boolean): StageBudgets => (hasPictures ? config.stages.image : config.stages.text);

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
