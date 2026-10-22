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

export type AccountRole = "ADMIN" | "TUTOR" | "CLIENT" | "STUDENT";

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
  role: AccountRole;
  displayName: string;
  /** The adult (18 or over) declaration made at sign-up. Students under 18 never hold an account of their own. */
  adultConfirmed: boolean;
  /** The family account (clients row), created on first need. null until then. Always null for a learner: a learner has no account of their own to pay with. */
  clientId: string | null;
  /** Set when this profile is a learner (a student's own login). The family they belong to is `learner.familyClientId`. */
  learner: LearnerContext | null;
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
