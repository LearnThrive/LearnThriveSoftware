import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The benchmark's own scoring (it is held to the same standard as the thing it measures), and the synthetic cases run through the real pipeline.

const bench = loadTsFrom(import.meta.url, "../src/lib/paper/bench.ts");
const run = loadTsFrom(import.meta.url, "../src/lib/paper/benchRun.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");

const solved = (number, finalAnswer, status) => ({ id: `q${number}`, number, finalAnswer, status });

test("extraction: found, missing and invented questions are told apart, by printed label and in order", () => {
  const expected = [{ label: "1(a)" }, { label: "1(b)" }, { label: "2" }, { label: "3(a)(i)" }];
  const perfect = bench.scoreExtraction(expected, [{ number: "1(a)" }, { number: "1(b)" }, { number: "2" }, { number: "3(a)(i)" }]);
  assert.deepEqual([perfect.recall, perfect.precision, perfect.inOrder, perfect.missing, perfect.extra], [1, 1, true, [], []]);
  const off = bench.scoreExtraction(expected, [{ number: "1(a)" }, { number: "2" }, { number: "9" }, { number: "1(b)" }]);
  assert.deepEqual([off.matched, off.missing, off.extra, off.inOrder], [3, ["3(a)(i)"], ["9"], false]);
  assert.equal(off.recall, 0.75);
  assert.equal(off.precision, 0.75);
  assert.equal(bench.scoreExtraction(expected, [{ number: "1 (A)" }]).matched, 1, "spacing and case in a label do not matter");
  assert.deepEqual(bench.scoreExtraction([], []).recall, 1);
});

test("transcription: the printed words must be in the text read; a stem added to a part is not held against it", () => {
  const expected = [{ label: "1", text: "Solve 2x + 7 = 19" }, { label: "2", text: "Work out the total cost" }, { label: "3" }];
  const score = bench.scoreTranscription(expected, [
    { number: "1", text: "Solve 2x + 7 = 19" },
    { number: "2", text: "Sam buys 3 pens. Work out the total cost" },
    { number: "3", text: "anything" },
  ]);
  assert.deepEqual([score.scored, score.mean], [2, 1]);
  const bad = bench.scoreTranscription([{ label: "1", text: "Solve 2x + 7 = 19" }], [{ number: "1", text: "Solve 2x + 1 = 19" }]);
  assert.ok(bad.mean < 1 && bad.mean > 0.5);
  assert.equal(bench.scoreTranscription([{ label: "1", text: "x" }], []).scored, 0, "a question that was not found is not scored here (extraction counts it)");
  assert.equal(bench.similarity("a b c", "c b a"), 1);
  assert.equal(bench.similarity("a b", "c d"), 0);
});

test("answers are compared by value and by algebra, and a solution set in any order is the same set", () => {
  const same = bench.sameAnswer;
  assert.ok(same("x = 6", "x = 6"));
  assert.ok(same("6", "x = 6"));
  assert.ok(same("x = 3 or x = 2", "x = 2 or x = 3"));
  assert.ok(same("x = 2, x = -2", "x = 2 or x = -2"));
  assert.ok(same("\\frac{1}{2}", "0.5"));
  assert.ok(same("3x + 12", "3(x + 4)"));
  assert.ok(same("84", "84.0"));
  assert.ok(!same("0.8333333333", "5/6"), "a rounded decimal for an exact value");
  assert.ok(same("0.83", "0.83"));
  assert.ok(same("0.25", "1/4"), "a terminating decimal is exact");
  assert.ok(!same("x = 2", "x = 2 or x = -2"), "half the solutions is not the answer");
  assert.ok(!same("3x + 4", "3x + 12"));
  assert.ok(!same("50", "40"));
  assert.ok(!same("", "6"));
});

test("answers: a wrong answer the checker vouched for is the one that is counted against it", () => {
  const expected = [{ label: "1", answer: "x = 6" }, { label: "2", answer: "3x + 12" }, { label: "3", answer: "52" }, { label: "4", answer: "7" }, { label: "5" }];
  const score = bench.scoreAnswers(expected, [
    solved("1", "x = 6", "verified"),
    solved("2", "3x + 4", "verified"),
    solved("3", "50", "unchecked"),
    solved("4", "", "unsolved"),
    solved("5", "9", "verified"),
  ]);
  assert.equal(score.scored, 4, "a question with no expected answer is not scored");
  assert.equal(score.correct, 1);
  assert.deepEqual(score.falseVerified, [{ label: "2", shown: "3x + 4", expected: "3x + 12" }]);
  assert.equal(score.verified, 2);
  assert.deepEqual(score.status, { verified: 2, unchecked: 1, unsolved: 1 });
  assert.equal(score.verifiedCoverage, 1, "of the one right answer, it was vouched for");
});

