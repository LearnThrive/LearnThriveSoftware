import type { Account } from "@learnthrive/data/library";
import type { AuthUser } from "@/lib/account/types";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { devDomainIdFor } from "@/lib/dev/accounts";

/**
 * An account as the signed-in app's user. The id is the account's own id (the same one in every table that mentions the person); the
 * name is the profile's (what the account page edits), then the sign-up name, then the address. `profileId` is the link to the domain
 * record (tutor, parent or student) the dashboard looks the person up by: in development the seeded record of the development accounts,
 * and nothing in production until the domain data is real and holds its own link (docs/SUPABASE_MIGRATION.md).
 */
export function toPlatformUser(
  user: Pick<AuthUser, "email" | "displayName">,
  account: Pick<Account, "profileId" | "role" | "displayName">,
  env: Record<string, string | undefined> = process.env,
): AuthenticatedUser {
  return {
    id: account.profileId,
    email: user.email,
    role: account.role,
    name: account.displayName || user.displayName || user.email,
    profileId: devDomainIdFor(account.profileId, env),
  };
}
