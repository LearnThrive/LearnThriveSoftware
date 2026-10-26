import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

const sp = loadTsFrom(import.meta.url, "../src/lib/assistant/speech.ts");

test("maths is read as words, never as LaTeX", () => {
  assert.equal(sp.mathToSpeech("x^2 + 5x + 6 = 0"), "x squared plus 5x plus 6 equals 0");
  assert.equal(sp.mathToSpeech("\\frac{3}{4} + \\frac{1}{8}"), "3 over 4 plus 1 over 8");
  assert.equal(sp.mathToSpeech("x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}"), "x equals minus b plus or minus the square root of b squared minus 4ac over 2a");
  assert.equal(sp.mathToSpeech("y = 3x^4 - 2x^2 + 5"), "y equals 3x to the power of 4 minus 2x squared plus 5");
  assert.equal(sp.mathToSpeech("a^3"), "a cubed");
  assert.equal(sp.mathToSpeech("\\sqrt[3]{27}"), "the cube root of 27");
  assert.equal(sp.mathToSpeech("30^\\circ"), "30 degrees");
  assert.equal(sp.mathToSpeech("a \\le b"), "a is less than or equal to b");
  assert.equal(sp.mathToSpeech("\\left( x + 1 \\right)"), "( x plus 1 )");
  assert.doesNotMatch(sp.mathToSpeech("\\unknowncommand{x}"), /\\/);
});

test("the maths the brief names is read aloud, not spelled out", () => {
  // A function name that used to be swallowed as an unknown command: "\sin \theta" said only "theta".
  assert.equal(sp.mathToSpeech("\\sin \\theta"), "sine theta");
  assert.equal(sp.mathToSpeech("\\cos^2 x"), "cosine squared x");
  assert.equal(sp.mathToSpeech("\\tan^{-1} x"), "tangent to the power of minus one x");
  assert.equal(sp.mathToSpeech("\\ln x"), "natural log x");
  assert.equal(sp.mathToSpeech("\\log_{2} 8"), "log base 2 8");
  // A derivative is "d y by d x", not "d y over d x"; a limit reads its arrow.
  assert.equal(sp.mathToSpeech("\\frac{dy}{dx}"), "d y by d x");
  assert.equal(sp.mathToSpeech("f'(x)"), "f prime (x)");
  assert.equal(sp.mathToSpeech("f''(x)"), "f double prime (x)");
  assert.equal(sp.mathToSpeech("\\lim_{x \\to 0} f(x)"), "the limit as x approaches 0 f(x)");
  assert.equal(sp.mathToSpeech("\\int_{0}^{1} x^2 dx"), "the integral from 0 to 1 of x squared dx");
  assert.equal(sp.mathToSpeech("\\sum_{n=1}^{10} n"), "the sum from n equals 1 to 10 of n");
  assert.equal(sp.mathToSpeech("\\sum_{k=1}^{n} k"), "the sum from k equals 1 to n of k");
  // Displayed notation is never changed by any of this: only the spoken version is.
});

