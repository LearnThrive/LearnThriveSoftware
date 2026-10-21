import { supabaseKeyHeaders } from "../supabaseKeys";
import type { AccountAuth, AuthTokens, AuthUser, EmailLinkKind, SignUpInput } from "./types";

/**
 * AccountAuth over Supabase Auth's REST API (GoTrue). Server only, no SDK and no new dependency: eight calls.
 *
 * Supabase Auth owns the passwords (it stores only hashes), the verification and reset emails and the token
 * signing. This site never sees a password after the request that carries it, and never stores one. Settings the
 * owner must make in the Supabase dashboard (email confirmation on, minimum password length, the email templates
 * that point at /account/confirm, session limits) are listed in docs/AUTHENTICATION.md.
 *
 * Nothing from a response is ever logged. Failures that are not the person's mistake all become "unavailable".
 */
export interface SupabaseAuthConfig {
  /** For example https://abcdefgh.supabase.co */
  url: string;
  /** The publishable key (sb_publishable_...) or the legacy anon JWT. It identifies the project; it grants nothing beyond what Auth allows anyone. */
  anonKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type Json = { [key: string]: unknown };

interface Reply {
  status: number;
  body: Json | null;
}

export class SupabaseAccountAuth implements AccountAuth {
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: SupabaseAuthConfig) {
    this.base = `${config.url.replace(/\/+$/, "")}/auth/v1`;
    this.doFetch = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  private async call(method: "GET" | "POST" | "PUT", path: string, body?: Json, bearer?: string): Promise<Reply | null> {
    try {
      const response = await this.doFetch(`${this.base}${path}`, {
        method,
        headers: {
          ...supabaseKeyHeaders(this.config.anonKey, bearer),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
      const text = await response.text();
      let parsed: Json | null = null;
      try {
        parsed = text ? (JSON.parse(text) as Json) : null;
      } catch {
        parsed = null;
      }
      return { status: response.status, body: parsed };
    } catch {
      return null;
    }
  }

  private static user(raw: Json | undefined): AuthUser | null {
    if (!raw || typeof raw.id !== "string" || typeof raw.email !== "string") return null;
    const metadata = raw.user_metadata;
    const name = typeof metadata === "object" && metadata !== null ? (metadata as Json).display_name : undefined;
    return { id: raw.id, email: raw.email, displayName: typeof name === "string" ? name : "" };
  }

  private static session(body: Json | null, now = Date.now()): { user: AuthUser; tokens: AuthTokens } | null {
    if (!body || typeof body.access_token !== "string" || typeof body.refresh_token !== "string") return null;
    const user = SupabaseAccountAuth.user(typeof body.user === "object" && body.user !== null ? (body.user as Json) : undefined);
    if (!user) return null;
    const seconds = typeof body.expires_in === "number" ? body.expires_in : 3600;
    return { user, tokens: { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: now + seconds * 1000 } };
  }

  private static code(reply: Reply): string {
    return String(reply.body?.error_code ?? reply.body?.code ?? "");
  }

  async signUp(input: SignUpInput) {
    const reply = await this.call("POST", "/signup", {
      email: input.email,
      password: input.password,
      data: { display_name: input.displayName, adult_confirmed: true },
    });
    if (!reply || reply.status >= 500 || reply.status === 429) return { ok: false as const, reason: "unavailable" as const };
    if (reply.status >= 200 && reply.status < 300) return { ok: true as const };
    const code = SupabaseAccountAuth.code(reply);
    if (code === "weak_password") return { ok: false as const, reason: "weak_password" as const };
    // validation_failed is also what Auth answers for a password it cannot hash (over 72 bytes): say that, not "invalid email".
    if (code === "validation_failed" && /password/i.test(String(reply.body?.msg ?? ""))) return { ok: false as const, reason: "weak_password" as const };
    if (code === "email_address_invalid" || code === "validation_failed") return { ok: false as const, reason: "invalid_email" as const };
    // "user_already_exists" is not reported to the caller: sign-up looks the same either way.
    if (code === "user_already_exists" || code === "email_exists") return { ok: true as const };
    return { ok: false as const, reason: "unavailable" as const };
  }

  async signIn(email: string, password: string) {
    const reply = await this.call("POST", "/token?grant_type=password", { email, password });
    if (!reply || reply.status >= 500 || reply.status === 429) return { ok: false as const, reason: "unavailable" as const };
    if (reply.status === 200) {
      const session = SupabaseAccountAuth.session(reply.body);
      return session ? { ok: true as const, ...session } : { ok: false as const, reason: "unavailable" as const };
    }
    if (SupabaseAccountAuth.code(reply) === "email_not_confirmed") return { ok: false as const, reason: "email_not_confirmed" as const };
    return { ok: false as const, reason: "invalid_credentials" as const };
  }

  async verifyEmailLink(tokenHash: string, kind: EmailLinkKind) {
    const reply = await this.call("POST", "/verify", { type: kind, token_hash: tokenHash });
    if (!reply || reply.status >= 500 || reply.status === 429) return { ok: false as const, reason: "unavailable" as const };
    const session = reply.status === 200 ? SupabaseAccountAuth.session(reply.body) : null;
    return session ? { ok: true as const, ...session } : { ok: false as const, reason: "invalid_token" as const };
  }

  async requestPasswordReset(email: string) {
    const reply = await this.call("POST", "/recover", { email });
    // A 4xx here would reveal nothing useful to the person; only an outage is worth saying.
    return !reply || reply.status >= 500 ? { ok: false as const, reason: "unavailable" as const } : { ok: true as const };
  }

  async resendVerification(email: string) {
    const reply = await this.call("POST", "/resend", { type: "signup", email });
    return !reply || reply.status >= 500 ? { ok: false as const, reason: "unavailable" as const } : { ok: true as const };
  }

  async updatePassword(accessToken: string, newPassword: string) {
    const reply = await this.call("PUT", "/user", { password: newPassword }, accessToken);
    if (!reply || reply.status >= 500 || reply.status === 429) return { ok: false as const, reason: "unavailable" as const };
    if (reply.status === 200) return { ok: true as const };
    const code = SupabaseAccountAuth.code(reply);
    if (code === "weak_password" || (code === "validation_failed" && /password/i.test(String(reply.body?.msg ?? "")))) return { ok: false as const, reason: "weak_password" as const };
    return { ok: false as const, reason: "invalid_token" as const };
  }

  async getUser(accessToken: string): Promise<AuthUser | null> {
    const reply = await this.call("GET", "/user", undefined, accessToken);
    return reply?.status === 200 ? SupabaseAccountAuth.user(reply.body ?? undefined) : null;
  }

  async refresh(refreshToken: string): Promise<AuthTokens | null> {
    const reply = await this.call("POST", "/token?grant_type=refresh_token", { refresh_token: refreshToken });
    return reply?.status === 200 ? (SupabaseAccountAuth.session(reply.body)?.tokens ?? null) : null;
  }

  async signOut(accessToken: string): Promise<void> {
    await this.call("POST", "/logout", {}, accessToken);
  }
}
