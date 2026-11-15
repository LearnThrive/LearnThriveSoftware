/**
 * Library, account and access types (plan19 phases C and D). Plain data: no behaviour, no storage.
 * The column names and checks these mirror live in supabase/migrations/0002_library.sql and 0003_billing.sql.
 */
export const LEVELS = ["KS2", "KS3", "GCSE", "A Level", "11+"] as const;
export type Level = (typeof LEVELS)[number];

export const RESOURCE_TYPES = ["worksheet", "exam paper", "mark scheme", "notes"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const ACCESS_TIERS = ["free_sample", "members"] as const;
export type AccessTier = (typeof ACCESS_TIERS)[number];

import type { LearnerContext } from "./identity";

import type { Role, RoleChangeRefusal } from "../roles";

/** One role. A person holds a SET of them (`Account.roles`, packages/data/src/roles.ts). */
export type AccountRole = Role;

export interface Resource {
  id: string;
  slug: string;
  title: string;
  description: string;
  subject: string;
  level: Level;
  examBoard: string | null;
  topic: string;
  resourceType: ResourceType;
  yearGroup: string | null;
  tags: string[];
  version: number;
  accessTier: AccessTier;
  /** Who made it. Mandatory: exam-board past papers are never redistributed. */
  authorship: string;
  /** null = draft; a future date = scheduled. */
  publishedAt: Date | null;
}

/** What the import tool writes. The id is assigned by the store. */
export type ResourceInput = Omit<Resource, "id" | "version"> & { version?: number };

export interface ResourceFile {
  id: string;
  resourceId: string;
  storagePath: string;
  bytes: number;
  contentType: string;
  checksumSha256: string;
}

export type ResourceFileInput = Omit<ResourceFile, "id" | "resourceId">;

export interface ResourceQuery {
  /** Free text, matched like a web search (all words must match). */
  q?: string;
  subject?: string;
  level?: Level;
  examBoard?: string;
  topic?: string;
  resourceType?: ResourceType;
  tier?: AccessTier;
  limit?: number;
  offset?: number;
}

export interface ResourcePage {
  items: Resource[];
  total: number;
}

export interface Facet {
  value: string;
  count: number;
}

export interface ResourceFacets {
  subjects: Facet[];
  levels: Facet[];
  resourceTypes: Facet[];
  examBoards: Facet[];
  topics: Facet[];
}

/** Narrows `facets()` to one subject (its levels, types and topics). */
export interface FacetScope {
  subject?: string;
}

/** A signed-in person, as the Library sees them. */
export interface Account {
  profileId: string;
  /** The roles this person holds, in canonical order, at least one. THIS is what every permission decision reads. */
  roles: AccountRole[];
  /** The highest of `roles`: only for a place that wants one word (a label, a default page). NEVER an authorization decision. */
  role: AccountRole;
  displayName: string;
  /** The adult (18 or over) declaration made at sign-up. Students under 18 never hold an account of their own. */
  adultConfirmed: boolean;
  /** The family account (clients row), created on first need. null until then. Always null for a learner: a learner has no account of their own to pay with. */
  clientId: string | null;
  /** Set when this profile is a learner (a student's own login). The family they belong to is `learner.familyClientId`. */
  learner: LearnerContext | null;
  /** What the person signs in with. null only for an account from before usernames, which production never has. */
  username: string | null;
  /** Where resets, notices and invoices go: their own address, or their parent's for a learner. Never the internal Auth address. */
  linkedEmail: string | null;
  /** A temporary password is in use: nothing but choosing a new one works until this clears. */
  mustChangePassword: boolean;
  /** An administrator has disabled this login. */
  loginDisabled: boolean;
}

/** Binding a brand new login to its username, linked email, role and record. One transaction; on any refusal nothing changes. */
export interface ProvisionInput {
  profileId: string;
  username: string;
  linkedEmail: string;
  displayName: string;
  role: AccountRole;
  /** The tutor record this login teaches as: required for a TUTOR, optional for an ADMIN who teaches. */
  tutorId?: string | null;
  /** The student this login belongs to: required for a STUDENT. */
  studentId?: string | null;
  actor: string | null;
  now?: Date;
}

export type ProvisionResult = "ok" | "no_profile" | "username_taken" | "not_eligible";

/** The domain records a person is: each is null unless they hold the matching record. A person can be several at once (a learner who also tutors). */
export interface AccountRecords {
  /** The tutor record they teach as (an active one), if they hold TUTOR or JUNIOR_TUTOR. */
  tutorId: string | null;
  /** The family they own, if any. */
  clientId: string | null;
  /** The student they are, if they have an active learner login. */
  studentId: string | null;
}

/** A line in the administrator's list of people and their roles. No address and no internal id beyond the profile's own. */
export interface ProfileSummary {
  profileId: string;
  displayName: string;
  username: string | null;
  roles: AccountRole[];
  loginDisabled: boolean;
}

export type RoleChangeStatus = RoleChangeRefusal | "NOT_FOUND" | "NEEDS_RECORD";

export type RoleChangeResult =
  | { status: "changed"; before: AccountRole[]; after: AccountRole[] }
  | { status: "refused"; reason: RoleChangeStatus; message: string };

export interface RoleChangeEntry {
  at: Date;
  actorProfileId: string | null;
  targetProfileId: string | null;
  before: AccountRole[];
  after: AccountRole[];
}

/** What the server knows about a family account's rights at one moment. Input to canAccess. */
export interface AccessFacts {
  /** An active TuitionAssignment links one of the family's students. */
  enrolled: boolean;
  /** An entitlement from an active paid subscription is open now. */
  subscription: boolean;
  /** An administrator override is open now. */
  adminGrant: boolean;
  /**
   * Set only for a learner: THIS learner is on an active tuition assignment themselves (not a sibling). A learner's tuition routes follow
   * this; `enrolled` (the family has an enrolled student) still gives them the household's Library benefit and nothing else.
   */
  ownTuition?: boolean;
}

export interface DownloadEvent {
  clientId: string;
  resourceId: string;
  at: Date;
  /** Anomaly flags, short snake_case words. Never personal data. */
  flags?: string[];
}
