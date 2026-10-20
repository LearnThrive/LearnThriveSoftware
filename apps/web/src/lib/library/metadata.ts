import { ACCESS_TIERS, LEVELS, RESOURCE_TYPES, type AccessTier, type Level, type ResourceInput, type ResourceType } from "@learnthrive/data/library";

/**
 * The metadata file the import tool reads (docs/LIBRARY.md has an example): `library.json` beside the PDFs.
 *
 *   { "resources": [ { "file": "quadratics.pdf", "title": "...", "subject": "Maths", "level": "GCSE", "topic": "Algebra",
 *       "type": "worksheet", "authorship": "LearnThrive Tuition", "publishedAt": "2026-11-01" } ] }
 *
 * Pure: it checks the shape and the rules and reports every problem at once (with the entry's position), never
 * stopping at the first. A resource without `authorship` is refused (plan19 section 3: nothing is imported unless it
 * says who made it), and so is an authorship that names an exam board or awarding body, because exam-board past papers
 * are not redistributed. `publishedAt` absent or null means a draft: nothing is public until a date is set.
 */
export interface PlannedMetadata {
  file: string[];
  input: Omit<ResourceInput, "version"> & { version?: number };
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Names that, as the author, mean the material is not ours. */
const NOT_OURS = /\b(AQA|Edexcel|Pearson|OCR|WJEC|Eduqas|CCEA|SQA|Cambridge|DfE|Department for Education|STA|Oxford University Press|CGP|Collins|BBC)\b/i;

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/, "");
}

type Json = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const optional = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

function when(value: unknown): { ok: true; date: Date | null } | { ok: false } {
  if (value === undefined || value === null || value === "" || value === "draft") return { ok: true, date: null };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/.test(value)) return { ok: false };
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? { ok: false } : { ok: true, date };
}

export function parseMetadata(raw: unknown): { entries: PlannedMetadata[]; problems: string[] } {
  const problems: string[] = [];
  const list = typeof raw === "object" && raw !== null && Array.isArray((raw as Json).resources) ? ((raw as Json).resources as unknown[]) : null;
  if (!list) return { entries: [], problems: ['The metadata file must be {"resources": [ ... ]}.'] };
  if (list.length === 0) problems.push("The metadata file lists no resources.");
  const seen = new Set<string>();
  const entries: PlannedMetadata[] = [];

  list.forEach((item, index) => {
    const where = `Entry ${index + 1}`;
    const here: string[] = [];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      problems.push(`${where}: not an object.`);
      return;
    }
    const e = item as Json;
    const title = text(e.title);
    const label = title ? `${where} ("${title.slice(0, 40)}")` : where;
    const fail = (message: string) => here.push(`${label}: ${message}`);

    const file = Array.isArray(e.files) ? e.files.map(text) : e.file !== undefined ? [text(e.file)] : [];
    if (file.length === 0 || file.some((f) => !f)) fail('needs "file" (or "files") naming the PDF(s) in the folder.');
    else if (file.some((f) => f.includes("/") || f.includes("\\") || f.startsWith("."))) fail("file names must be plain names in the folder, with no path.");
    else if (new Set(file).size !== file.length) fail("a file is listed twice.");

    if (title.length < 1 || title.length > 200) fail("title must be 1 to 200 characters.");
    const slug = text(e.slug) || slugify(title);
    if (!SLUG_PATTERN.test(slug) || slug.length > 120) fail(`slug "${slug}" must be lowercase letters, digits and single hyphens.`);
    else if (seen.has(slug)) fail(`slug "${slug}" is used twice in this file.`);
    seen.add(slug);

    const description = typeof e.description === "string" ? e.description.trim() : "";
    if (description.length > 2000) fail("description is over 2000 characters.");
    const subject = text(e.subject);
    if (subject.length < 1 || subject.length > 80) fail("subject must be 1 to 80 characters.");
    const level = text(e.level);
    if (!(LEVELS as readonly string[]).includes(level)) fail(`level must be one of ${LEVELS.join(", ")}.`);
    const examBoard = optional(e.examBoard);
    if (examBoard && examBoard.length > 40) fail("examBoard is over 40 characters.");
    const topic = text(e.topic);
    if (topic.length < 1 || topic.length > 120) fail("topic must be 1 to 120 characters.");
    const resourceType = text(e.type ?? e.resourceType);
    if (!(RESOURCE_TYPES as readonly string[]).includes(resourceType)) fail(`type must be one of ${RESOURCE_TYPES.join(", ")}.`);
    const yearGroup = optional(e.yearGroup);
    if (yearGroup && yearGroup.length > 40) fail("yearGroup is over 40 characters.");

    const tagsRaw = e.tags === undefined ? [] : e.tags;
    let tags: string[] = [];
    if (!Array.isArray(tagsRaw) || tagsRaw.some((t) => typeof t !== "string")) fail("tags must be a list of words.");
    else {
      tags = [...new Set((tagsRaw as string[]).map((t) => t.trim().toLowerCase()).filter(Boolean))];
      if (tags.length > 20 || tags.some((t) => t.length > 40)) fail("at most 20 tags, each up to 40 characters.");
    }

    const tier = e.accessTier === undefined ? "members" : text(e.accessTier);
    if (!(ACCESS_TIERS as readonly string[]).includes(tier)) fail(`accessTier must be ${ACCESS_TIERS.join(" or ")}.`);

    const authorship = text(e.authorship);
    if (!/[\p{L}\p{N}]/u.test(authorship)) fail('"authorship" is required: say who made it (for example "LearnThrive Tuition"). Nothing is imported without it.');
    else if (authorship.length > 200) fail("authorship is over 200 characters.");
    else if (NOT_OURS.test(authorship)) fail(`authorship "${authorship}" names an exam board or publisher. Past papers and other people's material are not redistributed here.`);

    const published = when(e.publishedAt);
    if (!published.ok) fail('publishedAt must be a date like "2026-11-01" (or absent / null for a draft).');

    const version = e.version === undefined ? undefined : Number(e.version);
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) fail("version must be a whole number from 1.");

    if (here.length > 0) {
      problems.push(...here);
      return;
    }
    entries.push({
      file,
      input: {
        slug,
        title,
        description,
        subject,
        level: level as Level,
        examBoard,
        topic,
        resourceType: resourceType as ResourceType,
        yearGroup,
        tags,
        accessTier: tier as AccessTier,
        authorship,
        publishedAt: published.ok ? published.date : null,
        ...(version !== undefined ? { version } : {}),
      },
    });
  });
  return { entries, problems };
}
