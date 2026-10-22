import { nextDeps } from "@/lib/account/next";
import { handleDeleteLearnerChats } from "@/lib/learner/handlers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { rt, jar } = await nextDeps();
  return handleDeleteLearnerChats(request, { rt, jar }, (await params).id);
}
