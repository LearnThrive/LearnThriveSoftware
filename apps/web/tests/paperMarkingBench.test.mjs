import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The marking benchmark's scoring and thresholds, and a synthetic typed response run through the real marker. The synthetic case tests the pipeline and
// the scoring only; the summary must say the marker is unvalidated, because no human-marked handwriting has been supplied.

const bm = loadTsFrom(import.meta.url, "../src/lib/paper/benchMark.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");

const marked = (number, over = {}) => ({
  number,
  outcome: "correct",
  student: { answer: "6", working: ["2x = 12", "x = 6"] },
  assessment: { answerState: "answered", review: null, override: null, marks: { awarded: 2, possible: 2, pending: 0 }, criteria: [], awards: [] },
  ...over,
});
const human = (label, over = {}) => ({ label, state: "answered", answer: "6", working: ["2x = 12", "x = 6"], answerCorrect: true, marks: 2, outOf: 2, ...over });

test("marks are compared only where the marker fully assessed; the error is a distribution, not an average", () => {
  const score = bm.scoreMarking(
    [human("1"), human("2", { marks: 3 }), human("3", { marks: 1 }), human("4"), human("5")],
    [
      marked("1"),
      marked("2"),
      marked("3", { assessment: { ...marked("3").assessment, marks: { awarded: 3, possible: 3, pending: 0 } } }),
      marked("4", { assessment: { ...marked("4").assessment, review: { code: "unreadable", why: "x" }, marks: { awarded: null, possible: 2, pending: 2 } } }),
    ],
  );
  assert.equal(score.assessed, 3, "question 4 was sent to a person, 5 was not returned");
  assert.deepEqual([score.review.count, score.review.rate], [2, 0.4]);
  assert.deepEqual([score.exactAgreement.compared, score.exactAgreement.exact], [3, 1]);
  assert.deepEqual(score.errorDistribution, { "0": 1, "-1": 1, "+2": 1 });
  assert.equal(score.withinOneMark, 2 / 3);
});

test("correctness decisions: false positives, false negatives, and the rate at which correct work is marked wrong", () => {
  const score = bm.scoreMarking(
    [human("1"), human("2"), human("3", { answerCorrect: false, answer: "5" }), human("4", { answerCorrect: false, answer: "5" })],
    [marked("1"), marked("2", { outcome: "incorrect" }), marked("3", { outcome: "correct" }), marked("4", { outcome: "incorrect" })],
  );
  assert.deepEqual([score.correctness.humanCorrect, score.correctness.humanWrong, score.correctness.falsePositives, score.correctness.falseNegatives], [2, 2, 1, 1]);
  assert.equal(score.correctness.correctMarkedWrong, 0.5);
  assert.equal(score.correctness.wrongMarkedCorrect, 0.5);
  // A question sent for review makes no decision, so it is neither.
  const abstain = bm.scoreMarking([human("1")], [marked("1", { outcome: "needs_checking" })]);
  assert.deepEqual([abstain.correctness.falseNegatives, abstain.correctness.falsePositives, abstain.review.count], [0, 0, 0], "needs_checking with nothing pending is still counted by its assessment, not hidden");
});

test("blank, unreadable and answered are told apart: a blank or unreadable answer called wrong is counted", () => {
  const score = bm.scoreMarking(
    [human("1", { state: "blank", answer: "", answerCorrect: false, marks: 0 }), human("2", { state: "unreadable" }), human("3", { state: "blank", answer: "", answerCorrect: false, marks: 0 })],
    [
      marked("1", { outcome: "incorrect", assessment: { ...marked("1").assessment, answerState: "answered" } }),
      marked("2", { outcome: "incorrect" }),
      marked("3", { outcome: "no_answer", assessment: { ...marked("3").assessment, answerState: "blank", marks: { awarded: 0, possible: 2, pending: 0 } } }),
    ],
  );
  assert.deepEqual([score.states.blankMarkedWrong, score.states.unreadableMarkedWrong, score.states.stateErrors], [1, 1, 2]);
});

test("follow-through is not guessed: it should reach a person, or be matched exactly", () => {
  const ft = (over) => bm.scoreMarking([human("1", { followThrough: true, marks: 1 })], [marked("1", over)]).followThrough;
  assert.deepEqual(ft({ assessment: { ...marked("1").assessment, review: { code: "follow_through", why: "x" }, marks: { awarded: 0, possible: 2, pending: 1 } } }), { cases: 1, sentToPerson: 1, matched: 0 });
  assert.deepEqual(ft({ assessment: { ...marked("1").assessment, marks: { awarded: 1, possible: 2, pending: 0 } } }), { cases: 1, sentToPerson: 0, matched: 1 });
  assert.deepEqual(ft({}), { cases: 1, sentToPerson: 0, matched: 0 }, "a different mark with no review is the failure");
});

