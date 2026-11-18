import { getSession } from "@/lib/auth/session";
import { enterLesson } from "@/lib/classroom/lessonEntry";
import { enterMeeting } from "@/lib/meetings/entry";
import { jsonResponse, originAllowed } from "@/lib/request-guards";

/**
 * POST { kind: "meeting" | "lesson", id }  ->  { token }
 *
 * A fresh classroom join link for someone who is already in a room and whose connection dropped. A join link only lasts five minutes (it is what proves
 * the person may enter), so the classroom asks here whenever it has to rejoin: after a dropped connection, a restart of the classroom server, or its
 * Reconnect button. The same rules as the first join are applied again, from the signed-in session and the records, never from anything the browser
 * says about itself: someone removed from a meeting, or outside a lesson's window, gets a refusal and no link.
 */
export const dynamic = "force-dynamic";

const ID = /^[0-9a-zA-Z-]{8,64}$/;

export async function POST(request: Request) {
  if (!originAllowed(request)) return jsonResponse(403, { ok: false, message: "That request did not come from this site." });
  const user = await getSession();
  if (!user) return jsonResponse(401, { ok: false, message: "Sign in again to rejoin." });
  let body: { kind?: unknown; id?: unknown };
  try {
    body = await request.json() as { kind?: unknown; id?: unknown };
  } catch {
    return jsonResponse(400, { ok: false, message: "That request could not be read." });
  }
  if ((body.kind !== "meeting" && body.kind !== "lesson") || typeof body.id !== "string" || !ID.test(body.id)) {
    return jsonResponse(400, { ok: false, message: "That request could not be read." });
  }
  const entry = body.kind === "meeting" ? await enterMeeting(user, body.id) : await enterLesson(user, body.id);
  if (!entry.ok) return jsonResponse(403, { ok: false, message: entry.message });
  return jsonResponse(200, { ok: true, token: entry.token });
}
