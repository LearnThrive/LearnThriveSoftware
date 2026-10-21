import { randomUUID } from "node:crypto";
import { deriveEntitlement, type AdminGrantRecord, type SubscriptionRecord } from "./billing";
import { CHAT_TEXT_DAYS, CHAT_UPLOAD_DAYS, DAY_MS, type ChatExport, type ChatFileRecord, type ChatMessageRecord, type ChatSessionRecord } from "./chat";
import type { AccessRepository, AccountRepository, BillingRepository, ChatRepository, DownloadRepository, LibraryStore, ResourceRepository } from "./ports";
import type {
  AccessFacts,
  Account,
  AccountRole,
  DownloadEvent,
  Facet,
  FacetScope,
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
  email: string | null;
}

interface EntitlementRow {
  clientId: string;
  source: "subscription" | "admin_grant";
  startsAt: Date;
  endsAt: Date | null;
  subscriptionId?: string;
  grantId?: string;
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
  private customers = new Map<string, string>(); // clientId -> Stripe customer id
  private subscriptionRows = new Map<string, SubscriptionRecord>(); // by id
  private eventRows = new Map<string, { processed: boolean; attempts: number }>();
  private grantRows = new Map<string, AdminGrantRecord>();
  private chatSessions = new Map<string, ChatSessionRecord>();
  private chatMessages: ChatMessageRecord[] = [];
  private chatFiles: ChatFileRecord[] = [];
  private usage = new Map<string, number>();
  private consentRows: Array<{ profileId: string; kind: string; version: string; textSha256: string; at: Date }> = [];

