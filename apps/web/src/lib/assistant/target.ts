import type { AssistantConfig, StageBudgets } from "./config";
import type { ChatProvider } from "./types";

/**
 * What generates a turn: the provider, the model it is asked for, and the limits the service plans against. There is exactly one: the configured provider
 * (Beam on Ollama Cloud during development). There is no model picker and no per-request model: a request that names a model is refused at the route
 * (handlers.ts), so nothing a page sends can change which model answers or where a student's words go.
 */
export interface GenerationTarget {
  provider: ChatProvider;
  /** The model the service names for capability checks; null: the provider's own. */
  model: string | null;
  contextSize: number;
  maxOutputTokens: number;
  /** The reasoning allowance added to the answer's when the turn may reason. */
  thinkingTokens: number;
  /** Charged against the per-account token budget (a hosted provider costs per token; the mock does not). */
  hosted: boolean;
  /** Stage budgets that differ for this target. */
  stages: Partial<StageBudgets>;
}

export function defaultTarget(config: AssistantConfig, provider: ChatProvider, hosted: boolean): GenerationTarget {
  return {
    provider,
    model: config.model,
    contextSize: config.contextSize,
    maxOutputTokens: config.maxOutputTokens,
    thinkingTokens: config.thinkingTokens,
    hosted,
    stages: {},
  };
}
