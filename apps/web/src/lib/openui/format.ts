import { buildMessage, parseMessage } from "@openuidev/lang-core";
import { LIBRARY_ID, LIBRARY_VERSION } from "./schemas";

/**
 * How an interface is kept, and how it is told apart from an ordinary answer.
 *
 * A message's stored `content` is EITHER plain Markdown (every answer there has ever been) OR an interface in OpenUI's own stored-message format:
 *
 *   ]]>openui:content?library=learnthrive-study%401.0.0
 *   root = Answer([...])
 *   ...
 *   ]]>openui:context
 *   { "v": 1, "verifications": [...], "sources": [...] }
 *   ]]>openui:end
 *
 * An answer is an interface ONLY if its content begins with that first marker line. Nothing else is ever read as OpenUI: Markdown that happens to look like
 * a program is Markdown. The marker is written by the server alone (a student's own message is stored as typed and is never interpreted), and the
 * `context` section carries what the server CHECKED about the interface (the status of each quotation, the sources that were read), kept apart from what the
 * model wrote, so a reopened chat shows the same checked state without asking anything again. The marker lines are stripped before history goes back to the
 * model (`modelText`), and they are never shown to a student.
 */
export type QuoteVerification = "VERIFIED_EXACT" | "VERIFIED_VARIANT" | "UNVERIFIED" | "INCORRECT_ATTRIBUTION" | "PARAPHRASE";

/** What the badge on a quotation says. Words, never colour alone. */
export const QUOTE_STATUS_LABEL: Record<QuoteVerification, string> = {
  VERIFIED_EXACT: "Checked: exact words",
  VERIFIED_VARIANT: "Checked: close to the text",
  UNVERIFIED: "Not verified",
  INCORRECT_ATTRIBUTION: "Wrong speaker or place",
  PARAPHRASE: "Not word for word",
};

export interface QuoteCheck {
  /** `quoteKey` of the quotation this is about. */
  key: string;
  status: QuoteVerification;
  /** One plain sentence the page shows next to the badge. */
  detail: string;
  /** Where the real words are (Act and scene), when the server found out. */
  location?: string;
  /** Who really speaks them, when the server found out. */
  speaker?: string;
  /** What the source actually says, when it differs from the quotation. */
  sourceWording?: string;
  /** The page it was checked against (already sanitised). */
  source?: { title: string; host: string; url: string };
}

export interface SourceNote {
  title: string;
  host: string;
  url: string;
  tier: string;
}

export interface InterfaceContext {
  v: 1;
  verifications: QuoteCheck[];
  sources: SourceNote[];
}

export const EMPTY_CONTEXT: InterfaceContext = { v: 1, verifications: [], sources: [] };
export const MARKER = "]]>openui:content";

/** The key two spellings of one quotation share: lower case, no punctuation, one space between words. */
export const quoteKey = (quote: string): string =>
  quote
    .toLowerCase()
    .replace(/[“”"'‘’`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const isInterfaceMessage = (content: string): boolean => content.startsWith(MARKER);

export function buildInterfaceMessage(program: string, context: InterfaceContext = EMPTY_CONTEXT): string {
  return buildMessage({ content: program.trim(), context, attributes: { library: `${LIBRARY_ID}@${LIBRARY_VERSION}` }, end: true });
}

export type StoredMessage = { kind: "text"; text: string } | { kind: "interface"; program: string; context: InterfaceContext; complete: boolean; library: string | null };

const status = (v: unknown): v is QuoteVerification => v === "VERIFIED_EXACT" || v === "VERIFIED_VARIANT" || v === "UNVERIFIED" || v === "INCORRECT_ATTRIBUTION" || v === "PARAPHRASE";
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const publicUrl = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString().slice(0, 500) : null;
  } catch {
    return null;
  }
};

/** What the server stored as the interface's checked state, read back and checked again: a context that does not look right is an empty one. */
export function readContext(raw: unknown): InterfaceContext {
  if (!raw || typeof raw !== "object") return EMPTY_CONTEXT;
  const c = raw as { verifications?: unknown; sources?: unknown };
  const verifications: QuoteCheck[] = [];
  for (const row of Array.isArray(c.verifications) ? c.verifications.slice(0, 12) : []) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.key !== "string" || !status(r.status)) continue;
    const url = publicUrl((r.source as { url?: unknown } | undefined)?.url);
    verifications.push({
      key: r.key.slice(0, 400),
      status: r.status,
      detail: text(r.detail, 300),
      ...(r.location ? { location: text(r.location, 80) } : {}),
      ...(r.speaker ? { speaker: text(r.speaker, 80) } : {}),
      ...(r.sourceWording ? { sourceWording: text(r.sourceWording, 300) } : {}),
      ...(url ? { source: { title: text((r.source as { title?: unknown }).title, 200), host: text((r.source as { host?: unknown }).host, 100), url } } : {}),
    });
  }
  const sources: SourceNote[] = [];
  for (const row of Array.isArray(c.sources) ? c.sources.slice(0, 8) : []) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const url = publicUrl(r.url);
    if (url) sources.push({ title: text(r.title, 200), host: text(r.host, 100), url, tier: text(r.tier, 40) });
  }
  return { v: 1, verifications, sources };
}

export function parseStoredMessage(content: string): StoredMessage {
  if (!isInterfaceMessage(content)) return { kind: "text", text: content };
  const parsed = parseMessage(content);
  return { kind: "interface", program: parsed.content, context: readContext(parsed.context), complete: parsed.end, library: parsed.attributes.library ?? null };
}

/** The strings an interface carries, in order, for a short plain description (history for the model, copying, reading aloud, a failed render). */
export function interfaceSummary(program: string, max = 1200): string {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  for (let m = re.exec(program); m; m = re.exec(program)) {
    const s = m[1]!.replace(/\\(["\\])/g, "$1").replace(/\\n/g, " ").trim();
    if (s.length >= 12 && /\s/.test(s)) out.push(s);
    if (out.join(" ").length > max) break;
  }
  return out.join(" ").slice(0, max);
}

/** An assistant message as the model should read it in history: Markdown as it is; an interface as a short description (no markers, no program). */
export function modelText(content: string): string {
  const stored = parseStoredMessage(content);
  if (stored.kind === "text") return stored.text;
  const said = interfaceSummary(stored.program, 900);
  return `[LearnThrive AI showed the student an interactive interface.${said ? ` It said: ${said}` : ""}]`;
}

/** An assistant message as plain text for copying and reading aloud. */
export function plainTextOf(content: string): string {
  const stored = parseStoredMessage(content);
  return stored.kind === "text" ? stored.text : interfaceSummary(stored.program, 4000);
}
