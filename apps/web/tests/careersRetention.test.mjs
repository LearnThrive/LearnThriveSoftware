import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The periods an application is kept for are written in two places on purpose: careersConfig, which the public pages and the privacy
// notice quote, and CAREERS_RETENTION in the careers store, which writes the deletion dates onto each application (launch checklist
// 3.12.5). This holds the two together, so the notice can never promise one period while the app deletes on another.

const { careersConfig } = loadTsFrom(import.meta.url, "../src/lib/careers-config.ts");
const { CAREERS_RETENTION, retentionFor } = loadTsFrom(import.meta.url, "../../../packages/data/src/careers.ts");

test("the store deletes on the periods the public pages quote", () => {
  assert.equal(CAREERS_RETENTION.unsuccessfulMonths, careersConfig.unsuccessfulRetentionMonths);
  assert.equal(CAREERS_RETENTION.identityMonths, careersConfig.unsuccessfulRetentionMonths, "identity documents go at the unsuccessful period");
  assert.equal(CAREERS_RETENTION.talentPoolMonths, careersConfig.talentPool.retentionMonths);
});

test("only an unsuccessful or withdrawn decision sets deletion dates", () => {
  const decided = new Date("2026-11-06T12:00:00.000Z");
  for (const status of ["NEW", "REVIEWING", "INTERVIEW", "ACCEPTED"]) assert.deepEqual(retentionFor(status, decided, false), { deleteAfter: null, identityDeleteAfter: null }, status);
  assert.equal(retentionFor("REJECTED", decided, false).deleteAfter, "2027-05-06T12:00:00.000Z");
  assert.equal(retentionFor("WITHDRAWN", decided, true).deleteAfter, "2027-11-06T12:00:00.000Z");
  assert.equal(retentionFor("REJECTED", null, false).deleteAfter, null, "no decision date, no clock");
});
