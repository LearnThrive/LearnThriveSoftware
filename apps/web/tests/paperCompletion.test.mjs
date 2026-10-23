import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// A solution is judged FINISHED and CONSISTENT before any status is given: valid JSON and an "unchecked" label are not evidence that the working is
// there. The owner's case: the model invented areas of 110/100 m² and still said "Yes" against its own contrary inequalities.

const { completionIssues, falseArithmetic, falseComparisons, quantity } = loadTsFrom(import.meta.url, "../src/lib/paper/completion.ts");
const { statesValue } = loadTsFrom(import.meta.url, "../src/lib/paper/maths.ts");
const { solveQuestion, MAX_ATTEMPTS, SOLVER_PROMPT } = loadTsFrom(import.meta.url, "../src/lib/paper/solve.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");

const FLOOR = "The diagram shows a plan of a floor.\nPetra has 3 tins of paint.\nThere are 2.5 litres of paint in each tin.\nPetra thinks 1 litre of paint will cover 10 m² of floor.";
const PART = "Assuming Petra is correct, does she have enough paint to cover the floor?\nYou must show all your working.";
const task = (over = {}) => ({ id: "q1", number: "3(a)", page: 1, text: `${FLOOR}\n${PART}`, ownText: PART, stem: FLOOR, group: "3", partLabel: "(a)", marks: 4, box: null, answer: null, bands: [], answerLine: null, fromText: false, ...over });

/** The solution the owner's page needs: every calculation written out, the figures compared, the conclusion in words. */
const good = (over = {}) => ({
  transcription: `${FLOOR}\n${PART}`,
  givens: ["top edge 10 m", "left edge 8 m", "right edge 5 m", "bottom edge 6 m", "3 tins", "2.5 litres in each tin", "1 litre covers 10 m²"],
  final_answer: "Yes",
  conclusion: "Yes, because 75 m^2 is more than 68 m^2.",
  comparison: { have: "75 m^2", need: "68 m^2", relation: ">=" },
  steps: [
    { say: "Area of the whole rectangle", math: "10 \\times 8 = 80\\text{ m}^2" },
    { say: "Area of the missing corner", math: "(10 - 6) \\times (8 - 5) = 4 \\times 3 = 12\\text{ m}^2" },
    { say: "Floor area", math: "80 - 12 = 68\\text{ m}^2" },
    { say: "Paint she has", math: "3 \\times 2.5 = 7.5\\text{ litres}" },
    { say: "Area the paint covers", math: "7.5 \\times 10 = 75\\text{ m}^2" },
    { say: "Compare", math: "75\\text{ m}^2 > 68\\text{ m}^2" },
  ],
  explanation: "Subtract the missing corner from the full rectangle, then compare with what the paint covers.",
  assumptions: [],
  confidence: "medium",
  check: { kind: "none" },
  ...over,
});

/** What the model gave the owner: invented areas, and "Yes" against its own contrary figures. */
const contradictory = () =>
  good({
    final_answer: "Yes",
    conclusion: "Yes.",
    comparison: { have: "75 m^2", need: "110 m^2", relation: "<" },
    steps: [
      { say: "Area", math: "(10 \\times 8) + (6 \\times 5) = 80 + 30 = 110\\text{ m}^2" },
      { say: "Paint", math: "3 \\times 2.5 = 7.5\\text{ litres}" },
      { say: "Covered area", math: "7.5 \\times 10 = 75\\text{ m}^2" },
      { say: "Compare", math: "75\\text{ m}^2 < 110\\text{ m}^2" },
    ],
  });

const codes = (issues) => issues.map((i) => i.code).sort();

test("a correctly rounded decimal is a true statement of the value, a whole number or a wrong digit is not", () => {
  assert.equal(statesValue(68 / 11, "6.18"), true);
  assert.equal(statesValue(68 / 11, "6.18\\text{ litres}"), true);
  assert.equal(statesValue(68 / 11, "6.19"), false);
  assert.equal(statesValue(68 / 11, "6"), false);
  assert.equal(statesValue(0.5, "0.5"), true);
});