test("an answer loses its Markdown and its dollar signs, and keeps its words", () => {
  const spoken = sp.toSpeech("## Good question\n\nTo factorise $x^2 + 5x + 6$ we need **two numbers**.\n\n- They multiply to $6$\n- They add to $5$\n\nSee [the notes](https://example.com/x).");
  assert.doesNotMatch(spoken, /[$*#\\\[\]]|https?:/);
  assert.match(spoken, /Good question/);
  assert.match(spoken, /x squared plus 5x plus 6/);
  assert.match(spoken, /two numbers/);
  assert.match(spoken, /the notes/);
  assert.match(spoken, /They multiply to 6/);
});

test("display maths, code and plain powers are handled", () => {
  assert.match(sp.toSpeech("$$\\frac{a}{b}$$"), /a over b/);
  assert.match(sp.toSpeech("Use ```python\nprint(1)\n``` here"), /code example is on the screen/);
  assert.doesNotMatch(sp.toSpeech("Use ```python\nprint(1)\n``` here"), /print/);
  assert.match(sp.toSpeech("Then x^2 is bigger than y^3."), /x squared is bigger than y cubed/);
  assert.equal(sp.toSpeech("**Hello** there \u{1F600}"), "Hello there");
});

test("speech is split into sentences with a short first chunk and padded later ones", () => {
  const text = "Okay. Let us look at this together because it is a good one. First, what do you notice? Yes. Now try the next step on your own please, and tell me what you get.";
  const chunks = sp.speechChunks(text);
  assert.ok(chunks.length >= 2 && chunks.length <= 4, JSON.stringify(chunks));
  assert.ok(chunks[0].length < 80);
  assert.equal(chunks.join(" "), text);
  assert.deepEqual(sp.speechChunks(""), []);
  const long = `${"word ".repeat(200)}end.`;
  assert.ok(sp.speechChunks(long).every((c) => c.length <= 300));
});

test("a long first sentence is cut at a pause so the first clip stays short", () => {
  // Kokoro synthesises at roughly real time on this CPU, so the first clip's length IS the wait before the student hears anything.
  const paused = "On a graph, the gradient tells you how steeply a line is rising or falling, and that is what the question is about.";
  const chunks = sp.speechChunks(paused);
  assert.equal(chunks[0], "On a graph, the gradient tells you how steeply a line is rising or falling,", chunks[0]);
  assert.equal(chunks.join(" "), paused, "no word is lost or repeated by the cut");
  // A sentence of ordinary length with no pause is spoken whole: a chopped clause sounds worse than the wait.
  const oneClause = "Factorise the expression by finding two numbers whose product is six and whose sum is five.";
  assert.equal(sp.speechChunks(oneClause)[0], oneClause);
  // A very long one is cut at a word boundary rather than making the student wait for all of it.
  const endless = "Factorise the expression by finding two numbers whose product is six and whose sum is five and then write them as a pair of brackets around x plus each of those numbers.";
  assert.ok(sp.speechChunks(endless)[0].length <= 64, sp.speechChunks(endless)[0]);
  assert.equal(sp.speechChunks(endless).join(" "), endless);
  // The options are still honoured where callers set them.
  assert.equal(sp.speechChunks(paused, { firstMax: 400 })[0], paused);
});

test("the voice addendum asks for short, spoken wording", () => {
  assert.match(sp.VOICE_PROMPT_ADDENDUM, /listening/);
  assert.match(sp.VOICE_PROMPT_ADDENDUM, /four sentences/);
});

test("while an answer streams, only settled sentences are spoken, outside maths and code", () => {
  assert.equal(sp.settledPrefix("Good question. Let us"), "Good question.");
  assert.equal(sp.settledPrefix("No sentence end yet"), "");
  assert.equal(sp.settledPrefix("The end is here."), "", "a final full stop with nothing after it is not settled yet");
  assert.equal(sp.settledPrefix("Try $x = 2.5. And then"), "", "an unfinished maths span is never cut");
  assert.equal(sp.settledPrefix("Try $x = 2.5$. And then"), "Try $x = 2.5$.");
  assert.equal(sp.settledPrefix("```py\nprint(1). \n"), "", "an open code fence is never cut");

  const text = "Okay. Let us look at this together because it is a good one. First, what do you notice? Now try";
  const first = sp.speechChunksPartial(sp.toSpeech(sp.settledPrefix(text)));
  assert.deepEqual(first.ready, ["Okay. Let us look at this together because it is a good one."]);
  // More text arriving never changes a chunk that was ready.
  const more = sp.speechChunksPartial(sp.toSpeech(sp.settledPrefix(`${text} on your own. Then tell me what you get. And`)));
  assert.equal(more.ready[0], first.ready[0]);
  assert.ok(more.ready.length >= first.ready.length);
});
