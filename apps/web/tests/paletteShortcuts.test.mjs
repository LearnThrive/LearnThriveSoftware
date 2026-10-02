import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan15 Wave 9: the palette's shortcut rules, pinned. A shortcut that steals keystrokes from a
// form is a bug people notice only when it eats their typing.
const { opensPalette, isTypingTarget, isMacPlatform } = loadTsFrom(import.meta.url, "../src/lib/palette/shortcuts.ts");

const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
const body = { tagName: "BODY" };
const input = (type = "text") => ({ tagName: "INPUT", type });

test("Ctrl+K opens on Windows/Linux, Cmd+K on macOS, never the other modifier", () => {
  assert.equal(opensPalette(key("k", { ctrlKey: true }), body, false), true);
  assert.equal(opensPalette(key("K", { ctrlKey: true }), body, false), true, "case-insensitive (Caps Lock)");
  assert.equal(opensPalette(key("k", { metaKey: true }), body, false), false, "Cmd is not the modifier off macOS");
  assert.equal(opensPalette(key("k", { metaKey: true }), body, true), true);
  assert.equal(opensPalette(key("k", { ctrlKey: true }), body, true), false, "Ctrl+K on macOS is not ours");
  assert.equal(opensPalette(key("k", { ctrlKey: true, metaKey: true }), body, true), false, "both held is somebody else's chord");
  assert.equal(opensPalette(key("k"), body, false), false, "a bare k never opens it");
  assert.equal(opensPalette(key("k", { ctrlKey: true, shiftKey: true }), body, false), false);
  assert.equal(opensPalette(key("k", { ctrlKey: true, altKey: true }), body, false), false);
});

test("the chord opens the palette from inside a form field (nobody types Ctrl+K as text)", () => {
  assert.equal(opensPalette(key("k", { ctrlKey: true }), input("text"), false), true);
  assert.equal(opensPalette(key("k", { ctrlKey: true }), { tagName: "TEXTAREA" }, false), true);
});

test("/ opens only when focus is not in a typing target, and never with a modifier", () => {
  assert.equal(opensPalette(key("/"), body, false), true);
  assert.equal(opensPalette(key("/"), input("text"), false), false);
  assert.equal(opensPalette(key("/"), input("email"), false), false);
  assert.equal(opensPalette(key("/"), { tagName: "TEXTAREA" }, false), false);
  assert.equal(opensPalette(key("/"), { tagName: "SELECT" }, false), false);
  assert.equal(opensPalette(key("/"), { tagName: "DIV", isContentEditable: true }, false), false);
  assert.equal(opensPalette(key("/", { ctrlKey: true }), body, false), false);
  assert.equal(opensPalette(key("/"), { tagName: "INPUT", type: "text", closest: (s) => (s === "[data-palette-input]" ? {} : null) }, false), false, "the palette's own input: typing a slash is typing");
});

test("a checkbox, button or link is not a typing target; text-like inputs are", () => {
  assert.equal(isTypingTarget(input("checkbox")), false);
  assert.equal(isTypingTarget(input("radio")), false);
  assert.equal(isTypingTarget(input("submit")), false);
  assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
  assert.equal(isTypingTarget({ tagName: "A" }), false);
  for (const type of ["text", "search", "email", "url", "tel", "password", "number"]) assert.equal(isTypingTarget(input(type)), true, type);
  assert.equal(isTypingTarget(null), false);
});

test("an already-handled event, or an IME composition, never opens it", () => {
  assert.equal(opensPalette({ ...key("k", { ctrlKey: true }), defaultPrevented: true }, body, false), false);
  assert.equal(opensPalette({ ...key("k", { ctrlKey: true }), isComposing: true }, body, false), false);
});

test("macOS is detected from the platform or user agent", () => {
  assert.equal(isMacPlatform("MacIntel", ""), true);
  assert.equal(isMacPlatform("", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), true);
  assert.equal(isMacPlatform("Win32", "Mozilla/5.0 (Windows NT 10.0)"), false);
  assert.equal(isMacPlatform(undefined, undefined), false);
});
