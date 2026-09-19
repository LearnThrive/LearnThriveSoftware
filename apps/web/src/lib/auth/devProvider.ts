import { randomUUID } from "node:crypto";
import { SEED_IDS } from "@learnthrive/data/inMemoryProvider";
import { hashPassword, verifyPassword } from "./passwords";
import type { AuthProvider, DevelopmentUser, LoginResult } from "./types";

// Next dev's Fast Refresh re-evaluates modules on file changes; a plain top-level `new Map()`
// would silently reset every seeded account (and every issued session — see session.ts) on the
// next edit. Attaching to `globalThis` makes the store a real singleton across those reloads,
// the same pattern used for e.g. a dev-mode database client singleton in Next.js apps.
const globalForAuth = globalThis as unknown as {
  __learnthriveDevUsers?: Map<string, DevelopmentUser>;
  __learnthriveDevUsersSeeded?: Promise<void>;
};

function usersStore(): Map<string, DevelopmentUser> {
  if (!globalForAuth.__learnthriveDevUsers) globalForAuth.__learnthriveDevUsers = new Map();
  return globalForAuth.__learnthriveDevUsers;
}

// Development-only accounts — see docs/DEVELOPMENT_ACCOUNTS.md for the credentials and rationale.
// The credentials only work on a local dev server (NODE_ENV !== "production", enforced in
// session.ts) and nothing here persists past a server restart.
const SEED_ACCOUNTS: Array<Omit<DevelopmentUser, "id" | "passwordHash"> & { password: string }> = [
  { email: "admin@learnthrive.dev", password: "dev-admin-pass", role: "ADMIN", name: "Alvi Hossain (Admin)", active: true },
  // profileId cross-references packages/data's seeded domain records (see SEED_IDS there) — the
  // two seed systems share these fixed ids deliberately, not by coincidence, so e.g. the Tutor
  // dashboard can find "this logged-in user's own Tutor record" without a lookup-by-email hack.
  { email: "tutor@learnthrive.dev", password: "dev-tutor-pass", role: "TUTOR", name: "Tahasin Hasan (Tutor)", active: true, profileId: SEED_IDS.tutorJamiePatel },
  { email: "client@learnthrive.dev", password: "dev-client-pass", role: "CLIENT", name: "Abdurrahman Mustafa (Client)", active: true, profileId: SEED_IDS.clientSarahAhmed },
  { email: "student@learnthrive.dev", password: "dev-student-pass", role: "STUDENT", name: "Brian James Khalawon (Student)", active: true, profileId: SEED_IDS.studentAyaanAhmed },
  // Deliberately disabled, so the "locked/disabled account" login state is exercisable without
  // extra setup — see docs/DEVELOPMENT_ACCOUNTS.md.
  { email: "disabled@learnthrive.dev", password: "dev-disabled-pass", role: "STUDENT", name: "Disabled Test Account", active: false },
];

async function ensureSeeded(): Promise<void> {
  if (!globalForAuth.__learnthriveDevUsersSeeded) {
    globalForAuth.__learnthriveDevUsersSeeded = (async () => {
      const store = usersStore();
      if (store.size > 0) return;
      for (const account of SEED_ACCOUNTS) {
        const passwordHash = await hashPassword(account.password);
        const id = randomUUID();
        store.set(account.email.toLowerCase(), {
          id, email: account.email, passwordHash, role: account.role, name: account.name, active: account.active,
          profileId: account.profileId,
        });
      }
    })();
  }
  await globalForAuth.__learnthriveDevUsersSeeded;
}

/**
 * Development-only credential store — a server-side in-memory dictionary, never persisted,
 * reset on every server restart. This is explicitly NOT production auth; see
 * assertNotProductionWithoutRealProvider() below, called once at process start.
 */
export class DevelopmentAuthProvider implements AuthProvider {
  async verifyCredentials(email: string, password: string): Promise<LoginResult> {
    await ensureSeeded();
    const user = usersStore().get(email.trim().toLowerCase());
    // Same generic failure for "no such account" and "wrong password" — confirming an account
    // exists via a different error message is a real enumeration risk, even in development.
    if (!user) return { ok: false, reason: "invalid_credentials" };
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return { ok: false, reason: "invalid_credentials" };
    if (!user.active) return { ok: false, reason: "account_disabled" };
    return { ok: true, user: { id: user.id, email: user.email, role: user.role, name: user.name, profileId: user.profileId } };
  }
}

/**
 * Production must refuse to silently run with development credentials (plan section 9). There
 * is no production auth provider yet, so this is a hard, deliberate fail-safe: importing this
 * provider in a process where NODE_ENV=production throws at startup rather than quietly serving
 * hard-coded accounts. This is not a placeholder to relax later without a real replacement —
 * it's the boundary itself.
 */
export function assertNotProductionWithoutRealProvider(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DevelopmentAuthProvider cannot run with NODE_ENV=production. " +
      "No production AuthProvider (e.g. Supabase-backed) is implemented yet — see docs/AUTHENTICATION.md.",
    );
  }
}

let provider: AuthProvider | null = null;
export function getAuthProvider(): AuthProvider {
  assertNotProductionWithoutRealProvider();
  if (!provider) provider = new DevelopmentAuthProvider();
  return provider;
}

// Notifications (Phase H) are addressed to an AuthenticatedUser.id, but the services that raise
// them (scheduling, reports) only know a domain profileId — the reverse of the lookup
// AuthenticatedUser.profileId already gives everywhere else. Many domain records created via
// Admin's "Add Tutor/Client/Student" forms have no login account at all (only the four seed
// accounts do), so this legitimately returns nothing for most of them — a notification with no
// resolvable recipient is simply not created, not an error. See docs/NOTIFICATIONS.md.
export async function findUserIdByProfileId(profileId: string): Promise<string | null> {
  await ensureSeeded();
  const match = [...usersStore().values()].find((u) => u.profileId === profileId && u.active);
  return match?.id ?? null;
}

export async function findUserIdsByRole(role: DevelopmentUser["role"]): Promise<string[]> {
  await ensureSeeded();
  return [...usersStore().values()].filter((u) => u.role === role && u.active).map((u) => u.id);
}
