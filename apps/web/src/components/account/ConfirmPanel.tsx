"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import styles from "./account.module.css";

type Kind = "signup" | "recovery";

/**
 * The page an emailed link opens. The link is spent by this button, a POST, and not by loading the page: mail
 * scanners and link previews open links (a GET), and that must not use up a one-time link.
 */
export function ConfirmPanel({ tokenHash, kind }: { tokenHash: string; kind: Kind }) {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [message, setMessage] = useState("");
  const busy = useRef(false);

  async function confirm() {
    if (busy.current) return;
    busy.current = true;
    setState("working");
    try {
      const response = await fetch("/api/account/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokenHash, type: kind }) });
      const data = (await response.json().catch(() => null)) as { next?: string; error?: string } | null;
      if (response.ok && data?.next) {
        window.location.assign(data.next);
        return;
      }
      setMessage(data?.error ?? "We could not use that link. Please try again.");
      setState("failed");
    } catch {
      setMessage("We could not reach the server. Check your connection and try again.");
      setState("failed");
    } finally {
      busy.current = false;
    }
  }

  return (
    <div className={styles.panel}>
      <p className={styles.lead}>{kind === "recovery" ? "Press the button to choose a new password." : "Press the button to confirm your email address and sign in."}</p>
      {state === "failed" ? (
        <p className={styles.error} role="alert">
          {message}{" "}
          <Link className={styles.link} href={kind === "recovery" ? "/account/forgot" : "/login"}>
            {kind === "recovery" ? "Ask for a new link" : "Back to sign in"}
          </Link>
        </p>
      ) : null}
      <div className={styles.actions}>
        <button type="button" className="button button--primary" onClick={confirm} disabled={state === "working"} aria-busy={state === "working"}>
          <span>{state === "working" ? "Please wait…" : kind === "recovery" ? "Choose a new password" : "Confirm my email"}</span>
        </button>
      </div>
    </div>
  );
}
