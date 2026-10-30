import { defineComponent, markReactive } from "@openuidev/lang-core";
import { z } from "zod/v4";

/**
 * LearnThrive's interactive-answer components: WHAT a model may ask for, with no React in it. The server builds its prompt and its validator from these
 * definitions (library.ts); the browser draws them (components/openui/library.tsx). They are the same objects, so the model is taught exactly the
 * vocabulary the page can draw, and a component that is not here cannot be drawn.
 *
 * Arguments are positional, in the key order of `props`: required first, optional last. A prop that is added later goes at the END and has a default, so a
 * stored interface keeps drawing (a stored response has no argument names; position is the meaning).
 */
export const LIBRARY_ID = "learnthrive-study";
export const LIBRARY_VERSION = "1.0.0";
export const ROOT = "Answer";

const defs = <T extends z.ZodObject>(name: string, description: string, props: T) => defineComponent({ name, description, props, component: null as unknown });

/** A prop that may be written as a $variable the page keeps and the user changes (a slider's value). */
function binding<T extends z.ZodType>(schema: T): T {
  markReactive(schema);
  return schema;
}

const str = z.string();
const num = z.number();
const strings = z.array(z.string());

// ---- parts (never at the top level) ----------------------------------------------------------------------------------------------------

export const GraphFunction = defs("GraphFunction", "One curve on a graph. `expression` is a formula in x (and in the names of the graph's Params): 2x+1, x^2-4, sin(x), 1/x, sqrt(x), a*x^2+b. Use ^ for powers and * or a bracket for products. NEVER write coordinates: the page draws the curve from the formula. `label` names it in the key.", z.object({ expression: str, label: str.optional() }));
export const GraphPoint = defs("GraphPoint", "A marked point (an intercept, a turning point, a data value) with an optional label. Only mark points you have worked out; for a point ON a curve, give the x and y the formula really has.", z.object({ x: num, y: num, label: str.optional() }));
export const Param = defs("Param", "A named number a graph's formulas may use (the a in a*x^2). Give it the $variable of a Slider so the student can change it and watch the curve move; or a plain number.", z.object({ name: str, value: num }));
export const Series = defs("Series", "One data series: a name and one number for each label of the chart.", z.object({ name: str, values: z.array(num) }));
export const ComparisonRow = defs("ComparisonRow", "One row of a comparison: a label for the row, then one short piece of text for each column (same number of cells as the comparison has columns).", z.object({ label: str, cells: strings }));
export const TimelineEvent = defs("TimelineEvent", "One event: when it happened (a date or a short phrase), a title and an optional detail.", z.object({ when: str, title: str, detail: str.optional() }));
export const Step = defs("Step", "One numbered step: a short title and a sentence or two.", z.object({ title: str, detail: str }));
export const SolutionStep = defs("SolutionStep", "One step of a worked solution: what is done in words (`say`), the working as LaTeX without dollar signs (`math`), and an optional `hint` shown before the step is revealed.", z.object({ say: str, math: str.optional(), hint: str.optional() }));
export const ProbLeaf = defs("ProbLeaf", "The second stage of a probability tree: an outcome and its probability (0 to 1) given the first stage.", z.object({ label: str, p: num }));
export const ProbBranch = defs("ProbBranch", "The first stage of a probability tree: an outcome and its probability (0 to 1). `then` lists the second-stage outcomes; their probabilities must add up to 1. The first-stage probabilities must add up to 1.", z.object({ label: str, p: num, then: z.array(ProbLeaf.ref).optional() }));
export const ProcessStage = defs("ProcessStage", "One stage of a process: its name, a short explanation, what goes in and what comes out (short names, e.g. glucose, oxygen).", z.object({ name: str, detail: str.optional(), inputs: strings.optional(), outputs: strings.optional() }));
export const MultipleChoice = defs("MultipleChoice", "A multiple-choice question. `answer` is the position of the correct option, counting from 0. Give 3 or 4 distinct options with exactly one correct. Add a `hint` (a nudge that does not give the answer away) and an `explanation` (why the right option is right).", z.object({ prompt: str, options: strings, answer: num, hint: str.optional(), explanation: str.optional() }));
export const ShortAnswer = defs("ShortAnswer", "A question with a short fixed answer (a number, a word, a term). `accepted` lists every form of the right answer you will accept (\"3/4\", \"0.75\", \"75%\"). Add a `hint`, an `explanation` and the `unit` if there is one. Do not use for answers that need judging (use OpenResponse).", z.object({ prompt: str, accepted: strings, hint: str.optional(), explanation: str.optional(), unit: str.optional() }));
export const Flashcard = defs("Flashcard", "One flashcard: a prompt on the front and the answer on the back. Keep both short.", z.object({ front: str, back: str }));
export const AOItem = defs("AOItem", "One assessment objective (for example \"AO1\" or \"AO2: language\") with a comment on how well the work meets it, and optionally a level or band in words.", z.object({ objective: str, comment: str, level: str.optional() }));
export const OrganiserSection = defs("OrganiserSection", "One section of a knowledge organiser: a heading and a few short points.", z.object({ heading: str, points: strings }));