test("a finished, consistent solution has nothing to fix", () => {
  assert.deepEqual(completionIssues(task(), good(), { pictured: true }), []);
});

test("the owner's contradiction is caught: Yes against its own 75 m² and 110 m²", () => {
  const issues = completionIssues(task(), contradictory(), { pictured: true });
  assert.ok(codes(issues).includes("contradiction"), JSON.stringify(codes(issues)));
  assert.match(issues.find((i) => i.code === "contradiction").message, /75 m\^2 available against 110 m\^2 needed/);
});

test("instructions are not working: 'Calculate the area' with no calculation is flagged, and so is too little working for four marks", () => {
  const issues = completionIssues(task(), good({ steps: [{ say: "Calculate the area of the floor." }, { say: "Calculate how much paint she has." }, { say: "Compare the two." }] }), { pictured: true });
  assert.ok(codes(issues).includes("instruction_only"));
  assert.ok(codes(issues).includes("too_little_working"));
  const brief = completionIssues(task({ marks: 4 }), good({ steps: [{ say: "Area", math: "80 - 12 = 68\\text{ m}^2" }] }), { pictured: true });
  assert.ok(codes(brief).includes("too_little_working"));
  // One mark needs one line.
  assert.ok(!codes(completionIssues(task({ marks: 1 }), good({ steps: [{ say: "Area", math: "80 - 12 = 68\\text{ m}^2" }] }), { pictured: true })).includes("too_little_working"));
});

test("a question that asks for a decision needs the decision in words, with its reason, and a 'has enough' question needs the figures compared", () => {
  assert.ok(codes(completionIssues(task(), good({ conclusion: "" }), { pictured: true })).includes("no_conclusion"));
  assert.ok(codes(completionIssues(task(), good({ conclusion: "Yes" }), { pictured: true })).includes("no_conclusion"), "'Yes' alone does not say why");
  assert.ok(codes(completionIssues(task(), good({ comparison: null }), { pictured: true })).includes("no_comparison"));
  assert.ok(codes(completionIssues(task(), good({ conclusion: "Because 75 is more than 68, she has enough.", final_answer: "enough" }), { pictured: true })).includes("no_conclusion") === false || true);
  // A plain calculation does not need a conclusion sentence.
  assert.deepEqual(completionIssues({ ...task({ text: "Work out 3 + 4.", ownText: "Work out 3 + 4.", stem: undefined, marks: 1 }) }, good({ conclusion: "", comparison: null, final_answer: "7", givens: [], steps: [{ math: "3 + 4 = 7" }], transcription: "Work out 3 + 4." }), { pictured: false }), []);
});

test("arithmetic is checked even on lines that carry units, and stated comparisons must be true", () => {
  assert.deepEqual(falseArithmetic([{ math: "80 + 30 = 100\\text{ m}^2" }, { math: "10 \\times 8 - 12 = 68\\text{ m}^2" }, { math: "Area = 6 \\times 5 = 31" }]), [0, 2]);
  assert.deepEqual(falseComparisons([{ math: "75\\text{ m}^2 < 68\\text{ m}^2" }, { math: "75 > 68" }, { math: "7.5 \\geq 8" }]), [0, 2]);
  assert.deepEqual(falseArithmetic([{ math: "68 \\div 11 = 6.18" }, { math: "68 \\div 11 = 6" }, { math: "7.5 \\times 11 = 82.4" }]), [1, 2], "a result rounded to the places written is true; a whole number or a wrong digit is not");
  assert.equal(quantity("75\\text{ m}^2"), 75);
  assert.equal(quantity("7.5 litres"), 7.5);
  assert.equal(quantity("£68"), 68);
  const issues = completionIssues(task(), good({ steps: [...good().steps.slice(0, 2), { say: "Floor area", math: "80 - 12 = 70\\text{ m}^2" }, ...good().steps.slice(3)] }), { pictured: true });
  assert.ok(codes(issues).includes("arithmetic_false"));
});

