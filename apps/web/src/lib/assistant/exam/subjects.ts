/**
 * Subjects the tutor reasons about differently. A maths answer is checked by working; a literature answer is argued from the text and its exact
 * words; a science answer is marked against points and units; a history answer is causation and evidence. Each profile carries the words that
 * identify it and the habits of mind that answer should follow, which are added to the instructions for that turn only.
 */
export type SubjectId =
  | "maths"
  | "english_literature"
  | "english_language"
  | "biology"
  | "chemistry"
  | "physics"
  | "history"
  | "geography"
  | "computer_science"
  | "business"
  | "languages"
  | "religious_studies"
  | "psychology";

export interface SubjectProfile {
  id: SubjectId;
  label: string;
  /** Strong signs: one is enough (a set text, the subject's name). */
  strong: RegExp;
  /** Weaker signs: two or more together point to the subject. */
  weak: RegExp;
  /** How an answer in this subject should be reasoned and written. */
  strategy: readonly string[];
  /** What to check before an answer in this subject is given. */
  checks: readonly string[];
}

export const SUBJECTS: readonly SubjectProfile[] = [
  {
    id: "maths",
    label: "Maths",
    strong: /\b(?:maths?|mathematics|algebra|geometry|trigonometry|simultaneous equations?|quadratics?|pythagoras|standard form|probability|vectors?|surds?|indices|sequences?)\b/i,
    weak: /\b(?:solve|equation|factoris\w*|expand|simplif\w*|gradient|fraction|percentage|ratio|angle|area|volume|perimeter|mean|median|graph|calculate|value of|hence|prove that|show that)\b|\d\s*[+\-×x*/÷^=]\s*\d/i,
    strategy: [
      "Show each step of the working, one line per step, and state the answer with its unit and a sensible degree of accuracy.",
      "Use the method the question asks for. Give the answer a student would be awarded marks for, not only the final number.",
      "Where a question says 'show that' or 'prove', end on the stated result, and do not work backwards from it.",
    ],
    checks: ["Check arithmetic with the check_calculation tool before stating a numeric result you are unsure of.", "Substitute the answer back into the question to see that it fits."],
  },
  {
    id: "english_literature",
    label: "English Literature",
    strong: /\b(?:macbeth|an inspector calls|inspector calls|a christmas carol|christmas carol|jekyll and hyde|dr jekyll|romeo and juliet|othello|much ado|the tempest|julius caesar|animal farm|lord of the flies|of mice and men|blood brothers|jane eyre|pride and prejudice|great expectations|frankenstein|power and conflict|ozymandias|english literature|lit(?:erature)? paper)\b/i,
    weak: /\b(?:quotations?|quote|ao[1-4]|theme|themes|character|characters|writer'?s? (?:methods|intentions)|language analysis|imagery|symbolism|context|essay|paragraph|PEE|PEEL|point evidence|stanza|soliloquy|protagonist|motif|foreshadow\w*|metaphor|simile|dramatic irony)\b/i,
    strategy: [
      "Argue from the text. Make a point, support it with a short exact quotation, then analyse the writer's choice of language, form or structure, and link it to the question.",
      "Only quote words you are certain are in the text. If you are not certain of the exact wording, say so and describe the moment instead of inventing a quotation.",
      "Give the act, scene, chapter or stanza for a quotation only when you are sure of it, and attribute it to the right speaker.",
      "Context (when and why the work was written, and the audience's world) must be tied to the question, not added as a separate history lesson.",
    ],
    checks: ["Check who says each quotation and where it is, and that every character relationship you state is the one in the text.", "Do not describe events that are not in the text."],
  },
  {
    id: "english_language",
    label: "English Language",
    strong: /\b(?:english language|language paper|descriptive writing|narrative writing|transactional writing|viewpoint writing|source a|source b|unseen (?:text|extract))\b/i,
    weak: /\b(?:question [1-5]|paper [12]|inference|structure|perspective|methods|writer's|purpose|audience|persuasive|speech|article|letter|SPaG|punctuation|vocabulary|sentence)\b/i,
    strategy: [
      "Answer exactly what each question asks (find, explain, analyse, compare, evaluate, write) and stay within the extract or the task.",
      "For writing tasks, plan briefly, then write to the stated purpose and audience, varying sentence structure and vocabulary on purpose.",
    ],
    checks: ["Quote only from the extract given.", "Match the length and depth of the answer to the marks."],
  },
  {
    id: "biology",
    label: "Biology",
    strong: /\b(?:biology|photosynthesis|mitosis|meiosis|osmosis|enzymes?|ecosystems?|dna|natural selection|homeostasis|respiration|cells?|genetics|digestion|pathogen)\b/i,
    weak: /\b(?:organism|species|gene|chromosome|membrane|nutrient|stomata|neurone|hormone|antibod\w*|bacteria|virus|food chain)\b/i,
    strategy: ["Use the correct biological terms and link cause to effect step by step (what changes, so what happens, why).", "Include the units, the conditions, and the control variables when describing an experiment."],
    checks: ["Do not mix up similar terms (diffusion/osmosis, mitosis/meiosis, aerobic/anaerobic)."],
  },
  {
    id: "chemistry",
    label: "Chemistry",
    strong: /\b(?:chemistry|moles?|ionic|covalent|titration|periodic table|electrolysis|reactivity series|alkanes?|alkenes?|oxidation|reduction|atomic structure|bonding)\b/i,
    weak: /\b(?:acid|alkali|compound|element|molecule|reaction|equation|concentration|mass|ion|isotope|catalyst|exothermic|endothermic|yield)\b/i,
    strategy: ["Balance every equation and include state symbols when asked.", "Show mole and concentration calculations step by step with units, and round only at the end."],
    checks: ["Check that equations balance and charges add up.", "Check calculations with check_calculation."],
  },
  {
    id: "physics",
    label: "Physics",
    strong: /\b(?:physics|velocity|acceleration|newton'?s? laws?|momentum|circuit|voltage|resistance|wavelength|frequency|kinetic energy|gravitational|half-life|radioactiv\w*)\b/i,
    weak: /\b(?:force|energy|power|current|speed|distance|time|mass|density|pressure|wave|magnetic|electric|joules?|watts?|newtons?)\b/i,
    strategy: ["Start from the equation, substitute with units, rearrange if needed, then give the answer with its unit.", "Convert units before substituting (cm to m, minutes to seconds, kilo to base)."],
    checks: ["Check units on both sides of every equation.", "Check calculations with check_calculation."],
  },
  {
    id: "history",
    label: "History",
    strong: /\b(?:history|treaty of versailles|cold war|nazi germany|weimar|world war (?:one|two|1|2|i|ii)|wwi|wwii|industrial revolution|tudors?|elizabeth i|norman conquest|suffrag\w*|civil rights|source (?:is|a|b|c) (?:useful|utility))\b/i,
    weak: /\b(?:cause|causes|consequence|significance|change and continuity|how far do you agree|source|interpretation|reliab\w*|utility|historian|era|dynasty|empire|revolution)\b/i,
    strategy: ["Support every claim with specific, dated, named evidence, and explain how it leads to the point (cause, effect, significance).", "For 'how far' questions, weigh at least two factors and reach a judgement with reasons."],
    checks: ["Do not state a date, name or number you are not sure of; say that it should be checked."],
  },
  {
    id: "geography",
    label: "Geography",
    strong: /\b(?:geography|tectonic|erosion|coastal|river basin|urbanisation|climate change|ecosystem|deforestation|glaciation)\b/i,
    weak: /\b(?:population|migration|development|resources|hazard|flood|earthquake|case study|renewable)\b/i,
    strategy: ["Use a named case study with place-specific facts whenever the question allows, and link physical or human processes to their effects."],
    checks: ["Do not invent statistics; say when a figure should be checked."],
  },
  {
    id: "computer_science",
    label: "Computer Science",
    strong: /\b(?:computer science|algorithms?|pseudocode|python|binary|hexadecimal|sql|boolean|logic gates?|networks?|cpu|sorting|searching|big o|programming)\b/i,
    weak: /\b(?:variable|loop|array|function|string|integer|database|input|output|syntax|debug|code)\b/i,
    strategy: ["Trace code by hand, line by line, with the values of the variables, before stating what it outputs.", "Use the exam board's pseudocode style when answering in pseudocode."],
    checks: ["Check the code you write by tracing it on the example in the question."],
  },
  {
    id: "business",
    label: "Business and Economics",
    strong: /\b(?:business studies|economics|supply and demand|inflation|gdp|profit margin|cash flow|marketing mix|stakeholders?|opportunity cost)\b/i,
    weak: /\b(?:revenue|cost|price|market|demand|supply|competition|customer|interest rate|budget)\b/i,
    strategy: ["Apply every point to the business or context in the question, and develop it: point, because, so what, therefore."],
    checks: ["Use the figures in the case and show the calculation."],
  },
  {
    id: "languages",
    label: "Modern Languages",
    strong: /\b(?:spanish|french|german|italian|mandarin|translate into|in (?:spanish|french|german)|gcse (?:spanish|french|german))\b/i,
    weak: /\b(?:vocabulary|verb|tense|conjugat\w*|gender|adjective agreement|preterite|imperfect|subjunctive)\b/i,
    strategy: ["Give the target-language answer first, then a short English gloss, and check agreement, tense and spelling.", "Use only structures a student at this level can reproduce."],
    checks: ["Check verb endings, gender and agreement before replying."],
  },
  {
    id: "religious_studies",
    label: "Religious Studies",
    strong: /\b(?:religious studies|christianity|islam|judaism|buddhism|hinduism|sikhism|ethics|philosophy of religion)\b/i,
    weak: /\b(?:belief|teachings?|scripture|sacred|worship|moral|afterlife|evil|free will)\b/i,
    strategy: ["Give accurate beliefs and teachings with their source (scripture, authority), show the range of views within a tradition, and weigh arguments before judging."],
    checks: ["Name the source of a teaching only if you are sure of it."],
  },
  {
    id: "psychology",
    label: "Psychology",
    strong: /\b(?:psychology|milgram|zimbardo|bandura|loftus|memory model|attachment theory|cognitive approach|behaviourism)\b/i,
    weak: /\b(?:study|participants|sample|variable|ethics|experiment|conformity|obedience|bias|reliab\w*|validity)\b/i,
    strategy: ["Describe studies with their aim, method, results and conclusion, and evaluate with named strengths and limitations tied to the study."],
    checks: ["Do not invent sample sizes or findings."],
  },
];

export const subjectById = (id: SubjectId): SubjectProfile => SUBJECTS.find((s) => s.id === id)!;

/** Scores every subject for a text: a strong sign is worth three, each weak sign one. */
export function scoreSubjects(text: string): Array<{ id: SubjectId; score: number }> {
  return SUBJECTS.map((s) => {
    const strong = (text.match(new RegExp(s.strong.source, "gi")) ?? []).length;
    const weak = new Set((text.match(new RegExp(s.weak.source, "gi")) ?? []).map((m) => m.toLowerCase())).size;
    return { id: s.id, score: Math.min(strong, 3) * 3 + Math.min(weak, 4) };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}
