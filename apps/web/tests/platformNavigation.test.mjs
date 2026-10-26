import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The one navigation of the signed-in product, built from capabilities. Each row of the brief's target table is a case. Hiding a link is not
// the control (every page and API checks again: learnerFlow.test.mjs, assistantRoutes.test.mjs); this holds the menu to the same facts.

const { platformNavigation } = loadTsFrom(import.meta.url, "../src/lib/navigation/appNavigation.ts");
const { platformAccess } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/access.ts");

const labels = (sections) => sections.flatMap((s) => s.items.map((i) => i.label));
const titles = (sections) => sections.map((s) => s.title).filter(Boolean);
const facts = (over) => ({ enrolled: false, subscription: false, adminGrant: false, ...over });
/** What PlatformShell passes: the access rule's answer, with the pages open. */
const nav = (role, f, over = {}) => {
  const access = platformAccess(role, f);
  return platformNavigation({ role, tuition: access.dashboard, studyBuddy: access.studyBuddy, library: access.library, account: true, ...over });
};

test("a guardian with active family tuition: the family's tuition areas, LearnThrive AI and the Library, in ONE menu", () => {
  const sections = nav("CLIENT", facts({ enrolled: true }));
  assert.deepEqual(labels(sections), ["Home", "Children", "Calendar", "Lesson reports", "Notifications", "Settings", "LearnThrive AI", "Library"]);
  assert.deepEqual(titles(sections), ["Learning"]);
  assert.ok(!labels(sections).includes("Account"), "the account is in the account menu, keeping this sidebar short");
});

test("an invited learner with their OWN active tuition: their lessons and progress, LearnThrive AI, the Library, no billing area", () => {
  const sections = nav("STUDENT", facts({ enrolled: true, ownTuition: true }));
  assert.deepEqual(labels(sections), ["Home", "Calendar", "Lessons", "Feedback", "Notifications", "Settings", "LearnThrive AI", "Library"]);
});

test("a Library-only adult subscriber: LearnThrive AI and the Library, their own account, no tuition", () => {
  const sections = nav("CLIENT", facts({ subscription: true }));
  assert.deepEqual(labels(sections), ["LearnThrive AI", "Library", "Search", "Account"]);
  assert.ok(!labels(sections).some((l) => ["Home", "Children", "Calendar", "Lessons", "Notifications"].includes(l)));
});

test("a learner linked to Library-only access (the household subscribes; or a sibling is enrolled): the same menu, never the sibling's lessons", () => {
  for (const f of [facts({ subscription: true }), facts({ enrolled: true, ownTuition: false })]) {
    const sections = nav("STUDENT", f);
    assert.deepEqual(labels(sections), ["LearnThrive AI", "Library", "Search", "Account"], JSON.stringify(f));
  }
});

test("no current entitlement: only the account (and its recovery actions), nothing paid", () => {
  assert.deepEqual(labels(nav("CLIENT", facts({}))), ["Account"]);
  assert.deepEqual(labels(nav("STUDENT", facts({}))), ["Account"]);
});

test("tutors and administrators keep their staff areas; an administrator also holds LearnThrive AI and the Library, a tutor only what the facts give", () => {
  const admin = labels(nav("ADMIN", facts({})));
  assert.ok(admin.includes("Assignments") && admin.includes("LearnThrive AI") && admin.includes("Library"));
  const tutor = labels(nav("TUTOR", facts({})));
  assert.ok(tutor.includes("Availability") && !tutor.includes("LearnThrive AI") && !tutor.includes("Library"));
  assert.ok(labels(nav("TUTOR", facts({ subscription: true }))).includes("LearnThrive AI"));
});

test("inside a supervised view the menu is the learner's: learning only, no dashboard, no account", () => {
  const access = platformAccess("STUDENT", facts({ enrolled: true, ownTuition: false }));
  const sections = platformNavigation({ role: "STUDENT", tuition: false, studyBuddy: access.studyBuddy, library: access.library, account: false });
  assert.deepEqual(labels(sections), ["LearnThrive AI", "Library", "Search"]);
});

test("a page that is closed gets no link: LearnThrive AI and the Library appear only where they are open", () => {
  const closed = platformNavigation({ role: "CLIENT", tuition: true, studyBuddy: false, library: false, account: true });
  assert.ok(!labels(closed).includes("LearnThrive AI") && !labels(closed).includes("Library"));
  assert.deepEqual(platformNavigation({ role: "CLIENT", tuition: false, studyBuddy: false, library: false, account: false }), []);
});
