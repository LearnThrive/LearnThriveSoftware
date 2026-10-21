/**
 * Turns a Study Buddy answer (Markdown with LaTeX) into words a speech voice can say (plan19 section 5.4): the screen keeps the
 * notation, the voice reads "x squared plus five x" and never "dollar x caret two". Pure and dependency-free, so the browser uses it
 * as the answer streams and the tests can pin it. It is a best-effort reader for school maths, not a LaTeX engine: anything it does
 * not know is spoken as plain words with the markup stripped.
 */

const SYMBOLS: Array<[RegExp, string]> = [
  [/\\times|\\cdot/g, " times "],
  [/\\div/g, " divided by "],
  [/\\pm/g, " plus or minus "],
  [/\\mp/g, " minus or plus "],
  [/\\leq?\b/g, " is less than or equal to "],
  [/\\geq?\b/g, " is greater than or equal to "],
  [/\\neq?\b/g, " is not equal to "],
  [/\\approx/g, " is approximately "],
  [/\\to\b|\\rightarrow\b/g, " goes to "],
  [/\\infty/g, " infinity "],
  [/\\pi\b/g, " pi "],
  [/\\theta\b/g, " theta "],
  [/\\alpha\b/g, " alpha "],
  [/\\beta\b/g, " beta "],
  [/\\Delta\b/g, " delta "],
  [/\\delta\b/g, " delta "],
  [/\\circ|\^\\circ|\\degree/g, " degrees "],
  [/\\%/g, " percent "],
  [/\\(?:left|right|big|Big|displaystyle)\b/g, ""],
  [/\\[,;:! ]/g, " "],
  [/\\(?:quad|qquad)\b/g, " "],
  [/\\ldots|\\dots|\\cdots/g, " and so on "],
];

/** The power in `x^n`: squared, cubed, to the power of n. */
function power(exp: string): string {
  const e = exp.trim();
  if (e === "2") return " squared";
  if (e === "3") return " cubed";
  if (e === "-1") return " to the power of minus one";
  return ` to the power of ${e.replace(/^-/, "minus ")}`;
}

/** Reads one stretch of LaTeX maths aloud. */
export function mathToSpeech(math: string): string {
  let s = ` ${math} `;
  // Fractions and roots first, innermost first, so nested braces resolve from the inside out.
  for (let pass = 0; pass < 6; pass += 1) {
    const before = s;
    s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_m, a: string, b: string) => ` ${a.trim()} over ${b.trim()} `);
    s = s.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, (_m, n: string, a: string) => ` the ${n.trim() === "3" ? "cube" : `${n.trim()}th`} root of ${a.trim()} `);
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_m, a: string) => ` the square root of ${a.trim()} `);
    s = s.replace(/\\sqrt\s*([A-Za-z0-9])/g, (_m, a: string) => ` the square root of ${a} `);
    s = s.replace(/\\text\s*\{([^{}]*)\}|\\mathrm\s*\{([^{}]*)\}|\\mathbf\s*\{([^{}]*)\}/g, (_m, a?: string, b?: string, c?: string) => ` ${a ?? b ?? c ?? ""} `);
    s = s.replace(/\^\s*\{([^{}]*)\}/g, (_m, e: string) => power(e));
    s = s.replace(/_\s*\{([^{}]*)\}/g, (_m, e: string) => ` sub ${e.trim()} `);
    if (s === before) break;
  }
  s = s.replace(/\^\s*(-?[A-Za-z0-9])/g, (_m, e: string) => power(e));
  s = s.replace(/_\s*([A-Za-z0-9])/g, (_m, e: string) => ` sub ${e} `);
  for (const [pattern, words] of SYMBOLS) s = s.replace(pattern, words);
  s = s.replace(/\\[A-Za-z]+/g, " "); // any command not known above: say nothing rather than a backslash
  s = s.replace(/[{}]/g, " ");
  s = s.replace(/\s*=\s*/g, " equals ");
  s = s.replace(/\s*\+\s*/g, " plus ");
  s = s.replace(/(\d|\)|[A-Za-z])\s*-\s*(?=[\dA-Za-z(])/g, "$1 minus ");
  s = s.replace(/(^|\s)-\s*(?=[\dA-Za-z(])/g, "$1minus ");
  s = s.replace(/\s*<\s*/g, " is less than ");
  s = s.replace(/\s*>\s*/g, " is greater than ");
  s = s.replace(/\s*\/\s*/g, " over ");
  s = s.replace(/\s*\*\s*/g, " times ");
  s = s.replace(/(\d)\s*%/g, "$1 percent");
  return s.replace(/\s+/g, " ").trim();
}

/** The whole answer as speech: maths read aloud, Markdown and links and code removed. */
export function toSpeech(markdown: string): string {
  let s = markdown;
  s = s.replace(/```[\s\S]*?```/g, " (a code example is on the screen) ");
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, m: string) => ` ${mathToSpeech(m)}. `);
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_m, m: string) => ` ${mathToSpeech(m)}. `);
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_m, m: string) => ` ${mathToSpeech(m)} `);
  s = s.replace(/\$([^$\n]+?)\$/g, (_m, m: string) => ` ${mathToSpeech(m)} `);
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  s = s.replace(/^\s*>\s?/gm, "");
  s = s.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "");
  s = s.replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, " ");
  s = s.replace(/\|/g, ", ");
  s = s.replace(/(\*\*|__|\*|_|~~|`)/g, "");
  // Plain-text maths the model wrote without dollar signs: x^2, 3/4 stay as they are but powers are said.
  s = s.replace(/([A-Za-z0-9)])\^(-?[A-Za-z0-9]+)/g, (_m, base: string, e: string) => `${base}${power(e)}`);
  s = s.replace(/&[a-z]+;/g, " ");
  s = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ");
  return s.replace(/\s*\n+\s*/g, ". ").replace(/\.(\s*\.)+/g, ".").replace(/([:;,])\s*\./g, "$1").replace(/\s+/g, " ").trim();
}

/**
 * Splits speech into sentences, then joins very short ones so the voice is not asked for a clip of two words. The first chunk is
 * allowed to be short (the sooner the first audio, the better); later ones are padded towards `target` characters.
 */
export function speechChunks(speech: string, { first = 24, target = 90, max = 300 }: { first?: number; target?: number; max?: number } = {}): string[] {
  const sentences = speech.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  let current = "";
  for (const raw of sentences) {
    const sentence = raw.length > max ? raw.slice(0, max).replace(/\s+\S*$/, "") : raw;
    const want = out.length === 0 ? first : target;
    current = current ? `${current} ${sentence}` : sentence;
    if (current.length >= want) {
      out.push(current);
      current = "";
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * What the model is told in voice mode, appended to the system prompt for that turn only (the chat service adds it when the request
 * says the answer will be spoken). Short answers, no notation the ear cannot follow.
 */
export const VOICE_PROMPT_ADDENDUM =
  "The student is listening to your answer, not reading it. Keep it short: at most four sentences, one idea at a time. Say maths in words (x squared, three over four) and avoid long strings of symbols; the screen will still show the notation. No lists, tables or code.";
