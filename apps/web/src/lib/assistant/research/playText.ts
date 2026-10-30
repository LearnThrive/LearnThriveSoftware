import { matchQuotation, words, type QuoteMatch } from "./quotations";

/**
 * Reading WHO says a line and WHERE, from the structure of a play's text as it is published on the web, so a quotation can be checked for
 * attribution and not only for its words. A phrase being somewhere on a page proves nothing about its speaker: Macbeth and Lady Macbeth are on the
 * same page. Nothing here is a stored text of any play; it reads pages fetched at runtime from public-domain sites and keeps the speaker, act and
 * scene each speech sits under.
 */
export interface Speech {
  speaker: string;
  act: number | null;
  scene: number | null;
  text: string;
  /**
   * Whether the speaker was read from a layout that names speakers unambiguously (the MIT anchors, the Folger line numbers, a bold name in converted
   * Markdown). The loose plain-text reading ("Name." or "NAME" at the start of a line) can split a page wrongly, for example by taking an abbreviated
   * stage name as a speaker or by running two speeches together, so a speaker it finds can say who speaks a line only as a lead: it must never be the basis
   * for telling a student a correct quotation is attributed to the wrong person. Found on a live check (30 October 2026): a correct quotation reported as
   * "spoken by Doct".
   */
  structured: boolean;
}

/** Sites that publish whole plays as structured text. Only these have their HTML kept for reading speeches. */
const PLAY_HOSTS = ["shakespeare.mit.edu", "gutenberg.org", "folger.edu", "shakespeare.folger.edu", "opensourceshakespeare.org", "perseus.tufts.edu"];
export const isPlayTextHost = (host: string): boolean => PLAY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

const PUBLIC_DOMAIN_PLAYS = new Set(["macbeth", "hamlet", "othello", "king lear", "romeo and juliet", "julius caesar", "much ado about nothing", "the tempest", "a midsummer night's dream", "twelfth night", "the merchant of venice", "as you like it", "richard iii", "henry v"]);
/** Plays whose text is public domain and published in full on the sites above. */
export const isPublicDomainPlay = (work: string | null | undefined): boolean => Boolean(work) && PUBLIC_DOMAIN_PLAYS.has(work!.trim().toLowerCase());

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
const roman = (s: string): number | null => ROMAN[s.toUpperCase()] ?? (Number.isInteger(Number(s)) ? Number(s) : null);

