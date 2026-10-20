import { createHash } from "node:crypto";
import { canAccess } from "@learnthrive/data/library";
import { downloadsPerHour } from "@/lib/library-config";
import { renewSession, type CookieJar } from "@/lib/account/session";
import type { AccountRuntime } from "@/lib/account/runtime";
import { jsonResponse, logOutcome, originAllowed } from "@/lib/request-guards";
import { siteConfig } from "@/lib/site";
import type { LibraryStorage } from "./storage";
import { watermarkPdf } from "./watermark";

/**
 * POST /api/library/download/<slug>: the one way a Library file leaves the building (plan19 phase D). In order:
 * the request's origin, the signed-in account, the resource (published only), `canAccess` (the single place access is
 * decided), the hourly cap, the stored file and its checksum, the watermark, and only then the audit row.
 *
 * WHY THE SERVER SENDS THE BYTES. The plan wants short-lived signed URLs and a watermark on every PDF. A signed URL
 * points at the stored original, which is not watermarked; a per-person copy cannot exist before the person asks.
 * So the server asks storage for the original through a 60 second signed URL, stamps it, and sends the stamped copy.
 * The browser never receives a storage URL, which is the property the signed URL was for. An unstamped file is never
 * sent: if the stamp fails, so does the download.
 *
 * It is a POST (a form button, so it works without JavaScript) and checks Origin, so another site cannot make a
 * signed-in visitor's browser spend their hourly allowance. The audit row holds the account, the resource, the time
 * and anomaly flags, never a name, an address, a file or an IP. A browser form post gets a redirect back to the
 * resource page with a reason; a script gets JSON.
 */
export interface DownloadDeps {
  rt: AccountRuntime | null;
  jar: CookieJar;
  storage: LibraryStorage | null;
  now?: () => Date;
  env?: Record<string, string | undefined>;
}

const HOUR = 60 * 60 * 1000;
const FALLBACK = `Please email ${siteConfig.email} and we will help.`;

export const downloadFlags = {
  /** 80% of the hourly cap used, counting this one. */
  nearLimit: "near_limit",
  /** The same resource, by the same account, within five minutes. */
  repeat: "repeat_5m",
} as const;

type Reason = "no_access" | "signed_out" | "rate_limited" | "unavailable" | "not_found" | "no_file" | "adult_required" | "bad_request";

const STATUS: Record<Reason, number> = { no_access: 403, signed_out: 401, rate_limited: 429, unavailable: 503, not_found: 404, no_file: 404, adult_required: 403, bad_request: 400 };

const MESSAGE: Record<Reason, string> = {
  no_access: "Your account does not include this resource.",
  signed_out: "Please sign in to download.",
  rate_limited: "You have reached the hourly download limit. Please try again later.",
  unavailable: `Downloads are not available right now. ${FALLBACK}`,
  not_found: "We could not find that resource.",
  no_file: `This resource has no file yet. ${FALLBACK}`,
  adult_required: "Downloads are for adult account holders.",
  bad_request: "We could not read that request.",
};

function wantsPage(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function fail(request: Request, slug: string, reason: Reason, extra: Record<string, string> = {}): Response {
  logOutcome("library-download", reason);
  if (wantsPage(request)) {
    const target = reason === "signed_out" ? `/account/sign-in?next=${encodeURIComponent(`/library/${slug}`)}` : `/library/${encodeURIComponent(slug)}?download=${reason}`;
    return new Response(null, { status: 303, headers: { Location: target, "Cache-Control": "no-store", ...extra } });
  }
  return jsonResponse(STATUS[reason], { code: reason, error: MESSAGE[reason] }, { "Cache-Control": "no-store", ...extra });
}

export async function handleDownload(request: Request, slug: string, deps: DownloadDeps): Promise<Response> {
  const env = deps.env ?? process.env;
  const now = (deps.now ?? (() => new Date()))();
  if (!originAllowed(request, env)) {
    logOutcome("library-download", "forbidden_origin");
    return jsonResponse(403, { error: "Forbidden." });
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return fail(request, "x", "not_found");
  if (!deps.rt || !deps.storage) return fail(request, slug, "unavailable");
  const { rt, storage } = { rt: deps.rt, storage: deps.storage };

  const session = await renewSession(deps.jar, rt);
  if (session.status !== "ok") return fail(request, slug, "signed_out");
  const account = await rt.store.accounts.getAccount(session.user.id);
  if (!account) return fail(request, slug, "signed_out");
  if (!account.adultConfirmed) return fail(request, slug, "adult_required");

  const resource = await rt.store.resources.getBySlug(slug, now);
  if (!resource) return fail(request, slug, "not_found");

  const clientId = account.clientId ?? (await rt.store.accounts.ensureClient(account.profileId));
  const facts = await rt.store.access.facts(clientId, now);
  const decision = canAccess(account, resource, facts, now);
  if (!decision.allowed) return fail(request, slug, "no_access");

  const cap = downloadsPerHour(env);
  const used = await rt.store.downloads.countSince(clientId, new Date(now.getTime() - HOUR));
  if (used >= cap) return fail(request, slug, "rate_limited", { "Retry-After": "900" });

  const files = await rt.store.resources.files(resource.id);
  const wanted = new URL(request.url).searchParams.get("file");
  const file = wanted ? files.find((f) => f.id === wanted) : files[0];
  if (!file) return fail(request, slug, "no_file");

  const original = await storage.read(file.storagePath);
  if (!original) return fail(request, slug, "unavailable");
  if (createHash("sha256").update(original).digest("hex") !== file.checksumSha256) {
    // The stored object is not the one that was imported. Never send it.
    logOutcome("library-download", "checksum_mismatch");
    return fail(request, slug, "unavailable");
  }

  let stamped: Uint8Array;
  try {
    stamped = await watermarkPdf(original, { holder: account.displayName || session.user.email, at: now });
  } catch {
    logOutcome("library-download", "watermark_failed");
    return fail(request, slug, "unavailable");
  }

  const flags: string[] = [];
  if (used + 1 >= Math.ceil(cap * 0.8)) flags.push(downloadFlags.nearLimit);
  if ((await rt.store.downloads.countForResourceSince(clientId, resource.id, new Date(now.getTime() - 5 * 60_000))) > 0) flags.push(downloadFlags.repeat);
  await rt.store.downloads.record({ clientId, resourceId: resource.id, at: now, flags });

  logOutcome("library-download", "ok", { reason: decision.reason, flags: flags.length });
  return new Response(stamped as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(stamped.byteLength),
      "Content-Disposition": `attachment; filename="${resource.slug}-v${resource.version}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