test("a tutor's override is what the marker's mark is judged as", () => {
  const score = bm.scoreMarking([human("1", { marks: 1 })], [marked("1", { assessment: { ...marked("1").assessment, override: { by: "t", at: "x", marks: 1, note: "" } } })]);
  assert.deepEqual([score.exactAgreement.compared, score.exactAgreement.exact], [1, 1]);
});

test("without real human-marked handwriting the marker is unvalidated, and synthetic cases never count towards a gate", () => {
  const empty = bm.summariseMarking([]);
  assert.equal(empty.validation, "unvalidated");
  assert.ok(Object.values(empty.gates).every((g) => g === "unmeasured"));
  assert.match(empty.reasons.join(" "), /No human-marked handwritten responses have been supplied/);
  const perfect = (n, kind) => {
    // One answer in ten is wrong and marked wrong, so every threshold can be measured.
    const questions = Array.from({ length: n }, (_, i) => (i % 10 === 9 ? human(String(i + 1), { answerCorrect: false, answer: "5", marks: 0 }) : human(String(i + 1))));
    const results = questions.map((q) => (q.answerCorrect ? marked(q.label) : marked(q.label, { outcome: "incorrect", assessment: { ...marked(q.label).assessment, marks: { awarded: 0, possible: 2, pending: 0 } } })));
    return { case: { id: kind + n, split: "dev", kind, provenance: "p", questions }, score: bm.scoreMarking(questions, results), students: 12 };
  };
  const synthetic = bm.summariseMarking([perfect(500, "synthetic")]);
  assert.equal(synthetic.validation, "unvalidated", "five hundred perfect synthetic answers prove nothing about handwriting");
  assert.equal(synthetic.handwrittenQuestions, 0);
  const few = bm.summariseMarking([perfect(50, "handwritten")]);
  assert.equal(few.validation, "unvalidated");
  assert.match(few.reasons.join(" "), /at least 300 questions from 10 students/);
  assert.ok(Object.values(few.gates).every((g) => g === "unmeasured"), "too few to call anything met");
  const enough = bm.summariseMarking([perfect(320, "handwritten")]);
  assert.equal(enough.validation, "validated");
  assert.ok(Object.values(enough.gates).every((g) => g === "met"));
  // One threshold failing is named.
  const bad = perfect(320, "handwritten");
  bad.score.correctness.falseNegatives = 30;
  bad.score.correctness.humanCorrect = 300;
  const failed = bm.summariseMarking([bad]);
  assert.equal(failed.gates.correctMarkedWrong, "failed");
  assert.equal(failed.validation, "unvalidated");
  assert.match(failed.reasons.join(" "), /correctMarkedWrong threshold is not met/);
});

test("a synthetic typed response goes through the real marker: blank, unreadable, crossed-out, doubted and alternative-method work are handled as designed", async () => {
  const syn = await bm.syntheticMarkingCase();
  const deps = { provider: bm.markingStandIn(syn.scripts), queue: new GenerationQueue(2, 200), model: "stand-in", visionModel: "stand-in" };
  const document = await loadTsFrom(import.meta.url, "../src/lib/paper/paper.ts").extractQuestions(deps, syn.bytes);
  const { markCompleted } = loadTsFrom(import.meta.url, "../src/lib/paper/paper.ts");
  const result = await markCompleted(deps, document, {});
  const by = Object.fromEntries(result.marked.map((m) => [m.number, m]));
  assert.deepEqual([by["1"].outcome, by["1"].estimate], ["correct", 3]);
  assert.deepEqual([by["2"].outcome, by["2"].estimate], ["incorrect", 1], "a wrong answer keeps the method mark its working earns");
  assert.deepEqual([by["4"].assessment.answerState, by["4"].estimate], ["blank", 0], "blank is a real zero");
  assert.deepEqual([by["5"].assessment.answerState, by["5"].estimate, by["5"].assessment.review.code], ["unreadable", null, "unreadable"], "unreadable is pending, never zero, never wrong");
  assert.deepEqual(by["6"].assessment.crossedOut, ["x = 14"]);
  assert.equal(by["7"].outcome, "needs_checking", "a doubted reading that disagrees is sent to a person");
  const score = await bm.runMarkingCase(syn.case, syn.bytes, deps);
  assert.equal(score.states.blankMarkedWrong + score.states.unreadableMarkedWrong, 0);
  assert.equal(score.correctness.falsePositives, 0);
  assert.equal(score.correctness.falseNegatives, 0, "no correct work was marked wrong");
  assert.equal(score.review.count, 3, "the unreadable answer, the doubted reading, and the right answer with no working shown (its method mark waits for a person)");
  assert.equal(score.review.rate, 3 / 8, "and the accuracy figures exclude those three");
  assert.equal(score.exactAgreement.compared, 5);
  assert.equal(bm.summariseMarking([{ case: syn.case, score }]).validation, "unvalidated");
});
