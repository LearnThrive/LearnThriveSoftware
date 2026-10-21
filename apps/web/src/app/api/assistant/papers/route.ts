import { nextDeps } from "@/lib/account/next";
import { assistantRuntime } from "@/lib/assistant/runtime";
import { handleStartPaper } from "@/lib/paper/handlers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { rt, jar } = await nextDeps();
  return handleStartPaper(request, { rt, jar, assistant: assistantRuntime() });
}
