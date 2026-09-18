import { NextResponse } from "next/server";
import { resetDataProvider } from "@learnthrive/data/inMemoryProvider";
import { requireRoleForApi } from "@/lib/auth/guard";

// Plan section 98: "Provide a deliberate development-only method to reset seed state... Do not
// expose a public reset endpoint." Two independent guards, not one: a hard NODE_ENV check (the
// same fail-safe pattern as assertNotProductionWithoutRealProvider() in devProvider.ts — this
// throws rather than silently no-opping, so a misconfigured production deploy fails loudly
// instead of quietly carrying a reset endpoint) and requireRoleForApi(["ADMIN"]) so even in
// development this can't be triggered by an unauthenticated request.
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The development data reset endpoint is not available when NODE_ENV=production.");
  }
  const user = await requireRoleForApi(["ADMIN"]);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  resetDataProvider();
  return NextResponse.json({ ok: true });
}