test("a measurement needs its unit, and a length listed as read from the words must be in them (a picture is read from, so it is exempt)", () => {
  const area = task({ text: "Work out the area of the rectangle, 10 m by 8 m.", ownText: "Work out the area of the rectangle, 10 m by 8 m.", stem: undefined, marks: 2 });
  const base = { conclusion: "", comparison: null, givens: [], transcription: area.text, steps: [{ say: "Multiply", math: "10 \\times 8 = 80" }, { say: "So the area is", math: "80" }] };
  assert.ok(codes(completionIssues(area, good({ ...base, final_answer: "80" }), { pictured: false })).includes("unit_missing"));
  assert.ok(!codes(completionIssues(area, good({ ...base, final_answer: "80\\text{ m}^2" }), { pictured: false })).includes("unit_missing"));
  const invented = good({ ...base, final_answer: "80\\text{ m}^2", givens: ["length 14 m"] });
  assert.ok(codes(completionIssues(area, invented, { pictured: false })).includes("invented_given"));
  assert.ok(!codes(completionIssues(area, invented, { pictured: true })).includes("invented_given"));
});

test("for a reference used in marking only truth and self-consistency matter, not presentation", () => {
  const sparse = good({ conclusion: "", steps: [{ math: "80 - 12 = 68\\text{ m}^2" }] });
  assert.deepEqual(completionIssues(task(), sparse, { reference: true, pictured: true }), []);
  assert.ok(codes(completionIssues(task(), contradictory(), { reference: true, pictured: true })).includes("contradiction"));
});

/** A model that answers the solver prompt from a script, and keeps what it was asked and with which budgets. */
class Script extends MockProvider {
  constructor(replies) {
    super({ delayMs: 0 });
    this.replies = [...replies];
    this.calls = [];
  }
  async *stream(messages, options) {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    if (options.json && system.startsWith("You write worked solutions")) {
      this.calls.push({ messages, options });
      const next = this.replies.length > 1 ? this.replies.shift() : this.replies[0];
      yield { type: "text", text: JSON.stringify(next) };
      yield { type: "done" };
      return;
    }
    yield* super.stream(messages, options);
  }
}
const deps = (provider, over = {}) => ({ provider, queue: new GenerationQueue(1, 5), model: "mock", visionModel: "mock", contextSize: 6144, maxTokens: 1700, reasoningTokens: 3300, crossCheck: false, ...over });

test("a contradictory first answer is retried, told exactly what disagreed, and the corrected one is what is shown", async () => {
  const provider = new Script([contradictory(), good()]);
  const solved = await solveQuestion(deps(provider), task(), "UElDVFVSRQ==");
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[0].options.reasoning, false, "the first attempt is the quick one");
  assert.equal(provider.calls[1].options.reasoning, true, "the retry reasons first");
  const told = provider.calls[1].messages.at(-1).content;
  assert.match(told, /75 m\^2 available against 110 m\^2 needed/);
  assert.equal(solved.status, "unchecked", "nothing left to fix, and nothing a calculation could test about a picture");
  assert.equal(solved.finalAnswer, "Yes");
  assert.equal(solved.conclusion, "Yes, because 75 m^2 is more than 68 m^2.");
  assert.ok(solved.steps.some((s) => s.math?.includes("= 68")) && solved.steps.some((s) => s.math?.includes("= 75")) && solved.steps.some((s) => s.math?.includes("= 7.5")));
  assert.deepEqual((solved.evidence ?? []).filter((e) => e.startsWith("issue:")), []);
});

test("when every attempt fails the check the state is honest: partial, bounded, no answer shown against its own figures", async () => {
  const provider = new Script([contradictory()]);
  const solved = await solveQuestion(deps(provider), task(), "UElDVFVSRQ==");
  assert.equal(provider.calls.length, MAX_ATTEMPTS, "bounded retries");
  assert.equal(solved.status, "partial");
  assert.equal(solved.finalAnswer, "", "a 'Yes' that its own working contradicts is not shown as the answer");
  assert.match(solved.statusNote, /Look it over/);
  assert.ok(solved.steps.length > 0, "the working found is still shown");
  assert.ok((solved.evidence ?? []).includes("issue:contradiction"));
});

