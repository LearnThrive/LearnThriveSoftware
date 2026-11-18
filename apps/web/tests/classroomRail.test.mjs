import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The cameras beside a shared screen or the whiteboard: students on top, the tutor (or the host of a meeting) below, everyone else keeping their place.

const { orderRail } = loadTsFrom(import.meta.url, "../src/features/classroom/components/railOrder.ts");
const who = (entries) => orderRail(entries).map((entry) => entry.key);

test("a student goes above the tutor, whichever way round they are listed", () => {
  assert.deepEqual(who([{ key: "tutor", role: "tutor" }, { key: "student", role: "student" }]), ["student", "tutor"]);
  assert.deepEqual(who([{ key: "student", role: "student" }, { key: "tutor", role: "tutor" }]), ["student", "tutor"]);
});

test("with several students they keep their own order and the tutor is last", () => {
  assert.deepEqual(
    who([{ key: "t", role: "tutor" }, { key: "s1", role: "student" }, { key: "s2", role: "student" }, { key: "s3", role: "student" }]),
    ["s1", "s2", "s3", "t"],
  );
});

test("someone with no role yet is treated as a student, not the tutor, and the input is not changed", () => {
  const input = [{ key: "t", role: "tutor" }, { key: "x", role: null }];
  assert.deepEqual(who(input), ["x", "t"]);
  assert.deepEqual(input.map((entry) => entry.key), ["t", "x"]);
});
