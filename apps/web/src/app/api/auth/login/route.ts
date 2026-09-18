import { getAuthProvider } from "@/lib/auth/devProvider";
import { createSession } from "@/lib/auth/session";

interface LoginRequestBody {
  email?: unknown;
  password?: unknown;
  rememberMe?: unknown;
}

const MESSAGES = {
  invalid_credentials: "Incorrect email or password.",
  account_disabled: "This account has been disabled. Contact LearnThrive for help.",
  malformed: "Enter your email and password.",
} as const;

export async function POST(request: Request) {
  let body: LoginRequestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: MESSAGES.malformed }, { status: 400 });
  }

  if (typeof body.email !== "string" || typeof body.password !== "string" || !body.email.trim() || !body.password) {
    return Response.json({ error: MESSAGES.malformed }, { status: 400 });
  }

  const result = await getAuthProvider().verifyCredentials(body.email, body.password);
  if (!result.ok) {
    // 401 either way — the message differs (account_disabled vs invalid_credentials) but the
    // status code doesn't, so a network tab alone can't distinguish "wrong password" from
    // "account exists but disabled" without reading the body.
    return Response.json({ error: MESSAGES[result.reason] }, { status: 401 });
  }

  await createSession(result.user, body.rememberMe === true);
  return Response.json({ user: result.user });
}
