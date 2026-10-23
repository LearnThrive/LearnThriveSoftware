import { TtlCache } from "./cache";
import { fetchSource, type FetchedSource, type FetchOptions } from "./fetchSource";
import { workOf } from "./works";
import { cleanQuery, quotationQuery } from "./privacy";
import { matchQuotation, words } from "./quotations";
import { isOfficialExamHost, rankResults, type RankedResult, type SearchPurpose, type SourceTier } from "./ranking";
import type { SearchOutcome, SearchStatus } from "./searxng";

/**
 * The research layer a tutoring turn can use. It is a CONTROLLED tool, not a free-running browser: every turn gets a session with a hard budget of
 * searches and page reads, repeated questions cost nothing, and what comes back is evidence with its source and rank, never an answer.
 *
 *   search results are LEADS            a snippet is never proof; a quotation is only "verified" when its words are found in a page that was READ
 *   rank matters                        an exam board's own page outranks a revision site; a revision site outranks a blog
 *   uncertainty is a result             "could not check" is a normal status, and it is what the student is told
 *   pages are untrusted                 instruction-like text in a page is reported and ignored, and never reaches the model as an instruction
 */
export interface SearchLike {
  available: boolean;
  search(query: string, options?: { signal?: AbortSignal; language?: string; categories?: string; timeRange?: "day" | "month" | "year" }): Promise<SearchOutcome>;
}

export interface ResearchLimits {
  maxSearches: number;
  maxFetches: number;
  fetchMaxBytes: number;
  fetchTimeoutMs: number;
  /** Searches one account may start per minute, across turns. */
  perMinute: number;
}

export const RESEARCH_LIMITS: ResearchLimits = { maxSearches: 3, maxFetches: 3, fetchMaxBytes: 1_500_000, fetchTimeoutMs: 10_000, perMinute: 10 };

export interface ResearchDeps {
  searx: SearchLike;
  limits: ResearchLimits;
  fetchOptions?: Pick<FetchOptions, "fetcher" | "resolve" | "pdfText">;
  cacheTtlSeconds?: number;
  now?: () => number;
}

export type QuoteStatus = "verified_exact" | "verified_variant" | "supported_secondary" | "paraphrase_or_misquote" | "unsupported" | "unverifiable";

export interface Evidence {
  url: string;
  title: string;
  tier: SourceTier;
  /** What was found there: words of the source that matched, or the sentences closest to the claim. Short, and already cleaned. */
  extract: string;
  read: boolean;
}

export interface QuoteVerdict {
  status: QuoteStatus;
  quotation: string;
  work: string | null;
  /** Where the real words are, when known (Act and scene for a play). */
  location?: string;
  speaker?: string;
  /** What the source actually says, when it differs from what was quoted. */
  sourceWording?: string;
  evidence: Evidence[];
  note: string;
}

export interface ClaimReport {
  status: "evidence_found" | "no_evidence" | "unavailable";
  claim: string;
  evidence: Evidence[];
  note: string;
}

export interface DocumentLead {
  url: string;
  title: string;
  tier: SourceTier;
}

export interface DocumentReport {
  status: "found" | "not_found" | "unavailable";
  leads: DocumentLead[];
  note: string;
}

const BOARDS: Record<string, string> = { aqa: "AQA", edexcel: "Pearson Edexcel", pearson: "Pearson Edexcel", ocr: "OCR", eduqas: "Eduqas", wjec: "WJEC", ccea: "CCEA" };
export const boardName = (raw: string): string | null => BOARDS[raw.toLowerCase().replace(/[^a-z]/g, "")] ?? null;

const STATUS_WORDS: Record<SearchStatus, string> = {
  ok: "Search worked.",
  empty: "The search found nothing.",
  json_disabled: "Web search is set up incorrectly on this server (its JSON output is off).",
  unavailable: "Web search could not be reached.",
  timeout: "Web search took too long.",
  rate_limited: "Web search is busy.",
  bad_response: "Web search gave an answer that could not be read.",
  disabled: "Web search is not switched on here.",
};

const clip = (text: string, n: number) => (text.length <= n ? text : `${text.slice(0, n - 1).trimEnd()}…`);

/** The few sentences of a page that share the most words with a claim. */
export function nearestSentences(text: string, claim: string, count = 2): string {
  const target = new Set(words(claim).filter((w) => w.length > 3));
  if (!target.size) return "";
  const sentences = text.split(/(?<=[.!?])\s+|\n/).map((s) => s.trim()).filter((s) => s.length > 20 && s.length < 500);
  return sentences
    .map((s) => ({ s, hits: new Set(words(s).filter((w) => target.has(w))).size }))
    .filter((x) => x.hits >= Math.min(3, target.size))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, count)
    .map((x) => x.s)
    .join(" ");
}

