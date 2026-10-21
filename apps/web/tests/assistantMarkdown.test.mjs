import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

const md = loadTsFrom(import.meta.url, "../src/lib/assistant/markdown.ts");
const inline = (s) => md.parseInline(s);
const kinds = (nodes) => nodes.map((n) => n.t);

test("inline: bold, italic, code and maths are found, and plain text is left alone", () => {
  assert.deepEqual(inline("plain words"), [{ t: "text", text: "plain words" }]);
  const nodes = inline("Use **factorising**, *carefully*, `x = 2` and $x^2 + 3x = 0$.");
  assert.deepEqual(kinds(nodes), ["text", "b", "text", "i", "text", "code", "text", "math", "text"]);
  assert.equal(nodes[7].tex, "x^2 + 3x = 0");
  assert.equal(nodes[5].text, "x = 2");
  assert.deepEqual(inline("\\(a+b\\)"), [{ t: "math", tex: "a+b" }]);
});

test("inline: money is not maths, an unclosed marker is text, and nothing inside code is read", () => {
  assert.deepEqual(kinds(inline("It costs $5 and $10 in total")), ["text"]);
  assert.deepEqual(kinds(inline("$5.50 is cheaper than $6")), ["text"]);
  assert.deepEqual(inline("a * b and 2 * 3"), [{ t: "text", text: "a * b and 2 * 3" }]);
  assert.deepEqual(inline("**unclosed"), [{ t: "text", text: "**unclosed" }]);
  assert.deepEqual(inline("`**not bold** $x$`"), [{ t: "code", text: "**not bold** $x$" }]);
  assert.deepEqual(kinds(inline("snake_case_name stays")), ["text"]);
});

test("inline: no raw HTML and no links: markup stays as text and a link keeps only its label", () => {
  const html = inline('<script>alert(1)</script> <img src=x onerror="alert(1)">');
  assert.deepEqual(html, [{ t: "text", text: '<script>alert(1)</script> <img src=x onerror="alert(1)">' }]);
  assert.deepEqual(inline("[click here](javascript:alert(1))"), [{ t: "text", text: "click here" }]);
  assert.deepEqual(inline("see [the BBC page](https://example.com/x)"), [{ t: "text", text: "see " }, { t: "text", text: "the BBC page" }]);
  assert.ok(!JSON.stringify(inline("[a](http://evil.example)")).includes("evil"), "the address is dropped");
});

test("inline: nesting cannot run away, and very long maths is not attempted", () => {
  const deep = "*".repeat(40) + "x" + "*".repeat(40);
  assert.ok(md.parseInline(deep).length > 0);
  const long = `$${"a".repeat(500)}$`;
  assert.deepEqual(kinds(inline(long)), ["text"]);
});

test("blocks: paragraphs, headings, lists, quotes, code fences and display maths", () => {
  const source = [
    "# Title",
    "Intro line one",
    "continues here.",
    "",
    "- first",
    "- second with **bold**",
    "",
    "1. step one",
    "2) step two",
    "",
    "> a quote",
    "",
    "```js",
    "const a = 1;",
    "```",
    "",
    "$$x = \\frac{-b}{2a}$$",
    "",
    "\\[",
    "y = mx + c",
    "\\]",
  ].join("\n");
  const blocks = md.parseMarkdown(source);
  assert.deepEqual(blocks.map((b) => b.t), ["h", "p", "ul", "ol", "quote", "code", "math", "math"]);
  assert.equal(blocks[0].level, 3);
  assert.equal(blocks[1].children.filter((n) => n.t === "br").length, 1);
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[3].items.length, 2);
  assert.equal(blocks[5].text, "const a = 1;");
  assert.equal(blocks[6].tex, "x = \\frac{-b}{2a}");
  assert.equal(blocks[7].tex, "y = mx + c");
  assert.equal(md.parseMarkdown("").length, 0);
  assert.equal(md.parseMarkdown("\n\n  \n").length, 0);
  assert.deepEqual(md.parseMarkdown("```\nnever closed").map((b) => b.t), ["code"]);
  assert.equal(md.parseMarkdown("####### seven").at(0).t, "p", "more than six hashes is not a heading");
});

test("plainText gives the words without markup", () => {
  assert.equal(md.plainText(md.parseMarkdown("## Hi\n\nA **bold** idea: $x^2$.\n\n- one\n- two")), "Hi A bold idea: x^2. one. two");
});
