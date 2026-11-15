import { getSession } from "@/lib/auth/session";
import { removeMessage } from "@/lib/lessonChat/handlers";
import { leadsFromEnv } from "@/lib/lessonChat/actor";
import { lessonChat } from "@/lib/lessonChat/runtime";

/**
 * DELETE /api/lessons/[id]/messages/[messageId]  { reason }
 * The ONLY way a message leaves view, and only an administrator may. It is marked removed, never deleted, and the removal is audit-logged. There is
 * no edit and no other delete, for anyone.
 */
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const { id, messageId } = await params;
  return removeMessage(await getSession(), id, messageId, request, { chat: lessonChat(), leads: leadsFromEnv() });
}
