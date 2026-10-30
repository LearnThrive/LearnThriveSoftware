/**
 * A small, safe reader and evaluator for the maths a generated interface may contain (a graph's formula, an arithmetic check on a quiz question).
 *
 * Nothing here runs the text it is given: it is tokenised, parsed into a tree of numbers, variables, operators and an allowlisted set of functions,
 * and evaluated by walking that tree. There is no `eval`, no `Function`, no property access and no way to name anything but the variables the caller
 * lists. A graph is therefore drawn from a FORMULA the code has understood, never from coordinates a model wrote down.
 *
 * Accepted: numbers, the variables the caller allows, `pi` and `e`, + - * / ^ and brackets, implicit multiplication (`2x`, `3(x+1)`, `(x+1)(x-1)`, `2pi`),
 * unary minus (so `-x^2` is -(x^2)), the functions in FUNCTIONS, and the symbols a student or a model writes naturally (× ÷ − π √ and superscript digits).
 */
export type MathNode =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "neg"; a: MathNode }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: MathNode; b: MathNode }
  | { k: "call"; fn: string; args: MathNode[] };

const clean = (v: number) => (Number.isFinite(v) ? v : Number.NaN);

export const FUNCTIONS: Readonly<Record<string, { arity: number; fn: (...n: number[]) => number }>> = {
  sin: { arity: 1, fn: Math.sin },
  cos: { arity: 1, fn: Math.cos },
  tan: { arity: 1, fn: Math.tan },
  asin: { arity: 1, fn: Math.asin },
  acos: { arity: 1, fn: Math.acos },
  atan: { arity: 1, fn: Math.atan },
  sqrt: { arity: 1, fn: Math.sqrt },
  abs: { arity: 1, fn: Math.abs },
  ln: { arity: 1, fn: Math.log },
  log: { arity: 1, fn: Math.log10 },
  exp: { arity: 1, fn: Math.exp },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
  round: { arity: 1, fn: Math.round },
  sign: { arity: 1, fn: Math.sign },
  min: { arity: 2, fn: Math.min },
  max: { arity: 2, fn: Math.max },
};
export const CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI, e: Math.E };

const MAX_SOURCE = 200;
const MAX_NODES = 300;
const MAX_DEPTH = 40;
const SUPERSCRIPTS: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

/** The symbols people write that mean an operator or a name, turned into the plain forms the parser knows. */
export function normaliseMath(source: string): string {
  return source
    .replace(/[×·∙⋅]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/π/g, "pi")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (run) => `^${[...run].map((c) => SUPERSCRIPTS[c]).join("")}`)
    .replace(/√\s*\(/g, "sqrt(")
    .replace(/√\s*([A-Za-z0-9.]+)/g, "sqrt($1)")
    .replace(/\*\*/g, "^")
    .trim();
}

type Token = { t: "num"; v: number } | { t: "id"; name: string } | { t: "op"; op: string } | { t: "(" } | { t: ")" } | { t: "," };

function tokenise(src: string): Token[] | string {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) return `a number could not be read near "${src.slice(i, i + 6)}"`;
      // "2e" followed by a letter is two things (2 and e), not an exponent; only take an exponent that is followed by digits.
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(src.slice(i))!;
      out.push({ t: "id", name: m[0] });
      i += m[0].length;
      continue;
    }
    if ("+-*/^".includes(c)) {
      out.push({ t: "op", op: c });
      i += 1;
      continue;
    }
    if (c === "(") out.push({ t: "(" });
    else if (c === ")") out.push({ t: ")" });
    else if (c === ",") out.push({ t: "," });
    else return `the character "${c}" is not allowed in a formula`;
    i += 1;
  }
  return out;
}

