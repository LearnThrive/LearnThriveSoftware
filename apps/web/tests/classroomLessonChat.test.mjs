import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// A lesson's saved chat as the classroom shows it (features/classroom/lessonChat.ts): who wrote each message, and which are yours.

const { savedChatMessages } = loadTsFrom(import.meta.url, "../src/features/classroom/lessonChat.ts");
const saved = (id, senderParty, senderName, own = false) => ({ id, senderParty, senderName, own, text: id, createdAt: "2026-11-26T19:01:00Z", removed: null, file: null });

test("messages from different people never share a sender, so each person's run gets its own name", () => {
  const [a, b, c, d] = savedChatMessages([saved("1", "tutor", "Fatin"), saved("2", "admin", "Alvi", true), saved("3", "tutor", "Fatin"), saved("4", "student", "Sam")]);
  assert.equal(a.senderId, c.senderId, "the same person reads as one sender");
  assert.equal(new Set([a.senderId, b.senderId, d.senderId]).size, 3);
});

test("what is yours is what the website says is yours, whatever you sent it as (an administrator supervising included)", () => {
  const list = savedChatMessages([saved("1", "admin", "Alvi", true), saved("2", "tutor", "Fatin")]);
  assert.deepEqual(list.map((m) => m.own), [true, false]);
});

test("someone else's message sent as an administrator says so, as the live one does", () => {
  const [other, mine] = savedChatMessages([saved("1", "admin", "Ada"), saved("2", "admin", "Alvi", true)]);
  assert.equal(other.name, "Ada (administrator)");
  assert.equal(mine.name, "Alvi (administrator)");
});

test("removed messages are left out, and a file comes as an attachment", () => {
  const list = savedChatMessages([
    { ...saved("1", "tutor", "Fatin"), removed: { at: "2026-11-26T19:02:00Z" } },
    { ...saved("2", "tutor", "Fatin"), file: { displayName: "sheet.pdf", size: 10, contentType: "application/pdf", url: "/f" } },
  ]);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].attachment, { name: "sheet.pdf", size: 10, image: false, url: "/f" });
});
