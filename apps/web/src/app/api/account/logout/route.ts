import { handleSignOut } from "@/lib/account/handlers";
import { nextDeps } from "@/lib/account/next";
import { destroySession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const response = await handleSignOut(request, await nextDeps());
  // The development provider's session too (local development only), so one sign-out ends every kind of sign-in. Not on a refused request.
  if (response.ok) await destroySession();
  return response;
}
