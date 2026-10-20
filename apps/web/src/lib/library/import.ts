import type { Resource, ResourceFileInput, ResourceRepository } from "@learnthrive/data/library";
import { inspectLibraryFile, storagePathFor } from "./files";
import { parseMetadata, type PlannedMetadata } from "./metadata";
import type { LibraryStorage } from "./storage";

/**
 * The import tool's logic (scripts/library-import.mjs wires it to the command line). Two steps, so a dry run shows
 * exactly what an apply would do:
 *
 *   planImport   reads library.json and every PDF it names, checks them all (metadata rules, then the real-type,
 *                size and no-scripts checks from files.ts), and decides each resource's version: a new resource is
 *                version 1; an existing one keeps its version if every file is byte-for-byte the same, and moves up
 *                by one if any file changed. Nothing is written.
 *   applyImport  uploads the files first (to a path that includes the version, so a new version never overwrites the
 *                old one) and only then writes the resource and its file records, so a row never points at a file that
 *                is not there. Re-running an import with nothing changed uploads nothing.
 *
 * Any problem anywhere stops the whole plan: it is better to fix the folder than to import half of it.
 */
export interface PlannedFile {
  name: string;
  bytes: Uint8Array;
  sha256: string;
  storagePath: string;
}

export interface PlannedResource {
  metadata: PlannedMetadata;
  version: number;
  files: PlannedFile[];
  /** What the import will do: `create`, `update` (metadata only), or `new-version` (a file changed). */
  action: "create" | "update" | "new-version";
  existing: Resource | null;
}

export interface ImportPlan {
  items: PlannedResource[];
  problems: string[];
}

export interface FolderReader {
  /** The text of library.json, or null if it is not there. */
  readMetadata(): string | null;
  /** A file's bytes from the folder, or null if it is not there. */
  readFile(name: string): Uint8Array | null;
}

export async function planImport(folder: FolderReader, resources: Pick<ResourceRepository, "findBySlug" | "files">): Promise<ImportPlan> {
  const rawText = folder.readMetadata();
  if (rawText === null) return { items: [], problems: ["library.json was not found in the folder."] };
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { items: [], problems: ["library.json is not valid JSON."] };
  }
  const parsed = parseMetadata(raw);
  const problems = [...parsed.problems];
  const items: PlannedResource[] = [];

  for (const metadata of parsed.entries) {
    const slug = metadata.input.slug;
    const checked: Array<{ name: string; bytes: Uint8Array; sha256: string }> = [];
    for (const fileName of metadata.file) {
      const bytes = folder.readFile(fileName);
      if (!bytes) {
        problems.push(`${slug}: the file "${fileName}" is not in the folder.`);
        continue;
      }
      const verdict = inspectLibraryFile(fileName, bytes);
      if (!verdict.ok) {
        problems.push(`${slug}: "${fileName}": ${verdict.problem.message}`);
        continue;
      }
      checked.push({ name: verdict.name, bytes, sha256: verdict.sha256 });
    }
    if (checked.length !== metadata.file.length) continue;
    const names = checked.map((f) => f.name);
    if (new Set(names).size !== names.length) {
      problems.push(`${slug}: two files would be stored under the same name (${names.join(", ")}).`);
      continue;
    }

    const existing = await resources.findBySlug(slug);
    let version = metadata.input.version ?? 1;
    let action: PlannedResource["action"] = "create";
    if (existing) {
      const current = await resources.files(existing.id);
      const same = current.length === checked.length && checked.every((f) => current.some((c) => c.checksumSha256 === f.sha256 && c.storagePath.endsWith(`/${f.name}`)));
      version = metadata.input.version ?? (same ? existing.version : existing.version + 1);
      action = same ? "update" : "new-version";
      if (version < existing.version) {
        problems.push(`${slug}: version ${version} is lower than the stored version ${existing.version}.`);
        continue;
      }
    }
    items.push({
      metadata,
      version,
      existing,
      action,
      files: checked.map((f) => ({ ...f, storagePath: storagePathFor(slug, version, f.name) })),
    });
  }
  return { items, problems };
}

export interface ImportSummary {
  created: number;
  updated: number;
  newVersions: number;
  uploaded: number;
}

export async function applyImport(plan: ImportPlan, deps: { resources: ResourceRepository; storage: LibraryStorage }): Promise<ImportSummary> {
  if (plan.problems.length > 0) throw new Error("refusing to apply a plan that has problems");
  const summary: ImportSummary = { created: 0, updated: 0, newVersions: 0, uploaded: 0 };
  for (const item of plan.items) {
    // Files first, to versioned paths; an unchanged resource's files are already there.
    if (item.action !== "update") {
      for (const file of item.files) {
        await deps.storage.put(file.storagePath, file.bytes, "application/pdf");
        summary.uploaded += 1;
      }
    }
    const saved = await deps.resources.upsert({ ...item.metadata.input, version: item.version });
    if (item.action !== "update") {
      const records: ResourceFileInput[] = item.files.map((f) => ({ storagePath: f.storagePath, bytes: f.bytes.length, contentType: "application/pdf", checksumSha256: f.sha256 }));
      await deps.resources.setFiles(saved.id, records);
    }
    if (item.action === "create") summary.created += 1;
    else if (item.action === "new-version") summary.newVersions += 1;
    else summary.updated += 1;
  }
  return summary;
}
