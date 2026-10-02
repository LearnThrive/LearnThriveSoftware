import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan15 Wave 11 section 15.2: the app's keyboard shortcuts and static palette commands are role-scoped,
// never destructive and never steal typing.

const shortcuts = loadTsFrom(import.meta.url, "../src/lib/palette/appShortcuts.ts");
const { buildAppCommands } = loadTsFrom(import.meta.url, "../src/lib/palette/appCommands.ts");
const { navigationFor } = loadTsFrom(import.meta.url, "../src/lib/navigation/appNavigation.ts");
const { quickCreateFor } = loadTsFrom(import.meta.url, "../src/lib/navigation/quickCreate.ts");

const ROLES = ["ADMIN", "TUTOR", "CLIENT", "STUDENT"];
const navHrefs = (role) => new Set(navigationFor(role).flatMap((s) => s.items.map((i) => i.href)));
const noop = () => {};

test("every go-to sequence points at a page in the role's own navigation", () => {
  for (const role of ROLES) {
    for (const target of shortcuts.goToTargetsFor(role)) {
      assert.ok(navHrefs(role).has(target.href), `${role}: g ${target.key} -> ${target.href} is not in that role's navigation`);
    }
  }
});

test("a role never gets another role's go-to shortcuts", () => {
  const keys = (role) => shortcuts.goToTargetsFor(role).map((t) => t.key);
  assert.ok(keys("ADMIN").includes("a"), "Admin has Assignments");
  for (const role of ["TUTOR", "CLIENT", "STUDENT"]) assert.ok(!keys(role).includes("a"), `${role} must not have the Admin-only Assignments shortcut`);
  assert.ok(keys("TUTOR").includes("v"), "Tutor has Availability");
  for (const role of ["ADMIN", "CLIENT", "STUDENT"]) assert.ok(!keys(role).includes("v"), `${role} must not have Availability`);
  assert.ok(!keys("STUDENT").includes("p"), "a Student has no People page");
  const hrefs = (role) => shortcuts.goToTargetsFor(role).map((t) => t.href);
  assert.ok(hrefs("TUTOR").every((h) => !h.startsWith("/dashboard/admin/")), "Tutor shortcuts never go to /dashboard/admin");
  assert.ok(hrefs("CLIENT").every((h) => !h.startsWith("/dashboard/admin/")));
});

test("g then a letter goes there; the second key must come in time; anything else cancels", () => {
  const targets = shortcuts.goToTargetsFor("ADMIN");
  const tracker = shortcuts.createGoToTracker(targets);
  assert.deepEqual(tracker.press("g", 1000), { kind: "pending" });
  assert.deepEqual(tracker.press("l", 1300), { kind: "go", href: "/dashboard/lessons" });
  // Too slow: the `l` is just a letter, not a destination.
  assert.deepEqual(tracker.press("g", 5000), { kind: "pending" });
  assert.deepEqual(tracker.press("l", 5000 + shortcuts.GO_TIMEOUT_MS + 1), { kind: "none" });
  // An unknown second key cancels, and does not leave the prefix armed.
  assert.deepEqual(tracker.press("g", 9000), { kind: "pending" });
  assert.deepEqual(tracker.press("z", 9100), { kind: "none" });
  assert.deepEqual(tracker.press("l", 9200), { kind: "none" });
  // A letter without the prefix does nothing.
  assert.deepEqual(tracker.press("d", 12000), { kind: "none" });
  // Case does not matter.
  tracker.press("G", 13000);
  assert.deepEqual(tracker.press("D", 13100), { kind: "go", href: "/dashboard" });
});

test("a role's tracker only knows its own targets", () => {
  const tutor = shortcuts.createGoToTracker(shortcuts.goToTargetsFor("TUTOR"));
  tutor.press("g", 0);
  assert.deepEqual(tutor.press("a", 100), { kind: "none" }, "Admin-only Assignments is not reachable by a Tutor");
});

const key = (k, extra = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, isComposing: false, ...extra });
const field = { tagName: "INPUT", type: "text" };

