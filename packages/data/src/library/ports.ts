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

  /** An administrator's override of access (and its entitlement row). */
  createGrant(input: AdminGrantInput): Promise<AdminGrantRecord>;
  /** Ends a grant now. Returns false if there is no such grant, or it was already revoked. */
  revokeGrant(grantId: string, at: Date): Promise<boolean>;
}

export interface LibraryStore {
  accounts: AccountRepository;
  resources: ResourceRepository;
  access: AccessRepository;
  downloads: DownloadRepository;
  billing: BillingRepository;
}
