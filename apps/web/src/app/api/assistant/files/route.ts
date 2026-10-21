import { nextDeps } from "@/lib/account/next";
import { handleUpload } from "@/lib/assistant/handlers";
import { assistantRuntime } from "@/lib/assistant/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { rt, jar } = await nextDeps();
  return handleUpload(request, { rt, jar, assistant: assistantRuntime() });
}
