import { nextDeps } from "@/lib/account/next";
import { renewSession, safeNextPath } from "@/lib/account/session";

export const dynamic = "force-dynamic";

/**
 * Pages cannot set cookies, so a page that finds an expired access token sends the browser here: the session is
 * renewed (or cleared) and the browser goes straight back. A GET that only touches the caller's own session.
 */
export async function GET(request: Request) {
  const next = safeNextPath(new URL(request.url).searchParams.get("next"));
  const { rt, jar } = await nextDeps();
  const state = rt ? await renewSession(jar, rt) : ({ status: "none" } as const);
  const target = state.status === "ok" ? next : `/login?next=${encodeURIComponent(next)}`;
  // A relative Location: behind the host's proxy the request URL may name an internal address.
  return new Response(null, { status: 303, headers: { Location: target, "Cache-Control": "no-store" } });
}
