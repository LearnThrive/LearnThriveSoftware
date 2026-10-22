/**
 * Learner identity: how a student under a family account gets a login of their own, and how a guardian controls it
 * (docs/IDENTITY.md). The SQL it mirrors is supabase/migrations/0010_learner_identity.sql. Plain data and one interface: the in-memory
 * store (tests, development) and the Postgres store both implement it and one contract test holds them to the same behaviour.
 *
 * The rules that matter, enforced in the stores and again by database constraints:
 *   - one student has at most one login and one login belongs to at most one student (unique on both sides);
 *   - an invitation is single use, expires, can be revoked, can be tied to one email address, and only its SHA-256 is kept;
 *   - a learner is never also a paying family account;
 *   - only an ACTIVE guardian link or learner identity gives anything: suspended and revoked give nothing, immediately.
 */
export type LinkStatus = "active" | "suspended" | "revoked";
export type AccessMode = "none" | "supervised" | "direct";

export interface StudentRecord {
  id: string;
  /** The owning family account (students.client_id). */
  clientId: string;
  displayName: string;
  yearGroup: string | null;
  isMinor: boolean;
  accessMode: AccessMode;
  active: boolean;
}

export interface StudentSummary extends StudentRecord {
  /** The learner has a login of their own (any status), and what state it is in. */
  learnerStatus: LinkStatus | null;
  /** An invitation for this student is waiting to be accepted. */
  invitationOpen: boolean;
}

/** Everything the server needs to treat a signed-in profile as a learner. null for anyone who is not one. */
export interface LearnerContext {
  studentId: string;
  /** The family account the learner belongs to (the owner's client id). Never the learner's own: a learner has none. */
  familyClientId: string;
  /** The status of the learner's own login. */
  status: LinkStatus;
  displayName: string;
  yearGroup: string | null;
  isMinor: boolean;
  accessMode: AccessMode;
  /** The student record is active and the family's owning guardian link is active. */
  guardianActive: boolean;
}

export interface InvitationRecord {
  id: string;
  studentId: string;
  clientId: string;
  /** The address the invitation is for, lower case; null when it is not tied to one. */
  email: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export type InviteFailure = "not_found" | "limit" | "already_learner" | "not_allowed";
/** What an invitation link says, without spending it. The address is returned so the sign-up form can pre-fill it; nothing else about the student. */
export type InvitationPeek = { state: "open"; email: string | null } | { state: "used" | "revoked" | "expired" | "invalid" };

export type AcceptFailure = "invalid" | "expired" | "used" | "revoked" | "email_mismatch" | "not_eligible";

export interface CreateInvitationInput {
  clientId: string;
  studentId: string;
  invitedBy: string;
  email: string | null;
  /** SHA-256 of the token, hex. The token itself is never given to the store. */
  tokenHash: string;
  expiresAt: Date;
  /** At most this many invitations per student in the last 24 hours (reissuing counts). */
  maxPerDay: number;
  now: Date;
}

export interface AcceptInvitationInput {
  tokenHash: string;
  /** The signed-in account that is accepting. */
  profileId: string;
  /** That account's verified sign-in address. */
  email: string;
  now: Date;
}

export interface IdentityAuditEntry {
  at: Date;
  actorProfileId: string | null;
  action: string;
  clientId: string | null;
  studentId: string | null;
}

/** The kind of consent a guardian gives for a learner to use Study Buddy. Withdrawing it closes the assistant for that learner. */
export const LEARNER_AI_CONSENT = "learner_ai_use";

export interface IdentityRepository {
  /** The student, only if this family reaches them through an ACTIVE guardian link. */
  getFamilyStudent(clientId: string, studentId: string): Promise<StudentRecord | null>;
  /** Every student this family reaches through an active link, with their learner login state. Newest last. */
  listFamilyStudents(clientId: string): Promise<StudentSummary[]>;
  /** A guardian adds a student to their own family (display name only: no email, no school, no address). */
  createStudent(clientId: string, input: { displayName: string; yearGroup: string | null; isMinor: boolean }): Promise<StudentRecord>;
  /** Sets how a student gets in. Only the owning family, and never to "direct" while the student has no login. False if not theirs. */
  setAccessMode(clientId: string, studentId: string, mode: AccessMode, actor: string, now: Date): Promise<boolean>;

  /** The learner a profile is, or null. Whatever the status: the caller decides what a suspended or revoked learner may do. */
  getLearner(profileId: string): Promise<LearnerContext | null>;
  getLearnerByStudent(studentId: string): Promise<LearnerContext | null>;

  /** Replaces any open invitation for the student with this one. Checks the student is the family's, has no login yet, and the daily limit. */
  createInvitation(input: CreateInvitationInput): Promise<{ ok: true; invitation: InvitationRecord } | { ok: false; reason: InviteFailure }>;
  listInvitations(clientId: string, studentId: string): Promise<InvitationRecord[]>;
  /** Reads an invitation by token hash without using it. */
  peekInvitation(tokenHash: string, now: Date): Promise<InvitationPeek>;
  /** False if it is not this family's, or is already accepted or revoked. */
  revokeInvitation(clientId: string, invitationId: string, actor: string, now: Date): Promise<boolean>;
  /**
   * Binds the signed-in profile to the student the invitation names, in ONE statement: the invitation is spent, the learner login is
   * created and the profile becomes a STUDENT, or nothing happens. The profile must not own a family account or already be a learner.
   */
  acceptInvitation(input: AcceptInvitationInput): Promise<{ ok: true; studentId: string; clientId: string } | { ok: false; reason: AcceptFailure }>;

  /** Suspends, restores or revokes a learner's login. `clientId` is the guardian's family, or null for staff. False if there is no such login (or it is not that family's). */
  setLearnerStatus(input: { studentId: string; clientId: string | null; status: LinkStatus; actor: string; now: Date }): Promise<boolean>;
  /** Suspends, restores or revokes a SECOND guardian's link. The owning family's link cannot be changed here. False if there is no such link. */
  setGuardianLinkStatus(input: { ownerClientId: string; studentId: string; guardianClientId: string; status: LinkStatus; actor: string; now: Date }): Promise<boolean>;

  /** A guardian (the signed-in adult of an owning or linked family) agrees that this learner may use Study Buddy. */
  grantLearnerConsent(input: { studentId: string; guardianProfileId: string; version: string; textSha256: string; now: Date }): Promise<boolean>;
  /** Withdraws every open learner-AI consent for the student. Returns how many. */
  withdrawLearnerConsent(studentId: string, now: Date): Promise<number>;
  /** An open (not withdrawn) learner-AI consent exists for the student. */
  hasLearnerConsent(studentId: string): Promise<boolean>;

  /**
   * A guardian opens a supervised view of one learner: needs an ACTIVE link from their family and the supervised access mode. Replaces any earlier
   * view of theirs. Only the token's hash is stored. False if the student is not theirs or is not set to supervised.
   */
  startSupervised(input: { clientId: string; guardianProfileId: string; studentId: string; tokenHash: string; expiresAt: Date; now: Date }): Promise<boolean>;
  /** The learner a supervised token selects, for THIS guardian, now: null if unknown, ended, expired, another guardian's, the link gone or the mode changed. */
  getSupervised(tokenHash: string, guardianProfileId: string, now: Date): Promise<LearnerContext | null>;
  /** Leaves the supervised view. Returns whether one was open. */
  endSupervised(tokenHash: string, guardianProfileId: string, now: Date): Promise<boolean>;

  /** Newest first. For staff and tests. */
  auditFor(studentId: string, limit?: number): Promise<IdentityAuditEntry[]>;
}
