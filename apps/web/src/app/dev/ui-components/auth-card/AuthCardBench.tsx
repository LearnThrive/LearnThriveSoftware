"use client";

import { useState, type ReactNode } from "react";
import { AuthCard, type AuthErrors, type AuthMode } from "@/components/ui/AuthCard";
import styles from "./AuthCardBench.module.css";

const noop = () => {};

function State({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section data-state={id} aria-label={title} className={styles.stack}>
      <h2 className={styles.stateTitle}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * The one interactive card. The rules (all invented for the bench): sign-in with the password
 * "wrong-password-1" fails with a form error; sign-up with taken@example.com fails with an email error; a good
 * sign-up goes to "check your email"; reset goes to the reset flavour of the same state.
 */
function Demo() {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [kind, setKind] = useState<"verify" | "reset">("verify");
  const [errors, setErrors] = useState<AuthErrors>({});
  const [log, setLog] = useState("Nothing submitted yet.");

  return (
    <div className={styles.stack} data-testid="demo">
      <AuthCard
        mode={mode}
        errors={errors}
        sentKind={kind}
        onResend={() => setLog("Resend asked for.")}
        onModeChange={(next) => {
          setErrors({});
          setMode(next);
        }}
        onSubmit={(values, submittedIn) => {
          setErrors({});
          setLog(`${submittedIn}: ${values.email}, password of ${values.password.length} characters, 18 or over: ${values.confirmAdult ? "yes" : "no"}.`);
          if (submittedIn === "sign-in" && values.password === "wrong-password-1") setErrors({ form: "Email or password is not right." });
          else if (submittedIn === "sign-up" && values.email === "taken@example.com") setErrors({ email: "We could not use that email address. Try another, or sign in." });
          else if (submittedIn === "sign-up") {
            setKind("verify");
            setMode("verify-sent");
          } else if (submittedIn === "reset") {
            setKind("reset");
            setMode("verify-sent");
          }
        }}
      />
      <p role="status" data-testid="demo-log" className={styles.log}>
        {log}
      </p>
    </div>
  );
}

export function AuthCardBench() {
  return (
    <>
      <h2>Interactive</h2>
      <Demo />

      <h2>Every state</h2>
      <div className={styles.grid}>
        <State id="sign-in" title="Sign in">
          <AuthCard mode="sign-in" onSubmit={noop} />
        </State>
        <State id="sign-up" title="Sign up">
          <AuthCard mode="sign-up" onSubmit={noop} />
        </State>
        <State id="reset" title="Reset">
          <AuthCard mode="reset" onSubmit={noop} />
        </State>
        <State id="verify-sent" title="Verify sent">
          <AuthCard mode="verify-sent" onSubmit={noop} onResend={noop} />
        </State>
        <State id="reset-sent" title="Reset link sent">
          <AuthCard mode="verify-sent" sentKind="reset" onSubmit={noop} />
        </State>
        <State id="sign-in-error" title="Sign in, form error">
          <AuthCard mode="sign-in" onSubmit={noop} errors={{ form: "Email or password is not right." }} />
        </State>
        <State id="sign-up-errors" title="Sign up, field errors">
          <AuthCard
            mode="sign-up"
            onSubmit={noop}
            errors={{
              email: "Enter an email address in the form name@example.com.",
              password: "Choose a password of at least 12 characters.",
              confirmAdult: "Confirm that you are 18 or over to create an account.",
            }}
          />
        </State>
        <State id="busy" title="Busy">
          <AuthCard mode="sign-in" onSubmit={noop} busy />
        </State>
        <State id="providers" title="Google and Apple enabled">
          <AuthCard mode="sign-in" onSubmit={noop} providers={{ google: true, apple: true }} />
        </State>
        <State id="providers-sign-up" title="Google and Apple, sign up">
          <AuthCard mode="sign-up" onSubmit={noop} providers={{ google: true, apple: true }} />
        </State>
      </div>
    </>
  );
}
