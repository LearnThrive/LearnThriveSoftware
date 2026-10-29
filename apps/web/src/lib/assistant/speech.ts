/**
 * Turns a LearnThrive AI answer (Markdown with LaTeX) into words a speech voice can say (plan19 section 5.4): the screen keeps the
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
  [/\\int\b/g, " the integral "],
  [/\\sum\b/g, " the sum "],
  [/\\prod\b/g, " the product "],
  [/\\partial\b/g, " partial "],
  [/\\angle\b/g, " angle "],
  [/\\equiv\b/g, " is equivalent to "],
];

/** Function names read as words. Without this, `\sin \theta` lost its "sine" and said only "theta" (the unknown-command rule). */
const FUNCTIONS: Record<string, string> = {
  arcsin: "arc sine",
  arccos: "arc cosine",
  arctan: "arc tangent",
  sinh: "hyperbolic sine",
  cosh: "hyperbolic cosine",
  tanh: "hyperbolic tangent",
  sin: "sine",
  cos: "cosine",
  tan: "tangent",
  sec: "secant",
  csc: "cosecant",
  cot: "cotangent",
  log: "log",
  ln: "natural log",
  exp: "e to the power of",
  lim: "the limit",
  max: "maximum",
  min: "minimum",
  det: "determinant",
  gcd: "highest common factor",
  lcm: "lowest common multiple",
};

