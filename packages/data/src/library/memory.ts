import { randomUUID } from "node:crypto";
import type { AccessRepository, AccountRepository, DownloadRepository, LibraryStore, ResourceRepository } from "./ports";
import type {
  AccessFacts,
  Account,
  AccountRole,
  DownloadEvent,
  Facet,
  Resource,
  ResourceFacets,
  ResourceFile,
  ResourceFileInput,
  ResourceInput,
  ResourcePage,
  ResourceQuery,
} from "./types";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

interface Profile {
  id: string;
  role: AccountRole;
  displayName: string;
  adultConfirmed: boolean;
}

interface EntitlementRow {
  clientId: string;
  source: "subscription" | "admin_grant";
  startsAt: Date;
  endsAt: Date | null;
}

const stem = (word: string) => word.replace(/(ing|es|s)$/, "");
const words = (text: string) => (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stem);

function published(resource: Resource, now: Date): boolean {
  return resource.publishedAt !== null && resource.publishedAt.getTime() <= now.getTime();
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 0), max);
}

function facet(values: Array<string | null>): Facet[] {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * The in-memory store: what tests and local development run on. It behaves like the SQL store, and one contract
 * test file (contract.ts) holds both to it. The seed* methods are not part of the repository interfaces: they stand
 * in for the rows the sign-up trigger, the family account and the admin tools create in production.
 */
export class InMemoryLibraryStore implements LibraryStore {
  private profiles = new Map<string, Profile>();
  private clients = new Map<string, string>(); // profileId -> clientId
  private studentLinks: Array<{ clientId: string; studentId: string }> = [];
  private assignments = new Map<string, { status: "ACTIVE" | "PAUSED" | "ENDED"; studentIds: Set<string> }>();
  private entitlementRows: EntitlementRow[] = [];
  private resourceRows = new Map<string, Resource>();
  private fileRows = new Map<string, ResourceFile[]>();
  private downloadRows: DownloadEvent[] = [];

  seedProfile(input: { id?: string; role?: AccountRole; displayName?: string; adultConfirmed?: boolean } = {}): string {
    const id = input.id ?? randomUUID();
    this.profiles.set(id, { id, role: input.role ?? "CLIENT", displayName: input.displayName ?? "", adultConfirmed: input.adultConfirmed ?? true });
    return id;
  }

  seedStudent(profileId: string): string {
    const clientId = this.clientFor(profileId);
    const studentId = randomUUID();
    this.studentLinks.push({ clientId, studentId });
    return studentId;
  }

  seedAssignment(studentId: string, status: "ACTIVE" | "PAUSED" | "ENDED" = "ACTIVE"): string {
    const id = randomUUID();
    this.assignments.set(id, { status, studentIds: new Set([studentId]) });
    return id;
  }

  seedEntitlement(profileId: string, source: "subscription" | "admin_grant", startsAt: Date, endsAt: Date | null): void {
    this.entitlementRows.push({ clientId: this.clientFor(profileId), source, startsAt, endsAt });
  }

  /** For tests: every download recorded so far, flags included. */
  downloadEvents(): DownloadEvent[] {
    return this.downloadRows.map((e) => ({ ...e, flags: [...(e.flags ?? [])] }));
  }

  private clientFor(profileId: string): string {
    let id = this.clients.get(profileId);
    if (!id) {
      id = randomUUID();
      this.clients.set(profileId, id);
    }
    return id;
  }

  accounts: AccountRepository = {
    getAccount: async (profileId) => {
      const profile = this.profiles.get(profileId);
      if (!profile) return null;
      const account: Account = { profileId, role: profile.role, displayName: profile.displayName, adultConfirmed: profile.adultConfirmed, clientId: this.clients.get(profileId) ?? null };
      return account;
    },
    ensureClient: async (profileId) => {
      if (!this.profiles.has(profileId)) throw new Error("no such profile");
      return this.clientFor(profileId);
    },
  };

  resources: ResourceRepository = {
    list: async (query: ResourceQuery, now = new Date()): Promise<ResourcePage> => {
      const terms = query.q ? words(query.q) : [];
      const scored: Array<{ resource: Resource; score: number }> = [];
      for (const resource of this.resourceRows.values()) {
        if (!published(resource, now)) continue;
        if (query.subject && resource.subject !== query.subject) continue;
        if (query.level && resource.level !== query.level) continue;
        if (query.examBoard && resource.examBoard !== query.examBoard) continue;
        if (query.topic && resource.topic !== query.topic) continue;
        if (query.resourceType && resource.resourceType !== query.resourceType) continue;
        if (query.tier && resource.accessTier !== query.tier) continue;
        let score = 0;
        if (terms.length > 0) {
          const title = new Set(words(resource.title));
          const middle = new Set(words(`${resource.topic} ${resource.subject} ${resource.tags.join(" ")}`));
          const description = new Set(words(resource.description));
          let all = true;
          for (const term of terms) {
            if (title.has(term)) score += 4;
            else if (middle.has(term)) score += 2;
            else if (description.has(term)) score += 1;
            else all = false;
          }
          if (!all) continue;
        }
        scored.push({ resource, score });
      }
      scored.sort(
        (a, b) =>
          b.score - a.score ||
          (b.resource.publishedAt?.getTime() ?? 0) - (a.resource.publishedAt?.getTime() ?? 0) ||
          a.resource.title.localeCompare(b.resource.title),
      );
      const limit = clamp(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
      const offset = clamp(query.offset, 0, 1_000_000);
      return { total: scored.length, items: scored.slice(offset, offset + limit).map((s) => s.resource) };
    },
    getBySlug: async (slug, now = new Date()) => {
      const found = [...this.resourceRows.values()].find((r) => r.slug === slug);
      return found && published(found, now) ? found : null;
    },
    getById: async (id) => this.resourceRows.get(id) ?? null,
    findBySlug: async (slug) => [...this.resourceRows.values()].find((r) => r.slug === slug) ?? null,
    facets: async (now = new Date()): Promise<ResourceFacets> => {
      const live = [...this.resourceRows.values()].filter((r) => published(r, now));
      return {
        subjects: facet(live.map((r) => r.subject)),
        levels: facet(live.map((r) => r.level)),
        resourceTypes: facet(live.map((r) => r.resourceType)),
        examBoards: facet(live.map((r) => r.examBoard)),
      };
    },
    upsert: async (input: ResourceInput) => {
      const existing = [...this.resourceRows.values()].find((r) => r.slug === input.slug);
      const resource: Resource = { ...input, tags: [...input.tags], id: existing?.id ?? randomUUID(), version: input.version ?? existing?.version ?? 1 };
      this.resourceRows.set(resource.id, resource);
      return resource;
    },
    files: async (resourceId) => [...(this.fileRows.get(resourceId) ?? [])],
    setFiles: async (resourceId, files: ResourceFileInput[]) => {
      if (!this.resourceRows.has(resourceId)) throw new Error("no such resource");
      const rows = files.map((f) => ({ ...f, id: randomUUID(), resourceId }));
      this.fileRows.set(resourceId, rows);
      return [...rows];
    },
  };

  access: AccessRepository = {
    facts: async (clientId, now = new Date()): Promise<AccessFacts> => {
      const studentIds = new Set(this.studentLinks.filter((l) => l.clientId === clientId).map((l) => l.studentId));
      const enrolled = [...this.assignments.values()].some((a) => a.status === "ACTIVE" && [...a.studentIds].some((s) => studentIds.has(s)));
      const open = (source: EntitlementRow["source"]) =>
        this.entitlementRows.some((e) => e.clientId === clientId && e.source === source && e.startsAt <= now && (e.endsAt === null || e.endsAt > now));
      return { enrolled, subscription: open("subscription"), adminGrant: open("admin_grant") };
    },
  };

  downloads: DownloadRepository = {
    record: async (event) => {
      this.downloadRows.push({ ...event, flags: [...(event.flags ?? [])] });
    },
    countSince: async (clientId, since) => this.downloadRows.filter((d) => d.clientId === clientId && d.at >= since).length,
    countForResourceSince: async (clientId, resourceId, since) =>
      this.downloadRows.filter((d) => d.clientId === clientId && d.resourceId === resourceId && d.at >= since).length,
  };
}
