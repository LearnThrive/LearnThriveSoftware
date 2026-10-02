import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan15 Wave 9: command palette ranking. Pure, so the whole matching contract is pinned here.
const { rankCommands, scoreCommand } = loadTsFrom(import.meta.url, "../src/lib/palette/score.ts");

const commands = [
  { title: "Home", group: "Pages" },
  { title: "Maths tuition", group: "Subjects", keywords: ["algebra", "gcse", "a-level", "number"] },
  { title: "English tuition", group: "Subjects", keywords: ["reading", "writing", "gcse"] },
  { title: "Science tuition", group: "Subjects", keywords: ["biology", "chemistry", "physics", "gcse"] },
  { title: "11+ tuition", group: "Subjects", keywords: ["eleven plus", "entrance"] },
  { title: "Send an enquiry", group: "Actions", keywords: ["book", "contact", "consultation"] },
  { title: "Safeguarding", group: "Pages", keywords: ["dbs", "child protection"] },
  { title: "Switch to dark theme", group: "Appearance", keywords: ["night", "colour"] },
];
const titles = (query) => rankCommands(query, commands).map((c) => c.title);

test("an empty query returns everything in authored order", () => {
  assert.deepEqual(titles(""), commands.map((c) => c.title));
  assert.deepEqual(titles("   "), commands.map((c) => c.title));
});

test("a title prefix outranks a keyword match, and an exact title outranks a prefix", () => {
  assert.equal(titles("maths")[0], "Maths tuition");
  assert.equal(titles("home")[0], "Home");
  const ranked = titles("gcse");
  assert.deepEqual(ranked.slice().sort(), ["English tuition", "Maths tuition", "Science tuition"].sort(), "only the subjects with that keyword");
});

test("every token must match, in any order", () => {
  assert.deepEqual(titles("tuition maths"), ["Maths tuition"]);
  assert.deepEqual(titles("dark theme"), ["Switch to dark theme"]);
  assert.deepEqual(titles("dark banana"), []);
});

test("a word-start match in the title outranks a mid-word match and a keyword match", () => {
  const scores = {
    wordStart: scoreCommand("tuition", { title: "Maths tuition" }),
    midWord: scoreCommand("uition", { title: "Maths tuition" }),
    keyword: scoreCommand("algebra", { title: "Maths tuition", keywords: ["algebra"] }),
    group: scoreCommand("subjects", { title: "Maths tuition", group: "Subjects" }),
  };
  assert.ok(scores.wordStart > scores.midWord);
  assert.ok(scores.midWord > scores.keyword);
  assert.ok(scores.keyword > scores.group);
  assert.ok(scores.group > 0);
});

test("matching ignores case, accents and punctuation noise", () => {
  assert.deepEqual(titles("MATHS"), ["Maths tuition"]);
  assert.deepEqual(titles("11+"), ["11+ tuition"]);
  assert.equal(scoreCommand("cafe", { title: "Café opening hours" }) > 0, true);
  assert.deepEqual(titles("a-level"), ["Maths tuition"]);
});

test("ties keep the authored order", () => {
  assert.deepEqual(titles("tuition"), ["Maths tuition", "English tuition", "Science tuition", "11+ tuition"]);
});

test("a query matching nothing returns nothing", () => {
  assert.deepEqual(titles("zzzz"), []);
  assert.equal(scoreCommand("zzzz", { title: "Home" }), -1);
});