/** The integral, the sum and the product, for the constructs that carry limits. */
const ACCUMULATORS: Record<string, string> = { int: "integral", sum: "sum", prod: "product" };

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
  // Constructs whose limits and arguments ARE the meaning, read from the raw LaTeX before braces are stripped: a derivative's
  // fraction is "d y by d x", not "d y over d x"; a limit is "the limit as x approaches 0", not "the limit sub ...".
  s = s.replace(/\\[dt]?frac\s*\{\s*d\s*([A-Za-z])\s*\}\s*\{\s*d\s*([A-Za-z])\s*\}/g, (_m, a: string, b: string) => ` d ${a} by d ${b} `);
  s = s.replace(/\\lim\s*_\s*\{([^{}]*)\}/g, (_m, inner: string) => ` the limit as ${inner.replace(/\\to\b/g, "approaches").trim()} `);
  s = s.replace(/\\(int|sum|prod)\s*_\s*\{([^{}]*)\}\s*\^\s*\{([^{}]*)\}/g, (_m, kind: string, from: string, to: string, offset: number, whole: string) => {
    // "the sum from n equals 1 to 10 of n": the thing being summed is read with an "of" when one follows, never left dangling.
    const body = whole.slice(offset + _m.length).replace(/^[\s$]+/, "");
    return ` the ${ACCUMULATORS[kind]} from ${from.trim()} to ${to.trim()}${body ? " of " : " "}`;
  });
  s = s.replace(/\\log\s*_\s*\{([^{}]*)\}/g, (_m, base: string) => ` log base ${base.trim()} `);

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
  s = s.replace(/\\(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|sec|csc|cot|log|ln|exp|lim|max|min|det|gcd|lcm)\b/g, (_m, name: string) => ` ${FUNCTIONS[name]} `);
  // A prime is a derivative: f' is "f prime", f'' is "f double prime" (the space before the tick is how it is typed).
  s = s.replace(/([A-Za-z])''/g, "$1 double prime ");
  s = s.replace(/([A-Za-z])'/g, "$1 prime ");
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
 * Where the first chunk may be cut when a sentence is long: a comma or dash (the pause a speaker would take). A sentence with no
 * such pause is spoken whole unless it is longer than `hard`, where a mid-clause break is less bad than seconds of silence. Returns
 * `null` rather than chopping a clause with no natural pause in it.
 */
function firstCut(chunk: string, min: number, cap: number, hard: number): [string, string] | null {
  let at = -1;
  for (const m of chunk.matchAll(/[,;:—–-]\s+/g)) {
    const end = (m.index ?? 0) + m[0].length;
    if (end >= min && end <= cap + 24) at = end;
  }
  if (at < 0 && chunk.length > hard) {
    const space = chunk.lastIndexOf(" ", cap);
    if (space >= min) at = space + 1;
  }
  if (at < 0) return null;
  const head = chunk.slice(0, at).trim();
  const tail = chunk.slice(at).trim();
  return head && tail ? [head, tail] : null;
}

/**
 * Splits speech into sentences, then joins very short ones so the voice is not asked for a clip of two words. The first chunk is
 * allowed to be short (the sooner the first audio, the better) and is **capped** (`firstMax`): Kokoro synthesises at roughly real
 * time on this CPU, so a first clip of two and a half seconds of audio is a two-and-a-half-second wait before the student hears
 * anything. Cutting the first sentence short at a natural pause is not a wording change: the rest follows as the next clip. Later
 * chunks are padded towards `target` characters. `ready` are chunks that will not change however much text follows; `rest` is a
 * remainder that later sentences may still join.
 */
export type ChunkOptions = { first?: number; firstMax?: number; target?: number; max?: number };

export function speechChunksPartial(speech: string, { first = 24, firstMax = 64, target = 90, max = 300 }: ChunkOptions = {}): { ready: string[]; rest: string } {
  const sentences = speech.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const ready: string[] = [];
  let current = "";
  for (const raw of sentences) {
    const sentence = raw.length > max ? raw.slice(0, max).replace(/\s+\S*$/, "") : raw;
    current = current ? `${current} ${sentence}` : sentence;
    if (ready.length === 0 && current.length > firstMax) {
      const cut = firstCut(current, first, firstMax, firstMax + 40);
      if (cut) {
        ready.push(cut[0]);
        current = cut[1];
      }
    }
    const want = ready.length === 0 ? first : target;
    if (current.length >= want) {
      ready.push(current);
      current = "";
    }
  }
  return { ready, rest: current };
}

export function speechChunks(speech: string, options?: ChunkOptions): string[] {
  const { ready, rest } = speechChunksPartial(speech, options);
  return rest ? [...ready, rest] : ready;
}

/**
 * Every word of a passage, as chunks the speech route will take: it refuses more than 600 characters, so nothing here is longer
 * than `max`. A sentence longer than that is cut at a word boundary rather than dropped, which is what `speechChunks` does to a
 * sentence over its own `max` (it is built for a live answer, where the rest arrives in the next delta). Reading a message that is
 * already complete must not lose its last words.
 */
export function speechChunksWhole(speech: string, max = 300): string[] {
  const pieces: string[] = [];
  let current = "";
  const add = (piece: string) => {
    if (!piece) return;
    if (current && `${current} ${piece}`.length > max) {
      pieces.push(current);
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  };
  for (const sentence of speech.split(/(?<=[.!?])\s+/)) {
    let rest = sentence.trim();
    while (rest.length > max) {
      let cut = rest.lastIndexOf(" ", max);
      if (cut < 40) cut = max; // one word longer than a whole chunk: cut it rather than loop forever
      add(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    add(rest);
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * The part of an answer that is safe to speak while it is still arriving: everything up to the last sentence end that is followed by
 * more text and is not inside an unfinished `$...$` or code fence. Anything after it may still change, so it waits.
 */
export function settledPrefix(markdownSoFar: string): string {
  let cut = -1;
  const re = /[.!?](?=\s)/g;
  for (let m = re.exec(markdownSoFar); m; m = re.exec(markdownSoFar)) {
    const before = markdownSoFar.slice(0, m.index + 1);
    const dollars = (before.match(/\$/g) ?? []).length;
    const fences = (before.match(/```/g) ?? []).length;
    if (dollars % 2 === 0 && fences % 2 === 0) cut = m.index + 1;
  }
  return cut < 0 ? "" : markdownSoFar.slice(0, cut);
}

/**
 * What the model is told in voice mode, appended to the system prompt for that turn only (the chat service adds it when the request
 * says the answer will be spoken). Short answers, no notation the ear cannot follow.
 */
export const VOICE_PROMPT_ADDENDUM =
  "The student is listening to your answer, not reading it. Keep it short: at most four sentences, one idea at a time. Say maths in words (x squared, three over four) and avoid long strings of symbols; the screen will still show the notation. No lists, tables or code.";