const strip = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Act and scene from an address such as .../macbeth.5.1.html or .../read/5/1/. */
export function placeFromUrl(url: string): { act: number | null; scene: number | null } {
  const m = /\.(\d{1,2})\.(\d{1,2})\.html?(?:$|[?#])/i.exec(url) ?? /\/(?:read\/)?(\d{1,2})\/(\d{1,2})\/?(?:$|[?#])/.exec(url);
  return m ? { act: Number(m[1]), scene: Number(m[2]) } : { act: null, scene: null };
}

/**
 * Speeches from a page. Handles the MIT "Complete Works" layout (a named anchor and a bold speaker name, then the lines as anchors) and plain text
 * where a speaker's name in capitals or "Name." starts a speech (Project Gutenberg style). Act and scene come from the address, or from
 * "ACT V. SCENE I." headings when the page holds several scenes.
 */
export function parseSpeeches(page: { html?: string; text: string; url: string }): Speech[] {
  const place = placeFromUrl(page.url);
  const out: Speech[] = [];
  const html = page.html ?? "";
  if (/<a\s+name="?speech\d+"?/i.test(html)) {
    // <A NAME=speech3><b>LADY MACBETH</b></a> <blockquote> <A NAME=5.1.31>Out, damned spot! out, I say!</A><br> ...
    const blocks = html.split(/<a\s+name="?speech\d+"?\s*>/i).slice(1);
    for (const block of blocks) {
      const speaker = strip(/<b>([\s\S]*?)<\/b>/i.exec(block)?.[1] ?? "");
      const body = block.slice(block.search(/<\/b>/i) + 4);
      const lines = [...body.matchAll(/<a\s+name="?(\d+)\.(\d+)\.\d+"?\s*>([\s\S]*?)<\/a>/gi)];
      if (!speaker || !lines.length) continue;
      out.push({ speaker: speaker.replace(/\.$/, ""), act: Number(lines[0]![1]), scene: Number(lines[0]![2]), text: lines.map((l) => strip(l[3]!)).join(" "), structured: true });
    }
    if (out.length) return out;
  }
  let act = place.act;
  let scene = place.scene;
  let current: Speech | null = null;
  const flush = () => {
    if (current && current.text.trim()) out.push(current);
    current = null;
  };
  for (const raw of page.text.split("\n")) {
    const line = raw.trim().replace(/^[#>*\s]+/, "");
    const heading = /^ACT\s+([IVX]+|\d+)\b[.,:\s-]*(?:SCENE\s+([IVX]+|\d+))?/i.exec(line);
    if (heading && line.length < 80) {
      flush();
      act = roman(heading[1]!) ?? act;
      if (heading[2]) scene = roman(heading[2]) ?? scene;
      continue;
    }
    const sceneHeading = /^SCENE\s+([IVX]+|\d+)\b/i.exec(line);
    if (sceneHeading && line.length < 80) {
      flush();
      scene = roman(sceneHeading[1]!) ?? scene;
      continue;
    }
    // The Folger edition: "LADY MACBETH 2072 Out, damned spot, out, I say!" with a line number at the start of every line.
    const folger = /^([A-Z][A-Z' ]{1,30}[A-Z])\s+\d{3,5}\s+(.*)$/.exec(line);
    if (folger) {
      flush();
      current = { speaker: folger[1]!.trim(), act, scene, text: folger[2] ?? "", structured: true };
      continue;
    }
    const numbered = /^\d{3,5}\s+(.*)$/.exec(line);
    if (numbered && current) {
      (current as Speech).text += ` ${numbered[1]}`;
      continue;
    }
    // Markdown from a page converter: a bold speaker name, then the lines quoted underneath ("**LADY MACBETH**" / "> Out, damned spot!").
    const bold = /^\*\*([^*]{2,40})\*\*$/.exec(raw.trim());
    if (bold) {
      flush();
      current = { speaker: bold[1]!.trim(), act, scene, text: "", structured: true };
      continue;
    }
    if (current && raw.trim().startsWith(">")) {
      (current as Speech).text += ` ${line}`;
      continue;
    }
    // "LADY MACBETH. Out, damned spot!" or "Lady Macbeth: Out, damned spot!" or a speaker alone on a line.
    const speech = /^([A-Z][A-Z' ]{2,30}|(?:[A-Z][a-z]+ ?){1,3})(?:\.|:)\s*(.*)$/.exec(line);
    const alone = /^([A-Z][A-Z' ]{2,30})$/.exec(line);
    if (speech && (speech[1] === speech[1]!.toUpperCase() || line.includes(":")) && speech[1]!.trim().length > 2) {
      flush();
      current = { speaker: speech[1]!.trim(), act, scene, text: speech[2] ?? "", structured: false };
    } else if (alone) {
      flush();
      current = { speaker: alone[1]!.trim(), act, scene, text: "", structured: false };
    } else if (current && line && !/^\[|^\(?Exit|^Enter|^Re-enter|^Exeunt/i.test(line)) {
      (current as Speech).text += ` ${line}`;
    }
  }
  flush();
  return out;
}

export interface Located {
  speech: Speech;
  match: QuoteMatch;
}

/** The speech a quotation is in, preferring an exact match. Null when no parsed speech contains the words. */
export function locateQuotation(speeches: readonly Speech[], quotation: string): Located | null {
  let best: Located | null = null;
  for (const speech of speeches) {
    const match = matchQuotation(quotation, speech.text);
    if (match.kind === "none") continue;
    if (!best || (match.kind === "exact" && best.match.kind !== "exact") || (match.kind === best.match.kind && match.similarity > best.match.similarity)) best = { speech, match };
  }
  return best;
}

const norm = (s: string): string => words(s).join(" ");

/** Whether a claimed speaker is the speaker found. "Macbeth" is not "Lady Macbeth". Titles and spelling of the name's case are ignored. */
export function sameSpeaker(claimed: string, found: string): boolean {
  const a = norm(claimed.replace(/^(?:mr|mrs|miss|lord|sir|the)\b\.?\s*/i, ""));
  const b = norm(found.replace(/^(?:mr|mrs|miss|lord|sir|the)\b\.?\s*/i, ""));
  return a === b;
}

// Words that look like names at the start of a phrase but are not someone speaking: determiners, and the authors (who write, they do not speak).
const NOT_SPEAKERS = /^(?:The|This|That|These|Those|His|Her|Their|Its|Our|My|Shakespeare|Priestley|Dickens|Stevenson|Orwell|Golding|Steinbeck|Russell|Austen|Shelley|Bronte|Writer|Playwright)$/;

/** The speaker a sentence says is speaking a quotation: "Lady Macbeth says '...'", "'...' says Macbeth", "'...', Lady Macbeth cries". */
export function claimedSpeaker(sentence: string, quotation: string): string | null {
  const at = sentence.indexOf(quotation);
  if (at < 0) return null;
  const NAME = "((?:Lady |Lord |Mr |Mrs |Miss |Sir |Inspector |King |Queen )?[A-Z][a-z]+(?: [A-Z][a-z]+)?)";
  const VERB = "(?:says|said|states|stated|declares|declared|tells|told|cries|cried|exclaims|exclaimed|whispers|whispered|asks|asked|replies|replied|tells|speaks|remarks|claims|argues|insists|warns|admits|confesses|reveals|reflects|muses)";
  const before = sentence.slice(Math.max(0, at - 90), at).replace(/["'“‘]\s*$/, "");
  const b = new RegExp(`${NAME}(?:'s)?\\s+(?:[a-z]+\\s+){0,3}${VERB}\\b[^"'“‘]{0,40}$`).exec(before) ?? new RegExp(`${NAME}(?:'s)?\\s+(?:famous |own |opening |closing )?(?:line|words|speech|soliloquy)[^"'“‘]{0,25}$`, "i").exec(before);
  if (b && !NOT_SPEAKERS.test(b[1]!)) return b[1]!;
  const after = sentence.slice(at + quotation.length, at + quotation.length + 70);
  const a = new RegExp(`^["”’']?[,.]?\\s*(?:says|said|states|declares|cries|exclaims|whispers|replied|replies)?\\s*${NAME}\\b`).exec(after);
  if (a && !NOT_SPEAKERS.test(a[1]!) && /^["”’']?[,.]?\s*(?:says|said|states|declares|cries|exclaims|whispers|replied|replies)/.test(after)) return a[1]!;
  return null;
}
