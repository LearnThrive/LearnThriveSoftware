/**
 * Whether a message is asking for something that is better as an interactive interface than as a paragraph. Decided from the message, by rules, so it is
 * predictable, testable and free: an ordinary question ("Explain photosynthesis") is answered in words and is never turned into an interface, and a student
 * who says they do not want one is believed. The model does not decide this; it is only asked to build the interface once the server has.
 *
 * Each kind comes with a line of guidance for the model (the components that suit it), added to the student's message for that turn.
 */
export type InterfaceKind = "graph" | "quiz" | "flashcards" | "diagram" | "comparison" | "timeline" | "worked" | "organiser" | "interactive";

export interface InterfacePlan {
  kind: InterfaceKind;
  /** Written into the turn for the model. Fixed wording chosen here, never copied from the student. */
  guidance: string;
}

const GUIDANCE: Record<InterfaceKind, string> = {
  graph: "Build a graph with FunctionGraph, drawn from formulas. If a number in the formula is worth exploring, declare a $variable, add a Slider and pass it in a Param. Add a short Text and a Callout for what to notice.",
  quiz: "Build a Quiz of 4 or 5 questions (MultipleChoice, and ShortAnswer where the answer is a number or a term) on what was asked. Every answer key must be right. Give each question a hint and an explanation.",
  flashcards: "Build a Flashcards deck of 6 to 10 cards on what was asked: short fronts, short backs, all accurate.",
  diagram: "Build a ProcessDiagram (or a Reaction for a chemical change, or a Timeline for a sequence in time) of what was asked, with only stages and details you are sure of, plus a short Text explaining it.",
  comparison: "Build a Comparison of what was asked, with a row for each point of comparison. For a text being studied, add QuoteCards for one or two short quotations you are sure of.",
  timeline: "Build a Timeline of what was asked, in order, with only events and dates you are sure of.",
  worked: "Build SolutionSteps that reveal the working one step at a time, each step with what is done in words and the working as LaTeX, and the final answer. Check every line of the working.",
  organiser: "Build a KnowledgeOrganiser (or a Checklist) of what was asked: short, accurate points under clear headings.",
  interactive: "Choose the interactive components that best suit what was asked (a graph with a slider, a quiz, flashcards, a diagram, a comparison, step-by-step working) and build a short, accurate interface.",
};

/** Said plainly: no interface, however the rest of the message reads. */
const DECLINES = /\b(no|not|without|don'?t want|do not want|skip|instead of)\b.{0,20}\b(interactive|diagram|graph|quiz|flash ?cards?|chart|table|interface)\b|\b(just|only)\b.{0,12}\b(text|words|an explanation|explain it|a paragraph)\b|\bin (plain )?(words|text)\b/i;

const RULES: Array<[InterfaceKind, RegExp]> = [
  ["quiz", /\bquiz (me|us)\b|\b(give|make|set|create|write)\b.{0,16}\b(a |an )?(quiz|test)\b|\btest (me|my knowledge|us)\b|\bmulti(ple)?[- ]?choice\b|\bmcqs?\b|\bquiz (on|about)\b/i],
  ["flashcards", /\bflash ?cards?\b|\brevision cards?\b/i],
  ["graph", /\b(plot|graph|sketch|draw)\b.{0,50}\b(y\s*=|f\s*\(\s*x\s*\)|x\s*\^|x²|x³|function|curve|parabola|straight line|quadratic|cubic|sine|cosine|sin\b|cos\b|tan\b|exponential|equation|line)\b|\b(plot|graph)\s+(of\s+)?y\s*=/i],
  ["worked", /\b(step[- ]by[- ]step|one step at a time|each step)\b.{0,60}\b(interactive|reveal(ing)?|show me each|one (step )?at a time)\b|\b(interactive|reveal(ing)?)\b.{0,40}\bstep[- ]by[- ]step\b|\breveal(ing)? (the )?(working|steps|solution)\b/i],
  ["comparison", /\bcompare\b.{3,80}\b(and|with|to|vs\.?|versus)\b|\bcomparison (table|chart)\b|\bside[- ]by[- ]side\b|\b(similarities|differences) between\b.{3,80}\b(table|chart)\b|\bcontrast\b.{3,60}\b(and|with)\b/i],
  ["timeline", /\btime ?line\b/i],
  ["diagram", /\b(diagram|flow ?chart|process diagram|cycle diagram)\b|\bshow me (the|how)\b.{0,50}\b(cycle|process|reaction|photosynthesis|respiration|digestion|circulation)\b|\bvisuali[sz]e\b/i],
  ["organiser", /\bknowledge organi[sz]er\b|\brevision (sheet|summary|checklist|plan)\b|\bchecklist\b/i],
  ["interactive", /\binteractive(ly)?\b|\blet me (explore|play|move|change|try)\b|\b(slider|drag)\b/i],
];

/** The plan for a message, or null: answer in words. */
export function planInterface(text: string): InterfacePlan | null {
  const message = text.replace(/\s+/g, " ").trim();
  if (message.length < 8 || message.length > 1500) return null;
  if (DECLINES.test(message)) return null;
  for (const [kind, rule] of RULES) {
    if (!rule.test(message)) continue;
    // Comparing two numbers or two fractions is a sentence, not a table.
    if (kind === "comparison" && /\d/.test(message) && !/\b(poems?|texts?|novels?|plays?|characters?|themes?|essays?|war|act|chapter|sources?|writers?|authors?|poets?)\b/i.test(message)) return null;
    return { kind, guidance: GUIDANCE[kind] };
  }
  return null;
}
