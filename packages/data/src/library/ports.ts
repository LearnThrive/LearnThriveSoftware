import type { ChatExport, ChatFileInput, ChatFileRecord, ChatMessageRecord, ChatRole, ChatSessionRecord, PurgeResult } from "./chat";
import type { AdminGrantInput, AdminGrantRecord, ClaimResult, EntitlementWindow, SubscriptionInput, SubscriptionRecord } from "./billing";
import type {
  AccessFacts,
  Account,
  DownloadEvent,
  Resource,
  FacetScope,
  ResourceFacets,
  ResourceFile,
  ResourceFileInput,
  ResourceInput,
  ResourcePage,
  ResourceQuery,
} from "./types";

/** The only thing the SQL stores need from a database driver. PGlite (tests) and `postgres` (production) both fit. */
export interface SqlExecutor {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface AccountRepository {
  /** null if there is no profile. */
  getAccount(profileId: string): Promise<Account | null>;
  /** The family account for a profile, created if it does not exist yet. Idempotent. */
  ensureClient(profileId: string): Promise<string>;
  /** The profile that owns a family account, or null if there is no such account. For webhooks, which carry a client id. */
  getOwnerProfileId(clientId: string): Promise<string | null>;
  /** The sign-in email address of a profile, for the billing emails. Server only. null if there is none. */
  getEmail(profileId: string): Promise<string | null>;
  /** The name printed on downloads. The caller has already cleaned it (at most 80 characters). Throws if there is no such profile. */
  updateDisplayName(profileId: string, displayName: string): Promise<void>;
}

export interface ResourceRepository {
  /** Published resources only (published_at in the past), newest first, or best match first when `q` is set. */
  list(query: ResourceQuery, now?: Date): Promise<ResourcePage>;
  /** A published resource by slug, or null. */
  getBySlug(slug: string, now?: Date): Promise<Resource | null>;
  /** By id, drafts included. For the server after it has decided what the caller may see. */
  getById(id: string): Promise<Resource | null>;
  /** By slug, drafts and scheduled included. For the import tool, which must find what it has already imported. */
  findBySlug(slug: string): Promise<Resource | null>;
  facets(now?: Date, scope?: FacetScope): Promise<ResourceFacets>;
  /** Insert or update by slug. A changed file set bumps nothing here: the import tool sets `version`. */
  upsert(input: ResourceInput): Promise<Resource>;
  files(resourceId: string): Promise<ResourceFile[]>;
  /** Replaces the resource's file records with these. */
  setFiles(resourceId: string, files: ResourceFileInput[]): Promise<ResourceFile[]>;
}

export interface AccessRepository {
  facts(clientId: string, now?: Date): Promise<AccessFacts>;
}

export interface DownloadRepository {
  record(event: DownloadEvent): Promise<void>;
  /** Downloads by this family account at or after `since`. For the hourly cap. */
  countSince(clientId: string, since: Date): Promise<number>;
  /** The same, for one resource: a quick repeat of one file is an anomaly flag. */
  countForResourceSince(clientId: string, resourceId: string, since: Date): Promise<number>;
}

/**
 * Billing (plan19 phase E): the mirror of Stripe's state and the entitlement rows derived from it. Server only: every
 * method here is a service-role write or read. Stripe stays the source of truth; nothing here is ever trusted over it.
 */
export interface BillingRepository {
  getStripeCustomerId(clientId: string): Promise<string | null>;
  getClientByStripeCustomer(stripeCustomerId: string): Promise<string | null>;
  /** Links a family account to its Stripe customer. Idempotent; throws if either side is already linked elsewhere. */
  linkCustomer(clientId: string, stripeCustomerId: string): Promise<void>;
  /** Inserts or updates by Stripe subscription id. Throws if that subscription already belongs to another family. */
  upsertSubscription(clientId: string, input: SubscriptionInput): Promise<SubscriptionRecord>;
  getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<SubscriptionRecord | null>;
  /** Newest first. */
  listSubscriptions(clientId: string): Promise<SubscriptionRecord[]>;
  listAllSubscriptions(): Promise<SubscriptionRecord[]>;
  /** Records a full refund. Returns false if there is no such subscription. */
  markRefunded(stripeSubscriptionId: string, at: Date): Promise<boolean>;
  /** Writes (or removes) the subscription's entitlement row from `deriveEntitlement`. Returns the window, or null for none. */
  syncEntitlement(subscription: SubscriptionRecord, now: Date): Promise<EntitlementWindow | null>;