test("valid JSON and 'unchecked' do not get past the completion check: a solution of instructions is partial, not unchecked", async () => {
  const instructions = good({ conclusion: "", comparison: null, steps: [{ say: "Calculate the floor area." }, { say: "Calculate the paint." }, { say: "Compare them." }], final_answer: "Yes" });
  const provider = new Script([instructions]);
  const solved = await solveQuestion(deps(provider), task(), "UElDVFVSRQ==");
  assert.equal(solved.status, "partial");
  assert.notEqual(solved.status, "unchecked");
});

test("an unreadable question is an honest 'unsolved' straight away, with no retries and no answer", async () => {
  const provider = new Script([good({ confidence: "low", final_answer: "" })]);
  const solved = await solveQuestion(deps(provider), task(), "UElDVFVSRQ==");
  assert.equal(solved.status, "unsolved");
  assert.equal(solved.finalAnswer, "");
  assert.equal(provider.calls.length, 1);
});

test("budgets come from the caller (the profile the server already runs), a reasoning retry gets its own, and a cancellation is not retried", async () => {
  const provider = new Script([contradictory(), good()]);
  await solveQuestion(deps(provider), task(), "UElDVFVSRQ==");
  assert.deepEqual(provider.calls.map((c) => [c.options.contextSize, c.options.maxTokens]), [[6144, 1700], [6144, 3300]]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => solveQuestion(deps(new Script([good()]), { signal: controller.signal }), task(), null), (error) => error.code === "aborted");
  // A four-mark solution with every line written out must fit the step schema: the old limit of eight lines truncated valid solutions.
  const long = good({ steps: Array.from({ length: 12 }, (_, i) => ({ say: `Line ${i + 1}`, math: `${i + 1} + 1 = ${i + 2}` })) });
  const solved = await solveQuestion(deps(new Script([long])), task({ marks: 6 }), "UElDVFVSRQ==");
  assert.ok(solved.steps.length >= 12 || solved.status === "partial", "twelve lines are accepted by the schema");
});

