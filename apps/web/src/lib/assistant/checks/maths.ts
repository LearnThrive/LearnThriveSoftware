import { equivalent, normaliseMaths, parseMaths, sameValue, valueOf, variablesOfNode } from "@/lib/paper/maths";
import { solutionsOf } from "@/lib/paper/mathsEvidence";
import type { EvidenceStatus } from "./evidence";

/**
 * Checks the working in a reply by calculation, with the Paper Tutor's own safe parser (no eval, no network, no model): the same checker that
 * makes "verified" mean something there. It reads only lines that are plainly maths (a display block, or a line that is nothing but an equation)
 * and judges only what it can decide:
 *
 *   arithmetic        a line with no unknowns must be true (a decimal is allowed to be a rounding to the figures it is written with)
 *   a chain           A = B = C: each link whose two sides have the same unknowns must be equal for every value (an identity); a link that
 *                     substitutes numbers for letters ("v = u + at = 0 + 9.8 x 3") is a substitution, not judged
 *   a run of steps    consecutive equations in one unknown, in one block of working, must not GAIN a solution (2x + 7 = 19, then 2x = 14 is
 *                     wrong). Losing one is allowed: a step may rightly discard a root that the question rules out (a length cannot be -3)
 *
 * Approximations, alternatives ("x = 2 or x = 3", ±), inequalities and anything it cannot parse are left alone: unchecked, never wrong.
 */
export interface WorkingFinding {
  /** The line of working as the reply wrote it. */
  line: string;
  problem: string;
  status: EvidenceStatus;
}

export interface WorkingCheck {
  /** Lines (or links of a chain) that were tested. */
  checked: number;
  findings: WorkingFinding[];
}

const SKIP = /\\pm|±|≈|\\approx|\\simeq|\\neq|≠|<|>|\\[lg]eq?\b|≤|≥|\bor\b|\band\b|[,;]|\\to\b|→|\\rightarrow|\\cup|\\cap|\\in\b|\\infty|\\sum|\\int|\\lim|\\log|\\ln|\\sin|\\cos|\\tan|\bsin\b|\bcos\b|\btan\b|\blog\b|\bln\b|!/;

/** Turns a written row of working into what the parser reads: no alignment marks, no annotations, no units or words in \text. */
function cleanRow(row: string): string {
  return row
    .replace(/\\(?:begin|end)\{[a-z*]+\}/gi, " ")
    .replace(/&/g, " ")
    .replace(/\\(?:qquad|quad)\b[\s\S]*$/, " ")
    .replace(/\\(?:text|mathrm|textrm|textbf|operatorname|mbox)\s*\{[^{}]*\}(?:\s*\^\s*\{?-?\d\}?)?/g, " ")
    .replace(/\^\s*\{?\s*\\circ\s*\}?|°/g, " ")
    .replace(/^\s*(?:\\Rightarrow|\\implies|\\therefore|⇒|∴|=>)\s*/, "")
    .replace(/\\(?:Rightarrow|implies|therefore)\b/g, " ")
    .replace(/[.,;:]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Is a plain line of text only maths (an equation with no words)? */
function mathsOnly(line: string): boolean {
  if (!line.includes("=") || line.length > 160) return false;
  const words = line.replace(/\\[a-zA-Z]+/g, " ");
  if (/[a-zA-Z]{3,}/.test(words)) return false;
  return /^[\s0-9a-zA-Z+\-−–*×÷/^=().{}[\]\\'²³√π·|]+$/.test(line) && /\d|[a-z]/i.test(line);
}

/** The reply's working, in runs: consecutive maths lines with no prose between them. Display blocks may span lines; their rows (\\) are lines. */
export function workingRuns(answer: string): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) runs.push(run);
    run = [];
  };
  const rows = (block: string) => block.split(/\\\\|\n/).map((r) => r.trim()).filter(Boolean);
  const lines = answer.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const opener = /^(\$\$|\\\[)/.exec(line);
    if (opener) {
      const close = opener[1] === "$$" ? "$$" : "\\]";
      let body = line.slice(opener[1]!.length);
      // The block may close on this line or a later one.
      while (!body.includes(close) && i + 1 < lines.length) body += `\n${lines[(i += 1)]}`;
      const end = body.indexOf(close);
      run.push(...rows(end >= 0 ? body.slice(0, end) : body));
      if (end >= 0 && body.slice(end + close.length).trim()) flush();
      continue;
    }
    const bare = line.replace(/^(?:[-*+]|\d+[.)])\s+/, "").replace(/^\$(.+)\$$/, "$1").replace(/^\\\((.+)\\\)$/, "$1").trim();
    if (mathsOnly(bare)) run.push(bare);
    else flush();
  }
  flush();
  return runs;
}

