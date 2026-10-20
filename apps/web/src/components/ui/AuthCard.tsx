"use client";

/* Converted from the Uiverse.io login card. From Uiverse.io by JohnnyCSilva (MIT) */

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { useFocusAfterRender } from "@/components/forms/useFocusAfterRender";
import styles from "./AuthCard.module.css";

/**
 * The sign-in / sign-up card for /login and sign-up (plan19.md section 7, the Login bullet, and the Phase C auth bullet).
 *
 * Controlled and presentational: it holds only what is being typed, calls `onSubmit` / `onModeChange` / `onProvider`,
 * and shows the `errors` it is given. No network, no storage, no tracking. Email and password only: there is no
 * "remember me" (persistent login is out of scope), and the Google and Apple buttons render only when `providers`
 * enables them (they are off unless the owner has configured them and updated the privacy and cookie pages).
 *
 * The checks in `validateAuthValues` only save a round trip. They are not the validation: the server repeats and
 * owns every one of them, and `errors` is how its answers come back.
 */

export type AuthMode = "sign-in" | "sign-up" | "reset" | "verify-sent";
export type AuthProvider = "google" | "apple";

export interface AuthValues {
  email: string;
  password: string;
  /** Sign-up only: the person confirmed they are 18 or over and are the account holder. */
  confirmAdult: boolean;
}

export interface AuthErrors {
  /** Not tied to one field (for example "Email or password is not right."). */
  form?: string;
  email?: string;
  password?: string;
  confirmAdult?: string;
}

export interface AuthLinks {
  privacy?: string;
  terms?: string;
  forgotPassword?: string;
}

export interface AuthCardProps {
  mode: AuthMode;
  /** Called with the values and the mode they were entered in, only after the client-side checks pass. */
  onSubmit: (values: AuthValues, mode: Exclude<AuthMode, "verify-sent">) => void;
  onModeChange?: (mode: AuthMode) => void;
  /** Answers from the server. Hidden while `busy` and as soon as the person edits anything; shown (and focused) again when a new answer arrives. */
  errors?: AuthErrors;
  busy?: boolean;
  /** Both default to off. A button renders only when its provider is true. */
  providers?: { google?: boolean; apple?: boolean };
  onProvider?: (provider: AuthProvider) => void;
  links?: AuthLinks;
  /** What the `verify-sent` state is about. Defaults to the email-verification link. */
  sentKind?: "verify" | "reset";
  /** When given, the `verify-sent` state offers "Send it again". */
  onResend?: () => void;
}

