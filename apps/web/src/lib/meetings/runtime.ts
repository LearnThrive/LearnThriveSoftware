import { createSqlMeetings, developmentMeetings, type MeetingPerson, type MeetingRepository } from "@learnthrive/data/meetings";
import { accountBackend, accountRuntime } from "@/lib/account/runtime";

type Env = Record<string, string | undefined>;

/**
 * The staff meetings store (migration 0028): the same backend choice as the rest of the tuition data. Postgres with the database, memory in
 * development and tests, and a THROW in production without the database.
 */
const g = globalThis as unknown as { __learnthriveMeetingsSql?: MeetingRepository };

export function getMeetings(env: Env = process.env): MeetingRepository {
  const backend = accountBackend(env);
  if (backend === "off") throw new Error("Meetings are not available: production needs SUPABASE_URL, SUPABASE_ANON_KEY and DATABASE_URL.");
  if (backend === "memory") return developmentMeetings();
  return (g.__learnthriveMeetingsSql ??= createSqlMeetings({
    query: async <T,>(text: string, params?: unknown[]) => {
      const rt = await accountRuntime(env);
      if (!rt?.db) throw new Error("The database connection is not available.");
      return rt.db.query<T>(text, params);
    },
  }));
}

/**
 * Everyone who may be invited: an administrator or a tutor (or junior tutor) whose login is on, by name. Never a parent's or a learner's login, and
 * never anyone who also holds the Student role (they may be under 18): the same rule as lib/meetings/rules.ts `isStaff`, which is checked again on entry.
 */
export async function staffDirectory(): Promise<MeetingPerson[]> {
  const rt = await accountRuntime();
  if (!rt) return [];
  return (await rt.store.accounts.listProfiles())
    .filter((p) => !p.loginDisabled && !p.roles.includes("STUDENT") && p.roles.some((r) => r === "ADMIN" || r === "TUTOR" || r === "JUNIOR_TUTOR"))
    .map((p) => ({ id: p.profileId, name: p.displayName || p.username || "Unnamed" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
