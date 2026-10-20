import { createHash } from "node:crypto";
import { extensionOf, formatBytes, sanitiseFileName, sniffKind, type FileProblem } from "@/lib/careers-files";
import { inspectPdf } from "@/lib/careers-files-server";

/**
 * What a Library file must be before it is stored (plan19 phase D): the company's own PDF, and nothing that can run
 * anything. The checks are the careers application's (lib/careers-files*.ts), reused, not copied: the file's first
 * bytes must say PDF, and the PDF must not be encrypted or carry scripting, launch actions or embedded files. Only
 * the size limit is the Library's own, because a worksheet or a scanned paper is larger than a CV.
 *
 * Like the careers check, this is not a virus scan: these are the company's own files, put in by the import tool.
 */
export const LIBRARY_FILE_MAX_BYTES = 25 * 1024 * 1024;

export type LibraryFileVerdict = { ok: true; name: string; bytes: number; sha256: string } | { ok: false; problem: FileProblem };

const refuse = (code: FileProblem["code"], message: string): LibraryFileVerdict => ({ ok: false, problem: { code, message } });

export function inspectLibraryFile(name: string, bytes: Uint8Array): LibraryFileVerdict {
  if (extensionOf(name) !== "pdf") return refuse("type", "Library files must be PDFs (a name ending in .pdf).");
  if (bytes.length === 0) return refuse("empty", "The file is empty.");
  if (bytes.length > LIBRARY_FILE_MAX_BYTES) return refuse("too-big", `The file is ${formatBytes(bytes.length)}; the limit is ${formatBytes(LIBRARY_FILE_MAX_BYTES)}.`);
  if (sniffKind(bytes) !== "pdf") return refuse("content", "This file does not look like a PDF, whatever its name says.");
  const verdict = inspectPdf(bytes);
  if (!verdict.ok) return verdict;
  return { ok: true, name: sanitiseFileName(name).full, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** Where a file lives in the private `library` bucket: by resource and version, so a new version never overwrites. */
export function storagePathFor(slug: string, version: number, fileName: string): string {
  return `${slug}/v${version}/${fileName}`;
}
