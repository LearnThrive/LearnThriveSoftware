import type { ElementNode, OpenUIError } from "@openuidev/lang-core";
import { checkEquations } from "@/lib/assistant/checks/chemistry";
import { checkGraphFormula } from "./graph";
import { parser } from "./library";
import { auditChoiceKey, auditShortKey } from "./quiz";
import { COMPONENT_NAMES } from "./schemas";

/**
 * Whether an interface the model wrote may be shown. The model's program is untrusted until this says otherwise, and it says so only for a program that
 *
 *   - parses against the library with no errors, is complete, and refers to nothing that is not defined;
 *   - stays small (characters, statements, components, nesting), so no reply can be a way to exhaust a student's browser;
 *   - contains no query, mutation, action or `@` call of any kind: the only actions are the ones the page's own components fire;
 *   - carries no markup that could run (script, frames, `javascript:` addresses) in any string;
 *   - passes the checks that make it TRUE: every formula parses and is defined, every answer key agrees with the calculation it can be checked against,
 *     tables are rectangular, probabilities add to one, a symbol equation balances.
 *
 * The checks return sentences written for the model to act on (the repair request quotes them), so each names the statement it is about.
 */
export interface Issue {
  /** Machine word for tests and logs. */
  code: string;
  message: string;
  statementId?: string;
  component?: string;
}

export interface QuoteRequest {
  statementId?: string;
  quote: string;
  work: string;
  speaker: string | null;
  location: string | null;
}

export interface Checked {
  ok: boolean;
  /** The program that was checked (fences and leading prose removed). */
  program: string;
  issues: Issue[];
  /** Fine to show, worth knowing: statements defined but never used. */
  warnings: string[];
  components: number;
  quotes: QuoteRequest[];
}

export const LIMITS = { chars: 20_000, statements: 300, components: 260, depth: 8, string: 1_500, quoteWords: 60 } as const;

