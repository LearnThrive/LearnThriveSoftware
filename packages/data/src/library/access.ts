import type { AccessFacts, Account, Resource } from "./types";

export type AccessReason = "free_sample" | "enrolled" | "subscription" | "admin_grant" | "admin" | "unpublished" | "no_entitlement";

export interface AccessDecision {
  allowed: boolean;
  reason: AccessReason;
}

/**
 * The one place that decides whether a signed-in account may download a resource (plan19 section 3). Pure: the
 * caller reads the facts (the store does) and passes them in, so every combination can be tested in a table.
 *
 * A person has access if the resource is a free sample, or they are enrolled, or they hold an active paid
 * subscription, or an administrator granted access. An ADMIN account can reach everything, drafts included.
 * Anything unpublished (a draft, or scheduled for later) is closed to everyone else, whatever they hold.
 * No account at all is not a question this function answers: the route returns 401 before it asks.
 */
export function canAccess(account: Pick<Account, "role">, resource: Pick<Resource, "accessTier" | "publishedAt">, facts: AccessFacts, now: Date): AccessDecision {
  if (account.role === "ADMIN") return { allowed: true, reason: "admin" };
  if (resource.publishedAt === null || resource.publishedAt.getTime() > now.getTime()) return { allowed: false, reason: "unpublished" };
  if (resource.accessTier === "free_sample") return { allowed: true, reason: "free_sample" };
  if (facts.enrolled) return { allowed: true, reason: "enrolled" };
  if (facts.subscription) return { allowed: true, reason: "subscription" };
  if (facts.adminGrant) return { allowed: true, reason: "admin_grant" };
  return { allowed: false, reason: "no_entitlement" };
}
