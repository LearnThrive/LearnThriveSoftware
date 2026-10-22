import { nextDeps } from "@/lib/account/next";
import { handleStartView } from "@/lib/learner/handlers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { rt, jar } = await nextDeps();
  return handleStartView(request, { rt, jar });
}
