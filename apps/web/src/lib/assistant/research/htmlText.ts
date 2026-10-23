/**
 * Turning a fetched page into plain text, and noticing text that is trying to give the model orders. A page is untrusted material: nothing in it is an
 * instruction to Study Buddy, whatever it says. Markup that can run or hide things is dropped, hidden characters are removed, and phrases that look like
 * an attempt to take over the assistant are reported (so they can be shown to the model as a warning, never followed) and then defused.
 */
const DROPPED = ["script", "style", "noscript", "template", "svg", "iframe", "object", "embed", "canvas", "form", "nav", "footer", "header", "aside", "select", "button", "head"];

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: "-", mdash: "-", hellip: "...", eacute: "e", pound: "£", copy: "(c)" };

const decode = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, dec: string) => safeChar(Number(dec)))
    .replace(/&([a-z]{2,8});/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);

const safeChar = (code: number): string => (Number.isInteger(code) && code > 31 && code < 0x110000 && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : " ");

/** Control characters and the invisible ones used to hide instructions from a reader (zero-width, bidirectional overrides, tags). */
const HIDDEN_RANGES: Array<[number, number]> = [[0, 8], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x7f], [0xad, 0xad], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff], [0xe0000, 0xe007f]];
const HIDDEN = new RegExp("[" + HIDDEN_RANGES.map(([a, b]) => String.fromCodePoint(a) + "-" + String.fromCodePoint(b)).join("") + "]", "gu");

export function htmlToText(html: string, maxChars = 30_000): { title: string; text: string } {
  let s = html.slice(0, 2_000_000);
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of DROPPED) s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, "gi"), " ");
  // Elements the page hides from a reader are not text for the model either.
  s = s.replace(/<([a-z0-9]+)\b[^>]*\b(?:hidden|aria-hidden="true"|style="[^"]*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)[^"]*")[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|blockquote|pre|dd|dt|dl)\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decode(s).replace(HIDDEN, "");
  const text = s
    .split("\n")
    .map((line) => line.replace(/[ \t\r\f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, maxChars);
  return { title, text };
}

/** Plain text (a text file, or a PDF's extracted text) cleaned the same way. */
export function cleanText(text: string, maxChars = 30_000): string {
  return text
    .replace(HIDDEN, "")
    .split("\n")
    .map((line) => line.replace(/[ \t\r\f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, maxChars);
}

const INJECTION: Array<[string, RegExp]> = [
  ["ignore_instructions", /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(?:all|any|your|the|previous|prior|above|earlier|system)\b[^.\n]{0,40}\b(?:instructions?|rules?|prompts?|guidelines?|directions?)\b/i],
  ["new_role", /\byou\s+are\s+(?:now|no longer)\b|\bact\s+as\s+(?:an?\s+)?(?:unrestricted|different|new)\b|\bpretend\s+(?:to\s+be|you\s+are)\b|\bfrom\s+now\s+on\s+you\b/i],
  ["reveal_prompt", /\b(?:reveal|show|print|repeat|output|leak)\b[^.\n]{0,30}\b(?:system\s+prompt|instructions|hidden\s+prompt|secret|api\s*key|password|token)s?\b/i],
  ["role_markers", /<\|?(?:im_start|im_end|system|assistant|user)\|?>|\[\/?INST\]|^\s*(?:system|assistant)\s*:/im],
  ["tool_abuse", /\b(?:call|use|invoke|run|execute)\b[^.\n]{0,30}\b(?:tool|function|command|shell|code)\b|\bfetch\s+https?:\/\//i],
  ["exfiltrate", /\b(?:send|post|email|upload|forward)\b[^.\n]{0,40}\b(?:conversation|chat|essay|personal|student|credentials?|data)\b/i],
  ["new_instructions", /\b(?:new|updated|important|urgent)\s+(?:instructions?|rules?|system\s+message)\b|\bas\s+an\s+ai\s+language\s+model\b[^.\n]{0,20}\bmust\b/i],
];

/** Labels of the injection patterns found in a text. Empty is not proof of safety: the text is untrusted either way. */
export function scanForInjection(text: string): string[] {
  return INJECTION.filter(([, re]) => re.test(text)).map(([label]) => label);
}

/** Markers the assistant uses for its own structure, and role markers, made harmless inside untrusted text. */
export function defuseMarkers(text: string): string {
  return text
    .replace(/<\s*\/?\s*(?:uploaded-file|page|retrieved|retrieved-material|passage|tool_result|source|verification|study-context|system|assistant|user)\b[^>]*>/gi, "[marker removed]")
    .replace(/<\|[^|>]{1,24}\|>|\[\/?INST\]/gi, "[marker removed]");
}