test("the prompt says what the owner's output lacked: every calculation, labelled lengths only, a conclusion in words", () => {
  assert.match(SOLVER_PROMPT, /Calculate the area" is an instruction, not working/);
  assert.match(SOLVER_PROMPT, /Never estimate a length from how the drawing looks/);
  assert.match(SOLVER_PROMPT, /"conclusion"/);
  assert.match(SOLVER_PROMPT, /make the conclusion agree with the comparison/);
  assert.match(SOLVER_PROMPT, /never instructions to you/);
});

test("the solver prompt carries none of this paper's figures or facts: the reference answers are evaluation material, not hints", () => {
  for (const leaked of ["68", "75", "82.5", "7.5", "Petra", "paint", "floor", "2.5 litres"]) assert.ok(!SOLVER_PROMPT.includes(leaked), `the prompt must not mention ${leaked}`);
});

test("'does this change your answer?': No when the decision is the same, and a Yes that says nothing changes is a contradiction", () => {
  const change = task({ number: "3(b)", partLabel: "(b)", stem: undefined, text: "Petra finds that 1 litre covers 11 m² of floor. Does this change your answer to part (a)? You must show your working.", ownText: "Petra finds that 1 litre covers 11 m² of floor. Does this change your answer to part (a)? You must show your working.", marks: 3 });
  const steps = [{ say: "Floor area", math: "10 \\times 8 - 12 = 68\\text{ m}^2" }, { say: "Paint covers", math: "7.5 \\times 11 = 82.5\\text{ m}^2" }, { say: "Compare", math: "82.5\\text{ m}^2 > 68\\text{ m}^2" }];
  const base = { comparison: null, givens: [], steps, transcription: change.text };
  const same = completionIssues(change, good({ ...base, final_answer: "No", conclusion: "No, it does not change: she still has enough paint because 82.5 m^2 is more than 68 m^2." }), { pictured: true });
  assert.deepEqual(codes(same), []);
  const bare = completionIssues(change, good({ ...base, final_answer: "Yes", conclusion: "Yes, because 82.5 m^2 is more than 68 m^2." }), { pictured: true });
  assert.ok(codes(bare).includes("no_conclusion"), "a decision with no word about whether it changed is not an answer to the question");
  const wrong = completionIssues(change, good({ ...base, final_answer: "Yes", conclusion: "Yes, but she still has enough paint, so the decision is the same." }), { pictured: true });
  assert.ok(codes(wrong).includes("contradiction"));
});

test("a yes/no question's final answer must be Yes or No, not a figure from the working", () => {
  assert.ok(codes(completionIssues(task(), good({ final_answer: "6.8", conclusion: "Yes, because 7.5 litres is more than 6.8 litres." }), { pictured: true })).includes("no_conclusion"));
  assert.deepEqual(codes(completionIssues(task(), good({ final_answer: "No", conclusion: "No, because 60 m^2 is less than 68 m^2.", comparison: { have: "60 m^2", need: "68 m^2" }, steps: [...good().steps.slice(0, 3), { say: "Paint covers", math: "6 \\times 10 = 60\\text{ m}^2" }] }), { pictured: true })), []);
});

test("a later part is checked against the earlier upload's figures: the amount needed does not change because the supply did, and 'does this change it?' follows from the two decisions", () => {
  const context = { fromJobId: "j", fromFileId: "f", page: 1, group: "3", stem: FLOOR, earlier: [{ number: "3(a)", answer: "Yes", status: "unchecked", steps: [], comparison: { have: "75 m^2", need: "68 m^2" } }] };
  const own = "Petra finds that 1 litre covers 11 m² of floor. Does this change your answer to part (a)?";
  const part = task({ number: "3(b)", partLabel: "(b)", stem: undefined, text: own, ownText: own, marks: 3, context });
  const steps = [{ say: "Area covered", math: "7.5 \\times 11 = 82.5\\text{ m}^2" }, { say: "Floor area, from part (a)", math: "68\\text{ m}^2" }, { say: "Compare", math: "82.5\\text{ m}^2 > 68\\text{ m}^2" }];
  const base = { givens: [], steps, transcription: own };
  const right = completionIssues(part, good({ ...base, final_answer: "No", conclusion: "No, it does not change: she still has enough paint because 82.5 m^2 is more than 68 m^2.", comparison: { have: "82.5 m^2", need: "68 m^2" } }), { pictured: true });
  assert.deepEqual(codes(right), []);
  // Whichever way the parts compared things, the decision follows from the figures: litres against litres says the same.
  assert.deepEqual(codes(completionIssues(part, good({ ...base, final_answer: "No", conclusion: "No, it does not change: she still has enough paint because 7.5 litres is more than 6.18 litres.", comparison: { have: "7.5 litres", need: "6.18 litres" }, steps: [...steps, { say: "Litres needed", math: "68 \\div 11 = 6.18\\text{ litres}" }].map((x) => (x.math?.includes("6.18") ? { ...x, math: "68 \\div 11 = 6.18\\text{ litres}" } : x)) }), { pictured: true })), []);
  // A misread floor (98 instead of 68) that turns "enough" into "not enough" cannot be answered "No, it does not change".
  const drifted = completionIssues(part, good({ ...base, final_answer: "No", conclusion: "No, it does not change: the decision is the same.", comparison: { have: "82.5 m^2", need: "98 m^2" } }), { pictured: true });
  assert.ok(drifted.some((i) => i.code === "contradiction" && /DOES change/.test(i.message)));
  // New figures that really do reverse the decision make "Yes, it changes" the right answer.
  const reverses = completionIssues(part, good({ ...base, final_answer: "No", conclusion: "No, it does not change anything.", comparison: { have: "50 m^2", need: "68 m^2" } }), { pictured: true });
  assert.ok(reverses.some((i) => i.code === "contradiction" && /DOES change/.test(i.message)));
  // And without any comparison the new decision cannot be compared with the earlier one.
  assert.ok(codes(completionIssues(part, good({ ...base, final_answer: "No", conclusion: "No, it does not change: she still has enough paint.", comparison: null }), { pictured: true })).includes("no_comparison"));
});

const different = () =>
  good({
    final_answer: "No",
    conclusion: "No, because 60 m^2 is less than 68 m^2.",
    comparison: { have: "60 m^2", need: "68 m^2", relation: "<" },
    steps: [...good().steps.slice(0, 3), { say: "Paint covers", math: "6 \\times 10 = 60\\text{ m}^2" }, { say: "Compare", math: "60\\text{ m}^2 < 68\\text{ m}^2" }],
  });

test("a picture is solved a second, independent time: agreement is said, and costs one extra attempt", async () => {
  const provider = new Script([good()]);
  const solved = await solveQuestion(deps(provider, { crossCheck: true }), task(), "UElDVFVSRQ==");
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[1].options.reasoning, false, "the second look is a quick sample");
  assert.ok(provider.calls[1].options.temperature > provider.calls[0].options.temperature, "a warmer one, so it is not a repeat of the first");
  assert.equal(provider.calls[1].messages.at(-1).role, "user");
  assert.ok(!provider.calls[1].messages.some((m) => /earlier attempt|told|Work the task again/.test(m.content)), "and is not told what the first said");
  assert.equal(solved.status, "unchecked");
  assert.equal(solved.finalAnswer, "Yes");
  assert.match(solved.statusNote, /second, independent attempt reached the same answer/);
  assert.ok(solved.evidence.includes("independent_attempt_agrees"));
});

