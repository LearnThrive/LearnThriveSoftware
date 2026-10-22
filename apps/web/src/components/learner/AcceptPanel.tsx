"use client";

import { useState, type FormEvent } from "react";
import styles from "./learner.module.css";

type Peek = { state: "checking" } | { state: "open"; email: string | null } | { state: "closed" };

async function post(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> | null }> {
  try {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, data: (await response.json().catch(() => null)) as Record<string, unknown> | null };
  } catch {
    return { status: 0, data: { error: "We could not reach the server. Check your connection and try again." } };
  }
}

/**
 * The page a guardian's invitation link opens. Signed in: one button binds this account to the student the link names. Signed out: make
 * the learner's account (no adult declaration: they are not an adult account holder), confirm the email, then open the link again; or
 * sign in to an account they already have. The link is the only secret: nothing about the student is shown before it is accepted.
 */
export function AcceptPanel({ token, signedIn, initial }: { token: string; signedIn: boolean; initial: { state: "open"; email: string | null } | { state: "closed" } }) {
  const [peek] = useState<Peek>(initial);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<"" | "sent" | "accepted">("");
  const [busy, setBusy] = useState(false);

  if (peek.state === "closed") {
    return <p role="alert">That invitation cannot be used. It may have expired, been used already, or been cancelled. Ask your parent or guardian for a new one.</p>;
  }
  if (done === "sent") {
    return (
      <div className={styles.wrap}>
        <p>We have sent you an email. Open the link in it to confirm your address, then come back to this page (open your invitation link again) to finish.</p>
      </div>
    );
  }
  if (done === "accepted") return <p role="status">All set. Taking you to your account…</p>;

  async function accept() {
    setBusy(true);
    setError("");
    const result = await post("/api/learner/accept", { token });
    setBusy(false);
    if (result.status === 200) {
      setDone("accepted");
      window.location.assign(typeof result.data?.next === "string" ? result.data.next : "/account");
    } else setError(typeof result.data?.error === "string" ? result.data.error : "We could not use that invitation. Please try again.");
  }

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setErrors({});
    const result = await post("/api/learner/signup", { token, email: String(form.get("email") ?? ""), password: String(form.get("password") ?? ""), displayName: String(form.get("displayName") ?? "") });
    setBusy(false);
    if (result.status === 200) return setDone("sent");
    const fieldErrors = result.data?.errors as Record<string, string> | undefined;
    if (fieldErrors) setErrors(fieldErrors);
    else setError(typeof result.data?.error === "string" ? result.data.error : "We could not do that just now. Please try again.");
  }

  if (signedIn) {
    return (
      <div className={styles.wrap}>
        <p>Your parent or guardian has invited you to use LearnThrive with your own sign-in. Continue to link this account to your learner profile.</p>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.row}>
          <button type="button" className="button button--primary" onClick={() => void accept()} disabled={busy}>
            {busy ? "Working…" : "Accept the invitation"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <p>Your parent or guardian has invited you to use LearnThrive with your own sign-in. Make your account below.</p>
      <form className={styles.form} onSubmit={signUp} aria-label="Make your account" noValidate>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <label className={styles.field}>
          <span>Your first name</span>
          <input name="displayName" maxLength={80} autoComplete="given-name" />
        </label>
        <label className={styles.field}>
          <span>Email address</span>
          <input name="email" type="email" required defaultValue={peek.state === "open" ? (peek.email ?? "") : ""} readOnly={peek.state === "open" && Boolean(peek.email)} autoComplete="email" aria-invalid={errors.email ? true : undefined} />
          {errors.email ? <span role="alert" className={styles.help}>{errors.email}</span> : null}
        </label>
        <label className={styles.field}>
          <span>Choose a password</span>
          <input name="password" type="password" required minLength={10} autoComplete="new-password" aria-invalid={errors.password ? true : undefined} />
          {errors.password ? <span role="alert" className={styles.help}>{errors.password}</span> : null}
        </label>
        <div className={styles.row}>
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? "Working…" : "Make my account"}
          </button>
        </div>
      </form>
      <p className={styles.help}>
        Already have an account made from an invitation? <a href={"/login?next=" + encodeURIComponent("/learner/accept?token=" + token)}>Sign in</a>, then open this link again.
      </p>
    </div>
  );
}
