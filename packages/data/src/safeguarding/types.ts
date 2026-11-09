// Two safeguarding records (migration 0022, docs/SAFEGUARDING_RECORDS.md): the tutor vetting register and the concern log.
// Pure types and rules: no I/O here, so the rules are testable on plain data.

export class SafeguardingError extends Error {
  constructor(public readonly code: "INVALID" | "NOT_FOUND", message: string) {
    super(message);
    this.name = "SafeguardingError";
  }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (v: string): boolean => YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

// ---- vetting -----------------------------------------------------------------------------------------------------------------------

export const VETTING_KINDS = ["DBS", "IDENTITY", "RIGHT_TO_WORK", "REFERENCES", "SAFEGUARDING_TRAINING", "AGREEMENT"] as const;
export type VettingKind = (typeof VETTING_KINDS)[number];

export const VETTING_LABELS: Record<VettingKind, string> = {
  DBS: "DBS check",
  IDENTITY: "Identity",
  RIGHT_TO_WORK: "Right to work",
  REFERENCES: "References",
  SAFEGUARDING_TRAINING: "Safeguarding training",
  AGREEMENT: "Safeguarding agreement",
};

/**
 * The checks a tutor is flagged for when missing or expired. Which checks are required for which role, and how often each is renewed,
 * is the owners' decision (OWNER_ANSWERS E3 to E5, D5: still open), so this is a default that flags, never a rule that blocks.
 */
export const DEFAULT_REQUIRED_VETTING: readonly VettingKind[] = ["DBS", "SAFEGUARDING_TRAINING"];
export const VETTING_DUE_SOON_DAYS = 60;

export interface VettingCheck {
  id: string;
  tutorId: string;
  kind: VettingKind;
  /** The day the check was seen, yyyy-mm-dd. */
  checkedOn: string;
  /** The day it runs out, if it does. */
  expiresOn: string | null;
  /** How it was seen: "Update Service", "Certificate seen in person". Never a certificate number. */
  how: string;
  note: string;
  recordedBy: string;
  recordedAt: string;
}

export type NewVettingCheck = Omit<VettingCheck, "id" | "recordedAt">;
export type VettingState = "MISSING" | "VALID" | "DUE_SOON" | "EXPIRED";

export interface VettingLine {
  kind: VettingKind;
  state: VettingState;
  required: boolean;
  /** The current (newest) check of this kind, if there is one. */
  check: VettingCheck | null;
}

/** A DBS certificate number is 12 digits. The record is that a check was SEEN; the number is never stored, so text carrying one is refused. */
const CERTIFICATE_NUMBER = /\d{12}/;

export function validateVettingCheck(input: NewVettingCheck, today: string): NewVettingCheck {
  const how = input.how.trim();
  const note = input.note.trim();
  if (!(VETTING_KINDS as readonly string[]).includes(input.kind)) throw new SafeguardingError("INVALID", "Choose which check this is.");
  if (!realDate(input.checkedOn)) throw new SafeguardingError("INVALID", "The date the check was seen must be a real date.");
  if (input.checkedOn > today) throw new SafeguardingError("INVALID", "The date the check was seen cannot be in the future.");
  if (input.expiresOn !== null) {
    if (!realDate(input.expiresOn)) throw new SafeguardingError("INVALID", "The expiry date must be a real date.");
    if (input.expiresOn <= input.checkedOn) throw new SafeguardingError("INVALID", "The expiry date must be after the date the check was seen.");
  }
  if (how.length < 2 || how.length > 80) throw new SafeguardingError("INVALID", "Say how the check was seen (2 to 80 characters).");
  if (note.length > 500) throw new SafeguardingError("INVALID", "The note is too long (500 characters at most).");
  if (CERTIFICATE_NUMBER.test(how) || CERTIFICATE_NUMBER.test(note)) {
    throw new SafeguardingError("INVALID", "Do not record a certificate number. Record that the check was seen, how and when.");
  }
  return { ...input, how, note };
}

const addDays = (ymd: string, days: number): string => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Where one tutor stands on every kind of check, as of `today`. The newest check of a kind is the current one. */
export function vettingStatus(checks: VettingCheck[], today: string, required: readonly VettingKind[] = DEFAULT_REQUIRED_VETTING, dueSoonDays = VETTING_DUE_SOON_DAYS): VettingLine[] {
  return VETTING_KINDS.map((kind) => {
    const mine = checks.filter((c) => c.kind === kind).sort((a, b) => b.checkedOn.localeCompare(a.checkedOn) || b.recordedAt.localeCompare(a.recordedAt));
    const check = mine[0] ?? null;
    let state: VettingState = "MISSING";
    if (check) {
      if (check.expiresOn === null) state = "VALID";
      else if (check.expiresOn < today) state = "EXPIRED";
      else if (check.expiresOn <= addDays(today, dueSoonDays)) state = "DUE_SOON";
      else state = "VALID";
    }
    return { kind, state, required: required.includes(kind), check };
  });
}

/** Does this tutor need someone's attention: a required check missing or expired, or any check expired or about to. */
export function needsAttention(lines: VettingLine[]): boolean {
  return lines.some((l) => (l.required && (l.state === "MISSING" || l.state === "EXPIRED")) || l.state === "EXPIRED" || l.state === "DUE_SOON");
}

// ---- concerns ----------------------------------------------------------------------------------------------------------------------

export const CONCERN_CATEGORIES = ["CHILD_WELFARE", "DISCLOSURE", "ONLINE_SAFETY", "ADULT_CONDUCT", "OTHER"] as const;
export type ConcernCategory = (typeof CONCERN_CATEGORIES)[number];
export const CONCERN_CATEGORY_LABELS: Record<ConcernCategory, string> = {
  CHILD_WELFARE: "A child's welfare or safety",
  DISCLOSURE: "Something a child said or disclosed",
  ONLINE_SAFETY: "Online safety",
  ADULT_CONDUCT: "The conduct of an adult (a tutor, a parent or someone else)",
  OTHER: "Something else",
};

export const CONCERN_STATUSES = ["OPEN", "IN_REVIEW", "CLOSED"] as const;
export type ConcernStatus = (typeof CONCERN_STATUSES)[number];
export type ConcernRole = "TUTOR" | "ADMIN";
export type ConcernEventKind = "RAISED" | "VIEWED" | "ACCESS_REFUSED" | "STATUS" | "NOTE";

export interface Concern {
  id: string;
  /** What the person who raised it can quote: SC-yyyymmdd-XXXXXX. Carries nothing about the child. */
  reference: string;
  raisedBy: string;
  raisedByRole: ConcernRole;
  raisedAt: string;
  category: ConcernCategory;
  /** Who it is about, in the reporter's words. */
  about: string;
  studentRef: string | null;
  lessonRef: string | null;
  details: string;
  immediateDanger: boolean;
  status: ConcernStatus;
}

export type NewConcern = Omit<Concern, "id" | "reference" | "raisedAt" | "status">;

/** All that the person who raised a concern can see of it afterwards: that it exists, when, and where it has got to. Never its content. */
export type ConcernReceipt = Pick<Concern, "id" | "reference" | "raisedAt" | "status">;

export interface ConcernEvent {
  id: string;
  concernId: string;
  at: string;
  actorId: string;
  kind: ConcernEventKind;
  note: string;
}

export function validateConcern(input: NewConcern): NewConcern {
  const about = input.about.trim();
  const details = input.details.trim();
  if (!(CONCERN_CATEGORIES as readonly string[]).includes(input.category)) throw new SafeguardingError("INVALID", "Choose what the concern is about.");
  if (input.raisedByRole !== "TUTOR" && input.raisedByRole !== "ADMIN") throw new SafeguardingError("INVALID", "Only a tutor or an administrator can raise a concern here.");
  if (!input.raisedBy.trim()) throw new SafeguardingError("INVALID", "A concern needs the account that raised it.");
  if (about.length < 2 || about.length > 200) throw new SafeguardingError("INVALID", "Say who the concern is about (2 to 200 characters).");
  if (details.length < 10 || details.length > 5000) throw new SafeguardingError("INVALID", "Describe what you saw or heard (10 to 5000 characters).");
  return { ...input, about, details, studentRef: input.studentRef?.trim() || null, lessonRef: input.lessonRef?.trim() || null };
}

export const receiptOf = (c: Concern): ConcernReceipt => ({ id: c.id, reference: c.reference, raisedAt: c.raisedAt, status: c.status });

// ---- the named safeguarding leads ---------------------------------------------------------------------------------------------------

export interface SafeguardingLeads {
  emails: string[];
}

export interface SafeguardingActor {
  id: string;
  /** The email linked to the account (never the username or the internal sign-in address). */
  email: string;
}

const normalise = (email: string): string => email.trim().toLowerCase();

/** Reads "a@x.com, b@y.com". Anything that is not an address is dropped, so a typo can never make everyone a lead. */
export function parseLeads(text: string | undefined): SafeguardingLeads {
  return { emails: (text ?? "").split(/[,;\s]+/).map(normalise).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) };
}

export const isSafeguardingLead = (actor: SafeguardingActor, leads: SafeguardingLeads): boolean => leads.emails.includes(normalise(actor.email));
