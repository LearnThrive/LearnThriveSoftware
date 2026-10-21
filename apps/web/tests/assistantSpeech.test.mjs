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
