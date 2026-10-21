import { notFound, redirect } from "next/navigation";
import type { Account } from "@learnthrive/data/library";
import { nextJar } from "./next";
import { accountRuntime, type AccountRuntime } from "./runtime";
import { readSession, type SessionState } from "./session";
import type { AuthUser } from "./types";

/** What a Server Component needs to know about the visitor. Reads cookies; never sets any. */
export async function currentSession(): Promise<{ rt: AccountRuntime | null; state: SessionState }> {
  const rt = await accountRuntime();
  if (!rt) return { rt, state: { status: "none" } };
  return { rt, state: await readSession(await nextJar(), rt) };
}

export interface SignedIn {
  rt: AccountRuntime;
  user: AuthUser;
  account: Account;
}

/**
 * For member pages: the signed-in account, or a redirect. No backend configured is a 404 (the page does not exist
 * yet); no session goes to sign-in and back; an expired access token goes through the renewing route and back.
 */
export async function requireAccountPage(path: string): Promise<SignedIn> {
  const { rt, state } = await currentSession();
  if (!rt) notFound();
  if (state.status === "refresh_needed") redirect(`/api/account/refresh?next=${encodeURIComponent(path)}`);
  if (state.status !== "ok") redirect(`/login?next=${encodeURIComponent(path)}`);
  const account = await rt.store.accounts.getAccount(state.user.id);
  // A signed-in user with no profile means the database trigger did not run: treat as signed out, not as a crash.
  if (!account) redirect(`/login?next=${encodeURIComponent(path)}`);
  return { rt, user: state.user, account };
}
