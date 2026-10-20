import { handleMe } from "@/lib/account/handlers";
import { nextDeps } from "@/lib/account/next";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleMe(await nextDeps());
}
