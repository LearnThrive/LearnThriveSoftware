"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { AuthenticatedUser } from "@/lib/auth/types";

const ROLE_LABELS: Record<AuthenticatedUser["role"], string> = {
  ADMIN: "Admin",
  TUTOR: "Tutor",
  CLIENT: "Client",
  STUDENT: "Student",
};

export function DashboardShell({ user, children }: { user: AuthenticatedUser; children: ReactNode }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="dashboard-shell">
      <header className="dashboard-shell__header">
        <Link href="/" className="dashboard-shell__brand">
          LearnThrive
        </Link>
        <div className="dashboard-shell__user">
          <span className="dashboard-shell__role-badge">{ROLE_LABELS[user.role]}</span>
          <span className="dashboard-shell__name">{user.name}</span>
          <button type="button" className="button button--text" onClick={handleLogout} disabled={signingOut}>
            <span>{signingOut ? "Signing out…" : "Log out"}</span>
          </button>
        </div>
      </header>
      <main className="dashboard-shell__content">{children}</main>
    </div>
  );
}
