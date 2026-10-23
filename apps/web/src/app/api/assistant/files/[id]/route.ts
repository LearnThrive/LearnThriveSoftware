import { nextDeps } from "@/lib/account/next";
import { assistantRuntime } from "@/lib/assistant/runtime";
import { handleFile } from "@/lib/paper/handlers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Context) {
  const { rt, jar } = await nextDeps();
  return handleFile(request, { rt, jar, assistant: assistantRuntime() }, (await params).id);
}

export async function GET(request: Request, { params }: Context) {
  const { rt, jar } = await nextDeps();
  return handleFile(request, { rt, jar, assistant: assistantRuntime() }, (await params).id);
}
