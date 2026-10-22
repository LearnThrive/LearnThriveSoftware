import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// Where a scan's answer space is: the vision model proposes, the drawing of the page decides. A proposal that fails any check is refused with
// its reason, and a scanned question that is not placed keeps its answer on the worked-solution pages.

const { placeFromLayout, proposeLayout, LAYOUT_MIN_CONFIDENCE } = loadTsFrom(import.meta.url, "../src/lib/paper/layout.ts");
const { extractQuestions } = loadTsFrom(import.meta.url, "../src/lib/paper/paper.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");

const W = 595;
const H = 842;

/** A white page (one pixel per PDF unit) with solid black blocks: [top, bottom] in pixel rows from the top, spanning the given columns. */
function render(blocks = []) {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (const [top, bottom, from = 40, to = W - 40] of blocks) {
    for (let y = top; y < bottom; y += 1) for (let x = from; x < to; x += 1) data.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 3);
  }
  return { number: 1, scale: 1, width: W, height: H, data, jpeg: () => new Uint8Array([0xff, 0xd8]) };
}
const page = (over = {}) => ({ number: 1, text: "", textQuality: "none", hasPictures: true, stackedMaths: false, image: null, lines: [], width: W, height: H, rotation: 0, originX: 0, originY: 0, ...over });
const question = (number, id = `q${number}`) => ({ id, number, page: 1, text: "", marks: null, box: null, answer: null, bands: [], answerLine: null, fromText: false });
const propose = (number, answer, confidence = 0.9, q = [0.08, 0.05, 0.92, 0.1]) => ({ number, question: q, answer, confidence });

test("a proposal the drawing agrees with gives the question its answer space, inside the box, with the confidence recorded", () => {
  const q = question("1");
  // The question's printed text is at the top (rows 40 to 90); the proposed space (0.2 to 0.4 of the height) is clear.
  const { placed, refused } = placeFromLayout([q], [propose("1", [0.1, 0.2, 0.9, 0.4])], page(), render([[40, 90]]));
  assert.deepEqual(refused, []);
  assert.deepEqual(placed, [{ id: "q1", confidence: 0.9 }]);
  assert.deepEqual(q.layout, { source: "vision", confidence: 0.9 });
  assert.ok(q.bands.length >= 1);
  const top = H - 0.2 * H;
  const bottom = H - 0.4 * H;
  for (const b of q.bands) {
    assert.ok(b.y >= bottom - 4 && b.y + b.h <= top + 4, "inside the proposed box (in PDF units, up from the bottom)");
    assert.ok(b.x >= 0.1 * W - 2 && b.x + b.w <= 0.9 * W + 2);
  }
  assert.ok(q.answer.h >= 18);
});

test("a proposal is refused, with the reason, when the model is unsure, silent, or sees no space", () => {
  const r = render();
  const a = question("1");
  const b = question("2");
  const c = question("3");
  const d = question("4");
  const { placed, refused } = placeFromLayout([a, b, c, d], [propose("1", [0.1, 0.2, 0.9, 0.3], 0.4), { number: "3", question: [0.1, 0.5, 0.9, 0.55], answer: null, confidence: 0.9 }, propose("4", [0.1, 0.6, 0.9, 0.7], LAYOUT_MIN_CONFIDENCE)], page(), r);
  assert.deepEqual(placed.map((p) => p.id), ["q4"], "exactly at the threshold is enough");
  assert.deepEqual(refused.map((x) => [x.id, x.reason.split(" (")[0]]), [["q1", "the model is not sure enough"], ["q2", "the model did not locate it"], ["q3", "the model saw no answer space"]]);
  assert.deepEqual([a.bands, a.layout], [[], undefined], "a refused question is left exactly as it was");
});

test("the drawing decides: printed text, a diagram or the student's writing inside the box means it is not an answer space", () => {
  const q = question("1");
  const busy = render([[200, 330]]);
  const { placed, refused } = placeFromLayout([q], [propose("1", [0.1, 0.2, 0.9, 0.4])], page(), busy);
  assert.deepEqual(placed, []);
  assert.match(refused[0].reason, /not empty in the drawing/);
  assert.deepEqual(q.bands, []);
  // The same box over a page whose ink is outside it is fine, and a dotted answer line inside it does not spoil it.
  const dotted = render();
  for (let x = 80; x < 500; x += 6) dotted.data.fill(0, (250 * W + x) * 4, (250 * W + x) * 4 + 3);
  assert.equal(placeFromLayout([question("1")], [propose("1", [0.1, 0.2, 0.9, 0.4])], page(), dotted).placed.length, 1);
});