/** The program inside a reply: the contents of a code fence if there is one, else the text from the first statement on. */
export function extractProgram(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n");
  const fenced = [...text.matchAll(/```[A-Za-z-]*\n([\s\S]*?)```/g)].map((m) => m[1]!);
  const body = fenced.length ? fenced.join("\n") : text.replace(/```[A-Za-z-]*\s*$/m, "");
  const lines = body.split("\n");
  const first = lines.findIndex((line) => /^\s*\$?[A-Za-z_][A-Za-z_0-9]*\s*=/.test(line));
  return (first > 0 ? lines.slice(first) : lines).join("\n").trim();
}

const stripStrings = (s: string) => s.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
const DANGEROUS = /<\s*(?:script|iframe|object|embed|style|link|meta|svg|img)\b|\bon[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html|vbscript\s*:/i;
const isState = (v: unknown): boolean => Boolean(v) && typeof v === "object" && (v as { k?: unknown }).k === "StateRef";
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

type Props = Record<string, unknown>;
const elements = (v: unknown): ElementNode[] => (Array.isArray(v) ? v.filter((x): x is ElementNode => Boolean(x) && typeof x === "object" && (x as ElementNode).type === "element") : []);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === "string");

export function validateInterface(raw: string): Checked {
  const program = extractProgram(raw);
  const issues: Issue[] = [];
  const warnings: string[] = [];
  const quotes: QuoteRequest[] = [];
  const add = (code: string, message: string, at?: ElementNode | { statementId?: string; typeName?: string }) => issues.push({ code, message, ...(at?.statementId ? { statementId: at.statementId } : {}), ...(at && "typeName" in at && at.typeName ? { component: at.typeName } : {}) });
  const done = (components: number): Checked => ({ ok: issues.length === 0, program, issues, warnings, components, quotes });

  if (!program) {
    add("empty", "The reply contained no interface. Write the program, starting with root = Answer([...]).");
    return done(0);
  }
  if (program.length > LIMITS.chars) {
    add("too_long", `The interface is ${program.length} characters long; the most allowed is ${LIMITS.chars}. Make it smaller: fewer blocks, shorter text.`);
    return done(0);
  }
  const code = stripStrings(program);
  if ((code.match(/^\s*\$?[A-Za-z_][A-Za-z_0-9]*\s*=/gm) ?? []).length > LIMITS.statements) {
    add("too_many_statements", `The interface has more than ${LIMITS.statements} statements. Make it smaller.`);
    return done(0);
  }
  if (/\b(?:Query|Mutation)\s*\(|@[A-Za-z]/.test(code)) {
    add("forbidden_call", "The interface used a Query, a Mutation or an @ call. None of these exist here: use only the listed components, and write $variables only for a Slider.");
    return done(0);
  }

  const result = parser.parse(program);
  const meta = result.meta;
  if (meta.incomplete) add("incomplete", "The interface was cut off before it finished (an unclosed bracket or quote). Write the whole program again, shorter if needed.");
  for (const e of meta.errors as OpenUIError[]) {
    if (e.severity === "warning") continue;
    add(e.code, `${e.message}${e.hint ? ` ${e.hint}` : ""}`, { statementId: e.statementId, typeName: e.component });
  }
  if (meta.unresolved.length) add("unresolved", `These names are used but never defined: ${meta.unresolved.slice(0, 6).join(", ")}. Define each one on its own line, or remove the reference.`);
  if (meta.orphaned.length) warnings.push(`Defined but never used: ${meta.orphaned.slice(0, 6).join(", ")}.`);
  if (!result.root) {
    add("no_root", "The interface has no root. Start with root = Answer([...]).");
    return done(0);
  }
  if (result.root.typeName !== "Answer") add("wrong_root", `The root must be an Answer, not a ${result.root.typeName}.`, result.root);

  let components = 0;
  let overflow = false;
  const visit = (node: ElementNode, depth: number) => {
    components += 1;
    if (components > LIMITS.components && !overflow) {
      overflow = true;
      add("too_many_components", `The interface has more than ${LIMITS.components} components. Make it smaller.`);
    }
    if (depth > LIMITS.depth) {
      add("too_deep", `Components are nested more than ${LIMITS.depth} levels deep (at ${node.statementId ?? node.typeName}).`, node);
      return;
    }
    const p = node.props as Props;
    for (const [key, value] of Object.entries(p)) {
      const scan = (v: unknown) => {
        if (typeof v === "string") {
          if (v.length > LIMITS.string) add("string_too_long", `A text in ${node.typeName}.${key} is ${v.length} characters; the most allowed is ${LIMITS.string}. Shorten it.`, node);
          if (DANGEROUS.test(v)) add("unsafe_text", `A text in ${node.typeName}.${key} contains markup or an address that cannot be shown. Write plain text only.`, node);
        } else if (Array.isArray(v)) v.forEach(scan);
      };
      scan(value);
    }
    check(node, p);
    for (const value of Object.values(p)) for (const child of elements(value)) visit(child, depth + 1);
  };

  const check = (node: ElementNode, p: Props) => {
    const at = node;
    switch (node.typeName) {
      case "Answer": {
        if (elements(p.children).length === 0) add("empty_answer", "The Answer has no blocks. Add a Text and at least one other block.", at);
        break;
      }
      case "Slider": {
        const { min, max, step } = p as { min: unknown; max: unknown; step: unknown };
        if (!finite(min) || !finite(max) || min >= max) add("slider_range", `Slider "${String(p.name)}": min must be less than max.`, at);
        else if (step !== undefined && step !== null && (!finite(step) || step <= 0 || (max - min) / step > 1000)) add("slider_step", `Slider "${String(p.name)}": step must be positive and give at most 1000 positions.`, at);
        break;
      }
      case "FunctionGraph": {
        const fns = elements(p.functions);
        const params = elements(p.params);
        const names = params.map((q) => String((q.props as Props).name ?? ""));
        if (fns.length === 0 || fns.length > 4) add("graph_functions", "A FunctionGraph needs between 1 and 4 GraphFunctions.", at);
        if (params.length > 4) add("graph_params", "A FunctionGraph may have at most 4 Params.", at);
        for (const q of params) {
          const name = String((q.props as Props).name ?? "");
          const v = (q.props as Props).value;
          if (!/^[A-DF-WYZa-df-wyz]$/.test(name)) add("param_name", `Param "${name}": a parameter name must be one letter other than x and e (a, b, c, k, m...).`, q);
          if (!finite(v) && !isState(v)) add("param_value", `Param "${name}": the value must be a number or a $variable.`, q);
        }
        if (new Set(names).size !== names.length) add("param_duplicate", "Two Params have the same name.", at);
        for (const q of fns) {
          const expression = (q.props as Props).expression;
          const checked = typeof expression === "string" ? checkGraphFormula(expression, names) : ({ ok: false, error: "the formula is missing" } as const);
          if (!checked.ok) add("graph_formula", `GraphFunction "${String(expression)}": ${checked.error}. Write a formula in x, like 2x+1 or x^2-4, using ^ for powers.`, q);
        }
        const { xMin, xMax, yMin, yMax } = p as { xMin: unknown; xMax: unknown; yMin: unknown; yMax: unknown };
        if (!finite(xMin) || !finite(xMax) || xMin >= xMax || xMax - xMin > 1e6) add("graph_window", "FunctionGraph: xMin must be less than xMax (and the window no wider than a million).", at);
        if ((yMin !== undefined && yMin !== null) !== (yMax !== undefined && yMax !== null)) add("graph_window_y", "FunctionGraph: give both yMin and yMax, or neither.", at);
        else if (finite(yMin) && finite(yMax) && yMin >= yMax) add("graph_window_y", "FunctionGraph: yMin must be less than yMax.", at);
        const points = elements(p.points);
        if (points.length > 12) add("graph_points", "A FunctionGraph may mark at most 12 points.", at);
        for (const q of points) if (!finite((q.props as Props).x) || !finite((q.props as Props).y)) add("graph_point", "A GraphPoint needs a number for x and for y.", q);
        break;
      }
      case "NumberLine": {
        const { min, max } = p as { min: unknown; max: unknown };
        const marks = list(p.marks);
        if (!finite(min) || !finite(max) || min >= max) add("line_range", "NumberLine: min must be less than max.", at);
        else if (marks.some((m) => !finite(m) || m < min || m > max)) add("line_marks", "NumberLine: every mark must be a number between min and max.", at);
        if (marks.length > 12) add("line_marks", "NumberLine: at most 12 marks.", at);
        break;
      }
      case "Triangle": {
        const { a, b, c } = p as { a: unknown; b: unknown; c: unknown };
        if (![a, b, c].every((v) => finite(v) && v > 0)) add("triangle_sides", "Triangle: the three sides must be positive numbers.", at);
        else if ((a as number) + (b as number) <= (c as number) || (a as number) + (c as number) <= (b as number) || (b as number) + (c as number) <= (a as number)) add("triangle_inequality", `Triangle: sides ${a}, ${b} and ${c} cannot make a triangle (two sides must add up to more than the third).`, at);
        break;
      }
      case "DataChart": {
        const labels = strs(p.labels);
        const series = elements(p.series);
        if (labels.length === 0 || labels.length > 30) add("chart_labels", "DataChart: between 1 and 30 labels.", at);
        if (series.length === 0 || series.length > 4) add("chart_series", "DataChart: between 1 and 4 series.", at);
        for (const s of series) {
          const values = list((s.props as Props).values);
          if (values.length !== labels.length) add("chart_length", `Series "${String((s.props as Props).name)}" has ${values.length} values for ${labels.length} labels. Give one number for each label.`, s);
          else if (values.some((v) => !finite(v))) add("chart_values", `Series "${String((s.props as Props).name)}" has a value that is not a number.`, s);
        }
        if (p.kind === "scatter" && labels.some((l) => !Number.isFinite(Number(l)))) add("chart_scatter", "A scatter chart needs every label to be a number.", at);
        break;
      }
      case "ProbabilityTree": {
        const sum = (items: ElementNode[]) => items.reduce((n, q) => n + Number((q.props as Props).p), 0);
        const first = elements(p.branches);
        for (const q of [...first, ...first.flatMap((b) => elements((b.props as Props).then))]) {
          const v = (q.props as Props).p;
          if (!finite(v) || v < 0 || v > 1) add("probability_range", `Probability ${String(v)} for "${String((q.props as Props).label)}" is not between 0 and 1.`, q);
        }
        if (first.length < 2) add("probability_branches", "A ProbabilityTree needs at least two first-stage outcomes.", at);
        else if (Math.abs(sum(first) - 1) > 0.001) add("probability_sum", `The first-stage probabilities add up to ${Number(sum(first).toFixed(4))}, not 1.`, at);
        for (const b of first) {
          const then = elements((b.props as Props).then);
          if (then.length && Math.abs(sum(then) - 1) > 0.001) add("probability_sum", `After "${String((b.props as Props).label)}" the second-stage probabilities add up to ${Number(sum(then).toFixed(4))}, not 1.`, b);
        }
        break;
      }
      case "Reaction": {
        const reactants = strs(p.reactants);
        const products = strs(p.products);
        if (!reactants.length || !products.length) add("reaction_sides", "Reaction: give at least one reactant and one product.", at);
        else {
          const equation = `${reactants.join(" + ")} -> ${products.join(" + ")}`;
          const found = checkEquations(equation).findings[0];
          if (found) add("reaction_unbalanced", `The reaction ${equation} ${found.problem}. Balance it.`, at);
        }
        break;
      }
      case "ProcessDiagram": {
        const n = elements(p.stages).length;
        if (n < 2 || n > 8) add("process_stages", "A ProcessDiagram needs between 2 and 8 stages.", at);
        break;
      }
      case "Comparison": {
        const columns = strs(p.columns);
        if (columns.length < 1 || columns.length > 4) add("comparison_columns", "A Comparison needs between 1 and 4 columns.", at);
        for (const row of elements(p.rows)) {
          const cells = list((row.props as Props).cells);
          if (cells.length !== columns.length) add("comparison_cells", `Row "${String((row.props as Props).label)}" has ${cells.length} cells but the comparison has ${columns.length} columns.`, row);
        }
        if (elements(p.rows).length === 0 || elements(p.rows).length > 12) add("comparison_rows", "A Comparison needs between 1 and 12 rows.", at);
        break;
      }
      case "DataTable": {
        const headers = strs(p.headers);
        const rows = list(p.rows);
        if (headers.length === 0 || headers.length > 8 || rows.length > 30) add("table_size", "A DataTable needs 1 to 8 headers and at most 30 rows.", at);
        rows.forEach((row, i) => {
          if (!Array.isArray(row) || row.length !== headers.length) add("table_shape", `DataTable row ${i + 1} has ${Array.isArray(row) ? row.length : 0} cells but there are ${headers.length} headers.`, at);
        });
        break;
      }
      case "Timeline": {
        const n = elements(p.events).length;
        if (n === 0 || n > 20) add("timeline_size", "A Timeline needs between 1 and 20 events.", at);
        break;
      }
      case "Steps":
      case "SolutionSteps": {
        const n = elements(node.typeName === "Steps" ? p.items : p.steps).length;
        if (n === 0 || n > 14) add("steps_size", `${node.typeName} needs between 1 and 14 steps.`, at);
        break;
      }
      case "Flashcards": {
        const n = elements(p.cards).length;
        if (n === 0 || n > 30) add("flashcards_size", "Flashcards needs between 1 and 30 cards.", at);
        break;
      }
      case "Checklist": {
        const n = strs(p.items).length;
        if (n === 0 || n > 20) add("checklist_size", "A Checklist needs between 1 and 20 items.", at);
        break;
      }
      case "FollowUps": {
        const q = strs(p.questions);
        if (q.length === 0 || q.length > 4) add("followups_size", "FollowUps needs between 1 and 4 questions.", at);
        if (q.some((x) => x.length > 120)) add("followups_long", "Each follow-up question must be under 120 characters.", at);
        break;
      }
      case "Tabs": {
        const n = elements(p.tabs).length;
        if (n < 2 || n > 4) add("tabs_size", "Tabs needs between 2 and 4 TabPanels.", at);
        break;
      }
      case "Accordion": {
        const n = elements(p.items).length;
        if (n === 0 || n > 8) add("accordion_size", "An Accordion needs between 1 and 8 items.", at);
        break;
      }
      case "Quiz": {
        const n = elements(p.questions).length;
        if (n === 0 || n > 8) add("quiz_size", "A Quiz needs between 1 and 8 questions.", at);
        break;
      }
      case "MultipleChoice": {
        const options = strs(p.options);
        const answer = p.answer;
        const prompt = String(p.prompt ?? "");
        if (options.length < 2 || options.length > 6) add("choice_options", `"${prompt.slice(0, 60)}": give between 2 and 6 options.`, at);
        else if (new Set(options.map((o) => o.trim().toLowerCase())).size !== options.length) add("choice_duplicate", `"${prompt.slice(0, 60)}": two options are the same.`, at);
        if (!finite(answer) || !Number.isInteger(answer) || answer < 0 || answer >= options.length) add("choice_key", `"${prompt.slice(0, 60)}": answer must be the position of the right option, counting from 0 (0 to ${Math.max(0, options.length - 1)}).`, at);
        else {
          const audit = auditChoiceKey(prompt, options, answer);
          if (audit) add("choice_key_wrong", `"${prompt.slice(0, 60)}": ${audit}.`, at);
        }
        break;
      }
      case "ShortAnswer": {
        const accepted = strs(p.accepted);
        const prompt = String(p.prompt ?? "");
        if (accepted.length === 0 || accepted.length > 10 || accepted.some((a) => !a.trim())) add("short_accepted", `"${prompt.slice(0, 60)}": list between 1 and 10 accepted answers.`, at);
        else {
          const audit = auditShortKey(prompt, accepted);
          if (audit) add("short_key_wrong", `"${prompt.slice(0, 60)}": ${audit}.`, at);
        }
        break;
      }
      case "QuoteCard": {
        const quote = String(p.quote ?? "").trim();
        const work = String(p.work ?? "").trim();
        if (wordCount(quote) < 2) add("quote_short", "A QuoteCard quotation must be at least two words.", at);
        if (wordCount(quote) > LIMITS.quoteWords) add("quote_long", `A QuoteCard quotation is ${wordCount(quote)} words; keep each to ${LIMITS.quoteWords} or fewer (a few words to one sentence).`, at);
        if (!work) add("quote_work", "A QuoteCard needs the title of the work it comes from.", at);
        quotes.push({ statementId: node.statementId, quote, work, speaker: typeof p.speaker === "string" && p.speaker.trim() ? p.speaker.trim() : null, location: typeof p.location === "string" && p.location.trim() ? p.location.trim() : null });
        break;
      }
      default:
        if (!COMPONENT_NAMES.has(node.typeName)) add("unknown_component", `${node.typeName} is not a component. Use only the listed ones.`, at);
    }
  };

  visit(result.root, 0);
  if (quotes.length > 8) add("too_many_quotes", "More than 8 QuoteCards. Keep the most useful few.");
  return done(components);
}

/** The model's repair instruction: what was wrong, in the model's own terms, and what to send back. Bounded so it cannot grow without end. */
export function repairInstruction(issues: readonly Issue[]): string {
  const lines = issues.slice(0, 8).map((i) => `- ${i.statementId ? `${i.statementId}${i.component ? ` (${i.component})` : ""}: ` : ""}${i.message}`);
  return `The interface you wrote could not be shown, for these reasons:\n${lines.join("\n")}\n\nWrite the WHOLE interface again as one openui-lang program with those problems fixed. Reply with the program only.`;
}