const variablesIn = (expr: string): Set<string> | null => {
  const node = parseMaths(normaliseMaths(expr));
  return node ? variablesOfNode(node) : null;
};

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/** A written decimal may be the true value rounded to the significant figures it is written with; anything else must be exact. */
function agrees(exact: number, writtenSide: string): boolean {
  const shown = valueOf(writtenSide);
  if (shown === null) return true;
  if (sameValue(exact, shown)) return true;
  const plain = normaliseMaths(writtenSide).replace(/\s+/g, "");
  const decimal = /^-?(\d+(?:\.\d+)?)(?:\*10\^\(?-?\d+\)?)?$/.exec(plain);
  if (!decimal) return false;
  const digits = decimal[1]!.replace(".", "").replace(/^0+/, "");
  const figures = Math.max(1, digits.length);
  const magnitude = shown === 0 ? 0 : Math.floor(Math.log10(Math.abs(shown)));
  return Math.abs(exact - shown) <= 0.5 * 10 ** (magnitude - figures + 1) + 1e-12;
}

const show = (n: number) => String(Math.round(n * 1e6) / 1e6);

export function checkWorkingLines(answer: string): WorkingCheck {
  const result: WorkingCheck = { checked: 0, findings: [] };
  for (const run of workingRuns(answer)) {
    let previous: { variable: string; roots: number[] } | null = null;
    for (const raw of run) {
      const row = cleanRow(raw);
      // Words inside \text{} decide too: "x = 3 \text{ or } x = -3" is two answers, not a chain.
      const spoken = raw.replace(/\\(?:text|mathrm|textrm|mbox)\s*\{([^{}]*)\}/g, " $1 ");
      if (!row.includes("=") || SKIP.test(row) || SKIP.test(spoken)) {
        previous = null;
        continue;
      }
      const parts = normaliseMaths(row).split("=").map((p) => p.trim());
      if (parts.length < 2 || parts.some((p) => !p)) {
        previous = null;
        continue;
      }
      let flawed = false;
      // Every link whose sides have the same unknowns: equal in value (none) or for every value (some).
      for (let k = 0; k + 1 < parts.length && !flawed; k += 1) {
        const a = parts[k]!;
        const b = parts[k + 1]!;
        const va = variablesIn(a);
        const vb = variablesIn(b);
        if (!va || !vb) continue;
        if (va.size === 0 && vb.size === 0) {
          const exact = valueOf(a);
          if (exact === null) continue;
          result.checked += 1;
          if (!agrees(exact, b)) {
            flawed = true;
            result.findings.push({ line: raw.slice(0, 160), problem: `${a} is ${show(exact)}, not ${b}`, status: "CONTRADICTED" });
          }
        } else if (parts.length > 2 && sameSet(va, vb)) {
          const same = equivalent(a, b);
          if (same === null) continue;
          result.checked += 1;
          if (!same) {
            flawed = true;
            result.findings.push({ line: raw.slice(0, 160), problem: `${a} and ${b} are not equal for every value of ${[...va].join(", ")}`, status: "CONTRADICTED" });
          }
        }
      }
      // A run of equations in one unknown keeps its solutions from one step to the next (the first and last parts of a chain are its equation).
      const equation = `${parts[0]} = ${parts.at(-1)}`;
      const now = flawed ? null : solutionsOf(equation);
      if (previous && now && previous.variable === now.variable && previous.roots.length) {
        result.checked += 1;
        const gained = now.roots.filter((r) => !previous!.roots.some((p) => sameValue(p, r)));
        if (gained.length) {
          result.findings.push({
            line: raw.slice(0, 160),
            problem: `this step does not follow from the one before: before it ${now.variable} = ${previous.roots.map(show).join(" or ")}, after it ${now.variable} = ${now.roots.map(show).join(" or ")}`,
            status: "CONTRADICTED",
          });
          previous = null;
          continue;
        }
      }
      previous = now;
    }
  }
  return result;
}
