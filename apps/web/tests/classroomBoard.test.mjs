import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// Sending the whiteboard (features/classroom/board.ts). Changes are sent a few times a second; nothing that changed in between may be lost.

const { boardBatcher } = loadTsFrom(import.meta.url, "../src/features/classroom/board.ts");
const el = (id, version = 1) => ({ id, version, versionNonce: 1 });
const recorder = () => {
  const sent = [];
  return { sent, send: (pageId, elements) => sent.push([pageId, elements.map((e) => `${e.id}@${e.version}`)]) };
};

test("two different changes inside one window are both sent, each element in its latest state", async () => {
  const { sent, send } = recorder();
  const batch = boardBatcher(send, 20);
  batch.add("p1", [el("picture")]);
  batch.add("p1", [el("arrow")]);
  batch.add("p1", [el("picture", 2)]);
  assert.deepEqual(sent, [], "nothing before the window ends");
  await sleep(60);
  assert.deepEqual(sent, [["p1", ["picture@2", "arrow@1"]]]);
});

test("changes on two pages stay on their own pages", async () => {
  const { sent, send } = recorder();
  const batch = boardBatcher(send, 20);
  batch.add("p1", [el("a")]);
  batch.add("p2", [el("b")]);
  await sleep(60);
  assert.deepEqual(sent, [["p1", ["a@1"]], ["p2", ["b@1"]]]);
});

test("a large paste is split into messages the server accepts", () => {
  const { sent, send } = recorder();
  const batch = boardBatcher(send, 20);
  batch.add("p1", Array.from({ length: 450 }, (_, i) => el(`e${i}`)));
  batch.flush();
  assert.deepEqual(sent.map(([, ids]) => ids.length), [200, 200, 50]);
});

test("flush sends what is waiting at once, and only once", async () => {
  const { sent, send } = recorder();
  const batch = boardBatcher(send, 20);
  batch.add("p1", [el("a")]);
  batch.flush();
  batch.flush();
  await sleep(60);
  assert.deepEqual(sent, [["p1", ["a@1"]]]);
});