// ---- blocks ------------------------------------------------------------------------------------------------------------------------------

export const Heading = defs("Heading", "A heading. `level` 1 is the biggest, 3 the smallest (default 2).", z.object({ text: str, level: num.optional() }));
export const Text = defs("Text", "A paragraph or short list in Markdown, with maths between $ signs ($x^2 + 3x = 0$). Use for explanation. No HTML, no links.", z.object({ markdown: str }));
export const Callout = defs("Callout", "A highlighted note. `tone` is info (default), tip, warning (a common mistake) or success.", z.object({ text: str, tone: z.enum(["info", "tip", "warning", "success"]).optional() }));
export const Equation = defs("Equation", "One displayed equation or formula as LaTeX WITHOUT dollar signs (for example x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}), with an optional caption.", z.object({ latex: str, caption: str.optional() }));
export const DataTable = defs("DataTable", "A table: column headers, then rows of short text (every row has one cell per header). For a comparison of ideas use Comparison instead.", z.object({ headers: strings, rows: z.array(strings), caption: str.optional() }));
export const Comparison = defs("Comparison", "Compare two or three things side by side: the column names, then one ComparisonRow for each point of comparison (theme, technique, structure, cause, effect...).", z.object({ columns: strings, rows: z.array(ComparisonRow.ref), title: str.optional() }));
export const Timeline = defs("Timeline", "Events in order.", z.object({ events: z.array(TimelineEvent.ref), title: str.optional() }));
export const Steps = defs("Steps", "A numbered sequence: an essay plan, a method, a revision plan.", z.object({ items: z.array(Step.ref), title: str.optional() }));
export const Checklist = defs("Checklist", "A list of things the student can tick off (revision topics, things to check in an answer).", z.object({ items: strings, title: str.optional() }));
export const FollowUps = defs("FollowUps", "Two or three short questions the student might ask next. Each is a button that asks it. Keep each under 80 characters.", z.object({ questions: strings }));
export const Slider = defs("Slider", "A slider the student moves. `name` is its identifier, `label` what it changes. Declare `$variable = start` and pass the $variable as `value` so a graph's Param (or any expression) can use it.", z.object({ name: str, label: str, min: num, max: num, step: num.optional(), value: binding(num.optional()) }));
export const FunctionGraph = defs("FunctionGraph", "A graph of one or more formulas in x on a window from xMin to xMax. The page draws the curves from the formulas, so they are exact. `params` makes the graph interactive (see Param and Slider). `points` marks worked-out points. Give yMin and yMax only if you need a particular window.", z.object({ functions: z.array(GraphFunction.ref), xMin: num, xMax: num, params: z.array(Param.ref).optional(), title: str.optional(), yMin: num.optional(), yMax: num.optional(), points: z.array(GraphPoint.ref).optional() }));
export const NumberLine = defs("NumberLine", "A number line from `min` to `max` with the numbers in `marks` shown on it (for example for inequalities, fractions, negatives). `step` is the tick spacing.", z.object({ min: num, max: num, marks: z.array(num), step: num.optional(), title: str.optional() }));
export const Triangle = defs("Triangle", "A triangle drawn to scale from its three side lengths (it must be possible: any two sides add up to more than the third). The page works out and labels the angles.", z.object({ a: num, b: num, c: num, title: str.optional() }));
export const DataChart = defs("DataChart", "A chart of data. `kind` is bar, line or scatter (for scatter, every label is a number). `labels` are the x values or categories; each Series has one number per label. Use real data from the question or the sources only.", z.object({ kind: z.enum(["bar", "line", "scatter"]), labels: strings, series: z.array(Series.ref), xLabel: str.optional(), yLabel: str.optional(), title: str.optional() }));
export const ProbabilityTree = defs("ProbabilityTree", "A two-stage probability tree. The page multiplies along the branches. Probabilities are numbers from 0 to 1.", z.object({ branches: z.array(ProbBranch.ref), title: str.optional() }));
export const ProcessDiagram = defs("ProcessDiagram", "A process shown as connected stages (photosynthesis, the water cycle, the carbon cycle, digestion). Only include stages and inputs/outputs you are sure of; if you are not sure of the detail, use a Table or Steps instead.", z.object({ stages: z.array(ProcessStage.ref), title: str.optional(), note: str.optional() }));
export const Reaction = defs("Reaction", "A chemical or word equation: reactants, products, and the conditions above the arrow. Write formulas plainly (6CO2 + 6H2O): digits after a letter become subscripts. A symbol equation must be balanced; the server checks it.", z.object({ reactants: strings, products: strings, conditions: str.optional(), title: str.optional() }));
export const QuoteCard = defs("QuoteCard", "A quotation from a text being studied. `work` is the title of the play, poem, novel or text. The page shows whether the quotation was CHECKED against the real text (the server does that, not you), so never claim it is verified yourself. Quote only words you are sure are in the text, a few words to one sentence, and name the speaker if you know it.", z.object({ quote: str, work: str, speaker: str.optional(), location: str.optional(), technique: str.optional(), note: str.optional() }));
export const AOFeedback = defs("AOFeedback", "Feedback on a student's own answer against assessment objectives. It is shown as AI feedback, not an exam board mark: do not state a mark or grade as if it were official.", z.object({ items: z.array(AOItem.ref), title: str.optional() }));
export const SolutionSteps = defs("SolutionSteps", "A worked solution the student reveals one step at a time. Put the final answer in `answer`. Use for 'explain step by step' and worked examples.", z.object({ steps: z.array(SolutionStep.ref), answer: str.optional(), title: str.optional() }));
export const Flashcards = defs("Flashcards", "A deck of flashcards the student flips and moves through.", z.object({ cards: z.array(Flashcard.ref), title: str.optional() }));
export const Quiz = defs("Quiz", "A quiz marked in the page: the student answers, submits, sees feedback, may ask for a hint, and gets a score at the end. Use 3 to 6 questions of MultipleChoice and ShortAnswer. The answer key is checked, so it must be right.", z.object({ questions: z.array(z.union([MultipleChoice.ref, ShortAnswer.ref])), title: str.optional() }));
export const OpenResponse = defs("OpenResponse", "A question whose answer is written in the student's own words and cannot be marked by a key. The student can send their answer to LearnThrive AI for feedback. `guidance` says what a good answer includes.", z.object({ prompt: str, guidance: str.optional() }));
export const KnowledgeOrganiser = defs("KnowledgeOrganiser", "A one-page summary of a topic as titled sections of short points.", z.object({ sections: z.array(OrganiserSection.ref), title: str.optional() }));

