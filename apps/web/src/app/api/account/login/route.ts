import { handleSignIn } from "@/lib/account/handlers";
import { nextDeps } from "@/lib/account/next";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleSignIn(request, await nextDeps());
}
