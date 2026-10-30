/**
 * A client for the operator's own self-hosted Crawl4AI (the open-source Docker server, REST API). SearXNG decides WHICH pages are worth reading; this
 * reads them in a real browser so pages that build their text with JavaScript come back as readable text. It never searches and it never calls
 * Crawl4AI's hosted or paid endpoints.
 *
 * The caller (fetchSource) has already checked the address against the private-network rules, and checks the address the crawler ended on. This
 * client only talks to the configured server, with the server-side token, and turns every outcome into a status: a missing token, a refused token, a
 * stopped container, a slow page, a broken answer and an empty page are different problems with different fixes, and none of them throws.
 */
export type CrawlStatus = "ok" | "disabled" | "unauthorised" | "unavailable" | "timeout" | "bad_response" | "extraction_failed";

export interface CrawlOutcome {
  status: CrawlStatus;
  /** What happened, in words an operator can act on. Never contains the token. */
  detail: string;
  url: string;
  /** Where the browser ended up after redirects (to be checked again by the caller). */
  finalUrl: string;
  title: string;
  /** Readable text (the page as Markdown). */
  text: string;
  /** The page's HTML, when the server returned it (for structured reading of known play texts). */
  html: string;
  httpStatus: number | null;
  /** Which reader produced it, when it is not Crawl4AI itself (Ollama's web_fetch sets "ollama"). */
  reader?: "ollama";
}

export interface Crawl4aiConfig {
  enabled: boolean;
  baseUrl: string;
  token: string;
  timeoutMs: number;
  maxConcurrency: number;
}

export type CrawlFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

const MAX_BODY = 6_000_000;
const clip = (v: unknown, n: number): string => (typeof v === "string" ? v.slice(0, n) : "");

