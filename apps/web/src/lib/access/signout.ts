import { nextJar } from "@/lib/account/next";
import { accountRuntime } from "@/lib/account/runtime";
import { ACCESS_COOKIE, clearSessionCookies, forgetAccessToken } from "@/lib/account/session";
import { destroySession } from "@/lib/auth/session";

/**
 * Ends every kind of sign-in this browser holds: the account session (the one login everyone uses; its tokens are revoked at the
 * provider, not just forgotten here) and the development provider's session. The two sign-out buttons (the app's and the Library's)
 * and both logout routes call this, so signing out of one place never leaves a session behind in the other. Never throws.
 */
export async function signOutEverywhere(): Promise<void> {
  try {
    const jar = await nextJar();
    const access = jar.get(ACCESS_COOKIE);
    if (access) {
      forgetAccessToken(access);
      const rt = await accountRuntime();
      if (rt) await rt.auth.signOut(access).catch(() => undefined);
    }
    clearSessionCookies(jar);
  } finally {
    await destroySession();
  }
}
