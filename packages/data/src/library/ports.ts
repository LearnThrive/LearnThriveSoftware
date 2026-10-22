import type { ChatExport, ChatFileInput, ChatOwner, ChatFileRecord, ChatMessageRecord, ChatRole, ChatSessionRecord, PurgeResult } from "./chat";
import type { IdentityRepository } from "./identity";
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
  /**
   * The tuition-domain record a signed-in person is: their tutor id (a tutor), their client id (an adult account holder with a family) or
   * their student id (a learner with an active login); null for anyone else (an administrator, a person with no records). This is the id
   * the dashboard looks a person up by (AuthenticatedUser.profileId), and it replaces the development mapping in production.
   */
  domainRef(profileId: string): Promise<string | null>;
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
  /**
   * What a learner may have: the family's Library facts (the household benefit, an ACTIVE guardian link required) plus whether THIS
   * learner's own tuition is active. All false for a learner whose login is not active or whose guardian link is not.
   */
  learnerFacts(studentId: string, now?: Date): Promise<AccessFacts>;
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
  /** A new chat for the owner (the family, and the learner when there is one). Throws if that student is not in the family. */
  createSession(owner: ChatOwner, options: { title?: string }, now: Date): Promise<ChatSessionRecord>;
  /** Renames the owner's own chat (at most 120 characters). False if it is not theirs or is being deleted. */
  renameSession(owner: ChatOwner, sessionId: string, title: string): Promise<boolean>;
  /** Newest activity first. Chats the owner has deleted are already gone from this list. */
  listSessions(owner: ChatOwner): Promise<ChatSessionRecord[]>;
  /** null for anyone else's chat (another family's, a sibling's, the guardian's own), one that does not exist, or one that was deleted. */
  getSession(owner: ChatOwner, sessionId: string): Promise<ChatSessionRecord | null>;
  listMessages(owner: ChatOwner, sessionId: string): Promise<ChatMessageRecord[]>;
  /** Appends a message, moves the chat's last activity and its deletion date (30 days from now). Throws if it is not this owner's chat. */
  appendMessage(owner: ChatOwner, sessionId: string, role: ChatRole, content: string, now: Date): Promise<ChatMessageRecord>;
  addFile(owner: ChatOwner, sessionId: string, file: ChatFileInput, now: Date): Promise<ChatFileRecord>;
  /** Attaches uploaded files (still unattached) to the message that used them. Returns how many were attached. */
  attachFiles(owner: ChatOwner, sessionId: string, fileIds: string[], messageId: string): Promise<number>;
  listFiles(owner: ChatOwner, sessionId: string): Promise<ChatFileRecord[]>;
  /** Files uploaded to this chat and not yet used in a message, by id (the caller picked these ids). */
  getUnattachedFiles(owner: ChatOwner, sessionId: string, fileIds: string[]): Promise<ChatFileRecord[]>;
  /** One file, only for the owner of its chat (and not once the chat is being deleted). */
  getFile(owner: ChatOwner, fileId: string): Promise<ChatFileRecord | null>;
  /** Hides the chat at once; the retention job removes it and its files. false if it is not this owner's, or already requested. */
  requestDeletion(owner: ChatOwner, sessionId: string, now: Date): Promise<boolean>;
  /** Every chat of this owner (and only theirs: a guardian's own chats, or one learner's). */
  requestDeletionAll(owner: ChatOwner, now: Date): Promise<number>;
  /**
   * A guardian deleting a learner's conversations. Deleting is allowed, reading is not: they cannot see a word of them. Only for a student
   * the family reaches through an ACTIVE guardian link. Returns how many chats were hidden.
   */
  requestLearnerDeletionAll(clientId: string, studentId: string, now: Date): Promise<number>;
  exportAll(owner: ChatOwner, now: Date): Promise<ChatExport>;
  /** Storage paths of every file the retention job is about to remove (due, or in a chat to be removed). Call BEFORE purgeDue. */
  dueStoragePaths(now: Date): Promise<string[]>;
  /** Deletes what is due: messages and files past their date, chats past theirs or requested deleted. Returns the counts. */
  purgeDue(now: Date): Promise<PurgeResult>;
  /** Adds to a per-family counter for a window and returns the new total. Counters are the family's: the caps are per household. */
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
  identity: IdentityRepository;
}
