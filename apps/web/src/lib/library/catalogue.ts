import { LEVELS, RESOURCE_TYPES, type Facet, type Level, type ResourceQuery, type ResourceType } from "@learnthrive/data/library";
import { slugify } from "./metadata";

/**
 * The catalogue's address bar: `?q=&subject=&level=&type=&page=`. Whatever arrives is untrusted, so every value is
 * checked against what it may be (a level must be one of the five, a type one of the four, free text is bounded) and
 * anything else is dropped, not passed on. Pure.
 */
export const PAGE_SIZE = 12;
export const MAX_PAGE = 200;

export interface CatalogueQuery {
  q: string;
  subject: string;
  level: Level | "";
  type: ResourceType | "";
  topic: string;
  page: number;
}

type Params = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function bounded(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function parseCatalogueQuery(params: Params): CatalogueQuery {
  const level = one(params.level);
  const type = one(params.type);
  const page = Number.parseInt(one(params.page), 10);
  return {
    q: bounded(one(params.q), 100),
    subject: bounded(one(params.subject), 80),
    level: (LEVELS as readonly string[]).includes(level) ? (level as Level) : "",
    type: (RESOURCE_TYPES as readonly string[]).includes(type) ? (type as ResourceType) : "",
    topic: bounded(one(params.topic), 120),
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
  };
}

export function toResourceQuery(query: CatalogueQuery, extra: Partial<ResourceQuery> = {}): ResourceQuery {
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(query.subject ? { subject: query.subject } : {}),
    ...(query.level ? { level: query.level } : {}),
    ...(query.type ? { resourceType: query.type } : {}),
    ...(query.topic ? { topic: query.topic } : {}),
    limit: PAGE_SIZE,
    offset: (query.page - 1) * PAGE_SIZE,
    ...extra,
  };
}

/** The address of a catalogue view, leaving out anything empty (and page 1). */
export function catalogueHref(path: string, query: Partial<CatalogueQuery>): string {
  const search = new URLSearchParams();
  if (query.q) search.set("q", query.q);
  if (query.subject) search.set("subject", query.subject);
  if (query.level) search.set("level", query.level);
  if (query.type) search.set("type", query.type);
  if (query.topic) search.set("topic", query.topic);
  if (query.page && query.page > 1) search.set("page", String(query.page));
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

/** `Maths` -> `maths`; for the subject and topic page addresses. */
export const nameSlug = slugify;

/** The facet whose name matches a slug, or null: a subject page for a subject nobody has published is a 404. */
export function findBySlug(facets: readonly Facet[], slug: string): Facet | null {
  return facets.find((f) => nameSlug(f.value) === slug) ?? null;
}
