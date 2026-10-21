/**
 * A small, safe maths checker for the Paper Tutor's answers (no eval, no network): it parses school expressions (numbers, decimals,
 * fractions, powers, roots, percentages, brackets, implied multiplication such as 2x or 3(x + 1), single-letter variables and
 * pi), in plain text or simple LaTeX, and evaluates them with given values.
 *
 * It is what makes "verified" mean something: an answer is only marked checked when a calculation confirms it (the value is right,
 * the solution satisfies the equation, the simplified form equals the original at several points). The model saying "I checked"
 * counts for nothing.
 *
 * ponytail: numeric checking with a tolerance and spot values, not a computer algebra system: enough for GCSE arithmetic,
 * fractions, linear and quadratic equations, simultaneous equations and expansion or factorising. Anything it cannot parse is
 * "unchecked", never "verified".
 */

type Node =
  | { t: "num"; v: number }
  | { t: "var"; name: string }
  | { t: "neg"; a: Node }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Node; b: Node }
  | { t: "fn"; name: "sqrt"; a: Node };

/** Rewrites LaTeX and typographic symbols into plain expression syntax. */
export function normaliseMaths(input: string): string {
  let s = input.trim();
  s = s.replace(/^\$+|\$+$/g, "").replace(/\\[()[\]]/g, "");
  s = s.replace(/\\left|\\right|\\displaystyle|\\,|\\;|\\!|\\quad/g, "");
  for (let pass = 0; pass < 8; pass += 1) {
    const before = s;
    s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "(($1)/($2))");
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, "sqrt($1)");
    s = s.replace(/\^\s*\{([^{}]*)\}/g, "^($1)");
    s = s.replace(/\\text\s*\{([^{}]*)\}|\\mathrm\s*\{([^{}]*)\}/g, "$1$2");
    if (s === before) break;
  }
  s = s.replace(/\\times|\\cdot|×|·/g, "*").replace(/\\div|÷/g, "/").replace(/−|–/g, "-").replace(/\\pi|π/g, "pi");
  s = s.replace(/\\%/g, "%").replace(/£|\\pounds|cm\b|mm\b|kg\b|\bm\b(?=\s*$)/g, "");
  s = s.replace(/(\d),(\d{3})(?!\d)/g, "$1$2"); // 1,000 -> 1000
  // Digit groups spaced the UK way: 10 000 -> 10000, 0.000 52 -> 0.00052 (a space between numbers is never a product in school maths).
  s = s.replace(/(?<![\d.])(\d{1,3})((?:[ \u2009\u202f]\d{3})+)(?![\d.])/g, (_, head: string, rest: string) => head + rest.replace(/\D/g, ""));
  s = s.replace(/(\.\d{3})[ \u2009\u202f](\d{1,3})(?!\d)/g, "$1$2");
  s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, "($1/100)");
  return s.replace(/[{}]/g, (c) => (c === "{" ? "(" : ")")).replace(/\s+/g, " ").trim();
}

type Token = { k: "num"; v: number } | { k: "id"; v: string } | { k: "op"; v: string };

function tokenise(text: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === " ") {
      i += 1;
    } else if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:e[+-]?\d+)?/i.exec(text.slice(i));
      if (!m) return null;
      out.push({ k: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (/[a-z]/i.test(c)) {
      const m = /^[a-z]+/i.exec(text.slice(i))!;
      const word = m[0];
      if (word === "sqrt" || word === "pi") out.push({ k: "id", v: word });
      // Anything else is single-letter variables written together (xy is x times y).
      else for (const letter of word) out.push({ k: "id", v: letter });
      i += word.length;
    } else if ("+-*/^()".includes(c)) {
      out.push({ k: "op", v: c });
      i += 1;
    } else return null;
  }
  return out;
}

function parse(text: string): Node | null {
  const read = tokenise(normaliseMaths(text));
  if (!read || read.length === 0) return null;
  const tokens: Token[] = read;
  let at = 0;
  const peek = () => tokens[at];
  const isOp = (v: string) => peek()?.k === "op" && peek()!.v === v;
  const startsFactor = () => {
    const t = peek();
    return Boolean(t && (t.k === "num" || t.k === "id" || (t.k === "op" && t.v === "(")));
  };

  function expr(): Node {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = (tokens[at++] as { v: "+" | "-" }).v;
      left = { t: "bin", op, a: left, b: term() };
    }
    return left;
  }
  function term(): Node {
    let left = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = (tokens[at++] as { v: "*" | "/" }).v;
        left = { t: "bin", op, a: left, b: unary() };
      } else if (startsFactor()) {
        left = { t: "bin", op: "*", a: left, b: power() }; // implied multiplication: 2x, 3(x + 1), (x + 2)(x + 3)
      } else return left;
    }
  }
  function unary(): Node {
    if (isOp("-")) {
      at += 1;
      return { t: "neg", a: unary() };
    }
    if (isOp("+")) {
      at += 1;
      return unary();
    }
    return power();
  }
  function power(): Node {
    const base = primary();
    if (isOp("^")) {
      at += 1;
      return { t: "bin", op: "^", a: base, b: unary() };
    }
    return base;
  }
  function primary(): Node {
    const t = tokens[at++];
    if (!t) throw new Error("end");
    if (t.k === "num") return { t: "num", v: t.v };
    if (t.k === "id") {
      if (t.v === "pi") return { t: "num", v: Math.PI };
      if (t.v === "sqrt") {
        if (!isOp("(")) return { t: "fn", name: "sqrt", a: primary() };
        at += 1;
        const a = expr();
        if (!isOp(")")) throw new Error("bracket");
        at += 1;
        return { t: "fn", name: "sqrt", a };
      }
      return { t: "var", name: t.v };
    }
    if (t.v === "(") {
      const inner = expr();
      if (!isOp(")")) throw new Error("bracket");
      at += 1;
      return inner;
    }
    throw new Error("unexpected");
  }

  try {
    const tree = expr();
    return at === tokens.length ? tree : null;
  } catch {
    return null;
  }
}

