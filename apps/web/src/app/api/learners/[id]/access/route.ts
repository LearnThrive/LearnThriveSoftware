import { nextDeps } from "@/lib/account/next";
import { handleSetAccess } from "@/lib/learner/handlers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { rt, jar } = await nextDeps();
  return handleSetAccess(request, { rt, jar }, (await params).id);
}
