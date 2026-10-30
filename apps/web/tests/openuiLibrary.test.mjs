import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The OpenUI layer, with no model and no browser: the safe formula reader, graph sampling, marking, the stored message format, the component library the model
// is taught, and the validator that decides whether an interface a model wrote may be shown. A fabricated or malformed interface is refused HERE, before any
// student could see it (docs/OPENUI.md).

const math = loadTsFrom(import.meta.url, "../src/lib/openui/mathExpr.ts");
const graph = loadTsFrom(import.meta.url, "../src/lib/openui/graph.ts");
const quiz = loadTsFrom(import.meta.url, "../src/lib/openui/quiz.ts");
const format = loadTsFrom(import.meta.url, "../src/lib/openui/format.ts");
const lib = loadTsFrom(import.meta.url, "../src/lib/openui/library.ts");
const schemas = loadTsFrom(import.meta.url, "../src/lib/openui/schemas.ts");
const check = loadTsFrom(import.meta.url, "../src/lib/openui/validate.ts");

const value = (src, scope = {}, vars = ["x", ...Object.keys(scope)]) => {
  const parsed = math.parseMath(src, vars.filter((v) => v !== "x" || true));
  assert.ok(parsed.ok, `${src}: ${parsed.error}`);
  return math.evaluateMath(parsed.tree, scope);
};

// ---- the formula reader -----------------------------------------------------------------------------------------------------------------

test("formulas: precedence, powers, unary minus and implicit multiplication read as a student would write them", () => {
  assert.equal(value("2+3*4"), 14);
  assert.equal(value("(2+3)*4"), 20);
  assert.equal(value("-x^2", { x: 3 }), -9, "-x^2 is -(x^2)");
  assert.equal(value("2^3^2"), 512, "powers associate to the right");
  assert.equal(value("2x+1", { x: 4 }), 9);
  assert.equal(value("3(x+1)", { x: 2 }), 9);
  assert.equal(value("(x+1)(x-1)", { x: 5 }), 24);
  assert.equal(value("x(x+1)", { x: 3 }), 12);
  assert.equal(value("2sin(x)", { x: Math.PI / 2 }), 2);
  assert.equal(value("a*x^2+b", { x: 2, a: 3, b: 1 }, ["x", "a", "b"]), 13);
  assert.equal(value("ax", { x: 2, a: 3 }, ["x", "a"]), 6, "two allowed names side by side multiply");
  assert.equal(value("x^-2", { x: 2 }), 0.25);
  assert.ok(Math.abs(value("2pi") - 2 * Math.PI) < 1e-12);
  assert.equal(value("sqrt(16)+abs(-3)"), 7);
  assert.equal(value("6 × 7"), 42);
  assert.equal(value("12 ÷ 4 − 1"), 2);
  assert.equal(value("x²+x³", { x: 2 }), 12);
  assert.equal(value("√9"), 3);
  assert.equal(value("2e3"), 2000, "an exponent only when digits follow");
  assert.equal(value("max(2,5)"), 5);
});

test("formulas: a domain error is NaN or infinity, never an exception", () => {
  assert.ok(Number.isNaN(value("sqrt(x)", { x: -1 })));
  assert.equal(value("1/x", { x: 0 }), Infinity);
  assert.ok(Number.isNaN(value("ln(x)", { x: -2 })));
  assert.equal(math.calculate("3/4 + 1/4"), 1);
  assert.equal(math.calculate("1/0"), null);
  assert.equal(math.calculate("x+1"), null, "a variable is not a plain calculation");
});

