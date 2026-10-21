import { nextDeps } from "@/lib/account/next";
import { assistantRuntime } from "@/lib/assistant/runtime";
import { handleTranscribe } from "@/lib/assistant/voiceHandlers";
import { voiceRuntime } from "@/lib/assistant/voice";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { rt, jar } = await nextDeps();
  return handleTranscribe(request, { rt, jar, assistant: assistantRuntime(), voice: voiceRuntime() });
}
