import { randomBytes, randomUUID } from "node:crypto";
import type { SafeguardingRepository } from "./repository";
import { SafeguardingError, validateConcern, validateVettingCheck, type Concern, type ConcernEvent, type VettingCheck } from "./types";

interface StoredCheck extends VettingCheck {
  voidedAt?: string;
}

/** SC-yyyymmdd-XXXXXX: the day and six random hex characters. Nothing about the child or the reporter. */
export function newConcernReference(now: Date = new Date()): string {
  return `SC-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/**
 * Development and tests: the same behaviour as the Postgres repository, with nothing persisted. `tutorExists` stands in for the foreign key
 * Postgres has (a check is recorded against a tutor who exists).
 */
export function createMemorySafeguarding(tutorExists: (id: string) => Promise<boolean> = async () => true): SafeguardingRepository {
  const checks: StoredCheck[] = [];
  const concerns: Concern[] = [];
  const events: ConcernEvent[] = [];
  let tick = 0;
  // Strictly increasing timestamps, so "newest" is well defined for rows written in the same millisecond.
  const now = () => new Date(Date.now() + tick++).toISOString();

  return {
    vetting: {
      async list(tutorId) {
        return checks.filter((c) => !c.voidedAt && (tutorId === undefined || c.tutorId === tutorId)).map(({ voidedAt: _v, ...c }) => c)
          .sort((a, b) => a.tutorId.localeCompare(b.tutorId) || b.checkedOn.localeCompare(a.checkedOn) || b.recordedAt.localeCompare(a.recordedAt));
      },
      async record(input, today) {
        const clean = validateVettingCheck(input, today);
        if (!(await tutorExists(clean.tutorId))) throw new SafeguardingError("NOT_FOUND", "That tutor does not exist.");
        const check: StoredCheck = { ...clean, id: randomUUID(), recordedAt: now() };
        checks.push(check);
        return { ...check };
      },
      async void(id, reason, _actor) {
        if (reason.trim().length < 3) throw new SafeguardingError("INVALID", "Say why this check is being removed.");
        const check = checks.find((c) => c.id === id && !c.voidedAt);
        if (!check) throw new SafeguardingError("NOT_FOUND", "That check does not exist.");
        check.voidedAt = now();
      },
    },
    concerns: {
      async create(input) {
        const clean = validateConcern(input);
        const concern: Concern = { ...clean, id: randomUUID(), reference: newConcernReference(), raisedAt: now(), status: "OPEN" };
        concerns.push(concern);
        return { ...concern };
      },
      async get(id) {
        const c = concerns.find((x) => x.id === id);
        return c ? { ...c } : null;
      },
      async list() {
        return concerns.map((c) => ({ ...c })).sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
      },
      async raisedBy(actorId) {
        return concerns.filter((c) => c.raisedBy === actorId).map((c) => ({ ...c })).sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
      },
      async setStatus(id, status) {
        const c = concerns.find((x) => x.id === id);
        if (!c) throw new SafeguardingError("NOT_FOUND", "That concern does not exist.");
        c.status = status;
        return { ...c };
      },
      async appendEvent(event) {
        if (!concerns.some((c) => c.id === event.concernId)) throw new SafeguardingError("NOT_FOUND", "That concern does not exist.");
        const row: ConcernEvent = { id: randomUUID(), concernId: event.concernId, at: now(), actorId: event.actorId, kind: event.kind, note: (event.note ?? "").slice(0, 2000) };
        events.push(row);
        return { ...row };
      },
      async events(concernId) {
        return events.filter((e) => e.concernId === concernId).map((e) => ({ ...e })).sort((a, b) => a.at.localeCompare(b.at));
      },
    },
  };
}

// One development instance for the life of the dev server, like the other in-memory stores (globalThis survives Fast Refresh).
const g = globalThis as unknown as { __learnthriveSafeguarding?: SafeguardingRepository };
export function developmentSafeguarding(): SafeguardingRepository {
  return (g.__learnthriveSafeguarding ??= createMemorySafeguarding());
}
export function resetDevelopmentSafeguarding(): SafeguardingRepository {
  return (g.__learnthriveSafeguarding = createMemorySafeguarding());
}
