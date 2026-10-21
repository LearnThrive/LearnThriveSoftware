import { signOutEverywhere } from "@/lib/access/signout";

export async function POST() {
  await signOutEverywhere();
  return Response.json({ ok: true });
}
