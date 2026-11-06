import { getRole } from "@/lib/careers";
import { requireRoleForApi } from "@/lib/auth/guard";
import { careersStore } from "@/lib/careers/store";
import { jsonResponse } from "@/lib/request-guards";

/**
 * Everything held about one applicant, as JSON, for answering a subject access request (launch checklist 3.12.5). ADMIN only; anyone else
 * gets the same 404 as an application that does not exist. GET /api/admin/careers/<application>/export
 *
 * It lists the files (name, kind, size) rather than embedding them: each is downloaded through the file route, which logs that it was
 * opened. Internal notes are included, because they are personal data about the applicant and are disclosable unless an exemption
 * applies; whoever answers the request decides that, not this route. Profile ids of the administrators are left out.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireRoleForApi(["ADMIN"]);
  if (!admin) return jsonResponse(404, { error: "Not found." });
  const { id } = await params;
  const store = careersStore();
  if (!store) return jsonResponse(503, { error: "Applications are not available on this server." });
  const app = await store.get(id);
  if (!app) return jsonResponse(404, { error: "Not found." });

  const body = {
    exportedAt: new Date().toISOString(),
    reference: app.reference,
    role: getRole(app.roleSlug)?.title ?? app.roleSlug,
    status: app.status,
    receivedAt: app.receivedAt,
    decidedAt: app.decidedAt,
    deleteAfter: app.deleteAfter,
    identityDocumentsDeleteAfter: app.identityDeleteAfter,
    keptForFutureRoles: app.talentPool,
    contact: { firstName: app.firstName, lastName: app.lastName, email: app.email },
    answers: app.answers,
    safeguardingAgreement: app.agreement,
    files: app.files.map((f) => ({ name: f.filename, kind: f.label, sizeBytes: f.sizeBytes, received: f.createdAt })),
    identitySeenOn: app.identitySeen?.on ?? null,
    dbsSeen: app.dbsSeen ? { on: app.dbsSeen.on, how: app.dbsSeen.how } : null,
    notes: app.notes.map((n) => ({ at: n.at, text: n.body })),
    history: app.events.map((e) => ({ at: e.at, what: e.kind, from: e.fromStatus, to: e.toStatus, detail: e.detail })),
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${app.reference}.json"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
