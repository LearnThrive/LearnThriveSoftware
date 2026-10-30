import { createMailer, emailWrapper, escapeHtml, htmlBanner, htmlHeading, htmlParagraph, htmlTable, readEmailConfig, sendEmail, textTable } from "@/lib/email";
import { chatUploadStorage, type LibraryStorage } from "@/lib/library/storage";
import { assistantAvailability, assistantConfig, type AssistantConfig, type Closed } from "./config";
import type { EmbeddingProvider } from "./embeddings";
import { Crawl4aiClient } from "./research/crawl4ai";
import { CompositeReader, CompositeSearch, OllamaWebClient } from "./research/ollamaWeb";
import { SearxngClient } from "./research/searxng";
import { ResearchService } from "./research/verify";
import { buildProvider } from "./providers";
import { GenerationQueue } from "./queue";
import type { SafeguardingFlag } from "./service";
import type { ChatProvider } from "./types";

type Env = Record<string, string | undefined>;

export interface AssistantRuntime {
  config: AssistantConfig;
  provider: ChatProvider;
  queue: GenerationQueue;
  uploads: LibraryStorage;
  hosted: boolean;
  /** The embedding role. Null: none is configured (the local helper was removed), so retrieval over uploads is off, not faked. */
  embeddings: EmbeddingProvider | null;
  /** Web research: Ollama's web search and page reader first when there is a key, SearXNG and Crawl4AI behind them. Always present: if nothing answers, a turn says what could not be checked. */
  research: ResearchService;
  flag: ((flag: SafeguardingFlag) => Promise<void>) | undefined;
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

/**
 * The research stack for a configuration. `RESEARCH_PROVIDER=auto` (the default) leads with Ollama's web search and page reader when OLLAMA_API_KEY is set
 * and falls back to SearXNG and Crawl4AI; `ollama` and `searxng` use only that one. Nothing here makes a model call.
 */
export function buildResearch(config: AssistantConfig, env: Env = process.env, fetchImpl?: typeof fetch): ResearchService {
  const r = config.research;
  const key = env.OLLAMA_API_KEY?.trim() ?? "";
  const ollama = new OllamaWebClient({ baseUrl: r.ollamaBaseUrl, apiKey: key, timeoutMs: Math.max(r.timeoutMs, 10_000), maxResults: r.maxResults, cacheTtlSeconds: r.cacheTtlSeconds }, fetchImpl as never);
  const searx = new SearxngClient({ enabled: true, baseUrl: r.baseUrl, timeoutMs: r.timeoutMs, maxResults: r.maxResults, cacheTtlSeconds: r.cacheTtlSeconds });
  const crawler = config.crawler.enabled ? new Crawl4aiClient(config.crawler) : null;
  const useOllama = r.provider === "ollama" || (r.provider === "auto" && ollama.available);
  const useSearx = r.provider === "searxng" || r.provider === "auto";
  const searchers = [...(useOllama ? [ollama] : []), ...(useSearx ? [searx] : [])];
  const readers = [...(useOllama ? [ollama] : []), ...(crawler && r.provider !== "ollama" ? [crawler] : [])];
  return new ResearchService({
    searx: new CompositeSearch(searchers),
    limits: { maxSearches: r.maxSearches, maxFetches: r.maxFetches, fetchMaxBytes: r.fetchMaxBytes, fetchTimeoutMs: 10_000, perMinute: r.perMinute },
    cacheTtlSeconds: r.cacheTtlSeconds,
    // The readers that turn a found page into text. If none is available or all fail, pages are fetched directly and the turn says so.
    fetchOptions: { crawler: readers.length ? new CompositeReader(readers) : null },
  });
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
  g.__learnthriveAssistant = {
    config,
    provider,
    queue: new GenerationQueue(config.concurrency, config.queueMax),
    uploads,
    // Anything but the mock costs per token, so the daily token budget applies to it.
    hosted: !config.providers.every((p) => p === "mock"),
    embeddings: null,
    research: buildResearch(config, env),
    flag,
  };
  return g.__learnthriveAssistant;
}

/** For tests. */
export function resetAssistantRuntime(): void {
  delete g.__learnthriveAssistant;
}
