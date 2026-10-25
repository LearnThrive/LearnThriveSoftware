import { TtlCache } from "./cache";

/**
 * A client for the operator's own SearXNG instance (JSON API). SearXNG answers "what pages might help"; it never says what is true. Its results are
 * leads for the research layer to rank and read, not evidence. The instance's address is configuration (it is usually on the same machine or network),
 * so it is deliberately NOT put through the fetched-page address guard; the addresses of the RESULTS are.
 *
 * Every outcome is a status, never a throw: a missing instance, a 403 because the JSON format is not enabled, a timeout or a rate limit all come back
 * as something the tutor can describe honestly ("I could not check this online") rather than a failed answer.
 */
export type SearchStatus = "ok" | "empty" | "json_disabled" | "unavailable" | "timeout" | "rate_limited" | "bad_response" | "disabled";

export interface RawResult {
  title: string;
  url: string;
  snippet: string;
  engines: string[];
  category: string;
  publishedDate: string | null;
}

export interface SearchOutcome {
  status: SearchStatus;
  query: string;
  results: RawResult[];
  /** What happened, in words an operator can act on (never a stack trace, never a secret). */
  detail: string;
}

export interface SearchOptions {
  language?: string;
  categories?: string;
  pageno?: number;
  timeRange?: "day" | "month" | "year";
  signal?: AbortSignal;
}

export interface SearxngConfig {
  enabled: boolean;
  baseUrl: string;
  timeoutMs: number;
  maxResults: number;
  cacheTtlSeconds: number;
}

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; ok: boolean; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export const JSON_DISABLED_HELP = "SearXNG refused the JSON format (HTTP 403). Add `json` to `search.formats` in the instance's settings.yml (formats: [html, json]) and restart it.";

const MAX_BODY = 1_500_000;
const clip = (text: unknown, n: number): string => (typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, n) : "");

export class SearxngClient {
  private readonly cache: TtlCache<SearchOutcome>;

  constructor(
    private readonly config: SearxngConfig,
    private readonly fetcher: FetchLike = fetch as unknown as FetchLike,
    now: () => number = Date.now,
  ) {
    this.cache = new TtlCache<SearchOutcome>(config.cacheTtlSeconds * 1000, 200, now);
  }

  get available(): boolean {
    return this.config.enabled && Boolean(this.config.baseUrl);
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchOutcome> {
    const q = query.replace(/\s+/g, " ").trim();
    const fail = (status: SearchStatus, detail: string): SearchOutcome => ({ status, query: q, results: [], detail });
    if (!this.available) return fail("disabled", "Web search is not configured on this server.");
    if (!q) return fail("empty", "There was nothing to search for.");
    const key = JSON.stringify([q.toLowerCase(), options.language ?? "", options.categories ?? "", options.pageno ?? 1, options.timeRange ?? ""]);
    const cached = this.cache.get(key);
    if (cached) return cached;

    let endpoint: URL;
    try {
      endpoint = new URL("search", this.config.baseUrl.endsWith("/") ? this.config.baseUrl : `${this.config.baseUrl}/`);
    } catch {
      return fail("unavailable", "SEARXNG_BASE_URL is not a valid address.");
    }
    endpoint.searchParams.set("q", q);
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("safesearch", "1");
    endpoint.searchParams.set("pageno", String(options.pageno ?? 1));
    if (options.language) endpoint.searchParams.set("language", options.language);
    if (options.categories) endpoint.searchParams.set("categories", options.categories);
    if (options.timeRange) endpoint.searchParams.set("time_range", options.timeRange);

    const timer = new AbortController();
    const stop = setTimeout(() => timer.abort(), this.config.timeoutMs);
    const relay = () => timer.abort();
    options.signal?.addEventListener("abort", relay, { once: true });
    try {
      const response = await this.fetcher(endpoint.toString(), { headers: { accept: "application/json", "user-agent": "LearnThrive-StudyBuddy/1.0 (+research)" }, signal: timer.signal });
      if (response.status === 403) return fail("json_disabled", JSON_DISABLED_HELP);
      if (response.status === 429) return fail("rate_limited", "SearXNG is rate limiting this server. Try again shortly.");
      if (!response.ok) return fail("unavailable", `SearXNG answered HTTP ${response.status}.`);
      const body = await response.text();
      if (body.length > MAX_BODY) return fail("bad_response", "SearXNG's answer was larger than expected and was ignored.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return fail("bad_response", "SearXNG did not return JSON. Check that the JSON format is enabled and the address points at the instance.");
      }
      const rows = (parsed as { results?: unknown })?.results;
      if (!Array.isArray(rows)) return fail("bad_response", "SearXNG's answer had no results list.");
      const seen = new Set<string>();
      const results: RawResult[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const url = typeof r.url === "string" ? r.url.trim() : "";
        if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
        seen.add(url);
        results.push({
          title: clip(r.title, 200),
          url,
          snippet: clip(r.content, 500),
          engines: Array.isArray(r.engines) ? r.engines.filter((e): e is string => typeof e === "string").slice(0, 6) : typeof r.engine === "string" ? [r.engine] : [],
          category: clip(r.category, 40),
          publishedDate: typeof r.publishedDate === "string" ? r.publishedDate.slice(0, 40) : null,
        });
        if (results.length >= this.config.maxResults * 2) break;
      }
      // No results because the search engines behind SearXNG are suspended or refusing it is a broken search, not a search that found nothing.
      const down = Array.isArray((parsed as { unresponsive_engines?: unknown })?.unresponsive_engines) ? ((parsed as { unresponsive_engines: unknown[] }).unresponsive_engines as unknown[]) : [];
      if (!results.length && down.length) {
        const named = down.slice(0, 4).map((e) => (Array.isArray(e) ? `${String(e[0])}: ${String(e[1] ?? "").slice(0, 60)}` : String(e).slice(0, 60)));
        return fail("unavailable", `SearXNG's search engines are not answering (${named.join("; ")}). They are probably limiting this machine; try again later, or add engines in settings.yml.`);
      }
      const outcome: SearchOutcome = results.length ? { status: "ok", query: q, results, detail: `${results.length} results.` } : { status: "empty", query: q, results: [], detail: "SearXNG found nothing for that query." };
      this.cache.set(key, outcome);
      return outcome;
    } catch (error) {
      if (options.signal?.aborted) return fail("unavailable", "The request was stopped.");
      if (timer.signal.aborted) return fail("timeout", `SearXNG did not answer within ${Math.round(this.config.timeoutMs / 1000)} seconds.`);
      return fail("unavailable", `SearXNG could not be reached (${(error as { code?: string; cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code ?? "network error"}).`);
    } finally {
      clearTimeout(stop);
      options.signal?.removeEventListener("abort", relay);
    }
  }
}
