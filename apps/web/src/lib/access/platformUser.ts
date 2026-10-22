import type { Account } from "@learnthrive/data/library";
import type { AuthUser } from "@/lib/account/types";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { devDomainIdFor } from "@/lib/dev/accounts";

/**
 * An account as the signed-in app's user. The id is the account's own id (the same one in every table that mentions the person); the
 * name is the profile's (what the account page edits), then the sign-up name, then the address. `profileId` is the link to the domain
 * record (tutor, parent or student) the dashboard looks the person up by: in development the seeded record of the development accounts;
 * everywhere else the person's real record from the database (`domainRef`: their tutor, client or learner id). Someone with no record
 * (an administrator) keeps their account id, which matches nothing, so a lookup finds nothing rather than someone else's data.
 */
export function toPlatformUser(
  user: Pick<AuthUser, "email" | "displayName">,
  account: Pick<Account, "profileId" | "role" | "displayName">,
  domainId: string | null = null,
  env: Record<string, string | undefined> = process.env,
): AuthenticatedUser {
  return {
    id: account.profileId,
    email: user.email,
    role: account.role,
    name: account.displayName || user.displayName || user.email,
    profileId: devDomainIdFor(account.profileId, env) ?? domainId ?? account.profileId,
  };
}