test("no shortcut fires while typing, with a modifier, or during composition", () => {
  assert.equal(shortcuts.isGoToCandidate(key("g"), { tagName: "BODY" }), true);
  assert.equal(shortcuts.isGoToCandidate(key("g"), field), false);
  assert.equal(shortcuts.isGoToCandidate(key("g"), { tagName: "TEXTAREA" }), false);
  assert.equal(shortcuts.isGoToCandidate(key("g"), { tagName: "DIV", isContentEditable: true }), false);
  assert.equal(shortcuts.isGoToCandidate(key("g", { ctrlKey: true }), { tagName: "BODY" }), false);
  assert.equal(shortcuts.isGoToCandidate(key("g", { metaKey: true }), { tagName: "BODY" }), false);
  assert.equal(shortcuts.isGoToCandidate(key("g", { altKey: true }), { tagName: "BODY" }), false);
  assert.equal(shortcuts.isGoToCandidate(key("g", { isComposing: true }), { tagName: "BODY" }), false);
  assert.equal(shortcuts.isGoToCandidate(key("Enter"), { tagName: "BODY" }), false, "only single characters");
});

test("? opens the help only outside a text field and without ctrl/cmd/alt", () => {
  assert.equal(shortcuts.opensShortcutHelp(key("?", { shiftKey: true }), { tagName: "BODY" }), true);
  assert.equal(shortcuts.opensShortcutHelp(key("?", { shiftKey: true }), field), false);
  assert.equal(shortcuts.opensShortcutHelp(key("?", { ctrlKey: true }), { tagName: "BODY" }), false);
  assert.equal(shortcuts.opensShortcutHelp(key("/"), { tagName: "BODY" }), false);
});

test("the app palette's commands for a role are exactly that role's pages, plus what it may create", () => {
  for (const role of ROLES) {
    const commands = buildAppCommands(role, { showShortcuts: noop, signOut: noop });
    const pageCommands = commands.filter((c) => c.group === "Go to");
    assert.deepEqual(new Set(pageCommands.map((c) => c.href)), navHrefs(role), `${role}: page commands must equal the role's navigation`);
    const creates = commands.filter((c) => c.group === "Create").map((c) => c.href);
    assert.deepEqual(creates, quickCreateFor(role).map((i) => i.href), `${role}: create commands must equal what quick-create offers`);
  }
});

test("only an Admin is offered anything to create; nobody else sees an /admin/ link at all", () => {
  for (const role of ["TUTOR", "CLIENT", "STUDENT"]) {
    const commands = buildAppCommands(role, { showShortcuts: noop, signOut: noop });
    assert.equal(commands.filter((c) => c.group === "Create").length, 0, role);
    assert.ok(commands.every((c) => !c.href || !c.href.startsWith("/dashboard/admin/")), `${role} was offered an Admin route`);
  }
  assert.equal(buildAppCommands("ADMIN", { showShortcuts: noop, signOut: noop }).filter((c) => c.group === "Create").length, 5);
});

test("every command has a unique id, a title, and either a route or an action; the only account action is sign out", () => {
  for (const role of ROLES) {
    const commands = buildAppCommands(role, { showShortcuts: noop, signOut: noop });
    assert.equal(new Set(commands.map((c) => c.id)).size, commands.length, `${role}: duplicate command ids`);
    for (const c of commands) {
      assert.ok(c.title.trim(), c.id);
      assert.ok(Boolean(c.href) !== Boolean(c.run), `${c.id}: needs exactly one of href or run`);
    }
    const accountActions = commands.filter((c) => c.group === "Account").map((c) => c.id);
    assert.deepEqual(accountActions, ["account:sign-out"]);
    assert.ok(!commands.some((c) => /delete|remove|reset|cancel/i.test(c.title)), `${role}: no destructive command`);
  }
});

test("sign out and the shortcut help run the callbacks they were given", () => {
  let signedOut = 0;
  let helped = 0;
  const commands = buildAppCommands("TUTOR", { showShortcuts: () => (helped += 1), signOut: () => (signedOut += 1) });
  commands.find((c) => c.id === "account:sign-out").run();
  commands.find((c) => c.id === "help:shortcuts").run();
  assert.deepEqual([signedOut, helped], [1, 1]);
});

test("the shortcut hint on a page command is the real sequence for that page", () => {
  const commands = buildAppCommands("ADMIN", { showShortcuts: noop, signOut: noop });
  assert.equal(commands.find((c) => c.href === "/dashboard/lessons").hint, "G L");
  assert.equal(commands.find((c) => c.href === "/dashboard/admin/assignments").hint, "G A");
});
