import { paperLimits } from "@/lib/paper/limits";
import { extensionOf, formatBytes, sanitiseFileName, sniffKind, type FileProblem } from "@/lib/careers-files";
import { inspectPdf } from "@/lib/careers-files-server";
import { preparePhoto, readPdfDocument } from "./documents";

/**
 * What a student may attach to a question: a JPEG or PNG photo, or a PDF. Checked like every other upload on this site (the real
 * type from the first bytes, size limits, no scripts or embedded files in a PDF), then prepared:
 *
 *   photos   decoded with their orientation applied (a phone's portrait photo is stored sideways), shrunk to a sensible size and
 *            re-encoded, which drops all metadata (camera model, GPS position, time, thumbnails)
 *   PDFs     opened with pdf.js and read page by page (documents.ts). A PDF that is only permission-restricted (no password to
 *            open, as many exam-board papers are) is read; one that needs a password is refused with that reason. Text pages,
 *            scans and pages with pictures are all accepted; what the model is shown is decided when the question is sent
 *
 * Limits: 8 MB a photo, 15 MB a PDF (the storage bucket's own limit), PAPER_MAX_PAGES pages (default 60), three files a message. HEIC (an iPhone's default) is refused with a way forward.
 * No network, no storage. Uploaded content is UNTRUSTED material for the model to read, never instructions.
 */
export const UPLOAD_LIMITS = { imageBytes: 8 * 1024 * 1024, pdfBytes: 15 * 1024 * 1024, pdfPages: paperLimits().maxPages, filesPerMessage: 3 } as const;

/** pdf_text: every page has readable text; pdf_scan: none does (pages are pictures); pdf_mixed: some of each. */
export type UploadKind = "image" | "pdf_text" | "pdf_scan" | "pdf_mixed";

export type UploadResult =
  | { ok: true; kind: "image"; name: string; contentType: "image/jpeg" | "image/png"; bytes: Uint8Array }
  | { ok: true; kind: "pdf_text" | "pdf_scan" | "pdf_mixed"; name: string; contentType: "application/pdf"; bytes: Uint8Array; pages: number; picturePages: number }
  | { ok: false; problem: FileProblem };

const refuse = (code: FileProblem["code"], message: string): UploadResult => ({ ok: false, problem: { code, message } });

const HEIC = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);

function isHeic(bytes: Uint8Array): boolean {
  return bytes.length > 12 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp" && HEIC.has(String.fromCharCode(...bytes.subarray(8, 12)));
}

// ---- the entry point -------------------------------------------------------------------------------------------

export async function inspectChatUpload(name: string, bytes: Uint8Array): Promise<UploadResult> {
  if (bytes.length === 0) return refuse("empty", "That file is empty.");
  if (isHeic(bytes)) return refuse("type", "That is a HEIC photo, which we cannot read. On an iPhone, set Camera to Most Compatible, or take a screenshot of the photo and send that.");
  const extension = extensionOf(name);
  const kind = sniffKind(bytes);
  const clean = sanitiseFileName(name).full;

  if (kind === "jpeg" || kind === "png") {
    if (!["jpg", "jpeg", "png"].includes(extension) || (kind === "jpeg") !== (extension === "jpg" || extension === "jpeg")) return refuse("content", "This file does not look like the type its name says.");
    if (bytes.length > UPLOAD_LIMITS.imageBytes) return refuse("too-big", `That photo is ${formatBytes(bytes.length)}; the limit is ${formatBytes(UPLOAD_LIMITS.imageBytes)}.`);
    const photo = await preparePhoto(bytes, kind);
    if (!photo.ok) return photo;
    return { ok: true, kind: "image", name: clean, contentType: kind === "jpeg" ? "image/jpeg" : "image/png", bytes: photo.bytes };
  }
  if (kind === "pdf") {
    if (extension !== "pdf") return refuse("content", "This file does not look like the type its name says.");
    if (bytes.length > UPLOAD_LIMITS.pdfBytes) return refuse("too-big", `That PDF is ${formatBytes(bytes.length)}; the limit is ${formatBytes(UPLOAD_LIMITS.pdfBytes)}.`);
    // Scripts, launch actions and embedded files are refused as everywhere on the site. Encryption is NOT refused here: pdf.js tells
    // a permission-only PDF (readable) from one that needs a password (refused, with that reason).
    const verdict = inspectPdf(bytes);
    if (!verdict.ok && verdict.problem.code !== "encrypted") return verdict;
    const read = await readPdfDocument(bytes, { render: false, maxPages: UPLOAD_LIMITS.pdfPages });
    if (!read.ok) return read;
    const good = read.pages.filter((p) => p.textQuality === "good").length;
    const pdfKind = good === read.pageCount ? "pdf_text" : good === 0 ? "pdf_scan" : "pdf_mixed";
    return { ok: true, kind: pdfKind, name: clean, contentType: "application/pdf", bytes, pages: read.pageCount, picturePages: read.pages.filter((p) => p.hasPictures || p.textQuality !== "good").length };
  }
  return refuse("type", "Please send a JPEG or PNG photo, or a PDF.");
}
