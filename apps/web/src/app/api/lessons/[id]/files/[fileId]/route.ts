import { getSession } from "@/lib/auth/session";
import { openFile } from "@/lib/lessonChat/handlers";
import { leadsFromEnv } from "@/lib/lessonChat/actor";
import { lessonChat } from "@/lib/lessonChat/runtime";

/**
 * GET /api/lessons/[id]/files/[fileId]?u=&exp=&sig=
 * A shared file, from a short-lived signed link made for the signed-in person (docs/LESSON_CHAT.md). The link is only a ticket: opening it checks the
 * lesson, the file's own lesson, and the person's right to read, again. Never cached, never indexed, served as an attachment or inline image with
 * nosniff and a sandboxing policy.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  return openFile(await getSession(), id, fileId, new URL(request.url), { chat: lessonChat(), leads: leadsFromEnv() });
}