const LEAVES = [Heading, Text, Callout, Equation, DataTable, Comparison, Timeline, Steps, Checklist, FollowUps, Slider, FunctionGraph, NumberLine, Triangle, DataChart, ProbabilityTree, ProcessDiagram, Reaction, QuoteCard, AOFeedback, SolutionSteps, Flashcards, Quiz, OpenResponse, KnowledgeOrganiser] as const;
const leaf = z.union(LEAVES.map((c) => c.ref) as unknown as [(typeof LEAVES)[0]["ref"], (typeof LEAVES)[1]["ref"], ...Array<(typeof LEAVES)[number]["ref"]>]);

export const Card = defs("Card", "A titled box that groups other blocks (not other cards).", z.object({ title: str, children: z.array(leaf), subtitle: str.optional() }));
export const TabPanel = defs("TabPanel", "One tab: its label and its blocks.", z.object({ label: str, children: z.array(leaf) }));
export const Tabs = defs("Tabs", "Tabs for alternative views of the same thing (two representations, two methods). Two to four TabPanels.", z.object({ tabs: z.array(TabPanel.ref) }));
export const AccordionItem = defs("AccordionItem", "One expandable section: its title and its blocks. `open` starts it expanded.", z.object({ title: str, children: z.array(leaf), open: z.boolean().optional() }));
export const Accordion = defs("Accordion", "Expandable sections, for detail the student may want to open (a worked example, a definition, extra practice).", z.object({ items: z.array(AccordionItem.ref) }));