test("a space that is too small, off the page, over the question's own text or on a rotated page is refused", () => {
  const r = render();
  const cases = [
    ["too small", propose("1", [0.1, 0.2, 0.9, 0.205]), /too small/],
    ["narrow", propose("1", [0.1, 0.2, 0.2, 0.4]), /too small/],
    ["off the page", propose("1", [0.1, 0.2, 1.4, 0.4]), /outside the page/],
    ["the margin only", propose("1", [0.0, 0.0, 0.01, 0.01]), /too small/],
    ["over the question", { number: "1", question: [0.08, 0.2, 0.92, 0.4], answer: [0.1, 0.2, 0.9, 0.4], confidence: 0.9 }, /overlaps the question's own text/],
  ];
  for (const [name, proposal, reason] of cases) {
    const { placed, refused } = placeFromLayout([question("1")], [proposal], page(), r);
    assert.deepEqual(placed, [], name);
    assert.match(refused[0].reason, reason, name);
  }
  const rotated = placeFromLayout([question("1")], [propose("1", [0.1, 0.2, 0.9, 0.4])], page({ rotation: 90 }), r);
  assert.deepEqual(rotated.placed, []);
  assert.match(rotated.refused[0].reason, /rotated/);
});

test("two questions cannot claim the same space; the first keeps it", () => {
  const a = question("1");
  const b = question("2");
  const { placed, refused } = placeFromLayout([a, b], [propose("1", [0.1, 0.2, 0.9, 0.4]), propose("2", [0.1, 0.3, 0.9, 0.5])], page(), render());
  assert.deepEqual(placed.map((p) => p.id), ["q1"]);
  assert.match(refused[0].reason, /overlaps the space of q1/);
  assert.equal(b.bands.length, 0);
  const apart = placeFromLayout([question("1"), question("2")], [propose("1", [0.1, 0.2, 0.9, 0.3]), propose("2", [0.1, 0.4, 0.9, 0.5])], page(), render());
  assert.equal(apart.placed.length, 2);
});

test("only scanned questions on this page are touched; a question read from the text layer is never moved", () => {
  const text = { ...question("1"), fromText: true, bands: [{ x: 1, y: 1, w: 200, h: 50 }] };
  const other = { ...question("2"), page: 2 };
  const { placed, refused } = placeFromLayout([text, other], [propose("1", [0.1, 0.2, 0.9, 0.4]), propose("2", [0.1, 0.2, 0.9, 0.4])], page(), render());
  assert.deepEqual([placed, refused], [[], []]);
  assert.deepEqual(text.bands, [{ x: 1, y: 1, w: 200, h: 50 }]);
});

test("asking the model: a good answer is read, anything else is null (and cancelling still cancels)", async () => {
  const deps = { provider: new MockProvider({ delayMs: 0 }), queue: new GenerationQueue(1, 5), model: "mock" };
  const items = await proposeLayout(deps, "AAAA");
  assert.equal(items?.[0].number, "1");
  assert.ok(items[0].confidence > 0.5);
  const broken = (text) => ({ ...deps, provider: { id: "x", capabilities: async () => ({}), health: async () => ({ ok: true }), async *stream() { yield { type: "text", text }; } } });
  assert.equal(await proposeLayout(broken("not json"), "AAAA"), null);
  assert.equal(await proposeLayout(broken('{"items":[{"number":"1","answer":[0,0,1],"confidence":0.9}]}'), "AAAA"), null, "a box with three numbers");
  assert.equal(await proposeLayout(broken('{"items":[{"number":"1","answer":[0,0,1,1],"confidence":7}]}'), "AAAA"), null, "a confidence above 1");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => proposeLayout({ ...broken("x"), signal: controller.signal }, "AAAA"));
});

test("reading a scan asks where the space is once per scanned page, and PAPER_SCAN_LAYOUT=false never asks", async () => {
  const scan = new Uint8Array(readFileSync(new URL("./fixtures/documents/scan-jpeg.pdf", import.meta.url)));
  const asked = (provider) => provider.requests.filter((m) => m[0].content.startsWith("You are locating questions")).length;
  const on = new MockProvider({ delayMs: 0 });
  const withLayout = await extractQuestions({ provider: on, queue: new GenerationQueue(1, 5), model: "mock" }, scan, { maxPages: 60, maxQuestions: 150, renderBatch: 6, scanLayout: true });
  assert.ok(!("problem" in withLayout));
  assert.equal(asked(on), withLayout.pages.filter((p) => p.textQuality !== "good").length);
  assert.ok(withLayout.questions.every((q) => !q.fromText));
  for (const q of withLayout.questions) assert.ok(q.layout === undefined || (q.layout.source === "vision" && q.bands.length > 0), "a layout is only recorded together with its validated space");
  const off = new MockProvider({ delayMs: 0 });
  const without = await extractQuestions({ provider: off, queue: new GenerationQueue(1, 5), model: "mock" }, scan, { maxPages: 60, maxQuestions: 150, renderBatch: 6, scanLayout: false });
  assert.equal(asked(off), 0);
  assert.ok(without.questions.every((q) => q.layout === undefined && q.bands.length === 0));
});
