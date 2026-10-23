import { nextDeps } from "@/lib/account/next";
import { assistantRuntime } from "@/lib/assistant/runtime";
import { handleCorrectPaper } from "@/lib/paper/handlers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { rt, jar } = await nextDeps();
  return handleCorrectPaper(request, { rt, jar, assistant: assistantRuntime() }, (await params).id);
}
