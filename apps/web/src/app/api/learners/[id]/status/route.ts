import { nextDeps } from "@/lib/account/next";
import { handleLearnerStatus } from "@/lib/learner/handlers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { rt, jar } = await nextDeps();
  return handleLearnerStatus(request, { rt, jar }, (await params).id);
}
