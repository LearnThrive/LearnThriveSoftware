import { platformAccess, type PlatformAccess } from "./access";
import type { ChatOwner } from "./chat";
import type { LearnerContext } from "./identity";

export type { ChatOwner };
import type { AccessFacts, Account } from "./types";

/**
 * Who is acting, and in whose name (docs/IDENTITY.md). Resolved on the SERVER for every request from the signed-in profile and live
 * database state; nothing a caller sends (a client id, a student id, a role, an enrolment) is ever an input. Pure: the caller reads the
 * rows (account, learner, facts, consent) and passes them in, so every combination is a table test.
 *
 *   staff       an ADMIN or TUTOR account
 *   guardian    an adult account holder (role CLIENT) acting as themselves: their own chats, their family's tuition views, billing
 *   learner     a student's own login (role STUDENT)
 *   supervised  a guardian's signed-in session with ONE of their learners selected (a young child with no login of their own). The
 *               actor is still the guardian, the effective learner is the student, and \`adultOperations\` is off until the guardian
 *               leaves the learner view with their password again.
 *
 * `owner` is what the chat store scopes every read and write by: the family account AND the learner. A guardian's own chats have no
 * learner; a learner's chats have theirs; so a sibling, and the guardian, never read each other's conversations by guessing an id.
 */
export type ActorMode = "staff" | "guardian" | "learner" | "supervised";

export type AssistantDenial =
  | "no_access" // nothing entitles them to Study Buddy
  | "adult_required" // an adult account that has not declared it is 18 or over
  | "learner_inactive" // the learner's login is suspended or revoked
  | "guardian_inactive" // the family's guardian link or the student record is not active
  | "learner_not_enabled" // the guardian has not enabled this way in (access mode)
  | "consent_needed" // a minor, and no open guardian consent for Study Buddy
  | "minors_closed"; // a minor, and the deployment has not approved the assistant for children

export interface AssistantEligibility {
  allowed: boolean;
  reason: AssistantDenial | null;
}

export interface Actor {
  mode: ActorMode;
  /** The signed-in profile. In supervised mode this is the guardian, never the learner. */
  profileId: string;
  role: Account["role"];
  /** The family account all data is scoped to. null for staff accounts with no family. */
  familyClientId: string | null;
  /** The effective learner (learner and supervised modes), else null. */
  studentId: string | null;
  owner: ChatOwner | null;
  /** May this actor pay, open the billing portal, manage guardian links and invite learners. Never a learner, never in supervised mode. */
  adultOperations: boolean;
  platform: PlatformAccess;
  assistant: AssistantEligibility;
}

export interface ActorInput {
  account: Pick<Account, "profileId" | "role" | "adultConfirmed" | "clientId" | "learner">;
  /** The family's facts for a guardian or staff; the learner's facts (`access.learnerFacts`) for a learner or a supervised learner. */
  facts: AccessFacts;
  /** The learner selected in a supervised session, already verified by the caller (an active guardian link, the supervised access mode). */
  supervised?: LearnerContext | null;
  /** An open guardian consent exists for the effective learner (`identity.hasLearnerConsent`). */
  learnerConsent?: boolean;
  /** ASSISTANT_MINORS_APPROVED: the deployment is approved for children. It permits the deployment; it never replaces the checks here. */
  minorsApproved: boolean;
}

const allowed = (): AssistantEligibility => ({ allowed: true, reason: null });
const denied = (reason: AssistantDenial): AssistantEligibility => ({ allowed: false, reason });

/** The one decision for a learner (own login or supervised): active, a live guardian relationship, enabled, entitled, and for a minor approved and consented. */
function learnerEligibility(learner: LearnerContext, mode: "learner" | "supervised", platform: PlatformAccess, consent: boolean, minorsApproved: boolean): AssistantEligibility {
  if (mode === "learner" && learner.status !== "active") return denied("learner_inactive");
  if (!learner.guardianActive) return denied("guardian_inactive");
  const enabled = mode === "learner" ? learner.accessMode === "direct" : learner.accessMode === "supervised";
  if (!enabled) return denied("learner_not_enabled");
  if (!platform.studyBuddy) return denied("no_access");
  if (learner.isMinor) {
    if (!minorsApproved) return denied("minors_closed");
    if (!consent) return denied("consent_needed");
  }
  return allowed();
}

export function resolveActor(input: ActorInput): Actor {
  const { account, facts } = input;
  const base = { profileId: account.profileId, role: account.role };

  // A learner's own login. A student profile without a learner record (never bound, or removed) has nothing.
  if (account.role === "STUDENT") {
    const learner = account.learner;
    if (!learner) {
      return { mode: "learner", ...base, familyClientId: null, studentId: null, owner: null, adultOperations: false, platform: platformAccess("STUDENT", { enrolled: false, subscription: false, adminGrant: false }), assistant: denied("no_access") };
    }
    const platform = platformAccess("STUDENT", facts);
    // A suspended or revoked learner, or one whose guardian link is gone, has no tuition or Library either: nothing is reachable.
    const live = learner.status === "active" && learner.guardianActive;
    const effective = live ? platform : platformAccess("STUDENT", { enrolled: false, subscription: false, adminGrant: false });
    return {
      mode: "learner", ...base, familyClientId: learner.familyClientId, studentId: learner.studentId, owner: { clientId: learner.familyClientId, studentId: learner.studentId },
      adultOperations: false, platform: effective, assistant: learnerEligibility(learner, "learner", effective, input.learnerConsent === true, input.minorsApproved),
    };
  }

  // A guardian with one learner selected: still the guardian's session, but the learner's view and no adult operations.
  if (input.supervised && account.role === "CLIENT" && account.clientId) {
    const learner = input.supervised;
    const platform = platformAccess("STUDENT", facts);
    return {
      mode: "supervised", ...base, familyClientId: account.clientId, studentId: learner.studentId, owner: { clientId: account.clientId, studentId: learner.studentId },
      adultOperations: false, platform, assistant: learnerEligibility(learner, "supervised", platform, input.learnerConsent === true, input.minorsApproved),
    };
  }

  const platform = platformAccess(account.role, facts);
  const staff = account.role === "ADMIN" || account.role === "TUTOR";
  let assistant: AssistantEligibility;
  if (!account.adultConfirmed) assistant = denied("adult_required");
  else if (!platform.studyBuddy) assistant = denied("no_access");
  else assistant = allowed();
  return {
    mode: staff ? "staff" : "guardian", ...base, familyClientId: account.clientId, studentId: null,
    owner: account.clientId ? { clientId: account.clientId, studentId: null } : null,
    adultOperations: account.adultConfirmed, platform, assistant,
  };
}

/**
 * May this student sign in on their own, or only under a guardian's supervision? A conservative staging default (the production
 * rule is the owner's to confirm, docs/IDENTITY.md): an adult learner always may; a minor may from `minYear` (default Year 9, about
 * 13, the UK age at which a child can consent to an online service themselves); a minor with an unreadable or unknown year group may
 * not. Below that, the guardian chooses a supervised learner view, which needs no email address.
 */
export function directLoginAllowed(student: { isMinor: boolean; yearGroup: string | null }, minYear = 9): boolean {
  if (!student.isMinor) return true;
  const group = student.yearGroup?.toLowerCase().trim() ?? "";
  if (!group) return false;
  if (/\b(a[\s-]?level|sixth form|6th form)\b/.test(group)) return true;
  const year = /(?:^|\b|y)(\d{1,2})\b/.exec(group.replace(/year\s*/g, ""))?.[1];
  return year !== undefined && Number(year) >= minYear && Number(year) <= 13;
}