/** A shared service: the search client, a cache of pages already read, and a per-account search rate limit. */
export class ResearchService {
  private readonly pages: TtlCache<FetchedSource>;
  private readonly recent = new Map<string, number[]>();

  constructor(readonly deps: ResearchDeps) {
    this.pages = new TtlCache<FetchedSource>((deps.cacheTtlSeconds ?? 3600) * 1000, 100, deps.now);
  }

  get available(): boolean {
    return this.deps.searx.available;
  }

  /** Whether this account may start a search now; counts it if so. */
  allow(owner: string): boolean {
    const now = (this.deps.now ?? Date.now)();
    const recent = (this.recent.get(owner) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.deps.limits.perMinute) {
      this.recent.set(owner, recent);
      return false;
    }
    recent.push(now);
    this.recent.set(owner, recent);
    if (this.recent.size > 500) this.recent.delete(this.recent.keys().next().value as string);
    return true;
  }

  async page(url: string, signal?: AbortSignal): Promise<FetchedSource> {
    const key = url.replace(/#.*$/, "");
    const hit = this.pages.get(key);
    if (hit) return hit;
    const got = await fetchSource(url, { ...this.deps.fetchOptions, maxBytes: this.deps.limits.fetchMaxBytes, timeoutMs: this.deps.limits.fetchTimeoutMs, signal });
    if (got.ok) this.pages.set(key, got);
    return got;
  }

  session(owner: string, signal?: AbortSignal): ResearchSession {
    return new ResearchSession(this, owner, signal);
  }
}

/** One turn's research: its own budget, its own record of what was searched, read and found. */
export class ResearchSession {
  searches = 0;
  fetches = 0;
  readonly queries = new Map<string, SearchOutcome>();
  readonly read = new Map<string, FetchedSource>();
  readonly ledger: Evidence[] = [];
  readonly notes: string[] = [];
  skipped = 0;

  constructor(
    private readonly service: ResearchService,
    private readonly owner: string,
    private readonly signal?: AbortSignal,
  ) {}

  get available(): boolean {
    return this.service.available;
  }

  private get limits(): ResearchLimits {
    return this.service.deps.limits;
  }

  /** One search, through the budget, the cache of this turn, the account's rate limit and the privacy cleaner. */
  async searchWeb(rawQuery: string, purpose: SearchPurpose = "general", options: { timeRange?: "day" | "month" | "year" } = {}): Promise<{ outcome: SearchOutcome; ranked: RankedResult[]; note: string }> {
    const empty = (status: SearchStatus, query: string, detail: string): { outcome: SearchOutcome; ranked: RankedResult[]; note: string } => ({ outcome: { status, query, results: [], detail }, ranked: [], note: detail });
    if (!this.available) return empty("disabled", rawQuery, STATUS_WORDS.disabled);
    const clean = cleanQuery(rawQuery);
    if (!clean.ok) return empty("empty", rawQuery, `Not searched: ${clean.reason}.`);
    const key = clean.query.toLowerCase();
    const repeat = this.queries.get(key);
    if (repeat) return { outcome: repeat, ranked: rankResults(repeat.results, purpose, { limit: this.service.deps.limits.maxFetches + 3 }), note: "Same search as earlier in this turn; the earlier result is reused." };
    if (this.searches >= this.limits.maxSearches) {
      this.skipped += 1;
      return empty("rate_limited", clean.query, `Search limit for one answer reached (${this.limits.maxSearches}). Work with what was found.`);
    }
    if (!this.service.allow(this.owner)) {
      this.skipped += 1;
      return empty("rate_limited", clean.query, "Too many searches in the last minute. Try again shortly.");
    }
    this.searches += 1;
    const outcome = await this.service.deps.searx.search(clean.query, { signal: this.signal, timeRange: options.timeRange });
    this.queries.set(key, outcome);
    const note = outcome.status === "ok" ? `${outcome.results.length} results.` : STATUS_WORDS[outcome.status];
    if (outcome.status !== "ok" && outcome.status !== "empty") this.notes.push(STATUS_WORDS[outcome.status]);
    return { outcome, ranked: rankResults(outcome.results, purpose, { limit: this.service.deps.limits.maxFetches + 3 }), note };
  }

