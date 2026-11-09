import {
  isSafeguardingLead, receiptOf, type Concern, type ConcernEvent, type ConcernEventKind, type ConcernReceipt, type ConcernStatus, type NewConcern, type NewVettingCheck,
  type SafeguardingActor, type SafeguardingLeads, type VettingCheck, CONCERN_STATUSES, SafeguardingError,
} from "./types";

/**
 * Where the safeguarding records live. Two implementations held to one contract (testing/safeguardingContract.ts): memory for development
 * and tests, Postgres for production (migration 0022). The repository stores; WHO may read a concern is decided by the functions below,
 * which every caller in apps/web goes through.
 */
export interface SafeguardingRepository {
  vetting: {
    /** Current (not voided) checks, for one tutor or for all. */
    list(tutorId?: string): Promise<VettingCheck[]>;
    /** `today` (yyyy-mm-dd, London) is what "not in the future" is measured against. */
    record(input: NewVettingCheck, today: string): Promise<VettingCheck>;
    /** A mistake is voided with a reason and kept, never edited or deleted. */
    void(id: string, reason: string, actor: string): Promise<void>;
  };
  concerns: {
    create(input: NewConcern): Promise<Concern>;
    get(id: string): Promise<Concern | null>;
    list(): Promise<Concern[]>;
    raisedBy(actorId: string): Promise<Concern[]>;
    setStatus(id: string, status: ConcernStatus): Promise<Concern>;
    appendEvent(event: { concernId: string; actorId: string; kind: ConcernEventKind; note?: string }): Promise<ConcernEvent>;
    events(concernId: string): Promise<ConcernEvent[]>;
  };
}

// ---- the rules about who may do what with a concern ----------------------------------------------------------------------------------

/** A tutor or an administrator raises a concern. It is stored first; telling the leads is the caller's next step and can fail safely. */
export async function raiseConcern(repo: SafeguardingRepository, input: NewConcern): Promise<ConcernReceipt> {
  const concern = await repo.concerns.create(input);
  await repo.concerns.appendEvent({ concernId: concern.id, actorId: input.raisedBy, kind: "RAISED" });
  return receiptOf(concern);
}

/** What the person who raised concerns sees afterwards: receipts only, never the content. */
export async function myConcernReceipts(repo: SafeguardingRepository, actorId: string): Promise<ConcernReceipt[]> {
  return (await repo.concerns.raisedBy(actorId)).map(receiptOf);
}

export type ConcernAccess<T> = { ok: true; value: T } | { ok: false; reason: "not_lead" | "not_found" };

/** The list, for a named lead only. Anyone else gets nothing, whatever their role. */
export async function listConcerns(repo: SafeguardingRepository, actor: SafeguardingActor, leads: SafeguardingLeads): Promise<ConcernAccess<Concern[]>> {
  if (!isSafeguardingLead(actor, leads)) return { ok: false, reason: "not_lead" };
  return { ok: true, value: await repo.concerns.list() };
}

/**
 * Opens one concern. Only a named lead gets it, and every opening is written to its history. An attempt by anyone else is refused AND
 * recorded on the concern, so the leads can see who tried.
 */
export async function readConcern(
  repo: SafeguardingRepository, id: string, actor: SafeguardingActor, leads: SafeguardingLeads,
): Promise<ConcernAccess<{ concern: Concern; events: ConcernEvent[] }>> {
  const concern = await repo.concerns.get(id);
  if (!isSafeguardingLead(actor, leads)) {
    if (concern) await repo.concerns.appendEvent({ concernId: concern.id, actorId: actor.id, kind: "ACCESS_REFUSED" });
    return { ok: false, reason: "not_lead" };
  }
  if (!concern) return { ok: false, reason: "not_found" };
  await repo.concerns.appendEvent({ concernId: concern.id, actorId: actor.id, kind: "VIEWED" });
  return { ok: true, value: { concern, events: await repo.concerns.events(concern.id) } };
}

/** A lead moves a concern on, or adds a note. The concern's own text never changes. */
export async function updateConcern(
  repo: SafeguardingRepository, id: string, actor: SafeguardingActor, leads: SafeguardingLeads, change: { status?: ConcernStatus; note?: string },
): Promise<ConcernAccess<Concern>> {
  const concern = await repo.concerns.get(id);
  if (!isSafeguardingLead(actor, leads)) {
    if (concern) await repo.concerns.appendEvent({ concernId: concern.id, actorId: actor.id, kind: "ACCESS_REFUSED" });
    return { ok: false, reason: "not_lead" };
  }
  if (!concern) return { ok: false, reason: "not_found" };
  const note = (change.note ?? "").trim();
  if (note.length > 2000) throw new SafeguardingError("INVALID", "The note is too long (2000 characters at most).");
  if (change.status !== undefined && !(CONCERN_STATUSES as readonly string[]).includes(change.status)) throw new SafeguardingError("INVALID", "Choose a status.");
  if (change.status === undefined && !note) throw new SafeguardingError("INVALID", "Write a note or choose a status.");
  let current = concern;
  if (change.status !== undefined && change.status !== concern.status) {
    current = await repo.concerns.setStatus(id, change.status);
    await repo.concerns.appendEvent({ concernId: id, actorId: actor.id, kind: "STATUS", note: `${concern.status} to ${change.status}${note ? `: ${note}` : ""}` });
  } else if (note) {
    await repo.concerns.appendEvent({ concernId: id, actorId: actor.id, kind: "NOTE", note });
  }
  return { ok: true, value: current };
}