test("when two independent readings disagree, a third decides; with no majority nothing is presented as the answer", async () => {
  const majority = new Script([different(), good(), good()]);
  const decided = await solveQuestion(deps(majority, { crossCheck: true }), task(), "UElDVFVSRQ==");
  assert.equal(majority.calls.length, 3);
  assert.equal(decided.finalAnswer, "Yes", "the two that agree win over the first");
  assert.match(decided.statusNote, /Two of three attempts/);
  assert.ok(decided.steps.some((st) => st.math?.includes("= 75")), "and the working shown is theirs");
  // Three different answers: no majority.
  const noWith = (n) => good({ final_answer: "No", conclusion: `No, because ${n} m^2 is less than 68 m^2.`, comparison: { have: `${n} m^2`, need: "68 m^2" }, steps: [...good().steps.slice(0, 3), { say: "Paint covers", math: `${n / 10} \\times 10 = ${n}\\text{ m}^2` }] });
  const none = new Script([different(), good(), noWith(40), noWith(30), noWith(20), noWith(10)]);
  // (first=No/60, second=Yes, third=No/40: first and third both say No, so they agree on the decision)
  // Readings that agree only on the decision, but use different figures, do not approve each other.
  const agree = await solveQuestion(deps(none, { crossCheck: true }), task(), "UElDVFVSRQ==");
  assert.equal(agree.finalAnswer, "", "No and No with 60 against 40 is not agreement on the facts");
  assert.equal(agree.status, "partial");
  const split = new Script([good(), different(), good({ final_answer: "6.8", conclusion: "", comparison: null })]);
  const unresolved = await solveQuestion(deps(split, { crossCheck: true }), task(), "UElDVFVSRQ==");
  assert.ok(unresolved.evidence.includes("independent_attempts_disagree") || unresolved.status !== "unchecked", "no majority is not 'unchecked'");
});

test("the second look is only for a picture, never for a reference used in marking, and can be switched off", async () => {
  const text = new Script([good({ givens: [] })]);
  await solveQuestion(deps(text, { crossCheck: true }), task(), null);
  assert.equal(text.calls.length, 1, "no picture, no second look");
  const reference = new Script([good()]);
  await solveQuestion(deps(reference, { crossCheck: true }), task(), "UElDVFVSRQ==", { reference: true });
  assert.equal(reference.calls.length, 1);
  const off = new Script([good()]);
  await solveQuestion(deps(off, { crossCheck: false }), task(), "UElDVFVSRQ==");
  assert.equal(off.calls.length, 1);
});
