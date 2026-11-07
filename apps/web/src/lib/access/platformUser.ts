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
 * `tutorRef` is the tutor record of an administrator who teaches: the capability lib/auth/teaching.ts reads. The email is the linked one,
 * never the internal address Auth holds.
 */
export function toPlatformUser(
  user: Pick<AuthUser, "email" | "displayName">,
  account: Pick<Account, "profileId" | "role" | "displayName"> & Partial<Pick<Account, "username" | "linkedEmail">>,
  domainId: string | null = null,
  env: Record<string, string | undefined> = process.env,
  tutorRef: string | null = null,
): AuthenticatedUser {
  const developmentRecord = devDomainIdFor(account.profileId, env);
  const tutorId = account.role === "ADMIN" ? (developmentRecord ?? tutorRef) : null;
  return {
    id: account.profileId,
    email: account.linkedEmail ?? user.email,
    role: account.role,
    name: account.displayName || user.displayName || account.username || user.email,
    profileId: developmentRecord ?? domainId ?? account.profileId,
    ...(tutorId ? { tutorId } : {}),
  };
}
