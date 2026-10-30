import { TtlCache } from "./cache";
import type { CrawlOutcome, CrawlStatus } from "./crawl4ai";
import type { RawResult, SearchOptions, SearchOutcome, SearchStatus } from "./searxng";

/**
 * Ollama's hosted web search and page reader (https://docs.ollama.com/capabilities/web-search):
 *
 *   POST {base}/api/web_search   { query, max_results? (default 5, at most 10) }  ->  { results: [{ title, url, content }] }
 *   POST {base}/api/web_fetch    { url }                                           ->  { title, content, links }
 *   Authorization: Bearer <OLLAMA_API_KEY>        (read on the server, sent in the header only, never logged or put in an outcome)
 *
 * The same rules as every other research source apply:
 *   - a search result is a LEAD, never proof: the research layer ranks it and reads the page before anything is called verified (verify.ts);
 *   - every outcome is a status, never a throw, so a refused key, a rate limit, a timeout or a broken answer is something the tutor can describe;
 *   - the address of every result is checked as a public http(s) address before it is kept, and the address handed to web_fetch has already passed the
 *     private-network guard in fetchSource.ts (this class is a reader there, like Crawl4AI);
 *   - identical searches are cached, duplicates are removed, and a response larger than expected is ignored.
 * The query itself is made privacy-safe upstream (privacy.ts: no names, emails or phone numbers go to a search), not here.
 */
export interface OllamaWebConfig {
  baseUrl: string;
  /** Server side only. */
  apiKey: string;
  timeoutMs: number;
  maxResults: number;
  cacheTtlSeconds: number;
}

type WebFetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; ok: boolean; headers?: { get(name: string): string | null }; text(): Promise<string> }>;

const MAX_BODY = 4_000_000;
const clip = (value: unknown, n: number): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** The same page under a trailing slash or a fragment is one result. */
function dedupeKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

export class OllamaWebClient {
  private readonly cache: TtlCache<SearchOutcome>;
  private readonly fetcher: WebFetchLike;

  constructor(
    private readonly config: OllamaWebConfig,
    fetcher?: WebFetchLike,
    now: () => number = Date.now,
  ) {
    this.fetcher = fetcher ?? (fetch as unknown as WebFetchLike);
    this.cache = new TtlCache<SearchOutcome>(config.cacheTtlSeconds * 1000, 200, now);
  }

  /** Whether there is a key to use. Without one nothing is called. */
  get available(): boolean {
    return Boolean(this.config.apiKey.trim() && this.config.baseUrl);
  }

