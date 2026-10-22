import type { ReactNode } from "react";
import { PlatformShell } from "@/components/shell/PlatformShell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <PlatformShell requireDashboard>{children}</PlatformShell>;
}
