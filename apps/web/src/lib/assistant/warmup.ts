import { isWarmable, type ChatProvider, type WarmResult } from "./types";

/**
 * One warm-up per endpoint, model and context, shared by every caller (brief section 6).
 *
 * The previous background warm-up sent `keep_alive` but not `num_ctx`; `/api/ps` then showed the model loaded, while the first
 * real request (`num_ctx 8192`) forced a full reload (215-251 s in the measured baseline). This manager always passes exactly the
 * options a turn uses, and never starts a second load for the same profile: a hot reload of the app, two students, or a retry all
 * join the same in-flight promise.
 */

export interface WarmProfile {
  provider: ChatProvider;
  model: string;
  contextSize: number;
  keepAlive?: string;
}

type Entry = { key: string; promise: Promise<WarmResult> };

// A globalThis singleton: Next.js can evaluate a module more than once (route bundles, hot reload), and a module-level Map would
// then allow two loads for the same model. Keyed by endpoint id + model + context.
const g = globalThis as unknown as { __learnthriveWarmups?: Map<string, Entry> };

const entries = () => (g.__learnthriveWarmups ??= new Map<string, Entry>());

export const warmKey = (profile: WarmProfile): string => `${profile.provider.id}|${profile.model}|${profile.contextSize}|${profile.keepAlive ?? ""}`;

/** How many warm-ups are running, for tests and the status line. Never which. */
export function warmUpsInFlight(): number {
  return entries().size;
}

/**
 * Makes the model resident, or joins the load already running. A failure is not cached: the next turn tries again (a stopped
 * server, for example, is retried once it is back).
 */
export function warmOnce(profile: WarmProfile, options: { signal?: AbortSignal; budgetMs?: number } = {}): Promise<WarmResult> {
  const key = warmKey(profile);
  const existing = entries().get(key);
  if (existing) return existing.promise;
  const provider = profile.provider;
  if (!isWarmable(provider)) return Promise.resolve({ ok: false, loadMs: null, detail: "not_warmable" });

  const budget = options.budgetMs && options.budgetMs > 0 ? options.budgetMs : 300_000;
  const controller = new AbortController();
  const onCaller = () => controller.abort("caller");
  if (options.signal?.aborted) return Promise.resolve({ ok: false, loadMs: null, detail: "aborted" });
  options.signal?.addEventListener("abort", onCaller, { once: true });
  const timer = setTimeout(() => controller.abort("budget"), budget);

  const promise = provider
    .warm({ model: profile.model, contextSize: profile.contextSize, keepAlive: profile.keepAlive, signal: controller.signal })
    .catch((): WarmResult => ({ ok: false, loadMs: null, detail: "unreachable" }))
    .then((result) => {
      entries().delete(key);
      return result;
    })
    .finally(() => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onCaller);
    });
  entries().set(key, { key, promise });
  return promise;
}

/** Whether a turn has to prepare the model first. `/api/ps` is the evidence; a provider that cannot report says "unknown". */
export async function modelReady(provider: ChatProvider, model: string): Promise<boolean | null> {
  if (!isWarmable(provider)) return null;
  try {
    return await (provider as ChatProvider & { resident(m?: string): Promise<boolean> }).resident(model);
  } catch {
    return null;
  }
}

/** For tests. */
export function resetWarmUps(): void {
  entries().clear();
}
