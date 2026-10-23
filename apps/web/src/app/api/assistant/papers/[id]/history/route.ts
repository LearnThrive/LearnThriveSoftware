import { nextDeps } from "@/lib/account/next";
import { assistantRuntime } from "@/lib/assistant/runtime";
import { handlePaperHistory } from "@/lib/paper/handlers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { rt, jar } = await nextDeps();
  return handlePaperHistory(request, { rt, jar, assistant: assistantRuntime() }, (await params).id);
}
