"use client";

import { useRef, useState, type FormEvent } from "react";
import { TextField } from "@/components/forms/Fields";
import { NAME_MAX } from "@/lib/account/validation";
import styles from "./account.module.css";

/** The name printed on every PDF you download. Optional: without one, your email address is printed instead. */
export function NameForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState(initialName);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const busy = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setStatus("saving");
    setError("");
    try {
      const response = await fetch("/api/account/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: name }) });
      const data = (await response.json().catch(() => null)) as { displayName?: string; error?: string; errors?: { displayName?: string } } | null;
      if (response.ok) {
        setSaved(data?.displayName ?? name);
        setName(data?.displayName ?? name);
        setStatus("saved");
        return;
      }
      setError(data?.errors?.displayName ?? data?.error ?? "We could not save that just now. Please try again.");
      setStatus("idle");
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setStatus("idle");
    } finally {
      busy.current = false;
    }
  }

  return (
    <form className={styles.panel} noValidate onSubmit={submit} aria-label="Your name">
      <TextField
        name="displayName"
        label="Name on downloads"
        optional
        autoComplete="name"
        hint="Printed, with the date, on every page of each PDF you download. Leave it empty to use your email address."
        value={name}
        onChange={(value) => {
          setName(value);
          setStatus("idle");
          setError("");
        }}
        error={error || undefined}
        maxLength={NAME_MAX}
      />
      <div className={styles.actions}>
        <button type="submit" className="button button--secondary" disabled={status === "saving" || name.trim() === saved.trim()} aria-busy={status === "saving"}>
          <span>{status === "saving" ? "Saving…" : "Save name"}</span>
        </button>
        <span role="status" aria-live="polite">
          {status === "saved" ? "Saved." : ""}
        </span>
      </div>
    </form>
  );
}