  /**
   * First step of handling a webhook: `process` for a new event or one whose earlier attempt did not finish,
   * `duplicate` for one already handled. The event's payload is never stored.
   */
  claimEvent(eventId: string, eventType: string, livemode: boolean, now: Date): Promise<ClaimResult>;
  completeEvent(eventId: string, now: Date): Promise<void>;
  failEvent(eventId: string, errorCode: string): Promise<void>;

  /** Records that a person ticked an express consent (the exact text is identified by its version and SHA-256). */
  recordConsent(input: { profileId: string; kind: string; version: string; textSha256: string; at: Date }): Promise<void>;
  /** An administrator's override of access (and its entitlement row). */
  createGrant(input: AdminGrantInput): Promise<AdminGrantRecord>;
  /** Ends a grant now. Returns false if there is no such grant, or it was already revoked. */
  revokeGrant(grantId: string, at: Date): Promise<boolean>;
}

/**
 * Study Buddy chats, uploads and usage counters (plan19 phase F). Every read and write that belongs to a family names its
 * `clientId` and is checked against it, so a session id from another family finds nothing. Server only.
 */
export interface ChatRepository {
  createSession(clientId: string, options: { studentId?: string | null; title?: string }, now: Date): Promise<ChatSessionRecord>;
  /** Renames a family's own chat (at most 120 characters). False if it is not theirs or is being deleted. */
  renameSession(clientId: string, sessionId: string, title: string): Promise<boolean>;
  /** Newest activity first. Chats the family has deleted are already gone from this list. */
  listSessions(clientId: string): Promise<ChatSessionRecord[]>;
  /** null for another family's chat, one that does not exist, or one the family deleted. */
  getSession(clientId: string, sessionId: string): Promise<ChatSessionRecord | null>;
  listMessages(clientId: string, sessionId: string): Promise<ChatMessageRecord[]>;
  /** Appends a message, moves the chat's last activity and its deletion date (30 days from now). Throws if it is not this family's chat. */
  appendMessage(clientId: string, sessionId: string, role: ChatRole, content: string, now: Date): Promise<ChatMessageRecord>;
  addFile(clientId: string, sessionId: string, file: ChatFileInput, now: Date): Promise<ChatFileRecord>;
  /** Attaches uploaded files (still unattached) to the message that used them. Returns how many were attached. */
  attachFiles(clientId: string, sessionId: string, fileIds: string[], messageId: string): Promise<number>;
  listFiles(clientId: string, sessionId: string): Promise<ChatFileRecord[]>;
  /** Files uploaded to this chat and not yet used in a message, by id (the caller picked these ids). */
  getUnattachedFiles(clientId: string, sessionId: string, fileIds: string[]): Promise<ChatFileRecord[]>;
  /** Hides the chat at once; the retention job removes it and its files. false if it is not this family's, or already requested. */
  requestDeletion(clientId: string, sessionId: string, now: Date): Promise<boolean>;
  requestDeletionAll(clientId: string, now: Date): Promise<number>;
  exportAll(clientId: string, now: Date): Promise<ChatExport>;
  /** Storage paths of every file the retention job is about to remove (due, or in a chat to be removed). Call BEFORE purgeDue. */
  dueStoragePaths(now: Date): Promise<string[]>;
  /** Deletes what is due: messages and files past their date, chats past theirs or requested deleted. Returns the counts. */
  purgeDue(now: Date): Promise<PurgeResult>;
  /** Adds to a per-family counter for a window and returns the new total. */
  incrementUsage(clientId: string, kind: string, windowStart: Date, by: number): Promise<number>;
  usageCount(clientId: string, kind: string, windowStart: Date): Promise<number>;
}

export interface LibraryStore {
  accounts: AccountRepository;
  resources: ResourceRepository;
  access: AccessRepository;
  downloads: DownloadRepository;
  billing: BillingRepository;
  chat: ChatRepository;
}