export class Crawl4aiClient {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly config: Crawl4aiConfig,
    private readonly fetcher: CrawlFetch = fetch as unknown as CrawlFetch,
  ) {}

  /** Whether crawling is switched on and has what it needs (an address and a token). */
  get available(): boolean {
    return this.config.enabled && Boolean(this.config.baseUrl) && Boolean(this.config.token);
  }

  private endpoint(path: string): string | null {
    try {
      return new URL(path, this.config.baseUrl.endsWith("/") ? this.config.baseUrl : `${this.config.baseUrl}/`).toString();
    } catch {
      return null;
    }
  }

  private async slot<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.config.maxConcurrency) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  /** Is the server up and ready? /health needs no token; it says whether Chromium's server is answering at all. */
  async health(signal?: AbortSignal): Promise<{ ok: boolean; version: string | null; detail: string }> {
    if (!this.config.enabled) return { ok: false, version: null, detail: "Crawl4AI is switched off (CRAWL4AI_ENABLED)." };
    const url = this.endpoint("health");
    if (!url) return { ok: false, version: null, detail: "CRAWL4AI_BASE_URL is not a valid address." };
    const timer = new AbortController();
    const stop = setTimeout(() => timer.abort(), 4000);
    const relay = () => timer.abort();
    signal?.addEventListener("abort", relay, { once: true });
    try {
      const response = await this.fetcher(url, { method: "GET", headers: { accept: "application/json" }, signal: timer.signal });
      if (!response.ok) return { ok: false, version: null, detail: `Crawl4AI answered HTTP ${response.status} on /health.` };
      const body = JSON.parse((await response.text()).slice(0, 10_000)) as { status?: string; version?: string };
      return body.status === "healthy" || body.status === "ok" ? { ok: true, version: clip(body.version, 20) || null, detail: "healthy" } : { ok: false, version: null, detail: `Crawl4AI reports status "${clip(body.status, 40)}".` };
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      return { ok: false, version: null, detail: timer.signal.aborted ? "Crawl4AI did not answer /health in time." : `Crawl4AI could not be reached${code ? ` (${code})` : ""}. Is the container running? \`npm start\` runs it.` };
    } finally {
      clearTimeout(stop);
      signal?.removeEventListener("abort", relay);
    }
  }

  /** Reads one page. The address must already have been approved by the caller. */
  async crawl(pageUrl: string, signal?: AbortSignal): Promise<CrawlOutcome> {
    const base: CrawlOutcome = { status: "unavailable", detail: "", url: pageUrl, finalUrl: pageUrl, title: "", text: "", html: "", httpStatus: null };
    const fail = (status: CrawlStatus, detail: string, extra: Partial<CrawlOutcome> = {}): CrawlOutcome => ({ ...base, ...extra, status, detail });
    if (!this.config.enabled) return fail("disabled", "Crawl4AI is switched off.");
    if (!this.config.token) return fail("unauthorised", "CRAWL4AI_API_TOKEN is not set, so the crawler cannot be used.");
    const url = this.endpoint("crawl");
    if (!url) return fail("unavailable", "CRAWL4AI_BASE_URL is not a valid address.");
    return this.slot(async () => {
      const timer = new AbortController();
      const stop = setTimeout(() => timer.abort(), this.config.timeoutMs + 3000);
      const relay = () => timer.abort();
      signal?.addEventListener("abort", relay, { once: true });
      try {
        const response = await this.fetcher(url, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${this.config.token}` },
          signal: timer.signal,
          body: JSON.stringify({
            urls: [pageUrl],
            browser_config: { type: "BrowserConfig", params: { headless: true, java_script_enabled: true } },
            crawler_config: {
              type: "CrawlerRunConfig",
              // One page, fresh, bounded in time; navigation and overlays removed so the result is the readable content.
              params: { stream: false, cache_mode: "bypass", page_timeout: this.config.timeoutMs, word_count_threshold: 10, remove_overlay_elements: true, exclude_social_media_links: true },
            },
          }),
        });
        if (response.status === 401 || response.status === 403) return fail("unauthorised", `Crawl4AI refused the token (HTTP ${response.status}). CRAWL4AI_API_TOKEN must match the one the container was started with.`, { httpStatus: response.status });
        if (response.status === 429) return fail("unavailable", "Crawl4AI is rate limiting this server.", { httpStatus: 429 });
        if (!response.ok) return fail("unavailable", `Crawl4AI answered HTTP ${response.status}.`, { httpStatus: response.status });
        const raw = await response.text();
        if (raw.length > MAX_BODY) return fail("bad_response", "Crawl4AI's answer was larger than expected and was ignored.");
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return fail("bad_response", "Crawl4AI did not return JSON.");
        }
        const first = (body as { results?: unknown })?.results;
        const result = Array.isArray(first) ? (first[0] as Record<string, unknown> | undefined) : undefined;
        if (!result || typeof result !== "object") return fail("bad_response", "Crawl4AI's answer had no result for the page.");
        const httpStatus = typeof result.status_code === "number" ? result.status_code : null;
        if (result.success !== true) return fail("extraction_failed", `Crawl4AI could not read the page${typeof result.error_message === "string" && result.error_message ? `: ${clip(result.error_message, 200).replace(/\s+/g, " ")}` : "."}`, { httpStatus });
        const md = result.markdown;
        const markdown = typeof md === "string" ? md : md && typeof md === "object" ? clip((md as Record<string, unknown>).fit_markdown, 400_000) || clip((md as Record<string, unknown>).raw_markdown, 400_000) : "";
        const text = markdown.replace(/\r/g, "").trim();
        const meta = result.metadata && typeof result.metadata === "object" ? (result.metadata as Record<string, unknown>) : {};
        const finalUrl = clip(result.redirected_url, 2000) || clip(result.url, 2000) || pageUrl;
        if (!text) return fail("extraction_failed", "The page had no readable text once loaded.", { httpStatus, finalUrl });
        return { ...base, status: "ok", detail: "ok", finalUrl, title: clip(meta.title, 200).replace(/\s+/g, " ").trim(), text, html: clip(result.html, 2_000_000), httpStatus };
      } catch (error) {
        if (signal?.aborted) return fail("unavailable", "The request was stopped.");
        if (timer.signal.aborted) return fail("timeout", `Crawl4AI did not finish within ${Math.round(this.config.timeoutMs / 1000)} seconds.`);
        const code = (error as { cause?: { code?: string } })?.cause?.code;
        return fail("unavailable", `Crawl4AI could not be reached${code ? ` (${code})` : ""}. Is the container running?`);
      } finally {
        clearTimeout(stop);
        signal?.removeEventListener("abort", relay);
      }
    });
  }
}
