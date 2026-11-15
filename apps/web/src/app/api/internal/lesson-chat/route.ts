import { relayedSend } from "@/lib/lessonChat/handlers";
import { leadsFromEnv } from "@/lib/lessonChat/actor";
import { lessonChat } from "@/lib/lessonChat/runtime";

/**
 * POST /api/internal/lesson-chat: how the classroom's Socket.IO server sends a chat message (docs/LESSON_CHAT.md). Not for browsers: the request is
 * signed with the secret the classroom and this app share, and anything unsigned or stale is refused. It runs the same service, and so the same
 * rules, as a message sent over HTTP.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return relayedSend(request, { chat: lessonChat(), leads: leadsFromEnv() });
}
