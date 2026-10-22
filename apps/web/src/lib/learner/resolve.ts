import { createHash, randomBytes } from "node:crypto";
import { resolveActor, type AccessFacts, type Account, type Actor, type LearnerContext } from "@learnthrive/data/library";
import type { AccountRuntime } from "@/lib/account/runtime";
import type { CookieJar } from "@/lib/account/session";

/**
 * Who is acting on this request, resolved on the server from the signed-in profile and live database state (docs/IDENTITY.md). Nothing
 * the browser sends (a client id, a student id, a role) is an input: the profile id comes from the verified session, everything else is
 * looked up. Because the lookup is live, a suspension, a revoked link or a withdrawn consent closes the very next request, even though
 * the learner's access token is still valid, and this is the same function for the page, the chat, the files, the papers and the voice.
 *
 * The one extra input is the supervised-view cookie: an opaque token a guardian's own session holds while viewing as one of their
 * learners. It is only believed if the database says that guardian started it for that learner and it has not ended or expired.
 */
export const SUPERVISED_COOKIE = "learnthrive_learner";
export const SUPERVISED_MINUTES = 60;

const NONE: AccessFacts = { enrolled: false, subscription: false, adminGrant: false };
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(24).toString("base64url");

export interface ResolvedActor {
  actor: Actor;
  account: Account;
  /** The learner in view (own login or supervised), for the screens that name them. */
  learner: LearnerContext | null;
}

export async function resolveRequestActor(
  rt: AccountRuntime,
  jar: Pick<CookieJar, "get" | "delete">,
  profileId: string,
  options: { minorsApproved: boolean; now: Date },
): Promise<ResolvedActor | null> {
  const store = rt.store;
  const account = await store.accounts.getAccount(profileId);
  if (!account) return null;

  // A learner's own login.
  if (account.role === "STUDENT") {
    const learner = account.learner;
    const facts = learner ? await store.access.learnerFacts(learner.studentId, options.now) : NONE;
    const consent = learner ? await store.identity.hasLearnerConsent(learner.studentId) : false;
    return { actor: resolveActor({ account, facts, learnerConsent: consent, minorsApproved: options.minorsApproved }), account, learner };
  }

  // A guardian viewing as one of their learners.
  const token = account.role === "CLIENT" ? jar.get(SUPERVISED_COOKIE) : undefined;
  if (token) {
    const supervised = await store.identity.getSupervised(hashToken(token), account.profileId, options.now);
    if (supervised) {
      const facts = await store.access.learnerFacts(supervised.studentId, options.now);
      const consent = await store.identity.hasLearnerConsent(supervised.studentId);
      return { actor: resolveActor({ account, facts, supervised, learnerConsent: consent, minorsApproved: options.minorsApproved }), account, learner: supervised };
    }
    // An ended, expired or foreign view: forget it, and fall through to the guardian's own session.
    jar.delete(SUPERVISED_COOKIE);
  }

  // A guardian or staff member acting as themselves. The family account is made on first need for an adult.
  const clientId = account.clientId ?? (account.adultConfirmed ? await store.accounts.ensureClient(account.profileId) : null);
  const facts = clientId ? await store.access.facts(clientId, options.now) : NONE;
  const resolved: Account = clientId && !account.clientId ? { ...account, clientId } : account;
  return { actor: resolveActor({ account: resolved, facts, minorsApproved: options.minorsApproved }), account: resolved, learner: null };
}
