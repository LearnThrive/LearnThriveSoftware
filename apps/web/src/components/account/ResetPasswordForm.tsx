"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { TextField } from "@/components/forms/Fields";
import { PASSWORD_MAX, PASSWORD_MIN, passwordError } from "@/lib/account/validation";
import styles from "./account.module.css";

/** Choose a new password, after an emailed link has signed the person in. */
export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const busy = useRef(false);
  const resultRef = useRef<HTMLParagraphElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const problem = passwordError(password);
    if (problem) return setError(problem);
    busy.current = true;
    setState("sending");
    setError("");
    try {
      const response = await fetch("/api/account/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = (await response.json().catch(() => null)) as { error?: string; errors?: { password?: string } } | null;
      if (response.ok) {
        setState("done");
        setPassword("");
        queueMicrotask(() => resultRef.current?.focus());
        return;
      }
      setError(data?.errors?.password ?? data?.error ?? "We could not change your password just now. Please try again.");
      setState("idle");
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setState("idle");
    } finally {
      busy.current = false;
    }
  }

  if (state === "done") {
    return (
      <div className={styles.panel}>
        <p className={styles.lead} role="status" tabIndex={-1} ref={resultRef}>
          Your password has been changed. Other devices have been signed out.
        </p>
        <div className={styles.actions}>
          <Link className="button button--primary" href="/account">
            <span>Go to your account</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.panel} noValidate onSubmit={submit} aria-label="Choose a new password">
      <TextField
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN} characters. A few random words is a good password.`}
        value={password}
        onChange={(value) => {
          setPassword(value);
          setError("");
        }}
        error={error || undefined}
        maxLength={PASSWORD_MAX}
      />
      <div className={styles.actions}>
        <button type="submit" className="button button--primary" disabled={state === "sending"} aria-busy={state === "sending"}>
          <span>{state === "sending" ? "Saving…" : "Save new password"}</span>
        </button>
      </div>
    </form>
  );
}