function variablesOf(node: Node, into = new Set<string>()): Set<string> {
  if (node.t === "var") into.add(node.name);
  else if (node.t === "neg" || node.t === "fn") variablesOf(node.a, into);
  else if (node.t === "bin") {
    variablesOf(node.a, into);
    variablesOf(node.b, into);
  }
  return into;
}

function run(node: Node, values: Record<string, number>): number {
  switch (node.t) {
    case "num":
      return node.v;
    case "var":
      if (!(node.name in values)) throw new Error(`no value for ${node.name}`);
      return values[node.name]!;
    case "neg":
      return -run(node.a, values);
    case "fn":
      return Math.sqrt(run(node.a, values));
    case "bin": {
      const a = run(node.a, values);
      const b = run(node.b, values);
      return node.op === "+" ? a + b : node.op === "-" ? a - b : node.op === "*" ? a * b : node.op === "/" ? a / b : a ** b;
    }
  }
}

/** The value of an expression with the given variables, or null if it cannot be parsed or worked out. */
export function evaluate(text: string, values: Record<string, number> = {}): number | null {
  const tree = parse(text);
  if (!tree) return null;
  try {
    const v = run(tree, values);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function variables(text: string): string[] {
  const tree = parse(text);
  return tree ? [...variablesOf(tree)].sort() : [];
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Spot values used to compare two expressions: a few awkward numbers, none special (not 0, 1 or 2). */
const SPOTS = [1.37, -2.71, 0.53, 3.19, -0.87, 5.41];

/** True if two expressions agree at several spot values of their variables (expanded, factorised and simplified forms). */
export function equivalent(a: string, b: string): boolean | null {
  const ta = parse(a);
  const tb = parse(b);
  if (!ta || !tb) return null;
  const names = [...new Set([...variablesOf(ta), ...variablesOf(tb)])];
  for (let k = 0; k < SPOTS.length; k += 1) {
    const values = Object.fromEntries(names.map((name, i) => [name, SPOTS[(k + i) % SPOTS.length]! + i * 0.11]));
    let va: number;
    let vb: number;
    try {
      va = run(ta, values);
      vb = run(tb, values);
    } catch {
      return null;
    }
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    if (!close(va, vb)) return false;
  }
  return true;
}

/** Splits "lhs = rhs" (one equals sign) into its sides. */
export function sides(equation: string): [string, string] | null {
  const parts = normaliseMaths(equation).split("=");
  return parts.length === 2 && parts[0]!.trim() && parts[1]!.trim() ? [parts[0]!, parts[1]!] : null;
}

/** Reads "x = 4, y = 3" or "x = 5 or x = -2" into sets of values: one set per alternative solution. */
export function readSolutions(answer: string): Array<Record<string, number>> | null {
  const text = normaliseMaths(answer).replace(/\band\b/gi, ",");
  const alternatives = text.split(/\bor\b|;/i).map((s) => s.trim()).filter(Boolean);
  const out: Array<Record<string, number>> = [];
  for (const alt of alternatives) {
    const values: Record<string, number> = {};
    const pairs = [...alt.matchAll(/([a-z])\s*=\s*([^,]+)/gi)];
    if (pairs.length === 0) return null;
    for (const [, name, raw] of pairs) {
      const v = evaluate(raw!);
      if (v === null) return null;
      values[name!.toLowerCase()] = v;
    }
    out.push(values);
  }
  // "x = 5 or -2": the second alternative carries only a number; it belongs to the first's variable.
  return out.length ? out : null;
}

/** True if every equation holds for every alternative solution given. */
export function satisfies(equations: string[], answer: string): boolean | null {
  const solutions = readSolutions(answer.replace(/\bor\s+(-?[\d.]+)/gi, (_m, n: string) => `or ${(answer.match(/([a-z])\s*=/i) ?? [])[1] ?? "x"} = ${n}`));
  if (!solutions || equations.length === 0) return null;
  for (const values of solutions) {
    for (const equation of equations) {
      const s = sides(equation);
      if (!s) return null;
      const l = evaluate(s[0], values);
      const r = evaluate(s[1], values);
      if (l === null || r === null) return null;
      if (!close(l, r)) return false;
    }
  }
  return true;
}

/** A value answer such as "7/8", "£68", "0.875" or "5.2 \\times 10^{-4}". */
export function valueOf(answer: string): number | null {
  const cleaned = normaliseMaths(answer).replace(/^[a-z]\s*=\s*/i, "");
  return evaluate(cleaned);
}

export function sameValue(a: number, b: number): boolean {
  return close(a, b);
}

/** Squeezes text for a "does this appear in the document" comparison: no spaces, one kind of minus and times sign, lower case. */
export function squeeze(text: string): string {
  return normaliseMaths(text).toLowerCase().replace(/\s+/g, "").replace(/\*/g, "x");
}
