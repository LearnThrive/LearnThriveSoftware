// Platform account roles. STAFF is a named future possibility in the plan behind this
// migration but is deliberately not built yet — adding it here would be scaffolding with
// no behaviour attached to it.
export type Role = "ADMIN" | "TUTOR" | "CLIENT" | "STUDENT";

export interface DevelopmentUser {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  name: string;
  // Domain-model linkage (e.g. a Tutor/Client/Student record) arrives in Phase C. Left as an
  // opaque optional field now so the auth layer doesn't need to change shape when it does.
  profileId?: string;
  active: boolean;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  name: string;
  profileId?: string;
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
