"use server";

import { revalidatePath } from "next/cache";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { requireSession } from "@/lib/auth/guard";

export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const user = await requireSession();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) throw new Error("Notification is required.");

  const data = getDataProvider();
  // A notification belongs to exactly one recipient — check ownership before marking read, the
  // same IDOR discipline every other mutating action in this app follows, even though the
  // consequence of skipping it here would only be marking someone else's notification read.
  const own = (await data.notifications.forUser(user.id)).some((n) => n.id === id);
  if (!own) throw new Error("Notification not found.");

  await data.notifications.markRead(id);
  revalidatePath("/dashboard/notifications");
}
