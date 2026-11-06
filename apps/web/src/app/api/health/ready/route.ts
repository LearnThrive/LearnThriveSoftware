import { accountBackend, accountRuntime } from "@/lib/account/runtime";
import { logOutcome } from "@/lib/log";
import { READINESS_TIMEOUT_MS, classroomInfo, readiness, type Readiness, type ReadinessProbes } from "@/lib/observability";

/**
 * Readiness, for the uptime monitor (launch checklist 3.8, docs/OBSERVABILITY.md): 200 when the database, Supabase Auth and the classroom
 * server all answer (or are not needed yet), 503 otherwise. /api/health stays the bare liveness answer the host restarts on: a database
 * outage must not make Render restart a healthy web server.
 *
 * The answer names each check as ok, failing or off, and nothing more: no host, no error, no count. It is worked out at most once every
 * CACHE_MS however often it is asked, so polling it cannot load the database, and a change of state writes one log line.
 */
export const dynamic = "force-dynamic";

const CACHE_MS = 10_000;

const g = globalThis as unknown as {
  __learnthriveReady?: { at: number; result: Promise<Readiness> };
  __learnthriveReadyLast?: boolean;
};

function probes(env: Record<string, string | undefined>): ReadinessProbes {
  const supabase = accountBackend(env) === "supabase";
  return {
    database: supabase
      ? async () => {
          const rt = await accountRuntime(env);
          if (!rt?.db) throw new Error("no database");
          await rt.db.query("select 1");
        }
      : undefined,
    // GoTrue's own health endpoint, with the publishable key it is meant to be called with.
    auth: supabase
      ? async () => {
          const response = await fetch(`${env.SUPABASE_URL!.replace(/\/+$/, "")}/auth/v1/health`, {
            headers: { apikey: env.SUPABASE_ANON_KEY! },
            signal: AbortSignal.timeout(READINESS_TIMEOUT_MS),
            cache: "no-store",
          });
          await response.body?.cancel();
          if (!response.ok) throw new Error(`auth answered ${response.status}`);
        }
      : undefined,
    classroom: () => classroomInfo() !== null,
  };
}

async function check(): Promise<Readiness> {
  const result = await readiness(process.env, probes(process.env));
  if (g.__learnthriveReadyLast !== result.ok) {
    g.__learnthriveReadyLast = result.ok;
    logOutcome("readiness", result.ok ? "ok" : "failing", result.checks);
  }
  return result;
}

export async function GET() {
  const now = Date.now();
  const cached = g.__learnthriveReady;
  if (!cached || now - cached.at >= CACHE_MS) g.__learnthriveReady = { at: now, result: check() };
  const result = await g.__learnthriveReady!.result;
  return Response.json(
    { status: result.ok ? "ok" : "failing", checks: result.checks },
    { status: result.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
