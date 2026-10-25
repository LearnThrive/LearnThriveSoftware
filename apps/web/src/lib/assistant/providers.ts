import { FallbackProvider } from "./chain";
import type { AssistantConfig, ProviderId } from "./config";
import { MockProvider } from "./mock";
import { profileForModel, type HostedModelProfile } from "./models";
import { NIM_BASE_URL, OpenAiCompatibleProvider } from "./openai";
import { OllamaProvider } from "./ollama";
import type { ChatProvider } from "./types";

type Env = Record<string, string | undefined>;

export const OLLAMA_DEFAULT_URL = "http://127.0.0.1:11434";
export const NIM_DEFAULT_MODEL = "meta/llama-3.2-11b-vision-instruct";

/**
 * The provider (or ordered chain) for this configuration (plan19 section 5.1). `ollama` and `nim` are DEVELOPMENT ONLY and are
 * refused when NODE_ENV=production, whatever the settings say (config.ts says it first; this is the second wall). `custom` is the
 * production slot: an OpenAI-compatible endpoint chosen under plan19 section 6. `mock` is for tests and refused in production.
 * Returns null when nothing usable is configured.
 *
 * Every provider is built with its OWN model names: `ASSISTANT_MODEL` belongs to Ollama and `custom`, `ASSISTANT_NIM_MODEL` to NIM. A
 * chain therefore never hands one provider's model identifier to another (the providers also refuse a name that is not theirs).
 */
export function buildProvider(config: AssistantConfig, env: Env = process.env, fetchImpl?: typeof fetch): ChatProvider | null {
  const make = (id: ProviderId): ChatProvider | null => {
    if (config.production && id !== "custom") return null;
    switch (id) {
      case "ollama":
        return new OllamaProvider({ baseUrl: config.baseUrl ?? OLLAMA_DEFAULT_URL, model: config.model, visionModel: config.visionModel ?? undefined, contextSize: config.contextSize, fetch: fetchImpl });
      case "nim": {
        const key = env.NVIDIA_API_KEY?.trim();
        const model = env.ASSISTANT_NIM_MODEL?.trim() || NIM_DEFAULT_MODEL;
        const profile = profileForModel(model) ?? undefined;
        return key ? new OpenAiCompatibleProvider({ id: "nim", baseUrl: NIM_BASE_URL, apiKey: key, model, visionModel: env.ASSISTANT_NIM_VISION_MODEL?.trim() || undefined, vision: Boolean(profile), profile, fetch: fetchImpl }) : null;
      }
      case "custom": {
        const key = env.ASSISTANT_API_KEY?.trim();
        return key && config.baseUrl ? new OpenAiCompatibleProvider({ id: "custom", baseUrl: config.baseUrl, apiKey: key, model: config.model, visionModel: config.visionModel ?? undefined, fetch: fetchImpl }) : null;
      }
      case "mock":
        return new MockProvider();
      default:
        return null;
    }
  };
  const built = config.providers.map(make).filter((p): p is ChatProvider => p !== null);
  if (built.length === 0) return null;
  return built.length === 1 ? built[0]! : new FallbackProvider(built.map((provider) => ({ provider })));
}

/**
 * One hosted model the developer picker may choose (models.ts), on NVIDIA's catalogue. DEVELOPMENT ONLY: null in production and without a
 * key. It is a provider of its own, never a chain: a picked model that fails is reported as that model's failure, not answered by another.
 */
export function buildHostedProvider(profile: HostedModelProfile, env: Env = process.env, options: { reasoningTokens?: number | null; fetch?: typeof fetch } = {}): OpenAiCompatibleProvider | null {
  if (env.NODE_ENV === "production") return null;
  const key = env.NVIDIA_API_KEY?.trim();
  if (!key) return null;
  return new OpenAiCompatibleProvider({
    id: "nim",
    baseUrl: NIM_BASE_URL,
    apiKey: key,
    model: profile.model,
    // Both models take pictures (their model cards); whether a student's upload may be SENT there is the service's decision (ASSISTANT_NIM_UPLOADS).
    vision: true,
    maxContext: profile.contextSize,
    profile,
    ...(options.reasoningTokens !== null && options.reasoningTokens !== undefined ? { reasoningTokens: options.reasoningTokens } : {}),
    fetch: options.fetch,
  });
}