/** Shortest password the client check accepts; the server's rule is the real one. */
export const MIN_PASSWORD_LENGTH = 12;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateAuthValues(mode: Exclude<AuthMode, "verify-sent">, values: AuthValues): AuthErrors {
  const errors: AuthErrors = {};
  const email = values.email.trim();
  if (!email) errors.email = "Enter your email address.";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "Enter an email address in the form name@example.com.";
  if (mode === "sign-in" && !values.password) errors.password = "Enter your password.";
  if (mode === "sign-up") {
    if (values.password.length < MIN_PASSWORD_LENGTH) errors.password = `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (!values.confirmAdult) errors.confirmAdult = "Confirm that you are 18 or over to create an account.";
  }
  return errors;
}

const DEFAULT_LINKS: Required<AuthLinks> = { privacy: "/privacy", terms: "/terms", forgotPassword: "/forgot-password" };

type FieldName = "email" | "password" | "confirmAdult";
const FIELD_ORDER: FieldName[] = ["email", "password", "confirmAdult"];

const HEADINGS: Record<AuthMode, string> = {
  "sign-in": "Sign in",
  "sign-up": "Create your account",
  reset: "Reset your password",
  "verify-sent": "Check your email",
};

export function AuthCard({
  mode,
  onSubmit,
  onModeChange,
  errors,
  busy = false,
  providers,
  onProvider,
  links,
  sentKind = "verify",
  onResend,
}: AuthCardProps) {
  const uid = useId();
  const headingId = `${uid}-heading`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownMode = useRef(mode);
  // The email survives a change of mode (sign-in to reset, sign-up to "check your email"); nothing else does.
  const [email, setEmail] = useState("");
  const resolved = { ...DEFAULT_LINKS, ...links };

  // A change of mode swaps the whole card, so a keyboard or screen-reader user is moved to the new heading.
  // Comparing with the last mode shown (not "is this the first run") keeps it quiet on mount, even in Strict Mode.
  useEffect(() => {
    if (shownMode.current === mode) return;
    shownMode.current = mode;
    headingRef.current?.focus();
  }, [mode]);

  const sentTo = email.trim();

  return (
    <div className={styles.card} data-auth-mode={mode}>
      <h2 className={styles.title} id={headingId} tabIndex={-1} ref={headingRef}>
        {HEADINGS[mode]}
      </h2>

      {mode === "verify-sent" ? (
        <div className={styles.body}>
          <p className={styles.lead}>
            {sentKind === "reset" ? (
              <>
                {sentTo ? (
                  <>
                    If there is an account for <strong className={styles.address}>{sentTo}</strong>, we have sent a link to choose a new password.
                  </>
                ) : (
                  "If there is an account for that address, we have sent a link to choose a new password."
                )}
              </>
            ) : (
              <>
                {sentTo ? (
                  <>
                    We have sent a link to <strong className={styles.address}>{sentTo}</strong>.
                  </>
                ) : (
                  "We have sent you a link."
                )}{" "}
                Open it to confirm your email address. You cannot sign in until you have.
              </>
            )}
          </p>
          <p className={styles.note}>It can take a few minutes to arrive. If it does not, look in your spam or junk folder.</p>
          <div className={styles.actions}>
            {onResend ? (
              <button type="button" className={`button button--secondary ${styles.wide}`} onClick={() => !busy && onResend()} aria-disabled={busy || undefined}>
                <span>{busy ? "Sending…" : "Send it again"}</span>
              </button>
            ) : null}
            <button type="button" className={`${styles.linkButton} ${styles.centred}`} onClick={() => onModeChange?.("sign-in")}>
              Back to sign in
            </button>
          </div>
          <p className="sr-only" role="status">
            {busy ? "Sending, please wait." : ""}
          </p>
        </div>
      ) : (
        <AuthForm
          key={mode}
          mode={mode}
          headingId={headingId}
          email={email}
          onEmailChange={setEmail}
          onSubmit={onSubmit}
          onModeChange={onModeChange}
          errors={errors}
          busy={busy}
          providers={providers}
          onProvider={onProvider}
          links={resolved}
        />
      )}
    </div>
  );
}

function AuthForm({
  mode,
  headingId,
  email,
  onEmailChange,
  onSubmit,
  onModeChange,
  errors,
  busy,
  providers,
  onProvider,
  links,
}: Pick<AuthCardProps, "onSubmit" | "onModeChange" | "errors" | "providers" | "onProvider"> & {
  mode: Exclude<AuthMode, "verify-sent">;
  headingId: string;
  email: string;
  onEmailChange: (email: string) => void;
  busy: boolean;
  links: Required<AuthLinks>;
}) {
  const uid = useId();
  const [password, setPassword] = useState("");
  const [confirmAdult, setConfirmAdult] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const adultRef = useRef<HTMLInputElement>(null);

  const id = (name: string) => `${uid}-${name}`;
  const isSignUp = mode === "sign-up";
  const isReset = mode === "reset";
  const values: AuthValues = { email, password, confirmAdult };

  // Server answers hide as soon as the person edits anything, and come back (a new key) with the next submit.
  const serverErrorsJson = JSON.stringify(errors ?? {});
  const serverKey = `${attempts}:${serverErrorsJson}`;
  const hasServerErrors = Boolean(errors && Object.values(errors).some(Boolean));
  // While a submit is in flight the previous answer is stale, so it is not shown (the parent may not have cleared it yet).
  const server: AuthErrors = hasServerErrors && !busy && dismissedKey !== serverKey ? (errors as AuthErrors) : {};
  const client = attempts > 0 ? validateAuthValues(mode, values) : {};
  const fieldErrors: AuthErrors = { ...server, ...client };
  const visibleFields = FIELD_ORDER.filter((name) => {
    if (isReset && name !== "email") return false;
    if (!isSignUp && name === "confirmAdult") return false;
    return Boolean(fieldErrors[name]);
  });
  const formError = server.form;
  const problemCount = visibleFields.length + (formError ? 1 : 0);
  const hasProblems = problemCount > 0;

  // A failed submit moves focus to the summary, and so does a server answer that arrives after a submit.
  // (Not "whenever there are problems": that would pull focus out of a field the person is correcting.)
  const focusAfterRender = useFocusAfterRender();
  const submitted = useRef(false);
  useEffect(() => {
    if (submitted.current && !busy && hasServerErrors) summaryRef.current?.focus();
  }, [hasServerErrors, serverErrorsJson, busy, attempts]);

  function edited() {
    setDismissedKey(serverKey);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    submitted.current = true;
    setAttempts((count) => count + 1);
    if (Object.keys(validateAuthValues(mode, values)).length > 0) {
      focusAfterRender(summaryRef);
      return;
    }
    onSubmit({ ...values, email: values.email.trim() }, mode);
  }

  function describedBy(name: FieldName, hint?: boolean) {
    const ids = [hint ? id(`${name}-hint`) : "", fieldErrors[name] ? id(`${name}-error`) : ""].filter(Boolean).join(" ");
    return ids || undefined;
  }

  function followFocus(event: MouseEvent<HTMLAnchorElement>, name: FieldName) {
    event.preventDefault();
    ({ email: emailRef, password: passwordRef, confirmAdult: adultRef })[name].current?.focus();
  }

  function goToReset(event: MouseEvent<HTMLAnchorElement>) {
    // Let a new-tab click or a middle-click behave like any link; a plain click stays in the card.
    if (!onModeChange || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onModeChange("reset");
  }

  const submitLabel = isReset ? (busy ? "Sending…" : "Send reset link") : isSignUp ? (busy ? "Creating account…" : "Create account") : busy ? "Signing in…" : "Sign in";
  const showProviders = !isReset && (providers?.google || providers?.apple);
  const providerVerb = isSignUp ? "Sign up" : "Sign in";

  return (
    <>
    <form className={styles.form} noValidate onSubmit={submit} aria-labelledby={headingId} aria-busy={busy || undefined}>
      {isReset ? <p className={styles.lead}>Enter your email address. If there is an account for it, we will send a link to choose a new password.</p> : null}
      {isSignUp ? <p className={styles.lead}>For parents, guardians and adult learners.</p> : null}

      {hasProblems ? (
        <div className={styles.summary} role="alert" tabIndex={-1} ref={summaryRef}>
          <strong>{problemCount === 1 ? "There is 1 thing to check." : `There are ${problemCount} things to check.`}</strong>
          {formError ? <p>{formError}</p> : null}
          {visibleFields.length > 0 ? (
            <ul>
              {visibleFields.map((name) => (
                <li key={name}>
                  <a href={`#${id(name)}`} onClick={(event) => followFocus(event, name)}>
                    {fieldErrors[name]}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor={id("email")}>
          Email
        </label>
        <div className={`${styles.control} ${fieldErrors.email ? styles.invalid : ""}`}>
          <svg className={styles.icon} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
            <path d="m30.853 13.87a15 15 0 0 0 -29.729 4.082 15.1 15.1 0 0 0 12.876 12.918 15.6 15.6 0 0 0 2.016.13 14.85 14.85 0 0 0 7.715-2.145 1 1 0 1 0 -1.031-1.711 13.007 13.007 0 1 1 5.458-6.529 2.149 2.149 0 0 1 -4.158-.759v-10.856a1 1 0 0 0 -2 0v1.726a8 8 0 1 0 .2 10.325 4.135 4.135 0 0 0 7.83.274 15.2 15.2 0 0 0 .823-7.455zm-14.853 8.13a6 6 0 1 1 6-6 6.006 6.006 0 0 1 -6 6z" />
          </svg>
          <input
            ref={emailRef}
            className={styles.input}
            id={id("email")}
            name="email"
            type="email"
            // "username" is what password managers key on for the sign-in identifier; it is also an input-purpose token (WCAG 1.3.5).
            autoComplete={mode === "sign-in" ? "username" : "email"}
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => {
              onEmailChange(event.target.value);
              edited();
            }}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={describedBy("email")}
          />
        </div>
        {fieldErrors.email ? (
          <p className={styles.error} id={id("email-error")}>
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      {isReset ? null : (
        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label className={styles.label} htmlFor={id("password")}>
              Password
            </label>
            {mode === "sign-in" ? (
              <a className={styles.link} href={links.forgotPassword} onClick={goToReset}>
                Forgot password?
              </a>
            ) : null}
          </div>
          <div className={`${styles.control} ${fieldErrors.password ? styles.invalid : ""}`}>
            <svg className={styles.icon} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="-64 0 512 512" aria-hidden="true" focusable="false">
              <path d="m336 512h-288c-26.453125 0-48-21.523438-48-48v-224c0-26.476562 21.546875-48 48-48h288c26.453125 0 48 21.523438 48 48v224c0 26.476562-21.546875 48-48 48zm-288-288c-8.8125 0-16 7.167969-16 16v224c0 8.832031 7.1875 16 16 16h288c8.8125 0 16-7.167969 16-16v-224c0-8.832031-7.1875-16-16-16zm0 0" />
              <path d="m304 224c-8.832031 0-16-7.167969-16-16v-80c0-52.929688-43.070312-96-96-96s-96 43.070312-96 96v80c0 8.832031-7.167969 16-16 16s-16-7.167969-16-16v-80c0-70.59375 57.40625-128 128-128s128 57.40625 128 128v80c0 8.832031-7.167969 16-16 16zm0 0" />
            </svg>
            <input
              ref={passwordRef}
              className={styles.input}
              id={id("password")}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={isSignUp ? "new-password" : "current-password"}
              autoCapitalize="none"
              spellCheck={false}
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                edited();
              }}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={describedBy("password", isSignUp)}
            />
            <button
              type="button"
              className={styles.toggle}
              onClick={() => setShowPassword((shown) => !shown)}
              aria-pressed={showPassword}
              aria-label="Show password"
            >
              {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
            </button>
          </div>
          {isSignUp ? (
            <p className={styles.hint} id={id("password-hint")}>
              At least {MIN_PASSWORD_LENGTH} characters. Three or four unrelated words work well.
            </p>
          ) : null}
          {fieldErrors.password ? (
            <p className={styles.error} id={id("password-error")}>
              {fieldErrors.password}
            </p>
          ) : null}
        </div>
      )}

      {isSignUp ? (
        <>
          <div className={styles.field}>
            <label className={`${styles.check} ${fieldErrors.confirmAdult ? styles.invalidCheck : ""}`} htmlFor={id("confirmAdult")}>
              <input
                ref={adultRef}
                className={styles.checkInput}
                id={id("confirmAdult")}
                name="confirmAdult"
                type="checkbox"
                required
                checked={confirmAdult}
                onChange={(event) => {
                  setConfirmAdult(event.target.checked);
                  edited();
                }}
                aria-invalid={Boolean(fieldErrors.confirmAdult)}
                aria-describedby={describedBy("confirmAdult")}
              />
              <span>I am 18 or over, and I am the account holder.</span>
            </label>
            {fieldErrors.confirmAdult ? (
              <p className={styles.error} id={id("confirmAdult-error")}>
                {fieldErrors.confirmAdult}
              </p>
            ) : null}
          </div>
          <p className={styles.note}>Students under 18 do not need an email address of their own. A parent or guardian creates the account and adds each student as a profile under it.</p>
          <p className={styles.note}>
            By creating an account you agree to the <NewTabLink href={links.terms}>terms</NewTabLink> and confirm you have read the{" "}
            <NewTabLink href={links.privacy}>privacy notice</NewTabLink>.
          </p>
        </>
      ) : null}

      <button type="submit" className={`button button--primary ${styles.wide}`} aria-disabled={busy || undefined}>
        <span>{submitLabel}</span>
      </button>

      {showProviders ? (
        <div className={styles.providers}>
          <p className={styles.divider}>
            <span>or</span>
          </p>
          {providers?.google ? (
            <button type="button" className={`${styles.provider} ${styles.google}`} onClick={() => !busy && onProvider?.("google")} aria-disabled={busy || undefined}>
              <GoogleMark />
              <span>{providerVerb} with Google</span>
            </button>
          ) : null}
          {providers?.apple ? (
            <button type="button" className={`${styles.provider} ${styles.apple}`} onClick={() => !busy && onProvider?.("apple")} aria-disabled={busy || undefined}>
              <AppleMark />
              <span>{providerVerb} with Apple</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {isReset ? (
        <p className={styles.switch}>
          <button type="button" className={styles.linkButton} onClick={() => onModeChange?.("sign-in")}>
            Back to sign in
          </button>
        </p>
      ) : (
        <p className={styles.switch}>
          {isSignUp ? "Already have an account? " : "New here? "}
          <button type="button" className={styles.linkButton} onClick={() => onModeChange?.(isSignUp ? "sign-in" : "sign-up")}>
            {isSignUp ? "Sign in" : "Create an account"}
          </button>
        </p>
      )}
    </form>
    {/* Outside the form on purpose: aria-busy on an ancestor can make a screen reader hold back this announcement. */}
    <p className="sr-only" role="status">
      {busy ? `${submitLabel.replace("…", "")}, please wait.` : ""}
    </p>
    </>
  );
}

function NewTabLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={styles.link} href={href} target="_blank" rel="noopener">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** The four-colour Google "G" from Google's sign-in branding guidelines. Its colours are the brand's, not ours. */
function GoogleMark() {
  return (
    <svg className={styles.mark} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** The Apple logo (the glyph from the Uiverse source), drawn in the button's text colour as Apple's guidelines ask. */
function AppleMark() {
  return (
    <svg className={styles.mark} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22.773 22.773" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M15.769,0c0.053,0,0.106,0,0.162,0c0.13,1.606-0.483,2.806-1.228,3.675c-0.731,0.863-1.732,1.7-3.351,1.573 c-0.108-1.583,0.506-2.694,1.25-3.561C13.292,0.879,14.557,0.16,15.769,0z" />
      <path d="M20.67,16.716c0,0.016,0,0.03,0,0.045c-0.455,1.378-1.104,2.559-1.896,3.655c-0.723,0.995-1.609,2.334-3.191,2.334 c-1.367,0-2.275-0.879-3.676-0.903c-1.482-0.024-2.297,0.735-3.652,0.926c-0.155,0-0.31,0-0.462,0 c-0.995-0.144-1.798-0.932-2.383-1.642c-1.725-2.098-3.058-4.808-3.306-8.276c0-0.34,0-0.679,0-1.019 c0.105-2.482,1.311-4.5,2.914-5.478c0.846-0.52,2.009-0.963,3.304-0.765c0.555,0.086,1.122,0.276,1.619,0.464 c0.471,0.181,1.06,0.502,1.618,0.485c0.378-0.011,0.754-0.208,1.135-0.347c1.116-0.403,2.21-0.865,3.652-0.648 c1.733,0.262,2.963,1.032,3.723,2.22c-1.466,0.933-2.625,2.339-2.427,4.74C17.818,14.688,19.086,15.964,20.67,16.716z" />
    </svg>
  );
}