  /** Whether a search in this turn returned this address: the only addresses the model may ask to have opened. */
  wasOffered(url: string): boolean {
    const key = url.replace(/#.*$/, "");
    for (const outcome of this.queries.values()) if (outcome.results.some((r) => r.url.replace(/#.*$/, "") === key)) return true;
    return false;
  }

  /** One page, through the fetch budget. Pages already read this turn cost nothing. */
  async fetchPage(url: string): Promise<FetchedSource> {
    const key = url.replace(/#.*$/, "");
    const again = this.read.get(key);
    if (again) return again;
    if (this.fetches >= this.limits.maxFetches) {
      this.skipped += 1;
      return { ok: false, code: "unavailable", reason: `page-read limit for one answer reached (${this.limits.maxFetches})` };
    }
    this.fetches += 1;
    const got = await this.service.page(url, this.signal);
    this.read.set(key, got);
    if (got.ok && got.injection.length) this.notes.push(`A page (${new URL(got.url).hostname}) contained text that looked like instructions to an AI (${got.injection.join(", ")}). It was ignored.`);
    return got;
  }

  private record(e: Evidence): Evidence {
    this.ledger.push(e);
    return e;
  }

  /** Whether a quotation is in the work it is said to come from. See QuoteStatus for what each answer means and does not mean. */
  async verifyQuotation(input: { quotation: string; work?: string | null; author?: string | null }): Promise<QuoteVerdict> {
    const quotation = input.quotation.replace(/\s+/g, " ").trim();
    const work = input.work || workOf(`${input.quotation} ${input.work ?? ""} ${input.author ?? ""}`) || null;
    const base = { quotation, work, evidence: [] as Evidence[] };
    if (words(quotation).length < 2) return { ...base, status: "unverifiable", note: "Too short to check on its own." };

    if (!this.available) return { ...base, status: "unverifiable", note: "This could not be checked against a source here (web search is not available)." };

    const search = await this.searchWeb(quotationQuery({ quotation, work: work ?? undefined, author: input.author ?? undefined }), "quotation");
    if (!search.ranked.length) {
      const failed = search.outcome.status !== "ok" && search.outcome.status !== "empty";
      return { ...base, status: failed ? "unverifiable" : "unsupported", note: failed ? `This could not be checked: ${search.note}` : "No source was found containing these words." };
    }

    let best: { kind: "exact" | "variant"; tier: SourceTier; evidence: Evidence; matched: string } | null = null;
    let nearest = 0;
    let nearestEvidence: Evidence | null = null;
    let readAny = false;
    const candidates = search.ranked.filter((r) => r.tier !== "low").slice(0, 3);
    for (const r of candidates) {
      if (best?.kind === "exact" && (best.tier === "authoritative_text" || best.tier === "official_exam" || best.tier === "institutional")) break;
      const page = await this.fetchPage(r.url);
      if (!page.ok) continue;
      readAny = true;
      const m = matchQuotation(quotation, page.text);
      nearest = Math.max(nearest, m.similarity);
      const evidence = this.record({ url: page.url, title: page.title || r.title, tier: r.tier, extract: clip(m.matched || nearestSentences(page.text, quotation, 1), 300), read: true });
      if (m.kind === "none") {
        if (!nearestEvidence || m.similarity >= nearest) nearestEvidence = evidence;
        continue;
      }
      if (!best || (m.kind === "exact" && best.kind !== "exact") || (m.kind === best.kind && rank(r.tier) > rank(best.tier))) best = { kind: m.kind, tier: r.tier, evidence, matched: m.matched };
    }

    if (best) {
      const strong = best.tier === "authoritative_text" || best.tier === "official_exam" || best.tier === "institutional";
      const status: QuoteStatus = strong ? (best.kind === "exact" ? "verified_exact" : "verified_variant") : "supported_secondary";
      return {
        ...base,
        status,
        sourceWording: best.kind === "variant" ? best.evidence.extract : undefined,
        evidence: [best.evidence],
        note: strong ? `Found in a ${best.tier.replace("_", " ")} source that was read.` : "Found only in a secondary source (revision or general site). Treat as likely, not confirmed.",
      };
    }
    if (readAny && nearest >= 0.5) return { ...base, status: "paraphrase_or_misquote", evidence: nearestEvidence ? [nearestEvidence] : [], note: "Something close to this is in the sources read, but not these exact words. It may be a paraphrase or a misquotation." };
    if (readAny) return { ...base, status: "unsupported", note: "These words were not found in the sources that were read. That does not prove they are wrong; the text itself should be checked." };
    // Only search snippets were seen: a snippet is a lead, never proof.
    const snippet = search.ranked.find((r) => matchQuotation(quotation, r.snippet).kind === "exact");
    return snippet
      ? { ...base, status: "supported_secondary", evidence: [this.record({ url: snippet.url, title: snippet.title, tier: snippet.tier, extract: clip(snippet.snippet, 300), read: false })], note: "Seen only in a search-result snippet; no page could be read to confirm it." }
      : { ...base, status: "unverifiable", note: "No page could be read to check this." };
  }

  /** Evidence about a factual claim: pages that were read and the sentences in them closest to the claim. Never a verdict of "true". */
  async verifyClaim(input: { claim: string; query?: string; purpose?: SearchPurpose }): Promise<ClaimReport> {
    const claim = input.claim.replace(/\s+/g, " ").trim();
    if (!this.available) return { status: "unavailable", claim, evidence: [], note: STATUS_WORDS.disabled };
    const search = await this.searchWeb(input.query || claim, input.purpose ?? "fact");
    if (!search.ranked.length) return { status: search.outcome.status === "empty" ? "no_evidence" : "unavailable", claim, evidence: [], note: search.note };
    const evidence: Evidence[] = [];
    for (const r of search.ranked.filter((x) => x.tier !== "low").slice(0, 2)) {
      const page = await this.fetchPage(r.url);
      if (!page.ok) continue;
      const extract = nearestSentences(page.text, claim);
      if (extract) evidence.push(this.record({ url: page.url, title: page.title || r.title, tier: r.tier, extract: clip(extract, 400), read: true }));
    }
    return evidence.length
      ? { status: "evidence_found", claim, evidence, note: "These are passages from pages that were read. Check that they say what the claim says before relying on them." }
      : { status: "no_evidence", claim, evidence, note: "Nothing relevant was found in the pages that could be read." };
  }

  /** Links to the exam board's own document. Only addresses that came back from the search AND sit on a board's site are returned; none is guessed. */
  async findOfficialDocument(input: { board: string; subject: string; qualification?: string; kind: "specification" | "mark scheme"; year?: string; paper?: string }): Promise<DocumentReport> {
    const board = boardName(input.board);
    if (!board) return { status: "not_found", leads: [], note: "That exam board is not one the tutor looks up." };
    if (!this.available) return { status: "unavailable", leads: [], note: STATUS_WORDS.disabled };
    const query = [board, input.qualification, input.subject, input.kind, input.paper, input.year].filter(Boolean).join(" ");
    const search = await this.searchWeb(query, input.kind === "specification" ? "specification" : "mark_scheme");
    const leads = search.ranked.filter((r) => isOfficialExamHost(r.url)).slice(0, 3).map((r) => ({ url: r.url, title: r.title, tier: r.tier }));
    if (leads.length) return { status: "found", leads, note: "These are the exam board's own pages from the search results. Open them to confirm the exact paper and year." };
    return { status: search.outcome.status === "ok" || search.outcome.status === "empty" ? "not_found" : "unavailable", leads: [], note: search.outcome.status === "ok" || search.outcome.status === "empty" ? `No ${board} page for that was found. Do not guess a link; the board's website has the current ${input.kind}.` : search.note };
  }

  /** A line for the answer: what was and was not checked this turn. Empty when no research was attempted. */
  summary(): { searches: number; fetches: number; sources: Array<{ title: string; url: string; tier: SourceTier }>; notes: string[] } {
    const seen = new Set<string>();
    const sources = this.ledger.filter((e) => e.read && !e.url.startsWith("local:") && !seen.has(e.url) && seen.add(e.url)).map((e) => ({ title: e.title, url: e.url, tier: e.tier }));
    return { searches: this.searches, fetches: this.fetches, sources, notes: [...new Set(this.notes)] };
  }
}

const TIER_RANK: Record<SourceTier, number> = { official_exam: 6, authoritative_text: 5, institutional: 4, reputable_education: 3, revision: 2, general: 1, low: 0 };
const rank = (t: SourceTier): number => TIER_RANK[t];

/** Whether a student's message is the kind that should be checked against sources, and why. Cheap and deterministic: no model call. */
export function needsResearch(message: string): { needed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (/\b(?:is|are)\s+(?:this|that|these|my)\s+(?:quote|quotation|quotes|quotations)\s+(?:correct|accurate|right|real)|\bcheck\s+(?:my|the|these)\s+quot|\bquote\s+(?:correct|accurate)|\bdid\s+\w+\s+(?:really\s+)?say\b/i.test(message)) reasons.push("quotation check");
  if (/\b(?:mark\s*scheme|specification|spec\b|assessment\s+objectives?|examiner'?s?\s+report|grade\s+boundar|past\s+paper|specimen)/i.test(message)) reasons.push("exam board document");
  if (/\b(?:latest|current|this\s+year|new\s+spec|changed|updated|202\d|203\d)\b/i.test(message)) reasons.push("may have changed recently");
  if (/\b(?:what\s+does\s+(?:aqa|edexcel|ocr|eduqas|wjec)|does\s+(?:aqa|edexcel|ocr|eduqas|wjec)\s+(?:require|want|expect|say))\b/i.test(message)) reasons.push("exam board requirement");
  if (/\bsearch\s+(?:the\s+)?(?:web|internet|online)|\blook\s+(?:it\s+)?up\b|\bgoogle\b/i.test(message)) reasons.push("asked to look it up");
  return { needed: reasons.length > 0, reasons };
}
