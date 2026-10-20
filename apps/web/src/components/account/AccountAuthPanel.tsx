"use client";

import { useEffect, useRef, useState } from "react";
import { Honeypot } from "@/components/forms/Fields";
import { HumanCheck } from "@/components/forms/HumanCheck";
import { useHumanCheck } from "@/components/forms/useHumanCheck";
import { AuthCard, type AuthErrors, type AuthMode, type AuthValues } from "@/components/ui/AuthCard";
import styles from "./account.module.css";

interface Reply {
  status: number;
  data: { success?: boolean; code?: string; error?: string; errors?: AuthErrors } | null;
}

async function post(path: string, body: Record<string, unknown>): Promise<Reply | null> {
  try {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json().catch(() => null) };
  } catch {
    return null;
  }
}

const NETWORK = "We could not reach the server. Check your connection and try again.";
const NOT_READY = "The check that you are a person has not finished yet. Please wait a moment, then try again.";

/**
 * Sign in, create an account, ask for a password-reset link, and the "check your email" state, over AuthCard. The
 * card is presentational: this holds the network calls. Sign-up and the two email-link requests carry the same
 * human check, honeypot and minimum time the site's other forms use; sign-in carries none (the server's lockout and
 * Supabase's own limits guard it). After a good sign-in the page is reloaded rather than client-routed, so the
 * server sees the new cookie on the first request.
 */
export function AccountAuthPanel({ initialMode = "sign-in", next = "/account" }: { initialMode?: Exclude<AuthMode, "verify-sent">; next?: string }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [sentKind, setSentKind] = useState<"verify" | "reset">("verify");
  const [errors, setErrors] = useState<AuthErrors>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [trap, setTrap] = useState("");
  const email = useRef("");
  const openedAt = useRef(0);
  const sending = useRef(false);
  const check = useHumanCheck({ auto: false });

  useEffect(() => {
    openedAt.current = performance.now();
  }, []);

  async function withCheck(path: string, body: Record<string, unknown>): Promise<Reply | null | "not-ready"> {
    const answer = check.getAnswer();
    if (!answer) return "not-ready";
    const reply = await post(path, { ...body, website: trap, elapsedMs: Math.round(performance.now() - openedAt.current), humanCheck: answer });
    if (!reply || ![413, 429, 503].includes(reply.status)) check.renew();
    return reply;
  }

  async function submit(values: AuthValues, submittedIn: Exclude<AuthMode, "verify-sent">) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setErrors({});
    setNotice("");
    email.current = values.email;
    try {
      if (submittedIn === "sign-in") {
        const reply = await post("/api/account/login", { email: values.email, password: values.password });
        if (!reply) return setErrors({ form: NETWORK });
        if (reply.status === 200) {
          window.location.assign(next);
          return;
        }
        if (reply.data?.code === "email_not_confirmed") {
          setSentKind("verify");
          setMode("verify-sent");
          setNotice(reply.data.error ?? "");
          return;
        }
        return setErrors({ form: reply.data?.error ?? "We could not sign you in just now. Please try again." });
      }

      const isSignUp = submittedIn === "sign-up";
      const reply = await withCheck(isSignUp ? "/api/account/signup" : "/api/account/forgot", isSignUp ? { email: values.email, password: values.password, confirmAdult: values.confirmAdult } : { email: values.email });
      if (reply === "not-ready") return setErrors({ form: NOT_READY });
      if (!reply) return setErrors({ form: NETWORK });
      if (reply.status === 200) {
        setSentKind(isSignUp ? "verify" : "reset");
        setMode("verify-sent");
        return;
      }
      setErrors({ ...(reply.data?.errors ?? {}), ...(reply.data?.errors ? {} : { form: reply.data?.error ?? "We could not do that just now. Please try again." }) });
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function resend() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setNotice("");
    try {
      const reply = await withCheck(sentKind === "reset" ? "/api/account/forgot" : "/api/account/resend", { email: email.current });
      if (reply === "not-ready") setNotice(NOT_READY);
      else if (!reply) setNotice(NETWORK);
      else setNotice(reply.status === 200 ? "We have sent it again." : (reply.data?.error ?? "We could not send it just now. Please try again shortly."));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <div onFocus={check.start}>
      <AuthCard
        mode={mode}
        sentKind={sentKind}
        errors={errors}
        busy={busy}
        onSubmit={submit}
        onResend={resend}
        onModeChange={(nextMode) => {
          setErrors({});
          setNotice("");
          setMode(nextMode);
        }}
        links={{ privacy: "/privacy", terms: "/terms", forgotPassword: "/account/forgot" }}
      />
      <p className={styles.notice} role="status" aria-live="polite">
        {notice}
      </p>
      {mode !== "sign-in" ? (
        <div className={styles.check}>
          <HumanCheck check={check} />
        </div>
      ) : null}
      <Honeypot id="account-website" value={trap} onChange={setTrap} />
    </div>
  );
}