test("formulas: nothing but numbers, allowed names and the allowlisted functions is ever read, and nothing is executed", () => {
  const hostile = [
    "process.exit()",
    "constructor",
    "__proto__",
    "a.b",
    "x;1",
    "x=1",
    "globalThis",
    "require('fs')",
    "[1,2]",
    "x[0]",
    "`x`",
    "x ? 1 : 2",
    "alert(1)",
    "sin x",
    "sin(",
    "(x",
    "x)",
    "",
    "   ",
    "x +",
    "1 2",
    "fn(x)",
    "sin(x,1)",
    "max(1)",
  ];
  for (const src of hostile) assert.equal(math.parseMath(src, ["x"]).ok, false, JSON.stringify(src));
  assert.equal(math.parseMath("y+1", ["x"]).ok, false, "a name that was not allowed");
  assert.equal(math.parseMath("x".repeat(300), ["x"]).ok, false, "too long");
  assert.equal(math.parseMath("(".repeat(60) + "x" + ")".repeat(60), ["x"]).ok, false, "too deeply nested");
  assert.equal(math.parseMath("x+".repeat(400) + "x", ["x"]).ok, false, "too many parts");
});

// ---- graphs --------------------------------------------------------------------------------------------------------------------------------

test("graphs: a curve is sampled from the formula, a gap is a gap, an asymptote is a break and the window is fitted", () => {
  const parse = (s, vars = ["x"]) => math.parseMath(s, vars).tree;
  const line = graph.sampleCurve(parse("2x+1"), {}, -5, 5, 10);
  assert.equal(line.segments.length, 1);
  assert.deepEqual(line.segments[0][0], [-5, -9]);
  assert.deepEqual(line.segments[0].at(-1), [5, 11]);
  assert.deepEqual(line.range, [-9, 11]);
  // sqrt(x) is undefined for negative x: the points before 0 are simply not there.
  const root = graph.sampleCurve(parse("sqrt(x)"), {}, -4, 4, 8);
  assert.ok(root.segments[0].every(([x]) => x >= 0));
  // 1/x breaks at 0: two runs, never a stroke across the gap.
  const recip = graph.sampleCurve(parse("1/x"), {}, -2, 2, 40, [-10, 10]);
  assert.equal(recip.segments.length, 2);
  assert.ok(recip.segments[0].every(([x]) => x < 0) && recip.segments[1].every(([x]) => x > 0));
  // A parameter moves the curve: the same formula, a different scope, different points.
  const a1 = graph.sampleCurve(parse("a*x", ["x", "a"]), { a: 1 }, 0, 2, 2).segments[0].at(-1);
  const a3 = graph.sampleCurve(parse("a*x", ["x", "a"]), { a: 3 }, 0, 2, 2).segments[0].at(-1);
  assert.deepEqual([a1[1], a3[1]], [2, 6]);
  assert.equal(graph.sampleCurve(parse("x"), {}, 0, 1, 5000).segments[0].length, graph.MAX_SAMPLES + 1, "the number of samples is capped");
  // Undefined everywhere in the window: no curve and no range, not a crash.
  assert.deepEqual(graph.sampleCurve(parse("sqrt(-1-x^2)"), {}, -2, 2, 20), { segments: [], range: null });
  const [lo, hi] = graph.fitY([null], [...Array.from({ length: 100 }, (_, i) => i / 10), 1e9]);
  assert.ok(hi < 20 && lo <= 0, "one point shooting off does not flatten the rest");
  assert.deepEqual(graph.niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.equal(graph.tickLabel(0.1 + 0.2), "0.3");
});

test("graphs: a formula is checked for its names and for being defined somewhere before it is drawn", () => {
  assert.equal(graph.checkGraphFormula("a*x^2", ["a"]).ok, true);
  assert.match(graph.checkGraphFormula("a*x^2", []).error, /not a name/);
  assert.match(graph.checkGraphFormula("sqrt(-1-x^2)", []).error, /not defined/);
  assert.match(graph.checkGraphFormula("system('rm')", []).error, /./);
});

// ---- marking ---------------------------------------------------------------------------------------------------------------------------------

test("marking: a choice is right only if it is the key; a short answer is judged as a marker would, in any usual form of a number", () => {
  assert.equal(quiz.gradeChoice(2, 2), true);
  assert.equal(quiz.gradeChoice(1, 2), false);
  assert.equal(quiz.gradeChoice(null, 0), false);
  assert.equal(quiz.gradeChoice(0.5, 0), false);
  const g = (input, accepted) => quiz.gradeShortAnswer(input, accepted);
  for (const typed of ["3/4", "0.75", " .75 ", "75%", "x = 0.75", "0.750"]) assert.equal(g(typed, ["3/4"]).correct, true, typed);
  assert.equal(g("0.74", ["3/4"]).correct, false);
  assert.equal(g("1,200", ["1200"]).correct, true);
  assert.equal(g("−3", ["-3"]).correct, true);
  assert.equal(g("12 cm", ["12"]).correct, true, "a unit after the number is not part of it");
  assert.equal(g("£4.50", ["4.5"]).correct, true);
  assert.equal(g("Chlorophyll.", ["chlorophyll"]).correct, true);
  assert.equal(g("the Mitochondria", ["mitochondria"]).correct, true);
  assert.equal(g("chloroplast", ["chlorophyll"]).correct, false);
  assert.deepEqual(g("", ["x"]), { correct: false, matched: null, reason: "empty" });
  assert.deepEqual(g("  ", ["x"]), { correct: false, matched: null, reason: "empty" });
  assert.equal(g("0.75", ["3/4", "0.75"]).matched, "3/4");
  assert.equal(quiz.percentage({ correct: 3, total: 4 }), 75);
  assert.equal(quiz.percentage({ correct: 0, total: 0 }), 0);
});

test("marking: an answer key is cross-checked against the calculation when the question is a plain one, and left alone when it is not", () => {
  assert.equal(quiz.auditChoiceKey("What is 6 × 7?", ["36", "42", "48"], 1), null, "a right key passes");
  assert.match(quiz.auditChoiceKey("What is 6 × 7?", ["36", "42", "48"], 0), /comes to 42, which is option 2/);
  assert.match(quiz.auditChoiceKey("What is 6 x 7?", ["36", "40", "48"], 0), /none of the options equals 42/);
  assert.match(quiz.auditChoiceKey("Calculate 3/4 + 1/4", ["1", "1", "2"], 0), /more than one option/);
  assert.equal(quiz.auditChoiceKey("Which is bigger: 3/4 or 2/3?", ["3/4", "2/3"], 1), null, "a question that asks you to choose is not audited");
  assert.equal(quiz.auditChoiceKey("Which gas do plants take in?", ["Oxygen", "Carbon dioxide"], 1), null);
  assert.equal(quiz.auditChoiceKey("What is the capital of France?", ["Paris", "Rome"], 0), null);
  assert.equal(quiz.auditChoiceKey("What is 12 + 5?", ["17", "maths"], 0), null, "options that are not all numbers are not audited");
  assert.equal(quiz.auditShortKey("What is 9 × 9?", ["81"]), null);
  assert.match(quiz.auditShortKey("What is 9 × 9?", ["72", "eighty"]), /comes to 81/);
  assert.equal(quiz.auditShortKey("Name the pigment", ["chlorophyll"]), null);
});

// ---- the stored message format -----------------------------------------------------------------------------------------------------------

const PROGRAM = `root = Answer([t], "Title")\nt = Text("A reasonably long sentence about photosynthesis for the student.")`;

test("format: an interface round-trips with its checked state, and only the marker makes a message an interface", () => {
  const context = { v: 1, verifications: [{ key: "out damned spot", status: "VERIFIED_EXACT", detail: "Found in a primary text that was read.", location: "Act 5 Scene 1", speaker: "Lady Macbeth", source: { title: "Macbeth", host: "shakespeare.mit.edu", url: "https://shakespeare.mit.edu/macbeth/macbeth.5.1.html" } }], sources: [{ title: "Macbeth", host: "shakespeare.mit.edu", url: "https://shakespeare.mit.edu/macbeth/macbeth.5.1.html", tier: "primary text" }] };
  const stored = format.buildInterfaceMessage(PROGRAM, context);
  assert.ok(stored.startsWith("]]>openui:content"));
  assert.ok(format.isInterfaceMessage(stored));
  const back = format.parseStoredMessage(stored);
  assert.equal(back.kind, "interface");
  assert.equal(back.program, PROGRAM);
  assert.equal(back.complete, true);
  assert.equal(back.library, "learnthrive-study@1.0.0");
  assert.deepEqual(back.context, context);
  // Markdown, even Markdown that looks like a program, is Markdown.
  for (const text of ["Hello there", PROGRAM, "```\n" + PROGRAM + "\n```", "  ]]>openui:content\n" + PROGRAM, "Here is ]]>openui:content inside"]) {
    assert.deepEqual(format.parseStoredMessage(text), { kind: "text", text }, text.slice(0, 30));
  }
});

test("format: a stored context that does not look right is an empty one, and nothing in it can carry a script address", () => {
  const empty = { v: 1, verifications: [], sources: [] };
  for (const bad of [null, "text", 42, [], { verifications: "x", sources: 3 }]) assert.deepEqual(format.readContext(bad), empty);
  const read = format.readContext({
    verifications: [
      { key: "k", status: "VERIFIED_EXACT", detail: "ok", source: { title: "t", host: "h", url: "javascript:alert(1)" } },
      { key: "k2", status: "MADE_UP", detail: "x" },
      { key: 7, status: "UNVERIFIED" },
      { key: "k3", status: "PARAPHRASE", detail: "d".repeat(900) },
    ],
    sources: [{ title: "Bad", host: "h", url: "javascript:alert(1)", tier: "x" }, { title: "Good", host: "h", url: "https://example.org/a", tier: "x" }],
  });
  assert.deepEqual(read.verifications.map((v) => [v.key, v.status, "source" in v]), [["k", "VERIFIED_EXACT", false], ["k3", "PARAPHRASE", false]], "an unknown status or a malformed row is dropped, a script address is not kept");
  assert.equal(read.verifications[1].detail.length, 300);
  assert.deepEqual(read.sources.map((s) => s.title), ["Good"]);
});

test("format: the model reads an interface in history as a short description, never as markers or a program, and quotations key the same way however they are spelled", () => {
  const said = format.modelText(format.buildInterfaceMessage(PROGRAM));
  assert.match(said, /^\[LearnThrive AI showed the student an interactive interface\./);
  assert.match(said, /photosynthesis/);
  assert.doesNotMatch(said, /openui|root =|Answer\(/);
  assert.equal(format.modelText("plain answer"), "plain answer");
  assert.match(format.plainTextOf(format.buildInterfaceMessage(PROGRAM)), /photosynthesis/);
  assert.equal(format.quoteKey("“Out, damned spot!”"), format.quoteKey("out damned spot"));
  assert.equal(format.quoteKey("To be, or not to be"), "to be or not to be");
});

// ---- the component library ------------------------------------------------------------------------------------------------------------------

test("library: the prompt teaches every component, the $binding form and the rules, and names no tool or query", () => {
  const prompt = lib.interfacePrompt();
  for (const name of schemas.COMPONENT_NAMES) assert.match(prompt, new RegExp(`\\b${name}\\(`), `${name} is taught`);
  assert.match(prompt, /\$binding<number>/, "a Slider's value is a binding");
  assert.match(prompt, /Your ENTIRE reply must be that program/);
  assert.match(prompt, /never say a quotation is verified|Never describe a quotation as verified/i);
  assert.match(prompt, /FORMULAS in x/);
  assert.doesNotMatch(prompt, /\bQuery\(|\bMutation\(|@Run|@ToAssistant|@OpenUrl/, "no live data, no actions are taught");
  assert.ok(prompt.length < 40_000, `the prompt stays a sensible size (${prompt.length} characters)`);
  assert.equal(lib.interfacePrompt(), prompt, "built once");
  assert.equal(schemas.COMPONENT_NAMES.size, schemas.COMPONENTS.length, "no two components share a name");
  assert.equal(schemas.ROOT, "Answer");
});

test("library: every example the model is taught parses with no errors and passes the same validation as a real answer", () => {
  assert.ok(lib.EXAMPLES.length >= 3);
  for (const example of lib.EXAMPLES) {
    const result = check.validateInterface(example);
    assert.deepEqual(result.issues, [], example.split("\n")[0]);
    assert.deepEqual(result.warnings, []);
    assert.ok(result.components > 3);
  }
});

// ---- the validator ------------------------------------------------------------------------------------------------------------------------

const wrap = (...lines) => ["root = Answer([a, b])", 'a = Text("An introduction long enough to be a real sentence.")', ...lines].join("\n");
const issues = (program) => check.validateInterface(program).issues.map((i) => i.code);

test("validate: a good interface passes, and a fence or a sentence before the program does not matter", () => {
  const good = wrap('b = Callout("Remember to check your working.", "tip")');
  assert.deepEqual(check.validateInterface(good).issues, []);
  assert.deepEqual(check.validateInterface("```openui\n" + good + "\n```").issues, []);
  assert.deepEqual(check.validateInterface("Here is the interface you asked for.\n\n" + good).issues, []);
  assert.equal(check.extractProgram("Sure!\n```\nroot = Answer([])\n```\nHope that helps").trim(), "root = Answer([])");
});

test("validate: a program that does not parse, is cut off, is empty or has no root is refused with a reason the model can act on", () => {
  assert.deepEqual(issues(""), ["empty"]);
  assert.deepEqual(issues("   \n  "), ["empty"]);
  assert.ok(issues('root = Answer([a])\na = Text("an unclosed string that goes on').includes("incomplete"));
  assert.ok(issues("root = Answer([a, b").includes("incomplete"));
  assert.ok(issues(wrap('b = Nope("x")')).includes("unknown-component"));
  const unresolved = check.validateInterface("root = Answer([a, ghost])\na = Text(\"A long enough introduction sentence.\")");
  assert.ok(unresolved.issues.some((i) => i.code === "unresolved" && /ghost/.test(i.message)));
  assert.ok(issues('a = Text("Only a text, no root, but long enough.")').some((c) => c === "no_root" || c === "no-root" || c === "wrong_root"));
  assert.equal(check.validateInterface('root = Text("Not an answer root at all, but long.")').issues.some((i) => i.code === "wrong_root"), true);
  // A statement nothing uses is not an error, only a note.
  const orphan = check.validateInterface(wrap('b = Callout("A note that is long enough to read.")', 'extra = Text("Never used by anything at all here.")'));
  assert.deepEqual(orphan.issues, []);
  assert.match(orphan.warnings[0], /extra/);
});

test("validate: queries, mutations, @ calls, markup that could run and oversized programs are refused outright", () => {
  assert.deepEqual(issues(wrap('b = Query("list_tickets", {}, {})')), ["forbidden_call"]);
  assert.deepEqual(issues(wrap('b = Callout("x long enough text", "tip")', '$v = @Set($v, 1)')), ["forbidden_call"]);
  assert.deepEqual(issues(wrap('b = Button("Go", @OpenUrl("https://evil.example"))')), ["forbidden_call"]);
  assert.ok(issues(wrap('b = Callout("Look <script>alert(1)</script> here please", "tip")')).includes("unsafe_text"));
  assert.ok(issues(wrap('b = Text("Click javascript:alert(1) to continue now")')).includes("unsafe_text"));
  assert.ok(issues(wrap('b = Text("<img src=x onerror=alert(1)> an image that is long enough")')).includes("unsafe_text"));
  assert.ok(issues(wrap(`b = Text("${"x".repeat(1600)}")`)).includes("string_too_long"));
  assert.deepEqual(issues(wrap(`b = Text("${"word ".repeat(5000)}")`)), ["too_long"]);
  // A string that merely MENTIONS an @ name is text, not a call.
  assert.deepEqual(check.validateInterface(wrap('b = Callout("Email me at a@b.com about this please.", "tip")')).issues, []);
});

test("validate: a graph's formulas must parse, use only x and its own parameters, and be defined somewhere", () => {
  const graphWith = (fn, extra = "") => wrap(`b = FunctionGraph([GraphFunction("${fn}")], -5, 5${extra})`);
  assert.deepEqual(issues(graphWith("x^2-4")), []);
  assert.deepEqual(issues(graphWith("2x+1")), []);
  assert.ok(issues(graphWith("process.exit()")).includes("graph_formula"));
  assert.ok(issues(graphWith("a*x^2")).includes("graph_formula"), "a is not a Param");
  assert.ok(issues(graphWith("sqrt(-1-x^2)")).includes("graph_formula"));
  assert.deepEqual(issues(wrap('$a = 1', 'b = FunctionGraph([GraphFunction("a*x^2")], -5, 5, [Param("a", $a)])')), []);
  assert.ok(issues(wrap('b = FunctionGraph([GraphFunction("x")], 5, -5)')).includes("graph_window"));
  assert.ok(issues(wrap('b = FunctionGraph([GraphFunction("x")], -5, 5, null, null, 3)')).includes("graph_window_y"));
  assert.ok(issues(wrap('b = FunctionGraph([GraphFunction("x")], -5, 5, [Param("xx", 1)])')).includes("param_name"));
  assert.ok(issues(wrap('b = FunctionGraph([GraphFunction("x")], -5, 5, [Param("a", 1), Param("a", 2)])')).includes("param_duplicate"));
  assert.ok(issues(wrap('b = FunctionGraph([GraphFunction("x"), GraphFunction("x+1"), GraphFunction("x+2"), GraphFunction("x+3"), GraphFunction("x+4")], -5, 5)')).includes("graph_functions"));
});

test("validate: a quiz's answer key must be inside the options and agree with the calculation when it can be checked", () => {
  const q = (line) => wrap("b = Quiz([q])", line);
  const ok = q('q = MultipleChoice("What is 6 × 7?", ["36", "42", "48"], 1, "Count in sixes.", "6 × 7 = 42.")');
  assert.deepEqual(issues(ok), []);
  assert.ok(issues(q('q = MultipleChoice("What is 6 × 7?", ["36", "42", "48"], 0)')).includes("choice_key_wrong"), "a wrong key is rejected, not shown");
  assert.ok(issues(q('q = MultipleChoice("What is 6 × 7?", ["36", "40", "48"], 1)')).includes("choice_key_wrong"));
  assert.ok(issues(q('q = MultipleChoice("Pick one", ["a", "b"], 5)')).includes("choice_key"));
  assert.ok(issues(q('q = MultipleChoice("Pick one", ["a", "b"], 1.5)')).includes("choice_key"));
  assert.ok(issues(q('q = MultipleChoice("Pick one", ["a", "A"], 0)')).includes("choice_duplicate"));
  assert.ok(issues(q('q = MultipleChoice("Pick one", ["only"], 0)')).includes("choice_options"));
  assert.deepEqual(issues(q('q = ShortAnswer("What is 9 × 9?", ["81"])')), []);
  assert.ok(issues(q('q = ShortAnswer("What is 9 × 9?", ["72"])')).includes("short_key_wrong"));
  assert.ok(issues(q('q = ShortAnswer("Name it", [])')).includes("short_accepted"));
  assert.ok(issues(wrap("b = Quiz([])")).includes("quiz_size"));
});

test("validate: tables are rectangular, comparisons have a cell for every column, probabilities add to one", () => {
  assert.deepEqual(issues(wrap('b = DataTable(["A", "B"], [["1", "2"], ["3", "4"]])')), []);
  assert.ok(issues(wrap('b = DataTable(["A", "B"], [["1"]])')).includes("table_shape"));
  assert.deepEqual(issues(wrap('b = Comparison(["X", "Y"], [r])', 'r = ComparisonRow("Theme", ["one", "two"])')), []);
  assert.ok(issues(wrap('b = Comparison(["X", "Y"], [r])', 'r = ComparisonRow("Theme", ["only one"])')).includes("comparison_cells"));
  const tree = (p1, p2, c1, c2) => wrap(`b = ProbabilityTree([r, w])`, `r = ProbBranch("Red", ${p1}, [ProbLeaf("Red", ${c1}), ProbLeaf("Blue", ${c2})])`, `w = ProbBranch("Blue", ${p2})`);
  assert.deepEqual(issues(tree(0.4, 0.6, 0.5, 0.5)), []);
  assert.ok(issues(tree(0.4, 0.5, 0.5, 0.5)).includes("probability_sum"), "first stage adds to 0.9");
  assert.ok(issues(tree(0.4, 0.6, 0.5, 0.4)).includes("probability_sum"), "second stage adds to 0.9");
  assert.ok(issues(tree(1.4, -0.4, 0.5, 0.5)).includes("probability_range"));
  assert.deepEqual(issues(wrap('b = Triangle(3, 4, 5)')), []);
  assert.ok(issues(wrap('b = Triangle(1, 2, 5)')).includes("triangle_inequality"));
  assert.ok(issues(wrap('b = DataChart("bar", ["a", "b"], [s])', 's = Series("n", [1, 2, 3])')).includes("chart_length"));
  assert.deepEqual(issues(wrap('b = DataChart("bar", ["a", "b"], [s])', 's = Series("n", [1, 2])')), []);
  assert.ok(issues(wrap('b = DataChart("scatter", ["a", "b"], [s])', 's = Series("n", [1, 2])')).includes("chart_scatter"));
  assert.ok(issues(wrap('b = Slider("a", "A", 5, 1, 1)')).includes("slider_range"));
});

test("validate: a symbol equation must balance, and a quotation is collected for checking with its work and speaker", () => {
  assert.deepEqual(issues(wrap('b = Reaction(["6CO2", "6H2O"], ["C6H12O6", "6O2"], "light, chlorophyll")')), []);
  assert.ok(issues(wrap('b = Reaction(["CO2", "H2O"], ["C6H12O6", "O2"])')).includes("reaction_unbalanced"));
  const quoted = check.validateInterface(wrap('b = QuoteCard("Out, damned spot!", "Macbeth", "Lady Macbeth", "Act 5, Scene 1")'));
  assert.deepEqual(quoted.issues, []);
  assert.deepEqual(quoted.quotes, [{ statementId: "b", quote: "Out, damned spot!", work: "Macbeth", speaker: "Lady Macbeth", location: "Act 5, Scene 1" }]);
  assert.ok(issues(wrap('b = QuoteCard("Out", "Macbeth")')).includes("quote_short"));
  assert.ok(issues(wrap(`b = QuoteCard("${"word ".repeat(70)}", "Macbeth")`)).includes("quote_long"));
  assert.ok(issues(wrap('b = QuoteCard("Out, damned spot!", "")')).includes("quote_work"));
});

test("validate: a repair request names the statement and the problem, and stays bounded", () => {
  const checked = check.validateInterface(wrap('b = Quiz([q])', 'q = MultipleChoice("What is 6 × 7?", ["36", "42", "48"], 0)'));
  const text = check.repairInstruction(checked.issues);
  assert.match(text, /- q \(MultipleChoice\): "What is 6 × 7\?": the answer key says option 1/);
  assert.match(text, /Write the WHOLE interface again/);
  const many = Array.from({ length: 30 }, (_, i) => ({ code: "x", message: `problem ${i}` }));
  assert.equal(check.repairInstruction(many).split("\n").filter((l) => l.startsWith("- ")).length, 8);
});