class Parser {
  private at = 0;
  private nodes = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly vars: ReadonlySet<string>,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }
  private next(): Token | undefined {
    return this.tokens[this.at++];
  }
  private node<T extends MathNode>(n: T): T {
    if ((this.nodes += 1) > MAX_NODES) throw new Error("the formula is too long");
    return n;
  }
  private isOp(op: string): boolean {
    const t = this.peek();
    return t?.t === "op" && t.op === op;
  }

  parse(): MathNode {
    const tree = this.add(0);
    if (this.at < this.tokens.length) throw new Error("something after the end of the formula could not be read");
    return tree;
  }

  private add(depth: number): MathNode {
    if (depth > MAX_DEPTH) throw new Error("the formula is nested too deeply");
    let left = this.mul(depth + 1);
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.next() as { op: "+" | "-" }).op;
      left = this.node({ k: "bin", op, a: left, b: this.mul(depth + 1) });
    }
    return left;
  }

  private mul(depth: number): MathNode {
    let left = this.unary(depth + 1);
    for (;;) {
      if (this.isOp("*") || this.isOp("/")) {
        const op = (this.next() as { op: "*" | "/" }).op;
        left = this.node({ k: "bin", op, a: left, b: this.unary(depth + 1) });
        continue;
      }
      // Implicit multiplication: a name or a bracket straight after a value (`2x`, `3(x+1)`, `(x+1)(x-1)`, `x(x+1)`).
      const t = this.peek();
      if (t && (t.t === "(" || t.t === "id")) {
        left = this.node({ k: "bin", op: "*", a: left, b: this.unary(depth + 1) });
        continue;
      }
      return left;
    }
  }

  private unary(depth: number): MathNode {
    if (depth > MAX_DEPTH) throw new Error("the formula is nested too deeply");
    if (this.isOp("-")) {
      this.next();
      return this.node({ k: "neg", a: this.unary(depth + 1) });
    }
    if (this.isOp("+")) {
      this.next();
      return this.unary(depth + 1);
    }
    return this.pow(depth + 1);
  }

  private pow(depth: number): MathNode {
    const base = this.primary(depth + 1);
    if (this.isOp("^")) {
      this.next();
      // Right associative, and the exponent may carry its own sign (x^-2).
      return this.node({ k: "bin", op: "^", a: base, b: this.unary(depth + 1) });
    }
    return base;
  }

  private primary(depth: number): MathNode {
    const t = this.next();
    if (!t) throw new Error("the formula ends too soon");
    if (t.t === "num") return this.node({ k: "num", v: t.v });
    if (t.t === "(") {
      const inner = this.add(depth + 1);
      if (this.next()?.t !== ")") throw new Error("a bracket is not closed");
      return inner;
    }
    if (t.t === "id") return this.name(t.name, depth);
    throw new Error("the formula has an operator or bracket in the wrong place");
  }

  private name(raw: string, depth: number): MathNode {
    const lower = raw.toLowerCase();
    if (FUNCTIONS[lower] && this.peek()?.t === "(") {
      const fn = FUNCTIONS[lower]!;
      this.next();
      const args: MathNode[] = [this.add(depth + 1)];
      while (this.peek()?.t === ",") {
        this.next();
        args.push(this.add(depth + 1));
      }
      if (this.next()?.t !== ")") throw new Error(`the brackets after ${lower} are not closed`);
      if (args.length !== fn.arity) throw new Error(`${lower} takes ${fn.arity} value${fn.arity === 1 ? "" : "s"}`);
      return this.node({ k: "call", fn: lower, args });
    }
    if (FUNCTIONS[lower]) throw new Error(`${lower} must be followed by brackets, like ${lower}(x)`);
    if (this.vars.has(raw)) return this.node({ k: "var", name: raw });
    if (lower in CONSTANTS) return this.node({ k: "var", name: lower });
    // `ax` where a and x are both allowed names: a times x.
    const letters = [...raw];
    if (letters.length > 1 && letters.every((c) => this.vars.has(c) || c.toLowerCase() in CONSTANTS)) {
      return letters.map((c) => this.node({ k: "var", name: this.vars.has(c) ? c : c.toLowerCase() }) as MathNode).reduce((a, b) => this.node({ k: "bin", op: "*", a, b }));
    }
    throw new Error(`"${raw}" is not a name this formula may use`);
  }
}

export type MathParse = { ok: true; tree: MathNode; variables: string[] } | { ok: false; error: string };

/** Reads a formula. `allowed` is the only set of variable names it may mention. Never throws. */
export function parseMath(source: string, allowed: readonly string[] = ["x"]): MathParse {
  if (typeof source !== "string" || !source.trim()) return { ok: false, error: "the formula is empty" };
  const src = normaliseMath(source);
  if (src.length > MAX_SOURCE) return { ok: false, error: `the formula is longer than ${MAX_SOURCE} characters` };
  const tokens = tokenise(src);
  if (typeof tokens === "string") return { ok: false, error: tokens };
  try {
    const tree = new Parser(tokens, new Set(allowed)).parse();
    const found = new Set<string>();
    const walk = (n: MathNode) => {
      if (n.k === "var") {
        if (!(n.name in CONSTANTS)) found.add(n.name);
      } else if (n.k === "neg") walk(n.a);
      else if (n.k === "bin") {
        walk(n.a);
        walk(n.b);
      }
      else if (n.k === "call") n.args.forEach(walk);
    };
    walk(tree);
    return { ok: true, tree, variables: [...found] };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Evaluates a parsed formula. A domain error (the root of a negative, dividing by zero) is NaN or an infinity, never a throw. */
export function evaluateMath(node: MathNode, scope: Readonly<Record<string, number>> = {}): number {
  switch (node.k) {
    case "num":
      return node.v;
    case "var":
      return node.name in CONSTANTS ? CONSTANTS[node.name]! : (scope[node.name] ?? Number.NaN);
    case "neg":
      return -evaluateMath(node.a, scope);
    case "bin": {
      const a = evaluateMath(node.a, scope);
      const b = evaluateMath(node.b, scope);
      switch (node.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "^":
          return Math.pow(a, b);
      }
      return Number.NaN;
    }
    case "call": {
      const f = FUNCTIONS[node.fn]!;
      return f.fn(...node.args.map((a) => evaluateMath(a, scope)));
    }
  }
}

/** Convenience for a formula with no variables ("6 x 7", "3/4 + 1/4"): the number, or null when it is not a plain calculation. */
export function calculate(source: string): number | null {
  const parsed = parseMath(source, []);
  if (!parsed.ok) return null;
  const value = evaluateMath(parsed.tree);
  return Number.isFinite(value) ? clean(value) : null;
}
