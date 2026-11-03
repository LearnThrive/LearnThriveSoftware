import { supabaseKeyHeaders } from "../supabaseKeys";
import type { AccountAdmin, AdminCreateFailure, AdminCreateInput } from "./types";

/**
 * AccountAdmin over Supabase Auth's admin REST API. Server only, with the secret key: that key never reaches a browser or a log, and
 * nothing from a response is logged. Failures that are not the administrator's mistake all become "unavailable".
 */
export interface SupabaseAdminConfig {
  url: string;
  /** The secret key (sb_secret_...) or the legacy service_role JWT. */
  serviceKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type Json = { [key: string]: unknown };

interface Reply {
  status: number;
  body: Json | null;
}

/** About a century: Auth has no "for ever", and "none" is what lifts a ban. */
const BAN_FOR_GOOD = "876000h";

export class SupabaseAccountAdmin implements AccountAdmin {
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: SupabaseAdminConfig) {
    this.base = `${config.url.replace(/\/+$/, "")}/auth/v1/admin`;
    this.doFetch = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  private async call(method: "POST" | "PUT" | "DELETE", path: string, body?: Json): Promise<Reply | null> {
    try {
      const response = await this.doFetch(`${this.base}${path}`, {
        method,
        headers: { ...supabaseKeyHeaders(this.config.serviceKey), ...(body ? { "Content-Type": "application/json" } : {}) },
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

  private static code(reply: Reply): string {
    return String(reply.body?.error_code ?? reply.body?.code ?? "");
  }

  private static passwordRefused(reply: Reply): boolean {
    const code = SupabaseAccountAdmin.code(reply);
    return code === "weak_password" || (code === "validation_failed" && /password/i.test(String(reply.body?.msg ?? "")));
  }

  async createUser(input: AdminCreateInput): Promise<{ ok: true; id: string } | { ok: false; reason: AdminCreateFailure }> {
    const reply = await this.call("POST", "/users", {
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { display_name: input.displayName, ...(input.adultConfirmed ? { adult_confirmed: true } : {}) },
    });
    if (!reply || reply.status >= 500 || reply.status === 429) return { ok: false, reason: "unavailable" };
    if (reply.status >= 200 && reply.status < 300 && typeof reply.body?.id === "string") return { ok: true, id: reply.body.id };
    const code = SupabaseAccountAdmin.code(reply);
    if (code === "email_exists" || code === "user_already_exists") return { ok: false, reason: "exists" };
    return { ok: false, reason: SupabaseAccountAdmin.passwordRefused(reply) ? "weak_password" : "unavailable" };
  }

  async setPassword(userId: string, password: string): Promise<{ ok: true } | { ok: false; reason: "weak_password" | "unavailable" }> {
    const reply = await this.call("PUT", `/users/${encodeURIComponent(userId)}`, { password });
    if (reply?.status === 200) return { ok: true };
    return { ok: false, reason: reply && SupabaseAccountAdmin.passwordRefused(reply) ? "weak_password" : "unavailable" };
  }

  async recoveryLink(email: string): Promise<{ tokenHash: string } | null> {
    // generate_link sends nothing: it hands the one-time token back, and the site emails the linked address itself.
    const reply = await this.call("POST", "/generate_link", { type: "recovery", email });
    const token = reply?.status === 200 ? reply.body?.hashed_token : undefined;
    return typeof token === "string" ? { tokenHash: token } : null;
  }

  async setDisabled(userId: string, disabled: boolean): Promise<boolean> {
    const reply = await this.call("PUT", `/users/${encodeURIComponent(userId)}`, { ban_duration: disabled ? BAN_FOR_GOOD : "none" });
    return reply?.status === 200;
  }

  async deleteUser(userId: string): Promise<boolean> {
    const reply = await this.call("DELETE", `/users/${encodeURIComponent(userId)}`);
    return reply !== null && reply.status >= 200 && reply.status < 300;
  }
}
