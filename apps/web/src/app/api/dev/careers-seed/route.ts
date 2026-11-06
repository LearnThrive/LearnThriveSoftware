import { randomUUID } from "node:crypto";
import { MemoryCareersStore } from "@learnthrive/data/careers";
import { buildAgreementRecord } from "@/lib/agreement-record";
import { currentAgreement } from "@/lib/safeguarding-agreement";
import { careersFiles, careersStore } from "@/lib/careers/store";
import { jsonResponse } from "@/lib/request-guards";

export const dynamic = "force-dynamic";

/**
 * DEVELOPMENT AND TESTS ONLY: puts one made-up tutor application (a CV and an identity document) in the in-memory careers store, so a
 * browser test can review it without posting the real form, which would send real email from a machine with Resend credentials.
 *
 *   POST /api/dev/careers-seed   ->  { id, cvFileId, idFileId }
 *
 * A 404 in production twice over: the proxy refuses /api/dev/**, and this route refuses to run with NODE_ENV=production or on any store
 * but the in-memory one.
 */
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(0)]);

export async function POST() {
  if (process.env.NODE_ENV === "production") return jsonResponse(404, { error: "Not found." });
  const store = careersStore();
  const files = careersFiles();
  if (!(store instanceof MemoryCareersStore) || !files) return jsonResponse(404, { error: "Not found." });

  const id = randomUUID();
  const cvFileId = randomUUID();
  const idFileId = randomUUID();
  const suffix = randomUUID().replace(/[^0-9a-f]/g, "").slice(0, 6).toUpperCase();
  const cv = { id: cvFileId, kind: "CV" as const, label: "CV", documentType: null, sensitive: false, filename: "CV - test.pdf", contentType: "application/pdf", sizeBytes: PDF.length, storagePath: `${id}/${cvFileId}.pdf` };
  const passport = {
    id: idFileId, kind: "SUPPORTING" as const, label: "Identity document", documentType: "identity", sensitive: true, filename: "Identity document - test.png",
    contentType: "image/png", sizeBytes: PNG.length, storagePath: `${id}/${idFileId}.png`,
  };
  await files.put(cv.storagePath, PDF, cv.contentType);
  await files.put(passport.storagePath, PNG, passport.contentType);
  await store.create({
    id, reference: `LT-APP-20261106-${suffix}`, roleSlug: "maths-tutor", firstName: "Test", lastName: `Applicant ${suffix}`, email: "applicant@example.test", talentPool: false,
    answers: { firstName: "Test", lastName: `Applicant ${suffix}`, email: "applicant@example.test", role: "maths-tutor", subjects: ["Maths"], whyTutor: "A made-up application for testing." },
    agreement: buildAgreementRecord(currentAgreement, { typedName: "Test Applicant", confirmedParts: [], understandingPassed: true, receivedAt: new Date() }) as unknown as Record<string, unknown>,
    files: [cv, passport],
  });
  return jsonResponse(200, { id, cvFileId, idFileId, name: `Test Applicant ${suffix}` });
}
