import { ASSISTANT_DEFAULTS, type AssistantConfig, type ProviderId } from "./config";
import { MockProvider } from "./mock";
import { OpenAiCompatibleProvider, type ReasoningEffort } from "./openai";
import type { ChatProvider } from "./types";

type Env = Record<string, string | undefined>;

export const OLLAMA_CLOUD_URL = ASSISTANT_DEFAULTS.cloudBaseUrl;

/**
 * How Beam is asked to reason. Ollama Cloud's OpenAI-compatible endpoint takes `reasoning_effort` (its documentation lists it, and says each model's own
 * accepted values come from /api/show). "Off" asks for none; an endpoint that refuses the field is asked again without it (openai.ts), so a model that
 * names its levels differently costs one retry, once, not a failed turn.
 */
export const beamReasoningFields = (effort: ReasoningEffort): ReadonlyArray<Record<string, unknown>> =>
  effort === "off" ? [{ reasoning_effort: "none" }, {}] : [{ reasoning_effort: effort }, {}];

/**
 * The one provider for this configuration (plan19 section 5.1). `ollama_cloud` is DEVELOPMENT ONLY and is refused when NODE_ENV=production, whatever the
 * settings say (config.ts says it first; this is the second wall). `custom` is the production slot: an OpenAI-compatible endpoint chosen under plan19
 * section 6. `mock` is for tests and refused in production. Returns null when nothing usable is configured (no key, no address).
 *
 * There is exactly one provider and one model: no chain, no fallback, no picker. If Beam fails the student is told it failed; another model never answers in
 * its place.
 */
export function buildProvider(config: AssistantConfig, env: Env = process.env, fetchImpl?: typeof fetch): ChatProvider | null {
  const id: ProviderId | undefined = config.providers[0];
  if (!id || (config.production && id !== "custom")) return null;
  switch (id) {
    case "ollama_cloud": {
      const key = env.OLLAMA_API_KEY?.trim();
      const baseUrl = env.OLLAMA_CLOUD_BASE_URL?.trim() || OLLAMA_CLOUD_URL;
      return key
        ? new OpenAiCompatibleProvider({
            id: "ollama_cloud",
            baseUrl,
            apiKey: key,
            model: config.model,
            // Beam reads text only (its Ollama page lists no vision input), so nothing is ever sent as a picture.
            vision: false,
            maxContext: config.contextSize,
            reasoningFields: beamReasoningFields,
            reasoningTokens: config.thinkingTokens,
            // Ollama Cloud's /v1 does not support tool_choice (its compatibility page); the model decides on its own whether to call a tool.
            toolChoice: false,
            fetch: fetchImpl,
          })
        : null;
    }
    case "custom": {
      const key = env.ASSISTANT_API_KEY?.trim();
      return key && config.baseUrl ? new OpenAiCompatibleProvider({ id: "custom", baseUrl: config.baseUrl, apiKey: key, model: config.model, fetch: fetchImpl }) : null;
    }
    case "mock":
      return new MockProvider();
    default:
      return null;
  }
}
