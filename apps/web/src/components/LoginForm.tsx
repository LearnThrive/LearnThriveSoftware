"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Status = "idle" | "submitting" | "error";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setStatus("error");
      setError("Enter your email and password.");
      return;
    }

    setStatus("submitting");
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, rememberMe }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setStatus("error");
        setError(data?.error ?? "Something went wrong. Please try again.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setStatus("error");
      setError("Could not reach the server. Check your connection and try again.");
    }
  }

  const submitting = status === "submitting";

  return (
    <form className="form auth-form" onSubmit={handleSubmit} noValidate>
      {error ? (
        <div className="alert alert--error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      <div className="field">
        <label className="field__label" htmlFor="login-email">Email</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          disabled={submitting}
          aria-invalid={status === "error" && !email.trim() ? "true" : undefined}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="login-password">Password</label>
        <div className="password-field">
          <input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            disabled={submitting}
            aria-invalid={status === "error" && !password ? "true" : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            className="password-field__toggle"
            onClick={() => setShowPassword((current) => !current)}
            aria-pressed={showPassword}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={rememberMe}
          disabled={submitting}
          onChange={(event) => setRememberMe(event.target.checked)}
        />
        <span>Remember me on this device</span>
      </label>

      <div className="form-actions">
        <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
          <span>{submitting ? "Signing in…" : "Sign in"}</span>
        </button>
      </div>
    </form>
  );
}
