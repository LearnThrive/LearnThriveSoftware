"use client";

import { LogOut } from "lucide-react";

/** Signing out is always allowed (a shared computer must not stay signed in); the lesson is still waiting at the next sign-in. */
export function SignOutButton() {
  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.replace("/");
    }
  }
  return (
    <button type="button" className="btn btn--ghost" onClick={signOut}>
      <LogOut size={16} aria-hidden="true" />Log out
    </button>
  );
}
