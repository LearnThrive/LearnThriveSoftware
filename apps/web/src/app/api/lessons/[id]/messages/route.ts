import { getSession } from "@/lib/auth/session";
import { listMessages, sendMessage } from "@/lib/lessonChat/handlers";
import { leadsFromEnv } from "@/lib/lessonChat/actor";
import { lessonChat } from "@/lib/lessonChat/runtime";
import { announceMessage } from "@/lib/lessonChat/announce";
import { getDataProvider } from "@/lib/data/provider";

/**
 * A lesson's chat (docs/LESSON_CHAT.md).
 *   GET   the messages, for the lesson's tutor and students, a parent (afterwards), an administrator or the safeguarding lead (audited).
 *   POST  a message ({ text }) or a file (multipart: file, caption). Only the lesson's own tutor, an enrolled student or an administrator, at any time.
 * Every rule is in the one service (lib/lessonChat); nothing here decides who may do what.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return listMessages(await getSession(), id, { chat: lessonChat(), leads: leadsFromEnv() });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return sendMessage(await getSession(), id, request, {
    chat: lessonChat(), leads: leadsFromEnv(), sent: (lessonId, message) => announceMessage(getDataProvider(), lessonId, message),
  });
}
