import { nextDeps } from "@/lib/account/next";
import { handleCreateLearner, handleListLearners } from "@/lib/learner/handlers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { rt, jar } = await nextDeps();
  return handleListLearners(request, { rt, jar });
}

export async function POST(request: Request) {
  const { rt, jar } = await nextDeps();
  return handleCreateLearner(request, { rt, jar });
}
