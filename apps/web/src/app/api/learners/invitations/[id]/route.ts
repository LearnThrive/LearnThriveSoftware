import { nextDeps } from "@/lib/account/next";
import { handleRevokeInvitation } from "@/lib/learner/handlers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Context) {
  const { rt, jar } = await nextDeps();
  return handleRevokeInvitation(request, { rt, jar }, (await params).id);
}
