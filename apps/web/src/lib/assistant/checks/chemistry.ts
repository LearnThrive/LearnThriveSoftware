import type { EvidenceStatus } from "./evidence";

/**
 * Checks that the chemical equations in a reply balance: the same number of each kind of atom on both sides, and the same total charge. It is
 * arithmetic on the formulae, so it needs no source and no model. It reads symbol equations only (2H2 + O2 -> 2H2O, Cu^{2+} + 2e^- -> Cu, \ce{...},
 * subscripts written as _2 or as small digits); a word equation, or anything with a symbol that is not an element, is left alone.
 */
export interface EquationFinding {
  line: string;
  problem: string;
  status: EvidenceStatus;
}

export interface EquationCheck {
  checked: number;
  findings: EquationFinding[];
}

const ELEMENTS = new Set(
  "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr".split(" "),
);

const SUB: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };
const SUP: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "-" };
const ARROW = /\s*(?:\\(?:long)?rightarrow|\\rightleftharpoons|\\leftrightharpoons|\\to\b|-{1,2}>|<=>|→|⟶|⇌|⇀)\s*/;

/** Plain text a formula parser can read: no LaTeX wrappers, ordinary digits for subscripts, `^n+` for a charge. */
function normalise(text: string): string {
  let s = text;
  for (let pass = 0; pass < 3; pass += 1) s = s.replace(/\\(?:ce|mathrm|text|rm)\s*\{([^{}]*)\}/g, "$1");
  s = s.replace(/\$/g, "");
  s = s.replace(/[₀-₉]/g, (c) => SUB[c] ?? c).replace(/[⁰-⁹⁺⁻]+/g, (run) => `^${[...run].map((c) => SUP[c] ?? c).join("")}`);
  s = s.replace(/_\{?(\d+)\}?/g, "$1");
  s = s.replace(/\^\{([^{}]*)\}/g, "^$1");
  s = s.replace(/\\cdot|·|•/g, "·");
  return s.replace(ARROW, " → ").replace(/\s+/g, " ").trim();
}

type Counts = Map<string, number>;

