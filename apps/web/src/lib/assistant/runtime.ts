import { createMailer, emailWrapper, escapeHtml, htmlBanner, htmlHeading, htmlParagraph, htmlTable, readEmailConfig, sendEmail, textTable } from "@/lib/email";
import { chatUploadStorage, type LibraryStorage } from "@/lib/library/storage";
import { assistantAvailability, assistantConfig, type AssistantConfig, type Closed } from "./config";
import { SystemOneClient } from "./decision";
import { OllamaEmbeddingProvider, type EmbeddingProvider } from "./embeddings";
import { buildProvider } from "./providers";
import { GenerationQueue } from "./queue";
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
  const note = "Study Buddy answered with the fixed safeguarding message (Childline, the NSPCC and 999). The reference is opaque: to find the account, ask the site's administrator to look it up. Follow the safeguarding procedure.";
  const html = emailWrapper([htmlHeading("Study Buddy safeguarding flag"), htmlBanner("This message may concern a child's safety.", "critical"), htmlTable(rows), htmlParagraph(note)].join("\n"), "A Study Buddy conversation was flagged.");
  const text = ["Study Buddy safeguarding flag", "", "This message may concern a child's safety.", "", textTable(rows), "", note].join("\n");
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
  g.__learnthriveAssistant = {
    config,
    provider,
    queue: new GenerationQueue(config.concurrency, config.queueMax),
    uploads,
    hosted: !config.providers.every((p) => p === "ollama" || p === "mock"),
    embeddings,
    decision,
    flag,
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
