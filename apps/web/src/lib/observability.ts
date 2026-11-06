/**
 * What the running service says about its own health (launch checklist 3.8, docs/OBSERVABILITY.md). Three pieces, all without personal data:
 *
 *   readiness      the rules behind GET /api/health/ready: is the database answering, is Supabase Auth answering, is the classroom server
 *                  running in this process. /api/health stays a bare liveness answer (the host restarts on it); this is for the uptime monitor.
 *   classroom      server.ts records here that it started the classroom's signalling, so the readiness check can tell a process started
 *                  the right way (`npm run serve`) from a plain `next start`, which serves the site but no classroom (checklist 3.1).
 *   request errors the fields onRequestError (src/instrumentation.ts) may log: the route's file pattern, never the URL, the message or a header.
 *
 * No imports: instrumentation.ts and server.ts both load this.
 */
type Env = Record<string, string | undefined>;

export type CheckState = "ok" | "failing" | "off";

export interface ClassroomStats {
  rooms: number;
  participants: number;
  waiting: number;
  sockets: number;
}

export interface ClassroomInfo {
  media: "sfu" | "mesh";
  maxStudents: number;
  stats: () => ClassroomStats;
}

// globalThis, not a module variable: server.ts and the route bundles are separate module graphs in one process.
const g = globalThis as unknown as { __learnthriveClassroom?: ClassroomInfo };

export function registerClassroom(info: ClassroomInfo): void {
  g.__learnthriveClassroom = info;
}

export function classroomInfo(): ClassroomInfo | null {
  return g.__learnthriveClassroom ?? null;
}

/** For tests. */
export function forgetClassroom(): void {
  delete g.__learnthriveClassroom;
}

export interface ReadinessProbes {
  /** Absent: not configured here. Resolves when the dependency answered, rejects (or times out) when it did not. */
  database?: () => Promise<unknown>;
  auth?: () => Promise<unknown>;
  /** Whether the classroom's signalling runs in this process. */
  classroom: () => boolean;
}

export interface Readiness {
  ok: boolean;
  checks: { database: CheckState; auth: CheckState; classroom: CheckState };
}

export const READINESS_TIMEOUT_MS = 3_000;

async function probe(run: (() => Promise<unknown>) | undefined, timeoutMs: number): Promise<CheckState> {
  if (!run) return "off";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
  });
  try {
    await Promise.race([run(), timeout]);
    return "ok";
  } catch {
    return "failing";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ready means: everything configured here answers, and, in production once the portal is open, the database, Auth and the classroom are
 * all there. With the portal closed (go-live step one, checklist 8.1) the public site needs none of them, so one that is not configured
 * is "off" and not a failure; one that IS configured and does not answer is a failure whatever the portal says.
 */
export async function readiness(env: Env, probes: ReadinessProbes, timeoutMs: number = READINESS_TIMEOUT_MS): Promise<Readiness> {
  const [database, auth] = await Promise.all([probe(probes.database, timeoutMs), probe(probes.auth, timeoutMs)]);
  const classroom: CheckState = probes.classroom() ? "ok" : "off";
  const required = env.NODE_ENV === "production" && env.NEXT_PUBLIC_APP_PORTAL_ENABLED === "true";
  const checks = { database, auth, classroom };
  const ok = Object.values(checks).every((state) => state === "ok" || (state === "off" && !required));
  return { ok, checks };
}

/** A route file pattern such as /dashboard/admin/students/[id]/page: safe to log because it names no record. Anything odd is "other". */
const ROUTE_PATTERN = /^\/[A-Za-z0-9_\-/[\]().@]{0,119}$/;
const WORD = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

/**
 * What a server error line may say. Deliberately NOT the message (a database error can quote the values it was given), the request path
 * (it holds ids and query strings) or any header. The digest is the hash React shows on the error page, so a person's report can be
 * matched to the line.
 */
export function requestErrorFields(
  error: unknown,
  request: { method?: string },
  context: { routePath?: string; routeType?: string },
): Record<string, string> {
  const fields: Record<string, string> = {};
  const name = error instanceof Error ? error.name : typeof error;
  fields.kind = WORD.test(name) ? name : "other";
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : "";
  if (/^[A-Za-z0-9_:-]{1,40}$/.test(digest)) fields.digest = digest;
  fields.route = context.routePath && ROUTE_PATTERN.test(context.routePath) ? context.routePath : "other";
  if (context.routeType && WORD.test(context.routeType)) fields.routeType = context.routeType;
  if (request.method && /^[A-Z]{3,7}$/.test(request.method)) fields.method = request.method;
  return fields;
}

/** The periodic line server.ts writes: is the process healthy, and how busy is the classroom. Counts only. */
export function heartbeatFields(input: {
  uptimeSeconds: number;
  memory: { rss: number; heapUsed: number };
  eventLoopDelayP99Ms: number;
  classroom: (ClassroomStats & { media: "sfu" | "mesh" }) | null;
}): Record<string, string | number> {
  const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));
  return {
    uptimeS: Math.round(input.uptimeSeconds),
    rssMb: mb(input.memory.rss),
    heapMb: mb(input.memory.heapUsed),
    loopP99Ms: Math.round(input.eventLoopDelayP99Ms),
    ...(input.classroom
      ? {
          media: input.classroom.media,
          rooms: input.classroom.rooms,
          participants: input.classroom.participants,
          waiting: input.classroom.waiting,
          sockets: input.classroom.sockets,
        }
      : {}),
  };
}