/** Atoms in a formula ("Ca(OH)2", "CuSO4·5H2O", "[Fe(CN)6]"), or null if it is not one. */
function atoms(formula: string): Counts | null {
  const counts: Counts = new Map();
  const parts = formula.split("·");
  for (const rawPart of parts) {
    const lead = /^(\d+)(?=[A-Z([])/.exec(rawPart);
    const times = lead ? Number(lead[1]) : 1;
    const part = lead ? rawPart.slice(lead[0].length) : rawPart;
    const stack: Counts[] = [new Map()];
    let i = 0;
    while (i < part.length) {
      const c = part[i]!;
      if (c === "(" || c === "[") {
        stack.push(new Map());
        i += 1;
      } else if (c === ")" || c === "]") {
        if (stack.length < 2) return null;
        const group = stack.pop()!;
        const m = /^\d+/.exec(part.slice(i + 1));
        const n = m ? Number(m[0]) : 1;
        i += 1 + (m ? m[0].length : 0);
        const top = stack.at(-1)!;
        for (const [el, k] of group) top.set(el, (top.get(el) ?? 0) + k * n);
      } else {
        const m = /^([A-Z][a-z]?)(\d*)/.exec(part.slice(i));
        if (!m || !ELEMENTS.has(m[1]!)) return null;
        const top = stack.at(-1)!;
        top.set(m[1]!, (top.get(m[1]!) ?? 0) + (m[2] ? Number(m[2]) : 1));
        i += m[0].length;
      }
    }
    if (stack.length !== 1) return null;
    for (const [el, k] of stack[0]!) counts.set(el, (counts.get(el) ?? 0) + k * times);
  }
  return counts.size ? counts : null;
}

interface Species {
  coefficient: number;
  atoms: Counts;
  charge: number;
}

/** One species: an optional coefficient, a formula or an electron, an optional charge and state symbol. */
function species(token: string): Species | null {
  let s = token.trim().replace(/\((?:s|l|g|aq)\)$/i, "").trim();
  const coef = /^(\d+(?:\/\d+)?|\d*\.\d+)\s*/.exec(s);
  let coefficient = 1;
  if (coef) {
    const [n, d] = coef[1]!.split("/");
    coefficient = d ? Number(n) / Number(d) : Number(n);
    s = s.slice(coef[0].length);
  }
  if (!s || !Number.isFinite(coefficient) || coefficient <= 0) return null;
  // A charge is "^2+" (from ^{2+} or a superscript) or a bare sign ("Na+", "OH-"). A digit before a bare sign ("Fe3+", "SO42-") could be a
  // subscript or a charge, so that species is not read at all rather than read wrongly.
  const charged = /^(.+?)(?:\^(\d*)([+-])|([+-]))$/.exec(s);
  let charge = 0;
  if (charged) {
    if (charged[4] && /\d$/.test(charged[1]!)) return null;
    const sign = charged[3] ?? charged[4];
    charge = (charged[2] ? Number(charged[2]) : 1) * (sign === "+" ? 1 : -1);
    s = charged[1]!;
  }
  if (s === "e") return { coefficient, atoms: new Map(), charge: charge || -1 };
  const counted = atoms(s.replace(/\^$/, ""));
  return counted ? { coefficient, atoms: counted, charge } : null;
}

/** The species on one side of an arrow, or null if any part is not a formula. A bare number before a formula is its coefficient. */
function side(tokens: string[]): Species[] | null {
  const out: Species[] = [];
  let pending = "";
  for (const token of tokens) {
    if (token === "+") continue;
    if (/^\d+(?:\/\d+)?$/.test(token)) {
      pending = token;
      continue;
    }
    const parsed = species(pending + token);
    pending = "";
    if (!parsed) return null;
    out.push(parsed);
  }
  return out.length && !pending ? out : null;
}

const looksLikeSpecies = (token: string) => token === "+" || /^\d+(?:\/\d+)?$/.test(token) || species(token) !== null;

/** The symbol equations in a reply: the formula-like words either side of each arrow. */
export function symbolEquations(answer: string): Array<{ text: string; left: string[]; right: string[] }> {
  const found: Array<{ text: string; left: string[]; right: string[] }> = [];
  for (const raw of answer.split(/\n|(?<=[.!?])\s+(?=[A-Z])/)) {
    const line = normalise(raw);
    const pieces = line.split(" → ");
    if (pieces.length !== 2) continue;
    const before = pieces[0]!.split(" ").filter(Boolean);
    const after = pieces[1]!.split(" ").filter(Boolean).map((t) => t.replace(/[.,;:]+$/, ""));
    const left: string[] = [];
    for (let k = before.length - 1; k >= 0 && looksLikeSpecies(before[k]!); k -= 1) left.unshift(before[k]!);
    const right: string[] = [];
    for (const token of after) {
      if (!looksLikeSpecies(token)) break;
      right.push(token);
    }
    // A side that stops just after a "+" lost a species it could not read ("Fe3+ + 3e-"): judging the rest would be judging half an equation.
    if (left[0] === "+" || right.at(-1) === "+") continue;
    if (left.length && right.length) found.push({ text: `${left.join(" ")} → ${right.join(" ")}`, left, right });
  }
  return found;
}

const total = (list: Species[]) => {
  const counts: Counts = new Map();
  let charge = 0;
  for (const s of list) {
    for (const [el, k] of s.atoms) counts.set(el, (counts.get(el) ?? 0) + k * s.coefficient);
    charge += s.charge * s.coefficient;
  }
  return { counts, charge };
};

export function checkEquations(answer: string): EquationCheck {
  const result: EquationCheck = { checked: 0, findings: [] };
  for (const eq of symbolEquations(answer).slice(0, 8)) {
    const left = side(eq.left);
    const right = side(eq.right);
    if (!left || !right) continue;
    // A lone "B -> C" is more likely a label than chemistry: judge only an equation with a number in it or three species.
    if (!/\d/.test(eq.text) && left.length + right.length < 3) continue;
    result.checked += 1;
    const l = total(left);
    const r = total(right);
    const elements = [...new Set([...l.counts.keys(), ...r.counts.keys()])];
    const off = elements.filter((el) => Math.abs((l.counts.get(el) ?? 0) - (r.counts.get(el) ?? 0)) > 1e-9);
    const parts = off.map((el) => `${el}: ${+(l.counts.get(el) ?? 0).toFixed(3)} on the left, ${+(r.counts.get(el) ?? 0).toFixed(3)} on the right`);
    if (Math.abs(l.charge - r.charge) > 1e-9) parts.push(`charge: ${l.charge} on the left, ${r.charge} on the right`);
    if (parts.length) result.findings.push({ line: eq.text, problem: `it does not balance (${parts.join("; ")})`, status: "CONTRADICTED" });
  }
  return result;
}
