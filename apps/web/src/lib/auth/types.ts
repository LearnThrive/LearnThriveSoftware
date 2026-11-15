import type { Role } from "@learnthrive/data/roles";

// Platform account roles (packages/data/src/roles.ts holds the list, the permissions each carries and the rules for changing them).
// A person holds a SET of them: `AuthenticatedUser.roles`. `role` is the highest of the set, kept for the places that want one word.
// Never decide who may do something from `role`: use `lib/auth/scope.ts` (`holds`, `scopes`) or `can()`. STAFF is still deliberately not built.
export type { Role };

export interface DevelopmentUser {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  roles: Role[];
  name: string;
  // Domain-model linkage (e.g. a Tutor/Client/Student record) arrives in Phase C. Left as an
  // opaque optional field now so the auth layer doesn't need to change shape when it does.
  profileId?: string;
  active: boolean;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  /** The highest role held. A label and a default, NOT a permission: `roles` is what is checked. */
  role: Role;
  /** Every role this person holds. Absent only on an object built by hand with one `role` (a test): `rolesOf` reads either. */
  roles?: Role[];
  name: string;
  /**
   * The domain record of the PRIMARY role (a tutor's own id, a parent's client id, a student's id). A person with several roles has one
   * record per role: use `tutorId`, `clientId` and `studentId` below through `recordFor` in lib/auth/scope.ts, never this.
   */
  profileId?: string;
  /** The tutor record this person teaches as (they hold TUTOR or JUNIOR_TUTOR). Read it through lib/auth/teaching.ts, never directly. */
  tutorId?: string;
  /** The family this person owns (they hold CLIENT). */
  clientId?: string;
  /** The student this person is (they hold STUDENT and have a learner login). */
  studentId?: string;
}

export type LoginFailureReason = "invalid_credentials" | "account_disabled";

export type LoginResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; reason: LoginFailureReason };

/**
 * The boundary this whole auth layer exists to protect: every other part of the app (login
 * route, session issuance, role guards) talks to this interface, never to a concrete provider
 * directly. A future SupabaseAuthProvider implements the same interface — nothing above this
 * line needs to change when that happens. See docs/AUTHENTICATION.md.
 */
export interface AuthProvider {
  verifyCredentials(email: string, password: string): Promise<LoginResult>;
}