test("placement: an answer over printing, off the page or too small is bad", () => {
  const pages = [{ number: 1, width: 595, height: 842, lines: [{ text: "Q", x: 72, y: 700, w: 300, h: 12 }] }];
  const score = bench.scorePlacement(
    [
      { questionId: "a", page: 1, rect: { x: 72, y: 600, w: 300, h: 40 }, kind: "answer", size: 14 },
      { questionId: "b", page: 1, rect: { x: 72, y: 695, w: 300, h: 40 }, kind: "answer", size: 14 },
      { questionId: "c", page: 1, rect: { x: 72, y: 500, w: 300, h: 40 }, kind: "answer", size: 9 },
      { questionId: "d", page: 1, rect: { x: 500, y: 500, w: 300, h: 40 }, kind: "answer", size: 14 },
      { questionId: "e", page: 4, rect: { x: 72, y: 500, w: 300, h: 40 }, kind: "answer", size: 14 },
    ],
    pages,
  );
  assert.deepEqual(score.bad.map((b) => [b.questionId, b.why]), [["b", "over printed text"], ["c", "written at 9 pt"], ["d", "off the page"], ["e", "no such page"]]);
  assert.equal(score.ok, 1);
});

test("the summary counts questions, not cases, and never calls an unmeasured gate a pass", () => {
  const ext = (expected, found, matched) => ({ expected, found, matched, missing: [], extra: [], inOrder: true, precision: 1, recall: 1 });
  const reports = [
    { id: "a", split: "dev", status: "run", extraction: ext(100, 100, 100), seconds: 2 },
    { id: "b", split: "dev", status: "run", extraction: ext(10, 10, 0), seconds: 4 },
    { id: "c", split: "heldout", status: "not_run", reason: "no file" },
  ];
  const dev = bench.summarise(reports, "dev");
  assert.equal(dev.extractionRecall, 100 / 110, "a long paper counts for more than a short one");
  assert.equal(dev.gates.extractionRecall, "failed");
  assert.equal(dev.gates.falseVerified, "unmeasured", "nothing was asked of a model, so nothing is claimed");
  assert.equal(dev.gates.placementBad, "unmeasured");
  const held = bench.summarise(reports, "heldout");
  assert.deepEqual([held.cases, held.run, held.notRun, held.extractionRecall], [1, 0, 1, null]);
  assert.equal(held.gates.extractionRecall, "unmeasured");
});

test("synthetic cases through the real pipeline: structure is found, the checker vouches only for what it can prove", async () => {
  const cases = await run.syntheticCases();
  assert.deepEqual(cases.map((c) => c.case.id), ["syn-worksheet", "syn-gcse-parts", "syn-long-120", "syn-pitfalls"]);
  const reports = {};
  for (const c of cases) {
    const deps = { provider: run.standInModel(c.model), queue: new GenerationQueue(2, 200), model: "stand-in" };
    reports[c.case.id] = await run.runCase(c.case, c.bytes, deps);
  }
  for (const [id, r] of Object.entries(reports)) {
    assert.equal(r.status, "run", id);
    assert.deepEqual(r.extraction.missing, [], `${id}: nothing missed`);
    assert.deepEqual(r.extraction.extra, [], `${id}: nothing invented`);
    assert.ok(r.extraction.inOrder, `${id}: in order`);
    assert.equal(r.answers.falseVerified.length, 0, `${id}: no wrong answer vouched for`);
    assert.deepEqual(r.placement.bad, [], `${id}: every answer is written where it fits`);
    assert.ok(r.transcription.mean >= 0.95, `${id}: the text read is the text printed (${r.transcription.mean})`);
  }
  assert.equal(reports["syn-long-120"].extraction.expected, 120);
  // The traps: each of these answers works when substituted, and none may be vouched for.
  const traps = reports["syn-pitfalls"].answers;
  assert.equal(traps.correct, 0, "every answer in this case is wrong, on purpose");
  assert.equal(traps.verified, 0);
  // And what is right and provable is vouched for.
  const worksheet = reports["syn-worksheet"].answers;
  assert.equal(worksheet.correct, worksheet.scored, "the stand-in gave the right answers");
  assert.ok(worksheet.verified >= 4, `the checker proved the calculable ones (${worksheet.verified})`);
});

test("extraction alone needs no model, and a gcse-shaped paper has its cover, formulae and blank pages skipped", async () => {
  const [, gcse] = await run.syntheticCases();
  const r = await run.runCase(gcse.case, gcse.bytes, null, { solve: false });
  assert.equal(r.answers, undefined);
  assert.equal(r.extraction.recall, 1);
  assert.deepEqual(gcse.case.expected.skippedPages, [1, 2, gcse.case.expected.pages]);
});
