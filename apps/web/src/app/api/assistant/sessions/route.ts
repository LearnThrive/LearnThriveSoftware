import { nextDeps } from "@/lib/account/next";
import { handleDeleteAll, handleSessions } from "@/lib/assistant/handlers";
import { assistantRuntime } from "@/lib/assistant/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { rt, jar } = await nextDeps();
  return handleSessions(request, { rt, jar, assistant: assistantRuntime() });
}

export async function DELETE(request: Request) {
  const { rt, jar } = await nextDeps();
  return handleDeleteAll(request, { rt, jar, assistant: assistantRuntime() });
}