const BLOCKS = [...LEAVES, Card, Tabs, Accordion] as const;
const block = z.union(BLOCKS.map((c) => c.ref) as unknown as [(typeof BLOCKS)[0]["ref"], (typeof BLOCKS)[1]["ref"], ...Array<(typeof BLOCKS)[number]["ref"]>]);

export const Answer = defs("Answer", "The root of every interface. A short `title`, if useful, then the blocks in the order a student should read them. Start with one or two sentences of Text before any interactive block, and end with FollowUps.", z.object({ children: z.array(block), title: str.optional() }));

const PARTS = [GraphFunction, GraphPoint, Param, Series, ComparisonRow, TimelineEvent, Step, SolutionStep, ProbLeaf, ProbBranch, ProcessStage, MultipleChoice, ShortAnswer, Flashcard, AOItem, OrganiserSection, TabPanel, AccordionItem] as const;

/** Every component, root first. */
export const COMPONENTS = [Answer, ...BLOCKS, ...PARTS] as const;
export type ComponentName = (typeof COMPONENTS)[number]["name"];
export const COMPONENT_NAMES: ReadonlySet<string> = new Set(COMPONENTS.map((c) => c.name));

export const COMPONENT_GROUPS = [
  { name: "Layout and text", components: ["Answer", "Heading", "Text", "Callout", "Card", "Tabs", "TabPanel", "Accordion", "AccordionItem", "FollowUps"], notes: ["Every interface starts with `root = Answer([...])`. Open with a sentence of Text, then the interactive blocks, then FollowUps."] },
  { name: "Maths", components: ["Equation", "SolutionSteps", "SolutionStep", "Slider", "FunctionGraph", "GraphFunction", "GraphPoint", "Param", "NumberLine", "Triangle", "DataChart", "Series", "ProbabilityTree", "ProbBranch", "ProbLeaf"], notes: ["Graphs are drawn from formulas, never from coordinates you write. To let the student change a number, declare `$a = 1`, add Slider(\"a\", \"label\", min, max, step, $a) and pass Param(\"a\", $a) to the graph."] },
  { name: "Science", components: ["ProcessDiagram", "ProcessStage", "Reaction", "DataTable", "Timeline", "TimelineEvent", "Comparison", "ComparisonRow", "DataChart"], notes: ["Do not invent structures, stages or data. If a diagram cannot be drawn accurately with these, use a DataTable or Steps."] },
  { name: "English", components: ["QuoteCard", "Comparison", "ComparisonRow", "Timeline", "TimelineEvent", "Steps", "Step", "AOFeedback", "AOItem"], notes: ["The page checks quotations against the real text. Quote only words you are sure of, keep them short, and never say a quotation is verified."] },
  { name: "Revision", components: ["Quiz", "MultipleChoice", "ShortAnswer", "OpenResponse", "Flashcards", "Flashcard", "Checklist", "KnowledgeOrganiser", "OrganiserSection", "SolutionSteps", "SolutionStep"], notes: ["Quiz answer keys are checked by the server; a wrong key is rejected."] },
];
