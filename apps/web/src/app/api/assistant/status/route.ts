import { nextDeps } from "@/lib/account/next";
import { handleStatus } from "@/lib/assistant/handlers";
import { assistantRuntime } from "@/lib/assistant/runtime";
import { voiceRuntime } from "@/lib/assistant/voice";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { rt, jar } = await nextDeps();
  return handleStatus(request, { rt, jar, assistant: assistantRuntime(), voice: voiceRuntime() });
}