  private endpoint(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private async post(path: string, body: unknown, signal: AbortSignal | undefined): Promise<{ ok: true; json: unknown } | { ok: false; status: SearchStatus; detail: string; http: number | null }> {
    const timer = new AbortController();
    const stop = setTimeout(() => timer.abort(), this.config.timeoutMs);
    const relay = () => timer.abort();
    signal?.addEventListener("abort", relay, { once: true });
    try {
      const response = await this.fetcher(this.endpoint(path), {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: timer.signal,
      });
      if (response.status === 401 || response.status === 403) return { ok: false, status: "unavailable", detail: "Ollama refused the key for web search (check OLLAMA_API_KEY).", http: response.status };
      if (response.status === 429) return { ok: false, status: "rate_limited", detail: "Ollama is rate limiting web search for this key. Try again shortly.", http: 429 };
      if (!response.ok) return { ok: false, status: "unavailable", detail: `Ollama web search answered HTTP ${response.status}.`, http: response.status };
      const text = await response.text();
      if (text.length > MAX_BODY) return { ok: false, status: "bad_response", detail: "Ollama's answer was larger than expected and was ignored.", http: response.status };
      try {
        return { ok: true, json: JSON.parse(text) as unknown };
      } catch {
        return { ok: false, status: "bad_response", detail: "Ollama did not return JSON.", http: response.status };
      }
    } catch {
      if (signal?.aborted) return { ok: false, status: "unavailable", detail: "The request was stopped.", http: null };
      if (timer.signal.aborted) return { ok: false, status: "timeout", detail: `Ollama web search did not answer within ${Math.round(this.config.timeoutMs / 1000)} seconds.`, http: null };
      return { ok: false, status: "unavailable", detail: "Ollama web search could not be reached.", http: null };
    } finally {
      clearTimeout(stop);
      signal?.removeEventListener("abort", relay);
    }
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchOutcome> {
    const q = query.replace(/\s+/g, " ").trim();
    const fail = (status: SearchStatus, detail: string): SearchOutcome => ({ status, query: q, results: [], detail });
    if (!this.available) return fail("disabled", "Ollama web search is not configured on this server (no OLLAMA_API_KEY).");
    if (!q) return fail("empty", "There was nothing to search for.");
    const key = q.toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;
    // The API takes at most 10; asking for what the research layer will rank (it keeps the best few) is enough.
    const reply = await this.post("/api/web_search", { query: q, max_results: Math.min(10, Math.max(1, this.config.maxResults)) }, options.signal);
    if (!reply.ok) return fail(reply.status, reply.detail);
    const rows = (reply.json as { results?: unknown })?.results;
    if (!Array.isArray(rows)) return fail("bad_response", "Ollama's answer had no results list.");
    const seen = new Set<string>();
    const results: RawResult[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const url = typeof r.url === "string" ? r.url.trim() : "";
      // Only public web addresses are kept as leads; whether one may actually be READ is decided again, per address, when it is fetched.
      if (!/^https?:\/\//i.test(url)) continue;
      const id = dedupeKey(url);
      if (seen.has(id)) continue;
      seen.add(id);
      results.push({ title: clip(r.title, 200), url, snippet: clip(r.content, 500), engines: ["ollama"], category: "general", publishedDate: null });
    }
    const outcome: SearchOutcome = results.length ? { status: "ok", query: q, results, detail: `${results.length} results.` } : { status: "empty", query: q, results: [], detail: "Ollama web search found nothing for that query." };
    this.cache.set(key, outcome);
    return outcome;
  }

  /**
   * Reads one page through web_fetch. Shaped like the Crawl4AI reader so fetchSource can use either: the text comes back as the page's `content`, and the
   * address is the one that was asked for (the API does not report redirects, and the caller checked the address before sending it).
   */
  async crawl(url: string, signal?: AbortSignal): Promise<CrawlOutcome> {
    const empty = (status: CrawlStatus, detail: string, httpStatus: number | null = null): CrawlOutcome => ({ status, detail, url, finalUrl: url, title: "", text: "", html: "", httpStatus });
    if (!this.available) return empty("disabled", "Ollama web fetch is not configured on this server (no OLLAMA_API_KEY).");
    const reply = await this.post("/api/web_fetch", { url }, signal);
    if (!reply.ok) {
      const status: CrawlStatus = reply.status === "timeout" ? "timeout" : reply.status === "bad_response" ? "bad_response" : reply.http === 401 || reply.http === 403 ? "unauthorised" : "unavailable";
      return empty(status, reply.detail, reply.http);
    }
    const body = reply.json as { title?: unknown; content?: unknown };
    const text = typeof body?.content === "string" ? body.content : "";
    if (!text.trim()) return empty("extraction_failed", "Ollama web fetch returned no text for that page.", 200);
    return { status: "ok", detail: "ok", url, finalUrl: url, title: clip(body?.title, 200), text: text.slice(0, 400_000), html: "", httpStatus: 200, reader: "ollama" };
  }
}

/** The search providers in order of preference. The first that returns results answers; a failure falls through to the next, and says so if all fail. */
export class CompositeSearch {
  constructor(private readonly providers: ReadonlyArray<{ available: boolean; search(query: string, options?: SearchOptions): Promise<SearchOutcome> }>) {}

  get available(): boolean {
    return this.providers.some((p) => p.available);
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchOutcome> {
    let last: SearchOutcome | null = null;
    for (const provider of this.providers) {
      if (!provider.available) continue;
      const outcome = await provider.search(query, options);
      if (outcome.status === "ok") return outcome;
      // "Found nothing" is an answer from a working search; try the next provider only for a failure, or for no results (a second index may know the page).
      last = last && last.status !== "empty" && outcome.status === "empty" ? outcome : (last ?? outcome);
      if (options.signal?.aborted) break;
    }
    return last ?? { status: "disabled", query, results: [], detail: "No web search is configured on this server." };
  }
}

/** Page readers in order of preference: the first that reads the page well answers. The direct fetch in fetchSource.ts is always the last resort. */
export class CompositeReader {
  constructor(private readonly readers: ReadonlyArray<{ available: boolean; crawl(url: string, signal?: AbortSignal): Promise<CrawlOutcome> }>) {}

  get available(): boolean {
    return this.readers.some((r) => r.available);
  }

  async crawl(url: string, signal?: AbortSignal): Promise<CrawlOutcome> {
    const notes: string[] = [];
    let last: CrawlOutcome | null = null;
    for (const reader of this.readers) {
      if (!reader.available) continue;
      const outcome = await reader.crawl(url, signal);
      if (outcome.status === "ok") return outcome;
      notes.push(outcome.detail);
      last = outcome;
      if (signal?.aborted) break;
    }
    if (last) return { ...last, detail: notes.join(" Then: ") };
    return { status: "disabled", detail: "No page reader is configured.", url, finalUrl: url, title: "", text: "", html: "", httpStatus: null };
  }
}
