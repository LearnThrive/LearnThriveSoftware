import { checkUrl, type Resolver } from "./safeUrl";
import { cleanText, defuseMarkers, htmlToText, scanForInjection } from "./htmlText";

/**
 * Reads one web page for the tutor. The address is checked before the request and again at EVERY redirect (a public page can redirect to a private
 * address), the body is read up to a byte limit, only text-like content is accepted, and what comes back is plain text with markup, hidden characters
 * and the assistant's own markers removed. The text is returned together with any instruction-like phrases found in it, so the model can be told
 * "this page tried to give orders; they were ignored".
 */
export interface PageResponse {
  status: number;
  headers: { get(name: string): string | null };
  /** Reads at most `maxBytes` of the body and says whether there was more. */
  read(maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }>;
}

export type PageFetcher = (url: string, init: { signal: AbortSignal }) => Promise<PageResponse>;

export const defaultPageFetcher: PageFetcher = async (url, { signal }) => {
  const response = await fetch(url, { redirect: "manual", signal, headers: { accept: "text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9", "user-agent": "LearnThrive-StudyBuddy/1.0 (+research)" } });
  return {
    status: response.status,
    headers: response.headers,
    async read(maxBytes) {
      if (!response.body) return { bytes: new Uint8Array(0), truncated: false };
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      let truncated = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (total + value.byteLength > maxBytes) {
          chunks.push(value.subarray(0, maxBytes - total));
          total = maxBytes;
          truncated = true;
          void reader.cancel();
          break;
        }
        chunks.push(value);
        total += value.byteLength;
      }
      const bytes = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) {
        bytes.set(c, at);
        at += c.byteLength;
      }
      return { bytes, truncated };
    },
  };
};

export type FetchFailure = "blocked" | "redirect_loop" | "bad_status" | "unsupported_type" | "timeout" | "unavailable" | "unreadable";

export type FetchedSource =
  | { ok: true; url: string; title: string; text: string; contentType: "html" | "text" | "pdf"; truncated: boolean; injection: string[] }
  | { ok: false; code: FetchFailure; reason: string };

export interface FetchOptions {
  fetcher?: PageFetcher;
  resolve?: Resolver;
  maxBytes?: number;
  maxChars?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Reads a PDF's bytes into text. Injected so tests need no PDF library. */
  pdfText?: (bytes: Uint8Array) => Promise<string | null>;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

async function defaultPdfText(bytes: Uint8Array): Promise<string | null> {
  const { readPdfDocument } = await import("../documents");
  const reading = await readPdfDocument(bytes, { render: false, maxPages: 40 });
  return reading.ok ? reading.pages.map((p) => p.text).join("\n\n") : null;
}

export async function fetchSource(start: string, options: FetchOptions = {}): Promise<FetchedSource> {
  const fetcher = options.fetcher ?? defaultPageFetcher;
  const maxBytes = options.maxBytes ?? 1_500_000;
  const maxRedirects = options.maxRedirects ?? 4;
  const control = new AbortController();
  const stop = setTimeout(() => control.abort(), options.timeoutMs ?? 10_000);
  const relay = () => control.abort();
  options.signal?.addEventListener("abort", relay, { once: true });
  try {
    let current = start;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const verdict = await checkUrl(current, { resolve: options.resolve });
      if (!verdict.ok) return { ok: false, code: "blocked", reason: verdict.reason };
      const page = await fetcher(verdict.url.toString(), { signal: control.signal });
      if (REDIRECTS.has(page.status)) {
        const location = page.headers.get("location");
        if (!location) return { ok: false, code: "bad_status", reason: "a redirect with nowhere to go" };
        try {
          current = new URL(location, verdict.url).toString();
        } catch {
          return { ok: false, code: "bad_status", reason: "a redirect to an unreadable address" };
        }
        continue;
      }
      if (page.status < 200 || page.status >= 300) return { ok: false, code: "bad_status", reason: `the site answered HTTP ${page.status}` };
      const type = (page.headers.get("content-type") ?? "").toLowerCase();
      const kind: "html" | "text" | "pdf" | null = /text\/html|application\/xhtml/.test(type) ? "html" : /application\/pdf/.test(type) ? "pdf" : /^text\/|application\/(?:json|xml)/.test(type) ? "text" : null;
      if (!kind) return { ok: false, code: "unsupported_type", reason: "that is not a page or document the tutor reads" };
      const declared = Number(page.headers.get("content-length") ?? "0");
      if (declared > maxBytes * 4) return { ok: false, code: "unreadable", reason: "that file is too large to read" };
      const { bytes, truncated } = await page.read(maxBytes);
      const maxChars = options.maxChars ?? 30_000;
      let title = "";
      let text: string;
      if (kind === "pdf") {
        const extracted = await (options.pdfText ?? defaultPdfText)(bytes);
        if (!extracted || !extracted.trim()) return { ok: false, code: "unreadable", reason: "that PDF could not be read as text" };
        text = cleanText(extracted, maxChars);
      } else {
        const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        if (kind === "html") ({ title, text } = htmlToText(raw, maxChars));
        else text = cleanText(raw, maxChars);
      }
      if (!text.trim()) return { ok: false, code: "unreadable", reason: "the page had no readable text" };
      const injection = scanForInjection(`${title}\n${text}`);
      return { ok: true, url: verdict.url.toString(), title: defuseMarkers(title), text: defuseMarkers(text), contentType: kind, truncated: truncated || text.length >= maxChars, injection };
    }
    return { ok: false, code: "redirect_loop", reason: "too many redirects" };
  } catch (error) {
    if (options.signal?.aborted) return { ok: false, code: "unavailable", reason: "the request was stopped" };
    if (control.signal.aborted) return { ok: false, code: "timeout", reason: "the site took too long" };
    return { ok: false, code: "unavailable", reason: `the site could not be reached${(error as { cause?: { code?: string } })?.cause?.code ? ` (${(error as { cause: { code: string } }).cause.code})` : ""}` };
  } finally {
    clearTimeout(stop);
    options.signal?.removeEventListener("abort", relay);
  }
}