  seedProfile(input: { id?: string; role?: AccountRole; displayName?: string; adultConfirmed?: boolean; email?: string } = {}): string {
    const id = input.id ?? randomUUID();
    this.profiles.set(id, { id, role: input.role ?? "CLIENT", displayName: input.displayName ?? "", adultConfirmed: input.adultConfirmed ?? true, email: input.email ?? null });
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

  /** For tests: the consents recorded so far. */
  consents() {
    return this.consentRows.map((c) => ({ ...c }));
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
    getEmail: async (profileId) => this.profiles.get(profileId)?.email ?? null,
    getOwnerProfileId: async (clientId) => [...this.clients].find(([, id]) => id === clientId)?.[0] ?? null,
    updateDisplayName: async (profileId, displayName) => {
      const profile = this.profiles.get(profileId);
      if (!profile) throw new Error("no such profile");
      profile.displayName = displayName;
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
    facets: async (now = new Date(), scope: FacetScope = {}): Promise<ResourceFacets> => {
      const live = [...this.resourceRows.values()].filter((r) => published(r, now) && (!scope.subject || r.subject === scope.subject));
      return {
        subjects: facet(live.map((r) => r.subject)),
        levels: facet(live.map((r) => r.level)),
        resourceTypes: facet(live.map((r) => r.resourceType)),
        examBoards: facet(live.map((r) => r.examBoard)),
        topics: facet(live.map((r) => r.topic)),
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

  billing: BillingRepository = {
    getStripeCustomerId: async (clientId) => this.customers.get(clientId) ?? null,
    getClientByStripeCustomer: async (stripeCustomerId) => [...this.customers].find(([, customer]) => customer === stripeCustomerId)?.[0] ?? null,
    linkCustomer: async (clientId, stripeCustomerId) => {
      const owner = [...this.customers].find(([, customer]) => customer === stripeCustomerId)?.[0];
      if (owner && owner !== clientId) throw new Error("that Stripe customer belongs to another account");
      const current = this.customers.get(clientId);
      if (current && current !== stripeCustomerId) throw new Error("this account already has a different Stripe customer");
      this.customers.set(clientId, stripeCustomerId);
    },
    upsertSubscription: async (clientId, input) => {
      const existing = [...this.subscriptionRows.values()].find((s) => s.stripeSubscriptionId === input.stripeSubscriptionId);
      if (existing && existing.clientId !== clientId) throw new Error("that subscription belongs to another account");
      const record: SubscriptionRecord = { ...input, id: existing?.id ?? randomUUID(), clientId, createdAt: existing?.createdAt ?? new Date(), refundedAt: existing?.refundedAt ?? null };
      this.subscriptionRows.set(record.id, record);
      return { ...record };
    },
    getSubscriptionByStripeId: async (stripeSubscriptionId) => {
      const found = [...this.subscriptionRows.values()].find((s) => s.stripeSubscriptionId === stripeSubscriptionId);
      return found ? { ...found } : null;
    },
    listSubscriptions: async (clientId) =>
      [...this.subscriptionRows.values()].filter((s) => s.clientId === clientId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((s) => ({ ...s })),
    listAllSubscriptions: async () => [...this.subscriptionRows.values()].map((s) => ({ ...s })),
    markRefunded: async (stripeSubscriptionId, at) => {
      const found = [...this.subscriptionRows.values()].find((s) => s.stripeSubscriptionId === stripeSubscriptionId);
      if (!found) return false;
      found.refundedAt = at;
      return true;
    },
    syncEntitlement: async (subscription, now) => {
      const current = this.subscriptionRows.get(subscription.id) ?? subscription;
      const window = deriveEntitlement(current, now);
      this.entitlementRows = this.entitlementRows.filter((e) => e.subscriptionId !== subscription.id);
      if (window) this.entitlementRows.push({ clientId: subscription.clientId, source: "subscription", subscriptionId: subscription.id, startsAt: window.startsAt, endsAt: window.endsAt });
      return window;
    },
    claimEvent: async (eventId) => {
      const row = this.eventRows.get(eventId);
      if (row?.processed) return "duplicate";
      this.eventRows.set(eventId, { processed: false, attempts: (row?.attempts ?? 0) + 1 });
      return "process";
    },
    completeEvent: async (eventId) => {
      const row = this.eventRows.get(eventId);
      if (row) row.processed = true;
    },
    failEvent: async () => {},
    recordConsent: async (input) => {
      if (!this.profiles.has(input.profileId)) throw new Error("no such profile");
      this.consentRows.push({ ...input });
    },
    createGrant: async (input) => {
      const startsAt = input.startsAt ?? new Date();
      const endsAt = input.endsAt ?? null;
      if (endsAt && endsAt <= startsAt) throw new Error("a grant must end after it starts");
      const record: AdminGrantRecord = { id: randomUUID(), clientId: input.clientId, reason: input.reason, startsAt, endsAt, revokedAt: null };
      this.grantRows.set(record.id, record);
      this.entitlementRows.push({ clientId: input.clientId, source: "admin_grant", grantId: record.id, startsAt, endsAt });
      return { ...record };
    },
    revokeGrant: async (grantId, at) => {
      const grant = this.grantRows.get(grantId);
      if (!grant || grant.revokedAt) return false;
      grant.revokedAt = at;
      const row = this.entitlementRows.find((e) => e.grantId === grantId);
      if (row) {
        if (at <= row.startsAt) this.entitlementRows = this.entitlementRows.filter((e) => e !== row);
        else if (!row.endsAt || row.endsAt > at) row.endsAt = at;
      }
      return true;
    },
  };

  chat: ChatRepository = {
    createSession: async (clientId, options, now) => {
      if (options.studentId && !this.studentLinks.some((l) => l.clientId === clientId && l.studentId === options.studentId)) throw new Error("that student is not in this family");
      const record: ChatSessionRecord = {
        id: randomUUID(), clientId, studentId: options.studentId ?? null, title: options.title ?? "", createdAt: now, lastActivityAt: now,
        deleteAfter: new Date(now.getTime() + CHAT_TEXT_DAYS * DAY_MS), deletionRequestedAt: null,
      };
      this.chatSessions.set(record.id, record);
      return { ...record };
    },
    renameSession: async (clientId, sessionId, title) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || s.clientId !== clientId || s.deletionRequestedAt) return false;
      s.title = title.slice(0, 120);
      return true;
    },
    listSessions: async (clientId) =>
      [...this.chatSessions.values()].filter((s) => s.clientId === clientId && !s.deletionRequestedAt).sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime()).map((s) => ({ ...s })),
    getSession: async (clientId, sessionId) => {
      const s = this.chatSessions.get(sessionId);
      return s && s.clientId === clientId && !s.deletionRequestedAt ? { ...s } : null;
    },
    listMessages: async (clientId, sessionId) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || s.clientId !== clientId || s.deletionRequestedAt) return [];
      return this.chatMessages.filter((m) => m.sessionId === sessionId).map((m) => ({ ...m }));
    },
    appendMessage: async (clientId, sessionId, role, content, now) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || s.clientId !== clientId || s.deletionRequestedAt) throw new Error("no such chat");
      const last = this.chatMessages.filter((m) => m.sessionId === sessionId).at(-1);
      const at = last && last.createdAt.getTime() >= now.getTime() ? new Date(last.createdAt.getTime() + 1) : now;
      const message: ChatMessageRecord = { id: randomUUID(), sessionId, role, content, createdAt: at, deleteAfter: new Date(at.getTime() + CHAT_TEXT_DAYS * DAY_MS) };
      this.chatMessages.push(message);
      s.lastActivityAt = at;
      s.deleteAfter = message.deleteAfter;
      return { ...message };
    },
    addFile: async (clientId, sessionId, file, now) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || s.clientId !== clientId || s.deletionRequestedAt) throw new Error("no such chat");
      const record: ChatFileRecord = { id: randomUUID(), sessionId, messageId: file.messageId ?? null, storagePath: file.storagePath, bytes: file.bytes, contentType: file.contentType, createdAt: now, deleteAfter: new Date(now.getTime() + CHAT_UPLOAD_DAYS * DAY_MS) };
      this.chatFiles.push(record);
      return { ...record };
    },
    attachFiles: async (clientId, sessionId, fileIds, messageId) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || s.clientId !== clientId || !this.chatMessages.some((m) => m.id === messageId && m.sessionId === sessionId)) return 0;
      let count = 0;
      for (const f of this.chatFiles) {
        if (f.sessionId === sessionId && fileIds.includes(f.id) && f.messageId === null) {
          f.messageId = messageId;
          count += 1;
        }
      }
      return count;
    },
    listFiles: async (clientId, sessionId) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || s.clientId !== clientId || s.deletionRequestedAt) return [];
      return this.chatFiles.filter((f) => f.sessionId === sessionId).map((f) => ({ ...f }));
    },
    getUnattachedFiles: async (clientId, sessionId, fileIds) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || s.clientId !== clientId || s.deletionRequestedAt) return [];
      return this.chatFiles.filter((f) => f.sessionId === sessionId && f.messageId === null && fileIds.includes(f.id)).map((f) => ({ ...f }));
    },
    requestDeletion: async (clientId, sessionId, now) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || s.clientId !== clientId || s.deletionRequestedAt) return false;
      s.deletionRequestedAt = now;
      return true;
    },
    requestDeletionAll: async (clientId, now) => {
      let count = 0;
      for (const s of this.chatSessions.values()) {
        if (s.clientId === clientId && !s.deletionRequestedAt) {
          s.deletionRequestedAt = now;
          count += 1;
        }
      }
      return count;
    },
    exportAll: async (clientId, now): Promise<ChatExport> => ({
      exportedAt: now.toISOString(),
      sessions: [...this.chatSessions.values()]
        .filter((s) => s.clientId === clientId && !s.deletionRequestedAt)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((s) => ({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt.toISOString(),
          lastActivityAt: s.lastActivityAt.toISOString(),
          messages: this.chatMessages.filter((m) => m.sessionId === s.id).map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })),
          files: this.chatFiles.filter((f) => f.sessionId === s.id).map((f) => ({ contentType: f.contentType, bytes: f.bytes, createdAt: f.createdAt.toISOString(), deleteAfter: f.deleteAfter.toISOString() })),
        })),
    }),
    dueStoragePaths: async (now) => {
      const gone = (s: ChatSessionRecord) => s.deletionRequestedAt !== null || s.deleteAfter <= now;
      return [...new Set(this.chatFiles.filter((f) => f.deleteAfter <= now || gone(this.chatSessions.get(f.sessionId)!)).map((f) => f.storagePath))];
    },
    purgeDue: async (now) => {
      const gone = new Set([...this.chatSessions.values()].filter((s) => s.deletionRequestedAt !== null || s.deleteAfter <= now).map((s) => s.id));
      const filesBefore = this.chatFiles.length;
      const messagesBefore = this.chatMessages.length;
      this.chatFiles = this.chatFiles.filter((f) => !(f.deleteAfter <= now || gone.has(f.sessionId)));
      this.chatMessages = this.chatMessages.filter((m) => !(m.deleteAfter <= now || gone.has(m.sessionId)));
      for (const id of gone) this.chatSessions.delete(id);
      return { sessions: gone.size, messages: messagesBefore - this.chatMessages.length, files: filesBefore - this.chatFiles.length };
    },
    incrementUsage: async (clientId, kind, windowStart, by) => {
      const key = `${clientId}|${kind}|${windowStart.getTime()}`;
      const total = (this.usage.get(key) ?? 0) + by;
      this.usage.set(key, total);
      return total;
    },
    usageCount: async (clientId, kind, windowStart) => this.usage.get(`${clientId}|${kind}|${windowStart.getTime()}`) ?? 0,
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
