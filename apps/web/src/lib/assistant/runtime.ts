import { createMailer, emailWrapper, escapeHtml, htmlBanner, htmlHeading, htmlParagraph, htmlTable, readEmailConfig, sendEmail, textTable } from "@/lib/email";
import { chatUploadStorage, type LibraryStorage } from "@/lib/library/storage";
import { assistantAvailability, assistantConfig, type AssistantConfig, type Closed } from "./config";
import { SystemOneClient } from "./decision";
import { OllamaEmbeddingProvider, type EmbeddingProvider } from "./embeddings";
import { LocalClaimRecall } from "./research/entail";
import { Crawl4aiClient } from "./research/crawl4ai";
import { SearxngClient } from "./research/searxng";
import { ResearchService } from "./research/verify";
import { modelLabSettings } from "./models";
import { buildHostedProvider, buildProvider } from "./providers";
import { GenerationQueue } from "./queue";
import type { ModelLab } from "./selection";
import type { SafeguardingFlag } from "./service";
import { isWarmable, type ChatProvider } from "./types";
import { warmOnce } from "./warmup";

type Env = Record<string, string | undefined>;

export interface AssistantRuntime {
  config: AssistantConfig;
  provider: ChatProvider;
  queue: GenerationQueue;
  uploads: LibraryStorage;
  hosted: boolean;
  /** The embedding role (CPU helper). Null when the local stack is not in use: retrieval is then off, not faked. */
  embeddings: EmbeddingProvider | null;
  /** The decision role (CPU helper). Null when unavailable: routing stays deterministic. */
  decision: SystemOneClient | null;
  /** The recall stage (research/entail.ts). Null when it is switched off: only the exact checks run. */
  recall: LocalClaimRecall | null;
  /** Web research through SearXNG. Always present: if the instance does not answer, a turn says what could not be checked. */
  research: ResearchService;
  flag: ((flag: SafeguardingFlag) => Promise<void>) | undefined;
  /** The developer model picker (selection.ts): null where it is not offered (production, no key, no models enabled). */
  lab: ModelLab | null;
}

/** The picker's hosted providers, one per enabled model, built once. Null when the picker is not offered on this server. */
export function buildModelLab(config: AssistantConfig, env: Env = process.env, fetchImpl?: typeof fetch): ModelLab | null {
  const settings = modelLabSettings(env, config.providers);
  if (!settings.available) return null;
  const providers = new Map<string, ChatProvider>();
  for (const profile of settings.models) {
    const provider = buildHostedProvider(profile, env, { reasoningTokens: settings.reasoningTokens, fetch: fetchImpl });
    if (provider) providers.set(profile.choice, provider);
  }
  return providers.size ? { settings, providers } : null;
}

const g = globalThis as unknown as { __learnthriveAssistant?: AssistantRuntime };

/** The safeguarding flag as an email to the lead's mailbox: a reference, the kind and a short excerpt, nothing that identifies the family. */
export function safeguardingEmail(flag: SafeguardingFlag): { subject: string; html: string; text: string } {
  const rows: Array<[string, string]> = [
    ["Reference", flag.reference],
    ["Kind", flag.kind.replace("_", " ")],
    ["When", flag.at.toISOString().replace("T", " ").slice(0, 16) + " UTC"],
    ["Excerpt (the least needed)", flag.excerpt],
  ];
  const note = "LearnThrive AI answered with the fixed safeguarding message (Childline, the NSPCC and 999). The reference is opaque: to find the account, ask the site's administrator to look it up. Follow the safeguarding procedure.";
  const html = emailWrapper([htmlHeading("LearnThrive AI safeguarding flag"), htmlBanner("This message may concern a child's safety.", "critical"), htmlTable(rows), htmlParagraph(note)].join("\n"), "A LearnThrive AI conversation was flagged.");
  const text = ["LearnThrive AI safeguarding flag", "", "This message may concern a child's safety.", "", textTable(rows), "", note].join("\n");
  void escapeHtml;
  return { subject: `Safeguarding flag ${flag.reference}`, html, text };
}

/** Whether the assistant may run here, and why not. Never throws and never contacts the provider. */
export function assistantClosed(env: Env = process.env, backend = true): Closed | null {
  const config = assistantConfig(env);
  const open = assistantAvailability(config, env, backend);
  if (!open.open) return open.reason;
  return buildProvider(config, env) ? null : "no_provider";
}

export function assistantRuntime(env: Env = process.env): AssistantRuntime | null {
  if (g.__learnthriveAssistant) return g.__learnthriveAssistant;
  const config = assistantConfig(env);
  if (!assistantAvailability(config, env).open) return null;
  const provider = buildProvider(config, env);
  const uploads = chatUploadStorage(env);
  if (!provider || !uploads) return null;
  const to = config.safeguardingEmail;
  const flag = to
    ? async (f: SafeguardingFlag) => {
        const mail = readEmailConfig(env);
        if (!mail.ok) throw new Error("email not configured");
        const built = safeguardingEmail(f);
        const sent = await sendEmail(createMailer(mail.config), { from: mail.config.fromAddress, to, subject: built.subject, html: built.html, text: built.text });
        if (!sent.ok) throw new Error("send failed");
      }
    : undefined;
  // The helper roles are part of the LOCAL stack only: a hosted provider keeps its own retrieval/decision story, and production
  // never uses these loopback endpoints (config.ts refuses ollama there).
  const local = !config.production && config.providers.includes("ollama");
  const embeddings = local && config.retrieval.enabled ? new OllamaEmbeddingProvider({ ...config.retrieval.embedding }) : null;
  const decision = local && config.decision.enabled ? new SystemOneClient(config.decision) : null;
  // The recall stage is a helper role like the others: local (development) only, and null unless it was asked for, because it costs a model call.
  const recall = local && config.recall.enabled ? new LocalClaimRecall(config.recall) : null;
  const r = config.research;
  const research = new ResearchService({
    searx: new SearxngClient({ enabled: true, baseUrl: r.baseUrl, timeoutMs: r.timeoutMs, maxResults: r.maxResults, cacheTtlSeconds: r.cacheTtlSeconds }),
    limits: { maxSearches: r.maxSearches, maxFetches: r.maxFetches, fetchMaxBytes: r.fetchMaxBytes, fetchTimeoutMs: 10_000, perMinute: r.perMinute },
    cacheTtlSeconds: r.cacheTtlSeconds,
    // The browser that reads the pages SearXNG finds. If it is off or unreachable, pages are fetched directly and the turn says so.
    fetchOptions: { crawler: config.crawler.enabled ? new Crawl4aiClient(config.crawler) : null },
    recall,
  });
  g.__learnthriveAssistant = {
    config,
    provider,
    queue: new GenerationQueue(config.concurrency, config.queueMax),
    uploads,
    hosted: !config.providers.every((p) => p === "ollama" || p === "mock"),
    embeddings,
    decision,
    recall,
    research,
    flag,
    lab: buildModelLab(config, env),
  };
  // Warm the tutor and the helpers once, in the background: the first question should not pay for a cold load. The manager
  // deduplicates, so a hot reload or two requests cannot start two loads.
  if (local) {
    if (isWarmable(provider)) void warmOnce({ provider, model: config.model, contextSize: config.contextSize, keepAlive: config.keepAlive }, { budgetMs: config.stages.text.loadMs }).catch(() => {});
    if (embeddings) void embeddings.embed(["ready"], { kind: "query" }).catch(() => {});
    if (decision) void decision.health().catch(() => {});
  }
  return g.__learnthriveAssistant;
}

/** For tests. */
export function resetAssistantRuntime(): void {
  delete g.__learnthriveAssistant;
}
