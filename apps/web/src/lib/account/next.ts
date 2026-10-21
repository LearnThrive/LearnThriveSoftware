import { cookies } from "next/headers";
import { assistantClosed } from "@/lib/assistant/runtime";
import { PORTAL_ENABLED } from "@/lib/portal";
import { accountRuntime } from "./runtime";
import type { CookieJar } from "./session";
import type { Deps } from "./handlers";

/** The request's cookies as a CookieJar. In a Server Component only `get` is usable (Next refuses `set` there). */
export async function nextJar(): Promise<CookieJar> {
  const store = await cookies();
  return {
    get: (name) => store.get(name)?.value,
    set: (name, value, options) => void store.set(name, value, options),
    delete: (name) => void store.delete(name),
  };
}

export async function nextDeps(): Promise<Deps> {
  // What the front door can offer right now: Study Buddy where the assistant is open, the dashboard where the signed-in app is open.
  return { rt: await accountRuntime(), jar: await nextJar(), studyBuddyOpen: assistantClosed(process.env, true) === null, dashboardOpen: PORTAL_ENABLED };
}
