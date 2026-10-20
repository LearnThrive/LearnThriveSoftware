"use client";

import { useState } from "react";

/** Ends the session on the server, then reloads the site's front page (a reload, so no signed-in page lingers). */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/account/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } finally {
      // A full load on purpose: nothing signed-in may linger in the client router cache.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/library");
    }
  }
  return (
    <button type="button" className="button button--secondary" onClick={signOut} disabled={busy} aria-busy={busy}>
      <span>{busy ? "Signing out…" : "Sign out"}</span>
    </button>
  );
}
