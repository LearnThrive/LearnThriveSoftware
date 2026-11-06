import { requireRoleForApi } from "@/lib/auth/guard";
import { careersFiles, careersStore } from "@/lib/careers/store";
import { jsonResponse, logOutcome } from "@/lib/request-guards";

/**
 * One file of a tutor application, for an administrator (launch checklist 3.12.3). GET /api/admin/careers/<application>/files/<file>
 *
 *   - ADMIN only, checked here: a tutor, a family, a learner or a stranger gets a 404, the same as a file that does not exist, so the
 *     route says nothing about what is stored.
 *   - The file must belong to that application: one application's id cannot reach another's file.
 *   - The bytes come through a signed link to the private bucket that the server makes for THIS request and that expires in 60 seconds
 *     (lib/library/storage.ts). The link never reaches the browser and nothing stores it; the browser gets the bytes from this origin.
 *   - Every opening is recorded against the application, with who opened it, BEFORE the bytes are sent.
 *   - Always a download, never shown inline, with nosniff and a sandbox: the file came from a public form and is untrusted, so it must not
 *     render as a page of this site.
 */
export const dynamic = "force-dynamic";

const notFound = () => jsonResponse(404, { error: "Not found." });

/** A header-safe name: the stored name is already cleaned (lib/careers-files.ts), this keeps it to plain ASCII for the quoted form. */
function disposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const admin = await requireRoleForApi(["ADMIN"]);
  if (!admin) return notFound();
  const { id, fileId } = await params;
  const store = careersStore();
  const files = careersFiles();
  if (!store || !files) return jsonResponse(503, { error: "Applications are not available on this server." });

  const file = await store.file(id, fileId);
  if (!file) return notFound();
  await store.logFileView(id, fileId, admin.id);
  const bytes = await files.read(file.storagePath);
  if (!bytes) {
    logOutcome("careers-file", "missing");
    return jsonResponse(502, { error: "The file could not be fetched just now. Try again." });
  }
  logOutcome("careers-file", "served", { bytes: bytes.byteLength });
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": disposition(file.filename),
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}
