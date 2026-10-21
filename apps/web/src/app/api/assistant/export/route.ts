import { nextDeps } from "@/lib/account/next";
import { handleExport } from "@/lib/assistant/handlers";
import { assistantRuntime } from "@/lib/assistant/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { rt, jar } = await nextDeps();
  return handleExport(request, { rt, jar, assistant: assistantRuntime() });
}
