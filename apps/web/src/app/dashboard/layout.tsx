import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth/guard";
import { DashboardShell } from "@/components/DashboardShell";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireSession();
  return <DashboardShell user={user}>{children}</DashboardShell>;
}
