import { randomUUID } from "node:crypto";
import { deriveEntitlement, type AdminGrantRecord, type SubscriptionRecord } from "./billing";
import { CHAT_TEXT_DAYS, CHAT_UPLOAD_DAYS, DAY_MS, type ChatExport, type ChatFileChunkRecord, type ChatFileRecord, type ChatMessageRecord, type ChatSessionRecord } from "./chat";
import type { AcceptFailure, AccessMode, InvitationPeek, IdentityAuditEntry, IdentityRepository, InvitationRecord, LearnerContext, LinkStatus, StudentRecord } from "./identity";
import { PAPER_JOB_DAYS, PAPER_JOB_MAX_ATTEMPTS, type AssessmentVersion, type PaperJobRecord, type PaperJobRepository, type PaperScope } from "./papers";
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
  private students = new Map<string, StudentRecord>();
  /** Guardian links (client_students): the owner's is created with the student; a second guardian's by seedGuardianLink. */
  private links: Array<{ clientId: string; studentId: string; status: LinkStatus }> = [];
  private invitations = new Map<string, InvitationRecord & { tokenHash: string; invitedBy: string; acceptedBy: string | null }>();
  private identities = new Map<string, { id: string; studentId: string; profileId: string; status: LinkStatus }>(); // by student id
  private auditRows: IdentityAuditEntry[] = [];
  private supervisedRows: Array<{ tokenHash: string; guardianProfileId: string; studentId: string; expiresAt: Date; endedAt: Date | null }> = [];
  private learnerConsents: Array<{ studentId: string; profileId: string; withdrawnAt: Date | null }> = [];
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
  private chatChunks: ChatFileChunkRecord[] = [];
  private usage = new Map<string, number>();
  private consentRows: Array<{ profileId: string; kind: string; version: string; textSha256: string; at: Date }> = [];

  seedProfile(input: { id?: string; role?: AccountRole; displayName?: string; adultConfirmed?: boolean; email?: string } = {}): string {
    const id = input.id ?? randomUUID();
    this.profiles.set(id, { id, role: input.role ?? "CLIENT", displayName: input.displayName ?? "", adultConfirmed: input.adultConfirmed ?? true, email: input.email ?? null });
    return id;
  }

  seedStudent(profileId: string, options: { displayName?: string; yearGroup?: string | null; isMinor?: boolean } = {}): string {
    const clientId = this.clientFor(profileId);
    const studentId = randomUUID();
    this.students.set(studentId, { id: studentId, clientId, displayName: options.displayName ?? "Student", yearGroup: options.yearGroup ?? null, isMinor: options.isMinor ?? true, accessMode: "none", active: true });
    this.links.push({ clientId, studentId, status: "active" });
    return studentId;
  }

  /**
   * Binds a profile to a student as their own login (what an accepted invitation does): the profile becomes a STUDENT, the student's
   * way in is "direct". Development and tests only; production goes through the invitation.
   */
  seedLearner(studentId: string, profileId: string): void {
    const student = this.students.get(studentId);
    const profile = this.profiles.get(profileId);
    if (!student || !profile) throw new Error("no such student or profile");
    profile.role = "STUDENT";
    student.accessMode = "direct";
    this.identities.set(studentId, { id: randomUUID(), studentId, profileId, status: "active" });
  }

  /** A second guardian: another family's link to the student (what the server writes after verifying them). */
  seedGuardianLink(studentId: string, guardianProfileId: string, status: LinkStatus = "active"): void {
    this.links.push({ clientId: this.clientFor(guardianProfileId), studentId, status });
  }

  seedAssignment(studentId: string, status: "ACTIVE" | "PAUSED" | "ENDED" = "ACTIVE"): string {
    const id = randomUUID();
    this.assignments.set(id, { status, studentIds: new Set([studentId]) });
    return id;
  }

  /** For tests: set an assignment's status (it ends, pauses, resumes). */
  setAssignmentStatus(assignmentId: string, status: "ACTIVE" | "PAUSED" | "ENDED"): void {
    const a = this.assignments.get(assignmentId);
    if (!a) throw new Error("no such assignment");
    a.status = status;
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

  private learnerOf(profileId: string): LearnerContext | null {
    const identity = [...this.identities.values()].find((i) => i.profileId === profileId);
    return identity ? this.contextFor(identity) : null;
  }

  private contextFor(identity: { studentId: string; status: LinkStatus }): LearnerContext | null {
    const student = this.students.get(identity.studentId);
    if (!student) return null;
    return {
      studentId: student.id, familyClientId: student.clientId, status: identity.status, displayName: student.displayName, yearGroup: student.yearGroup, isMinor: student.isMinor,
      accessMode: student.accessMode, guardianActive: student.active && this.links.some((l) => l.clientId === student.clientId && l.studentId === student.id && l.status === "active"),
    };
  }

  /** A chat session belongs to exactly this owner: the family, and the same learner (or, for the guardian's own, no learner). */
  private owns(owner: { clientId: string; studentId: string | null }, s: ChatSessionRecord): boolean {
    return s.clientId === owner.clientId && s.studentId === owner.studentId;
  }

  private audit(actor: string | null, action: string, clientId: string | null, studentId: string | null, now: Date): void {
    this.auditRows.push({ at: now, actorProfileId: actor, action, clientId, studentId });
  }

  private activeLink(clientId: string, studentId: string): boolean {
    return this.links.some((l) => l.clientId === clientId && l.studentId === studentId && l.status === "active");
  }

  accounts: AccountRepository = {
    getAccount: async (profileId) => {
      const profile = this.profiles.get(profileId);
      if (!profile) return null;
      const account: Account = { profileId, role: profile.role, displayName: profile.displayName, adultConfirmed: profile.adultConfirmed, clientId: this.clients.get(profileId) ?? null, learner: this.learnerOf(profileId) };
      return account;
    },
    ensureClient: async (profileId) => {
      if (!this.profiles.has(profileId)) throw new Error("no such profile");
      // A learner is never a paying family account (the database refuses it too).
      if (this.learnerOf(profileId)) throw new Error("a learner cannot own a family account");
      return this.clientFor(profileId);
    },
    // The in-memory store has no tuition domain of its own: development maps accounts to the seeded records (apps/web lib/dev/accounts.ts).
    domainRef: async () => null,
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
      const studentIds = new Set(this.links.filter((l) => l.clientId === clientId && l.status === "active").map((l) => l.studentId));
      const enrolled = [...this.assignments.values()].some((a) => a.status === "ACTIVE" && [...a.studentIds].some((s) => studentIds.has(s)));
      const open = (source: EntitlementRow["source"]) =>
        this.entitlementRows.some((e) => e.clientId === clientId && e.source === source && e.startsAt <= now && (e.endsAt === null || e.endsAt > now));
      return { enrolled, subscription: open("subscription"), adminGrant: open("admin_grant") };
    },
    learnerFacts: async (studentId, now = new Date()): Promise<AccessFacts> => {
      const student = this.students.get(studentId);
      if (!student || !student.active || !this.activeLink(student.clientId, studentId)) return { enrolled: false, subscription: false, adminGrant: false, ownTuition: false };
      const family = await this.access.facts(student.clientId, now);
      const ownTuition = [...this.assignments.values()].some((a) => a.status === "ACTIVE" && a.studentIds.has(studentId));
      return { ...family, ownTuition };
    },
  };

  identity: IdentityRepository = {
    getFamilyStudent: async (clientId, studentId) => {
      const student = this.students.get(studentId);
      return student && student.active && this.activeLink(clientId, studentId) ? { ...student } : null;
    },
    listFamilyStudents: async (clientId) =>
      [...this.students.values()]
        .filter((st) => st.active && this.activeLink(clientId, st.id))
        .map((st) => ({
          ...st,
          learnerStatus: this.identities.get(st.id)?.status ?? null,
          invitationOpen: [...this.invitations.values()].some((i) => i.studentId === st.id && !i.acceptedAt && !i.revokedAt),
        })),
    createStudent: async (clientId, input) => {
      const record: StudentRecord = { id: randomUUID(), clientId, displayName: input.displayName.trim(), yearGroup: input.yearGroup, isMinor: input.isMinor, accessMode: "none", active: true };
      this.students.set(record.id, record);
      this.links.push({ clientId, studentId: record.id, status: "active" });
      return { ...record };
    },
    setAccessMode: async (clientId, studentId, mode: AccessMode, actor, now) => {
      const student = this.students.get(studentId);
      if (!student || student.clientId !== clientId) return false;
      if (mode === "direct" && !this.identities.has(studentId)) return false;
      student.accessMode = mode;
      this.audit(actor, `access_mode_${mode}`, clientId, studentId, now);
      return true;
    },
    getLearner: async (profileId) => this.learnerOf(profileId),
    getLearnerByStudent: async (studentId) => {
      const identity = this.identities.get(studentId);
      return identity ? this.contextFor(identity) : null;
    },
    createInvitation: async (input) => {
      const student = this.students.get(input.studentId);
      if (!student || !student.active || student.clientId !== input.clientId || !this.activeLink(input.clientId, input.studentId)) return { ok: false, reason: "not_found" };
      const identity = this.identities.get(input.studentId);
      if (identity && identity.status !== "revoked") return { ok: false, reason: "already_learner" };
      const since = input.now.getTime() - 24 * 3_600_000;
      if ([...this.invitations.values()].filter((i) => i.studentId === input.studentId && i.createdAt.getTime() > since).length >= input.maxPerDay) return { ok: false, reason: "limit" };
      for (const open of this.invitations.values()) if (open.studentId === input.studentId && !open.acceptedAt && !open.revokedAt) open.revokedAt = input.now;
      const row = { id: randomUUID(), studentId: input.studentId, clientId: input.clientId, email: input.email ? input.email.toLowerCase() : null, expiresAt: input.expiresAt, acceptedAt: null, revokedAt: null, createdAt: input.now, tokenHash: input.tokenHash, invitedBy: input.invitedBy, acceptedBy: null };
      this.invitations.set(row.id, row);
      this.audit(input.invitedBy, "invitation_created", input.clientId, input.studentId, input.now);
      const { tokenHash: _hash, invitedBy: _by, acceptedBy: _acc, ...record } = row;
      return { ok: true, invitation: record };
    },
    listInvitations: async (clientId, studentId) =>
      [...this.invitations.values()]
        .filter((i) => i.clientId === clientId && i.studentId === studentId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(({ tokenHash: _hash, invitedBy: _by, acceptedBy: _acc, ...record }) => record),
    peekInvitation: async (tokenHash, now): Promise<InvitationPeek> => {
      const inv = [...this.invitations.values()].find((i) => i.tokenHash === tokenHash);
      if (!inv) return { state: "invalid" };
      if (inv.acceptedAt) return { state: "used" };
      if (inv.revokedAt) return { state: "revoked" };
      if (inv.expiresAt.getTime() <= now.getTime()) return { state: "expired" };
      return { state: "open", email: inv.email };
    },
    revokeInvitation: async (clientId, invitationId, actor, now) => {
      const inv = this.invitations.get(invitationId);
      if (!inv || inv.clientId !== clientId || inv.acceptedAt || inv.revokedAt) return false;
      inv.revokedAt = now;
      this.audit(actor, "invitation_revoked", clientId, inv.studentId, now);
      return true;
    },
    acceptInvitation: async (input) => {
      const inv = [...this.invitations.values()].find((i) => i.tokenHash === input.tokenHash);
      const fail = (reason: AcceptFailure) => ({ ok: false as const, reason });
      if (!inv) return fail("invalid");
      if (inv.acceptedAt) return fail("used");
      if (inv.revokedAt) return fail("revoked");
      if (inv.expiresAt.getTime() <= input.now.getTime()) return fail("expired");
      if (inv.email !== null && inv.email !== input.email.toLowerCase()) return fail("email_mismatch");
      const profile = this.profiles.get(input.profileId);
      const student = this.students.get(inv.studentId);
      const taken = this.identities.get(inv.studentId);
      const already = [...this.identities.values()].some((i) => i.profileId === input.profileId);
      // Only a plain account with no family of its own and no learner login can become a learner; staff never can.
      if (!profile || profile.role !== "CLIENT" || this.clients.has(input.profileId) || already || !student || !student.active || (taken && taken.status !== "revoked") || !this.activeLink(inv.clientId, inv.studentId)) return fail("not_eligible");
      inv.acceptedAt = input.now;
      inv.acceptedBy = input.profileId;
      this.identities.set(inv.studentId, { id: randomUUID(), studentId: inv.studentId, profileId: input.profileId, status: "active" });
      profile.role = "STUDENT";
      student.accessMode = "direct";
      this.audit(input.profileId, "invitation_accepted", inv.clientId, inv.studentId, input.now);
      return { ok: true, studentId: inv.studentId, clientId: inv.clientId };
    },
    setLearnerStatus: async ({ studentId, clientId, status, actor, now }) => {
      const identity = this.identities.get(studentId);
      const student = this.students.get(studentId);
      if (!identity || !student || (clientId !== null && student.clientId !== clientId)) return false;
      identity.status = status;
      if (status === "revoked") student.accessMode = "none";
      this.audit(actor, status === "active" ? "learner_restored" : `learner_${status}`, student.clientId, studentId, now);
      return true;
    },
    setGuardianLinkStatus: async ({ ownerClientId, studentId, guardianClientId, status, actor, now }) => {
      const student = this.students.get(studentId);
      if (!student || student.clientId !== ownerClientId || guardianClientId === ownerClientId) return false;
      const link = this.links.find((l) => l.clientId === guardianClientId && l.studentId === studentId);
      if (!link) return false;
      link.status = status;
      this.audit(actor, `guardian_${status}`, ownerClientId, studentId, now);
      return true;
    },
    grantLearnerConsent: async ({ studentId, guardianProfileId, now }) => {
      const clientId = this.clients.get(guardianProfileId);
      if (!clientId || !this.activeLink(clientId, studentId)) return false;
      this.learnerConsents.push({ studentId, profileId: guardianProfileId, withdrawnAt: null });
      this.audit(guardianProfileId, "learner_consent_granted", clientId, studentId, now);
      return true;
    },
    withdrawLearnerConsent: async (studentId, now) => {
      let n = 0;
      for (const c of this.learnerConsents) if (c.studentId === studentId && c.withdrawnAt === null) { c.withdrawnAt = now; n += 1; }
      if (n) this.audit(null, "learner_consent_withdrawn", this.students.get(studentId)?.clientId ?? null, studentId, now);
      return n;
    },
    hasLearnerConsent: async (studentId) =>
      this.learnerConsents.some((c) => {
        if (c.studentId !== studentId || c.withdrawnAt !== null) return false;
        const clientId = this.clients.get(c.profileId);
        // The consent only counts while the guardian who gave it still has an active link.
        return Boolean(clientId) && this.activeLink(clientId!, studentId);
      }),
    startSupervised: async ({ clientId, guardianProfileId, studentId, tokenHash, expiresAt, now }) => {
      const student = this.students.get(studentId);
      if (this.clients.get(guardianProfileId) !== clientId || !student || !student.active || student.accessMode !== "supervised" || !this.activeLink(clientId, studentId)) return false;
      for (const row of this.supervisedRows) if (row.guardianProfileId === guardianProfileId && !row.endedAt) row.endedAt = now;
      this.supervisedRows.push({ tokenHash, guardianProfileId, studentId, expiresAt, endedAt: null });
      this.audit(guardianProfileId, "supervised_started", clientId, studentId, now);
      return true;
    },
    getSupervised: async (tokenHash, guardianProfileId, now) => {
      const row = this.supervisedRows.find((r) => r.tokenHash === tokenHash);
      if (!row || row.guardianProfileId !== guardianProfileId || row.endedAt || row.expiresAt.getTime() <= now.getTime()) return null;
      const student = this.students.get(row.studentId);
      const clientId = this.clients.get(guardianProfileId);
      if (!student || !student.active || student.accessMode !== "supervised" || !clientId || !this.activeLink(clientId, row.studentId)) return null;
      return {
        studentId: student.id, familyClientId: student.clientId, status: "active", displayName: student.displayName, yearGroup: student.yearGroup, isMinor: student.isMinor,
        accessMode: student.accessMode, guardianActive: true,
      };
    },
    endSupervised: async (tokenHash, guardianProfileId, now) => {
      const row = this.supervisedRows.find((r) => r.tokenHash === tokenHash && r.guardianProfileId === guardianProfileId && !r.endedAt);
      if (!row) return false;
      row.endedAt = now;
      this.audit(guardianProfileId, "supervised_ended", this.clients.get(guardianProfileId) ?? null, row.studentId, now);
      return true;
    },
    recordAudit: async ({ actor, action, clientId, studentId, now }) => void this.audit(actor, action, clientId ?? null, studentId ?? null, now),
    auditFor: async (studentId, limit = 50) => this.auditRows.filter((a) => a.studentId === studentId).slice().reverse().slice(0, limit),
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
    createSession: async (owner, options, now) => {
      if (owner.studentId && !this.activeLink(owner.clientId, owner.studentId)) throw new Error("that student is not in this family");
      const record: ChatSessionRecord = {
        id: randomUUID(), clientId: owner.clientId, studentId: owner.studentId, title: options.title ?? "", createdAt: now, lastActivityAt: now,
        deleteAfter: new Date(now.getTime() + CHAT_TEXT_DAYS * DAY_MS), deletionRequestedAt: null,
      };
      this.chatSessions.set(record.id, record);
      return { ...record };
    },
    renameSession: async (owner, sessionId, title) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || !this.owns(owner, s) || s.deletionRequestedAt) return false;
      s.title = title.slice(0, 120);
      return true;
    },
    listSessions: async (owner) =>
      [...this.chatSessions.values()].filter((s) => this.owns(owner, s) && !s.deletionRequestedAt).sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime()).map((s) => ({ ...s })),
    getSession: async (owner, sessionId) => {
      const s = this.chatSessions.get(sessionId);
      return s && this.owns(owner, s) && !s.deletionRequestedAt ? { ...s } : null;
    },
    listMessages: async (owner, sessionId) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || !this.owns(owner, s) || s.deletionRequestedAt) return [];
      return this.chatMessages.filter((m) => m.sessionId === sessionId).map((m) => ({ ...m }));
    },
    appendMessage: async (owner, sessionId, role, content, now) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || !this.owns(owner, s) || s.deletionRequestedAt) throw new Error("no such chat");
      const last = this.chatMessages.filter((m) => m.sessionId === sessionId).at(-1);
      const at = last && last.createdAt.getTime() >= now.getTime() ? new Date(last.createdAt.getTime() + 1) : now;
      const message: ChatMessageRecord = { id: randomUUID(), sessionId, role, content, createdAt: at, deleteAfter: new Date(at.getTime() + CHAT_TEXT_DAYS * DAY_MS) };
      this.chatMessages.push(message);
      s.lastActivityAt = at;
      s.deleteAfter = message.deleteAfter;
      return { ...message };
    },
    addFile: async (owner, sessionId, file, now) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || !this.owns(owner, s) || s.deletionRequestedAt) throw new Error("no such chat");
      const record: ChatFileRecord = { id: randomUUID(), sessionId, messageId: file.messageId ?? null, storagePath: file.storagePath, bytes: file.bytes, contentType: file.contentType, extractedText: null, pages: null, createdAt: now, deleteAfter: new Date(now.getTime() + CHAT_UPLOAD_DAYS * DAY_MS) };
      this.chatFiles.push(record);
      return { ...record };
    },
    attachFiles: async (owner, sessionId, fileIds, messageId) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || !this.owns(owner, s) || !this.chatMessages.some((m) => m.id === messageId && m.sessionId === sessionId)) return 0;
      let count = 0;
      for (const f of this.chatFiles) {
        if (f.sessionId === sessionId && fileIds.includes(f.id) && f.messageId === null) {
          f.messageId = messageId;
          count += 1;
        }
      }
      return count;
    },
    listFiles: async (owner, sessionId) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || !this.owns(owner, s) || s.deletionRequestedAt) return [];
      return this.chatFiles.filter((f) => f.sessionId === sessionId).map((f) => ({ ...f }));
    },
    getFile: async (owner, fileId) => {
      const f = this.chatFiles.find((x) => x.id === fileId);
      const s = f ? this.chatSessions.get(f.sessionId) : undefined;
      return f && s && this.owns(owner, s) && !s.deletionRequestedAt ? { ...f } : null;
    },
    deleteUnattachedFile: async (owner, fileId) => {
      const f = this.chatFiles.find((x) => x.id === fileId);
      const s = f ? this.chatSessions.get(f.sessionId) : undefined;
      if (!f || !s || !this.owns(owner, s) || s.deletionRequestedAt || f.messageId !== null) return null;
      this.chatFiles = this.chatFiles.filter((x) => x.id !== fileId);
      this.chatChunks = this.chatChunks.filter((c) => c.fileId !== fileId);
      return { ...f };
    },
    getUnattachedFiles: async (owner, sessionId, fileIds) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || !this.owns(owner, s) || s.deletionRequestedAt) return [];
      return this.chatFiles.filter((f) => f.sessionId === sessionId && f.messageId === null && fileIds.includes(f.id)).map((f) => ({ ...f }));
    },
    setFileReading: async (owner, fileId, reading) => {
      const f = this.chatFiles.find((x) => x.id === fileId);
      const s = f ? this.chatSessions.get(f.sessionId) : undefined;
      if (!f || !s || !this.owns(owner, s) || s.deletionRequestedAt) return false;
      f.extractedText = reading.extractedText.slice(0, 32_000);
      f.pages = reading.pages;
      return true;
    },
    replaceFileChunks: async (owner, sessionId, fileId, chunks, now) => {
      const s = this.chatSessions.get(sessionId);
      const f = this.chatFiles.find((x) => x.id === fileId);
      if (!s || !this.owns(owner, s) || s.deletionRequestedAt || !f || f.sessionId !== sessionId) return 0;
      this.chatChunks = this.chatChunks.filter((c) => c.fileId !== fileId);
      const stored = chunks.map((c) => ({
        id: randomUUID(), fileId, sessionId, page: c.page, label: c.label, ordinal: c.ordinal, text: c.text.slice(0, 4000),
        model: c.model, digest: c.digest, dimension: c.embedding.length, chunkConfigVersion: c.chunkConfigVersion,
        embedding: [...c.embedding], createdAt: now,
      }));
      this.chatChunks.push(...stored);
      return stored.length;
    },
    listFileChunks: async (owner, sessionId, options = {}) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || !this.owns(owner, s) || s.deletionRequestedAt) return [];
      const order = new Map(this.chatFiles.filter((f) => f.sessionId === sessionId).map((f) => [f.id, f.createdAt.getTime()]));
      return this.chatChunks
        .filter((c) => c.sessionId === sessionId && (!options.fileId || c.fileId === options.fileId) && order.has(c.fileId))
        .sort((a, b) => (order.get(a.fileId)! - order.get(b.fileId)!) || a.ordinal - b.ordinal)
        .slice(0, options.limit ?? 200)
        .map((c) => ({ ...c, embedding: [...c.embedding] }));
    },
    deleteFileChunks: async (owner, sessionId, fileId) => {
      const s = this.chatSessions.get(sessionId);
      const f = this.chatFiles.find((x) => x.id === fileId);
      if (!s || !this.owns(owner, s) || s.deletionRequestedAt || !f || f.sessionId !== sessionId) return 0;
      const before = this.chatChunks.length;
      this.chatChunks = this.chatChunks.filter((c) => c.fileId !== fileId);
      return before - this.chatChunks.length;
    },
    requestDeletion: async (owner, sessionId, now) => {
      const s = this.chatSessions.get(sessionId);
      if (!s || !this.owns(owner, s) || s.deletionRequestedAt) return false;
      s.deletionRequestedAt = now;
      return true;
    },
    requestLearnerDeletionAll: async (clientId, studentId, now) => {
      if (!this.activeLink(clientId, studentId)) return 0;
      let count = 0;
      for (const s of this.chatSessions.values()) {
        if (s.clientId === clientId && s.studentId === studentId && !s.deletionRequestedAt) {
          s.deletionRequestedAt = now;
          count += 1;
        }
      }
      return count;
    },
    requestDeletionAll: async (owner, now) => {
      let count = 0;
      for (const s of this.chatSessions.values()) {
        if (this.owns(owner, s) && !s.deletionRequestedAt) {
          s.deletionRequestedAt = now;
          count += 1;
        }
      }
      return count;
    },
    exportAll: async (owner, now): Promise<ChatExport> => ({
      exportedAt: now.toISOString(),
      sessions: [...this.chatSessions.values()]
        .filter((s) => this.owns(owner, s) && !s.deletionRequestedAt)
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
      const liveFiles = new Set(this.chatFiles.map((f) => f.id));
      this.chatChunks = this.chatChunks.filter((c) => liveFiles.has(c.fileId) && !gone.has(c.sessionId));
      this.chatMessages = this.chatMessages.filter((m) => !(m.deleteAfter <= now || gone.has(m.sessionId)));
      for (const id of gone) this.chatSessions.delete(id);
      for (const [jobId, job] of this.paperJobs) if (gone.has(job.sessionId)) this.paperJobs.delete(jobId);
      this.paperVersions = this.paperVersions.filter((v) => this.paperJobs.has(v.jobId));
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

  private paperJobs = new Map<string, PaperJobRecord>();
  private paperVersions: AssessmentVersion[] = [];

  private paperIn(scope: PaperScope, id: string): PaperJobRecord | null {
    const job = this.paperJobs.get(id);
    if (!job) return null;
    return scope.kind === "staff" || this.paperOwns(scope.owner, job) ? job : null;
  }

  private paperOwns(owner: { clientId: string; studentId: string | null }, job: PaperJobRecord): boolean {
    return job.clientId === owner.clientId && job.studentId === owner.studentId;
  }

  private paperActive(clientId: string, except?: string): PaperJobRecord | undefined {
    return [...this.paperJobs.values()].find((j) => j.clientId === clientId && j.id !== except && (j.state === "extracting" || j.state === "solving"));
  }

  /** The job as the worker holds it: lease live and owned. */
  private paperHeld(id: string, workerId: string): PaperJobRecord | null {
    const job = this.paperJobs.get(id);
    return job && job.leaseOwner === workerId && (job.state === "extracting" || job.state === "solving") ? job : null;
  }

  papers: PaperJobRepository = {
    create: async (owner, input, worker, now) => {
      const session = this.chatSessions.get(input.sessionId);
      if (!session || !this.owns(owner, session) || session.deletionRequestedAt) return { ok: false, code: "not_found" };
      if (this.paperActive(owner.clientId)) return { ok: false, code: "busy" };
      const job: PaperJobRecord = {
        id: randomUUID(), clientId: owner.clientId, studentId: owner.studentId, sessionId: input.sessionId, fileId: input.fileId, schemeFileId: input.schemeFileId, blankFileId: input.blankFileId ?? null,
        kind: input.kind, state: "extracting", mode: null, selectedIds: null, questions: [], checkpoints: {}, progress: [], resultFileId: null, pageCount: null,
        workedPages: [], message: null, attempts: 1, leaseOwner: worker.id, leaseExpiresAt: new Date(now.getTime() + worker.leaseMs),
        createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + PAPER_JOB_DAYS * DAY_MS),
      };
      this.paperJobs.set(job.id, job);
      return { ok: true, job: structuredClone(job) };
    },
    get: async (owner, id) => {
      const job = this.paperJobs.get(id);
      return job && this.paperOwns(owner, job) ? structuredClone(job) : null;
    },
    getById: async (id) => {
      const job = this.paperJobs.get(id);
      return job ? structuredClone(job) : null;
    },
    amend: async (scope, jobId, questionId, change, now) => {
      const job = this.paperIn(scope, jobId);
      if (!job) return { ok: false, code: "not_found" };
      if (job.state !== "done") return { ok: false, code: "not_done" };
      if (!(questionId in job.checkpoints)) return { ok: false, code: "no_question" };
      const mine = this.paperVersions.filter((v) => v.jobId === jobId && v.questionId === questionId);
      if (mine.length === 0) this.paperVersions.push({ jobId, questionId, version: 1, kind: "ai", actorKind: "system", actorId: null, value: structuredClone(job.checkpoints[questionId]), note: null, createdAt: job.updatedAt });
      const version = Math.max(1, ...mine.map((v) => v.version)) + 1;
      this.paperVersions.push({ jobId, questionId, version, kind: change.kind, actorKind: change.actorKind, actorId: change.actorId, value: structuredClone(change.value), note: change.note, createdAt: now });
      job.checkpoints[questionId] = structuredClone(change.value);
      job.updatedAt = now;
      return { ok: true, version };
    },
    setResult: async (scope, id, result, now) => {
      const job = this.paperIn(scope, id);
      if (!job || job.state !== "done") return false;
      job.resultFileId = result.resultFileId;
      if (result.pageCount !== undefined) job.pageCount = result.pageCount;
      if (result.workedPages !== undefined) job.workedPages = [...result.workedPages];
      job.updatedAt = now;
      return true;
    },
    versions: async (scope, jobId, questionId) => {
      if (!this.paperIn(scope, jobId)) return [];
      return this.paperVersions.filter((v) => v.jobId === jobId && v.questionId === questionId).sort((a, b) => a.version - b.version).map((v) => structuredClone(v));
    },
    listForSession: async (owner, sessionId) => {
      return [...this.paperJobs.values()]
        .filter((j) => j.sessionId === sessionId && this.paperOwns(owner, j))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((j) => structuredClone(j));
    },
    activeForFamily: async (clientId) => {
      const job = this.paperActive(clientId);
      return job ? structuredClone(job) : null;
    },
    begin: async (owner, id, input, worker, now) => {
      const job = this.paperJobs.get(id);
      if (!job || !this.paperOwns(owner, job)) return { ok: false, code: "not_found" };
      if (job.state !== "ready") return { ok: false, code: "not_ready" };
      if (this.paperActive(owner.clientId, id)) return { ok: false, code: "busy" };
      Object.assign(job, { state: "solving", mode: input.mode, selectedIds: input.selectedIds, leaseOwner: worker.id, leaseExpiresAt: new Date(now.getTime() + worker.leaseMs), attempts: 1, progress: [], updatedAt: now });
      return { ok: true, job: structuredClone(job) };
    },
    save: async (id, workerId, patch, worker, now) => {
      const job = this.paperHeld(id, workerId);
      if (!job) return null;
      if (patch.questions) job.questions = structuredClone(patch.questions);
      if (patch.progress) job.progress = structuredClone(patch.progress);
      if (patch.message !== undefined) job.message = patch.message;
      if (patch.checkpoint) job.checkpoints[patch.checkpoint.questionId] = structuredClone(patch.checkpoint.value);
      job.leaseExpiresAt = new Date(now.getTime() + worker.leaseMs);
      job.updatedAt = now;
      return structuredClone(job);
    },
    finish: async (id, workerId, outcome, now) => {
      const job = this.paperHeld(id, workerId);
      if (!job) return false;
      job.state = outcome.state;
      if (outcome.message !== undefined) job.message = outcome.message;
      if (outcome.resultFileId !== undefined) job.resultFileId = outcome.resultFileId;
      if (outcome.pageCount !== undefined) job.pageCount = outcome.pageCount;
      if (outcome.workedPages !== undefined) job.workedPages = [...outcome.workedPages];
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      job.updatedAt = now;
      return true;
    },
    cancel: async (owner, id, now) => {
      const job = this.paperJobs.get(id);
      if (!job || !this.paperOwns(owner, job)) return false;
      if (job.state === "extracting" || job.state === "solving" || job.state === "ready") Object.assign(job, { state: "cancelled", message: "Cancelled.", leaseOwner: null, leaseExpiresAt: null, updatedAt: now });
      return true;
    },
    claimStale: async (worker, now, maxAttempts = PAPER_JOB_MAX_ATTEMPTS) => {
      const claimed: PaperJobRecord[] = [];
      let failed = 0;
      for (const job of this.paperJobs.values()) {
        if ((job.state !== "extracting" && job.state !== "solving") || !job.leaseExpiresAt || job.leaseExpiresAt > now) continue;
        if (job.attempts >= maxAttempts) {
          Object.assign(job, { state: "failed", message: "Something went wrong with that paper more than once. Please try again.", leaseOwner: null, leaseExpiresAt: null, updatedAt: now });
          failed += 1;
          continue;
        }
        Object.assign(job, { attempts: job.attempts + 1, leaseOwner: worker.id, leaseExpiresAt: new Date(now.getTime() + worker.leaseMs), updatedAt: now });
        claimed.push(structuredClone(job));
      }
      return { claimed, failed };
    },
    purgeDue: async (now) => {
      let removed = 0;
      for (const [id, job] of this.paperJobs) {
        if (job.expiresAt <= now && job.state !== "extracting" && job.state !== "solving") {
          this.paperJobs.delete(id);
          this.paperVersions = this.paperVersions.filter((v) => v.jobId !== id);
          removed += 1;
        }
      }
      return removed;
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
