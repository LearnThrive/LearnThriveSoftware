import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createMemoryMeetings, createSqlMeetings, meetingRoleFor, MeetingError, type MeetingRepository, type NewMeeting } from "./meetings";
import { createTestDb, type TestDb } from "./testing/pglite";

// Staff meetings: one contract, run against the in-memory store and Postgres (PGlite), plus the pure rules and the database's own guarantees.

const person = (name: string) => ({ id: randomUUID(), name });
const meeting = (over: Partial<NewMeeting> = {}): NewMeeting => ({
  title: "Weekly tutor catch-up", startsAt: "2026-12-01T10:00:00.000Z", durationMinutes: 45, hostId: "host-1", hostName: "Alvi", invitees: [person("Tara")], ...over,
});

function contract(name: string, make: () => Promise<{ repo: MeetingRepository; close(): Promise<void> }>) {
  describe(`meetings contract: ${name}`, () => {
    let repo: MeetingRepository;
    let close: () => Promise<void>;
    before(async () => ({ repo, close } = await make()));
    after(() => close());

    test("a meeting is stored cleanly, with a private room and the invitees, and is found by its id", async () => {
      const tara = person("  Tara  ");
      const made = await repo.create(meeting({ title: "  Planning   the term ", invitees: [tara, tara, { id: "host-1", name: "Alvi" }] }));
      assert.equal(made.title, "Planning the term");
      assert.deepEqual(made.invitees, [{ id: tara.id, name: "Tara" }], "trimmed, de-duplicated, and the host is never also an invitee");
      assert.match(made.roomId, /^[a-z0-9][a-z0-9-]{7,47}$/);
      assert.equal(made.cancelledAt, null);
      assert.deepEqual(await repo.get(made.id), made);
      assert.equal(await repo.get(randomUUID()), null);
      assert.equal(await repo.get("not-an-id"), null);
    });

    test("two meetings never share a room", async () => {
      const a = await repo.create(meeting());
      const b = await repo.create(meeting());
      assert.notEqual(a.roomId, b.roomId);
    });

    test("what is refused: a short title, a bad time, a bad length, nobody to meet, too many people", async () => {
      await assert.rejects(repo.create(meeting({ title: "x" })), MeetingError);
      await assert.rejects(repo.create(meeting({ startsAt: "soon" })), MeetingError);
      await assert.rejects(repo.create(meeting({ durationMinutes: 2 })), MeetingError);
      await assert.rejects(repo.create(meeting({ durationMinutes: 600 })), MeetingError);
      await assert.rejects(repo.create(meeting({ durationMinutes: 30.5 })), MeetingError);
      await assert.rejects(repo.create(meeting({ invitees: [] })), MeetingError);
      await assert.rejects(repo.create(meeting({ invitees: [{ id: "host-1", name: "Alvi" }] })), MeetingError, "the host alone is not a meeting");
      await assert.rejects(repo.create(meeting({ invitees: Array.from({ length: 10 }, () => person("Someone")) })), MeetingError);
    });

    test("a person sees the meetings they host or are invited to that have not finished, soonest first, and nobody else's", async () => {
      const host = randomUUID();
      const guest = person("Guest");
      const stranger = randomUUID();
      const later = await repo.create(meeting({ hostId: host, startsAt: "2026-12-03T10:00:00.000Z", invitees: [guest] }));
      const sooner = await repo.create(meeting({ hostId: host, startsAt: "2026-12-02T10:00:00.000Z", invitees: [guest] }));
      const over = await repo.create(meeting({ hostId: host, startsAt: "2026-11-30T10:00:00.000Z", durationMinutes: 30, invitees: [guest] }));
      const since = "2026-12-01T00:00:00.000Z";
      assert.deepEqual((await repo.forPerson(host, since)).map((m) => m.id), [sooner.id, later.id]);
      assert.deepEqual((await repo.forPerson(guest.id, since)).map((m) => m.id), [sooner.id, later.id]);
      assert.deepEqual(await repo.forPerson(stranger, since), []);
      assert.ok((await repo.forPerson(host, "2026-11-30T00:00:00.000Z")).some((m) => m.id === over.id), "a meeting that has not ended by then is still listed");
    });

    test("cancelling keeps the meeting but takes it off everyone's list, once", async () => {
      const host = randomUUID();
      const guest = person("Guest");
      const m = await repo.create(meeting({ hostId: host, invitees: [guest] }));
      assert.equal(await repo.cancel(m.id, host), true);
      assert.equal(await repo.cancel(m.id, host), false, "already cancelled");
      assert.equal(await repo.cancel(randomUUID(), host), false);
      assert.equal(await repo.cancel("not-an-id", host), false);
      assert.deepEqual(await repo.forPerson(guest.id, "2026-01-01T00:00:00.000Z"), []);
      assert.ok((await repo.get(m.id))?.cancelledAt, "still there, marked");
    });
  });
}

contract("in-memory", async () => ({ repo: createMemoryMeetings(), close: async () => {} }));
contract("sql on PGlite", async () => {
  const db = await createTestDb();
  return { repo: createSqlMeetings({ query: <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params)) }), close: () => db.close() };
});

describe("who may enter a meeting", () => {
  const base = { hostId: "h", invitees: [{ id: "i", name: "Invitee" }], cancelledAt: null };
  test("the host and the invited, no one else, and no one once it is cancelled", () => {
    assert.equal(meetingRoleFor(base, "h"), "HOST");
    assert.equal(meetingRoleFor(base, "i"), "INVITEE");
    assert.equal(meetingRoleFor(base, "x"), null);
    assert.equal(meetingRoleFor({ ...base, cancelledAt: "2026-12-01T09:00:00.000Z" }, "h"), null);
    assert.equal(meetingRoleFor({ ...base, cancelledAt: "2026-12-01T09:00:00.000Z" }, "i"), null);
  });
});

describe("meeting tables in Postgres", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.close());

  test("neither a signed-in user nor an anonymous visitor can read or write them through the API roles", async () => {
    const userId = await db.createUser({ displayName: "Tutor", adult: true });
    for (const t of ["staff_meetings", "staff_meeting_invitees"]) {
      await assert.rejects(db.asUser(userId, (q) => q.query(`select 1 from public.${t}`)), `authenticated can read ${t}`);
      await assert.rejects(db.asAnon((q) => q.query(`select 1 from public.${t}`)), `anon can read ${t}`);
      await assert.rejects(db.asUser(userId, (q) => q.query(`insert into public.${t} default values`)), `authenticated can write ${t}`);
    }
  });

  test("the database refuses a room code that is not the video room's shape, and a half-cancelled row", async () => {
    const owner = (sql: string, params?: unknown[]) => db.asOwner((q) => q.query(sql, params));
    await assert.rejects(owner("insert into public.staff_meetings (title, starts_at, duration_minutes, room_id, host_id, host_name) values ('Meet', now(), 30, 'SHORT', 'h', 'H')"));
    await assert.rejects(owner("insert into public.staff_meetings (title, starts_at, duration_minutes, room_id, host_id, host_name, cancelled_at) values ('Meet', now(), 30, 'room-abcdefgh', 'h', 'H', now())"));
  });
});
