import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth/guard";
import { DashboardShell } from "@/components/DashboardShell";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireSession();
  const unreadCount = await getDataProvider().notifications.unreadCountForUser(user.id);
  return <DashboardShell user={user} unreadCount={unreadCount}>{children}</DashboardShell>;
}
