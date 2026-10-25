/**
 * Checking the dramatic events a reply attributes to named characters ("Eric is sent to prison", "Lady Macbeth sees Banquo's ghost") against the
 * pages that were read. A real character's name appearing in a page proves nothing about an event: the name check cannot see that Gerald does not
 * become pregnant. This reads WHO the sources say did a thing, and compares it with who the reply says did it.
 *
 * It looks only at a short list of high-stakes events (the ones models invent), only at claims with a named subject (a pronoun is ambiguous), and
 * it never says "false" when the sources are merely silent:
 *
 *   supported     a read page says this character did this
 *   contradicted  the pages say this happened, but to someone else
 *   unsupported   no page read mentions this event at all (the evidence is missing, which is not the same as the claim being wrong)
 */
export type ClaimStatus = "supported" | "contradicted" | "unsupported";

export interface EventClaim {
  sentence: string;
  subject: string;
  event: string;
  status: ClaimStatus;
  /** For a contradicted claim: who the sources say it was. */
  actuallyBy: string[];
}

const EVENTS: Array<[string, RegExp]> = [
  ["pregnancy", /\b(?:pregnan\w*|expecting a (?:baby|child)|with child)\b/i],
  ["prison", /\b(?:prison\w*|jail\w*|imprison\w*|arrest\w*|convicted|sentenced)\b/i],
  ["an institution", /\b(?:asylum|mental (?:institution|hospital|home)|institution|sanatorium)\b/i],
  ["a killing", /\b(?:murder\w*|kill(?:s|ed|ing)?|stab\w*|slay\w*|slain|assassinat\w*)\b/i],
  ["suicide", /\b(?:suicide|kills? (?:him|her)self|took (?:his|her) own life|takes (?:his|her) own life)\b/i],
  ["a ghost", /\b(?:ghosts?|ghost's|apparition|spectre)\b/i],
  ["a death", /\b(?:dies|died|dead|death)\b/i],
  ["drinking", /\b(?:alcohol\w*|drunk\w*|drinks? heavily)\b/i],
  ["a crime", /\b(?:criminal|thief|theft|steal\w*|stole\w*|stolen|embezzl\w*|fraud)\b/i],
  ["a marriage", /\b(?:married|marries|marriage|wedding|wed\b|engaged to|engagement)\b/i],
  ["an affair", /\b(?:affair|mistress|adulter\w*)\b/i],
  ["poison", /\bpoison\w*\b/i],
];

const TITLES = /^(?:Lady|Lord|Mr|Mrs|Miss|Sir|Inspector|King|Queen|Dr|Sergeant)\.?$/;
const FEMALE_TITLES = new Set(["lady", "mrs", "miss", "queen"]);
const NOT_NAMES = new Set(
  "The This That These Those There Their They When Where Which What While Whilst Although Though However Therefore Furthermore Moreover Ultimately Overall Throughout Despite Both Each Some Such Then Thus Also Here After Before During Through Between Within Without Act Scene Priestley Shakespeare Edwardian Jacobean Victorian Elizabethan English British Britain God Scotland England Birmingham Brumley Inverness Dunsinane Birnam Banquet Fleance".split(/\s+/),
);

interface ParsedName {
  title: string;
  given: string;
  family: string;
  text: string;
}

const parseName = (text: string): ParsedName => {
  const tokens = text.replace(/'s$/, "").split(/\s+/).filter(Boolean);
  const title = tokens.length > 1 && TITLES.test(tokens[0]!) ? tokens.shift()!.replace(/\.$/, "").toLowerCase() : "";
  return { title, given: tokens.length > 1 ? tokens[0]!.toLowerCase() : "", family: (tokens.length > 1 ? tokens[1]! : (tokens[0] ?? "")).toLowerCase(), text };
};

/** Whether two ways of naming a character can be the same person. "Macbeth" is not "Lady Macbeth"; "Mr Birling" is not "Mrs Birling". */
export function sameCharacter(a: string, b: string): boolean {
  const x = parseName(a);
  const y = parseName(b);
  if (x.title && y.title && x.title !== y.title && (FEMALE_TITLES.has(x.title) || FEMALE_TITLES.has(y.title) || (x.title === "mr" && y.title === "mrs"))) return false;
  if (FEMALE_TITLES.has(x.title) !== FEMALE_TITLES.has(y.title) && (x.title === "lady" || y.title === "lady" || x.title === "mrs" || y.title === "mrs")) return false;
  if (x.given && y.given) return x.given === y.given && x.family === y.family;
  const xs = new Set([x.given, x.family].filter(Boolean));
  return [y.given, y.family].filter(Boolean).some((t) => xs.has(t));
}

const NAME = /(?:(?:Lady|Lord|Mr|Mrs|Miss|Sir|Inspector|King|Queen|Dr|Sergeant)\.? )?[A-Z][a-z]{2,}(?: [A-Z][a-z]{2,})?(?:'s|’s)?/g;

interface Found {
  name: string;
  end: number;
}

/** Names in a sentence that could be characters, with where each ends. A possessor ("Banquo's ghost") is not the one who acts and is left out. */
function namesIn(sentence: string, _known: ReadonlySet<string>): Found[] {
  const out: Found[] = [];
  for (const m of sentence.matchAll(NAME)) {
    const raw = m[0];
    if (/['’]s$/.test(raw)) continue;
    const parts = raw.split(" ").filter((p) => !TITLES.test(p.replace(/\.$/, "")));
    const first = parts[0];
    if (!first || NOT_NAMES.has(first) || (first.length >= 6 && /ly$/.test(first))) continue;
    // "Eric Birling" matched greedily as a name plus a following capital: keep only words that are names.
    out.push({ name: raw, end: m.index! + raw.length });
  }
  return out;
}

const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 12 && s.length < 600);

interface Pair {
  subject: string;
  event: string;
  sentence: string;
}

const GHOST_NAME = "((?:Lady |Lord |Mr |Mrs |Miss |Sir |King |Queen )?[A-Z][a-z]{2,}(?: [A-Z][a-z]{2,})?)";
/** Who SEES a ghost: "Macbeth sees Banquo's ghost", "the ghost of Banquo appears to Macbeth". The one who is seen, or who is merely named nearby, is not the subject. */
const SEES = new RegExp(`${GHOST_NAME}\\s+(?:[a-z]+\\s+){0,2}(?:sees?|saw|seeing|sights?|hallucinates?|is haunted by|is visited by|speaks to|talks to|addresses|confronts)\\s+(?:the |a |an )?(?:[A-Z][a-z]+'s |[A-Z][a-z]+’s )?(?:ghost|apparition|spectre)`);
const APPEARS = new RegExp(`(?:ghost|apparition|spectre)(?: of [A-Z][a-z]+)?(?:'s)?\\s+(?:[a-z]+\\s+){0,2}(?:appears?|reappears?|returns?|visits?|haunts?|comes?)\\s+(?:to|for|before)\\s+${GHOST_NAME}`, "i");

function pairsIn(sentence: string, known: ReadonlySet<string>): Pair[] {
  const names = namesIn(sentence, known);
  const out: Pair[] = [];
  for (const [event, re] of EVENTS) {
    const m = re.exec(sentence);
    if (!m) continue;
    if (event === "a ghost") {
      const seer = SEES.exec(sentence)?.[1] ?? APPEARS.exec(sentence)?.[1];
      if (seer && !NOT_NAMES.has(seer.split(" ")[0]!)) {
        out.push({ subject: seer, event, sentence });
        continue;
      }
    }
    const before = names.filter((n) => n.end <= m.index).at(-1);
    // A subject far from the event word is not its subject.
    if (before && m.index - before.end <= 80) out.push({ subject: before.name, event, sentence });
  }
  return out;
}

/** Names the pages or the question mention: a name in none of them is an invented character, not a known one with a wrong event. */
export function knownNames(texts: readonly string[]): Set<string> {
  const known = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/\b[A-Z][a-z]{2,}\b/g)) known.add(m[0].toLowerCase());
  return known;
}

export function checkEventClaims(reply: string, evidenceTexts: readonly string[], question = ""): EventClaim[] {
  const known = knownNames([...evidenceTexts, question]);
  const evidence: Pair[] = evidenceTexts.flatMap((t) => sentencesOf(t).flatMap((s) => pairsIn(s, known)));
  const claims: EventClaim[] = [];
  const seen = new Set<string>();
  for (const sentence of sentencesOf(reply)) {
    for (const p of pairsIn(sentence, known)) {
      const key = `${p.subject}|${p.event}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sameEvent = evidence.filter((e) => e.event === p.event);
      const mine = sameEvent.filter((e) => sameCharacter(e.subject, p.subject));
      const others = [...new Set(sameEvent.filter((e) => !sameCharacter(e.subject, p.subject)).map((e) => e.subject.replace(/['’]s$/, "")))].slice(0, 3);
      const status: ClaimStatus = mine.length ? "supported" : others.length ? "contradicted" : "unsupported";
      claims.push({ sentence, subject: p.subject, event: p.event, status, actuallyBy: status === "contradicted" ? others : [] });
    }
  }
  return claims;
}

/** Characters the reply introduces as "a character called X" that no source mentions. */
export function inventedCharacters(reply: string, evidenceTexts: readonly string[], question = ""): string[] {
  const known = knownNames([...evidenceTexts, question]);
  const out: string[] = [];
  for (const m of reply.matchAll(/\b(?:character|woman|man|girl|boy|maid|servant|friend|brother|sister|son|daughter)s? (?:called|named|known as) ([A-Z][a-z]{2,})/g)) if (!known.has(m[1]!.toLowerCase()) && !out.includes(m[1]!)) out.push(m[1]!);
  return out;
}
