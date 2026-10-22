"use client";

import { useState, type FormEvent } from "react";
import styles from "./learner.module.css";

/**
 * Shown on every page while a guardian is viewing as one of their learners. The way out needs the guardian's password, so a child using
 * the guardian's open browser cannot reach the account, billing or the learner controls.
 */
export function SupervisedBanner({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function leave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/learner/view/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = (await response.json().catch(() => null)) as { next?: string; error?: string } | null;
      if (response.ok) return window.location.assign(data?.next ?? "/account");
      setError(data?.error ?? "That did not work. Please try again.");
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.banner} role="region" aria-label="Supervised view">
      <span>
        Viewing as <strong>{name}</strong>
      </span>
      {open ? (
        <form onSubmit={leave}>
          <label>
            <span className="sr-only">Your password</span>
            <input name="password" type="password" autoComplete="current-password" placeholder="Your password" required aria-label="Your password" />
          </label>
          <button type="submit" className="button button--secondary" disabled={busy}>
            {busy ? "Checking…" : "Leave"}
          </button>
          <button type="button" className="button button--secondary" onClick={() => setOpen(false)}>
            Cancel
          </button>
          {error ? <span role="alert">{error}</span> : null}
        </form>
      ) : (
        <button type="button" className="button button--secondary" onClick={() => setOpen(true)}>
          Leave this view
        </button>
      )}
    </div>
  );
}
