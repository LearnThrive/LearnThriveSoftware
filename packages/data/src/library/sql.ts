import { deriveEntitlement, type AdminGrantRecord, type PlanInterval, type SubscriptionRecord, type SubscriptionStatus } from "./billing";
import type { ChatExport, ChatFileChunkRecord, ChatFileRecord, ChatMessageRecord, ChatSessionRecord } from "./chat";
import type { AccessMode, IdentityAuditEntry, InvitationPeek, IdentityRepository, InvitationRecord, LearnerContext, LinkStatus, StudentRecord } from "./identity";
import { PAPER_JOB_DAYS, PAPER_JOB_MAX_ATTEMPTS, type AssessmentVersion, type PaperJobKind, type PaperJobRecord, type PaperJobRepository, type PaperJobState } from "./papers";
import type { AccessRepository, AccountRepository, BillingRepository, ChatRepository, DownloadRepository, LibraryStore, ResourceRepository, SqlExecutor } from "./ports";
import type { AccessFacts, Account, Facet, FacetScope, Level, Resource, ResourceFacets, ResourceFile, ResourcePage, ResourceQuery, ResourceType } from "./types";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

type Row = Record<string, any>;

function toResource(row: Row): Resource {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    subject: row.subject,
    level: row.level as Level,
    examBoard: row.exam_board,
    topic: row.topic,
    resourceType: row.resource_type as ResourceType,
    yearGroup: row.year_group,
    tags: row.tags,
    version: row.version,
    accessTier: row.access_tier,
    authorship: row.authorship,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
  };
}

function toFile(row: Row): ResourceFile {
  return { id: row.id, resourceId: row.resource_id, storagePath: row.storage_path, bytes: Number(row.bytes), contentType: row.content_type, checksumSha256: row.checksum_sha256 };
}

const json = <T>(value: unknown, fallback: T): T => (value === null || value === undefined ? fallback : typeof value === "string" ? (JSON.parse(value) as T) : (value as T));

function toPaperJob(row: Row): PaperJobRecord {
  return {
    id: row.id, clientId: row.client_id, studentId: row.student_id, sessionId: row.session_id, fileId: row.file_id, schemeFileId: row.scheme_file_id, blankFileId: row.blank_file_id ?? null,
    kind: row.kind as PaperJobKind, state: row.state as PaperJobState, mode: row.mode, selectedIds: json<string[] | null>(row.selected_ids, null),
    questions: json<unknown[]>(row.questions, []), checkpoints: json<Record<string, unknown>>(row.checkpoints, {}), progress: json<unknown[]>(row.progress, []),
    resultFileId: row.result_file_id, pageCount: row.page_count === null ? null : Number(row.page_count), workedPages: (row.worked_pages ?? []).map(Number), message: row.message,
    attempts: Number(row.attempts), leaseOwner: row.lease_owner, leaseExpiresAt: date(row.lease_expires_at), createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at), expiresAt: new Date(row.expires_at),
  };
}

const date = (value: unknown): Date | null => (value ? new Date(value as string | number | Date) : null);

function toSubscription(row: Row): SubscriptionRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripePriceId: row.stripe_price_id,
    status: row.status as SubscriptionStatus,
    planInterval: row.plan_interval as PlanInterval,
    currentPeriodEnd: date(row.current_period_end),
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    canceledAt: date(row.canceled_at),
    endedAt: date(row.ended_at),
    createdAt: new Date(row.created_at),
    refundedAt: date(row.refunded_at),
  };
}

function toStudent(row: Row): StudentRecord {
  return { id: row.id, clientId: row.client_id, displayName: row.display_name, yearGroup: row.year_group, isMinor: row.is_minor === true, accessMode: row.access_mode as AccessMode, active: row.active === true };
}

function toInvitation(row: Row): InvitationRecord {
  return { id: row.id, studentId: row.student_id, clientId: row.client_id, email: row.email, expiresAt: new Date(row.expires_at), acceptedAt: date(row.accepted_at), revokedAt: date(row.revoked_at), createdAt: new Date(row.created_at) };
}

/** A learner's context from a learner_identities row joined to its student: `guardian_link` is whether the owner's link is active. */
function toLearner(row: Row): LearnerContext {
  return {
    studentId: row.student_id, familyClientId: row.family_client_id, status: row.status as LinkStatus, displayName: row.display_name, yearGroup: row.year_group,
    isMinor: row.is_minor === true, accessMode: row.access_mode as AccessMode, guardianActive: row.active === true && row.guardian_link === true,
  };
}

const LEARNER_SELECT = `select l.student_id, l.status, s.client_id as family_client_id, s.display_name, s.year_group, s.is_minor, s.access_mode, s.active,
         exists (select 1 from public.client_students cs where cs.client_id = s.client_id and cs.student_id = s.id and cs.status = 'active') as guardian_link
    from public.learner_identities l join public.students s on s.id = l.student_id`;

function toSession(row: Row): ChatSessionRecord {
  return {
    id: row.id, clientId: row.client_id, studentId: row.student_id, title: row.title, createdAt: new Date(row.created_at), lastActivityAt: new Date(row.last_activity_at),
    deleteAfter: new Date(row.delete_after), deletionRequestedAt: date(row.deletion_requested_at),
  };
}

function toMessage(row: Row): ChatMessageRecord {
  return { id: row.id, sessionId: row.session_id, role: row.role, content: row.content, createdAt: new Date(row.created_at), deleteAfter: new Date(row.delete_after), generatedBy: row.generated_by ?? null, activity: row.activity ?? null };
}

function toChatFile(row: Row): ChatFileRecord {
  return {
    id: row.id, sessionId: row.session_id, messageId: row.message_id, storagePath: row.storage_path, bytes: Number(row.bytes), contentType: row.content_type,
    extractedText: row.extracted_text ?? null, pages: row.pages === null || row.pages === undefined ? null : Number(row.pages),
    createdAt: new Date(row.created_at), deleteAfter: new Date(row.delete_after),
  };
}

/** `real[]` arrives as a JS array from PGlite and as a `{1,2}` literal string from some drivers: both become numbers. */
function toVector(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter((n) => Number.isFinite(n));
  if (typeof value === "string") return value.replace(/^\{|\}$/g, "").split(",").filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
  return [];
}

function toChatChunk(row: Row): ChatFileChunkRecord {
  return {
    id: row.id, fileId: row.file_id, sessionId: row.session_id, page: row.page === null ? null : Number(row.page), label: row.label ?? null,
    ordinal: Number(row.ordinal), text: row.text, model: row.model, digest: row.digest ?? null, dimension: Number(row.dimension),
    chunkConfigVersion: row.chunk_config_version, embedding: toVector(row.embedding), createdAt: new Date(row.created_at),
  };
}

/**
 * A session this owner has and has not deleted. $1 is the family's client id and $2 the learner's student id (null for the adult's own
 * chats): every statement that uses it passes both first. `is not distinct from` makes null match only null, so a guardian's own query
 * never returns a learner's chat and a learner's never returns a sibling's or the guardian's.
 */
const OWN = "s.client_id = $1 and s.student_id is not distinct from $2::uuid and s.deletion_requested_at is null";

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 0), max);
}

/** A "published" row: published_at has passed. Applied to every public read; $1 is always `now`. */
const PUBLISHED = "published_at is not null and published_at <= $1";

/**
 * The Postgres store. Every statement is parameterised (nothing from a request is ever concatenated into SQL; the
 * only interpolated values are fixed column names and two clamped integers), and every family-scoped read or write
 * names its client_id, because the server connection bypasses Row Level Security: RLS is the second wall (proven in
 * rls.test.ts), not the first.
 */
export class SqlLibraryStore implements LibraryStore {
  constructor(private readonly db: SqlExecutor) {}

  accounts: AccountRepository = {
    getAccount: async (profileId) => {
      const rows = await this.db.query<Row>(
        `select p.id, p.role, p.display_name, p.adult_confirmed_at, c.id as client_id
           from public.profiles p left join public.clients c on c.owner_profile_id = p.id
          where p.id = $1`,
        [profileId],
      );
      const row = rows[0];
      if (!row) return null;
      const learner = row.role === "STUDENT" ? ((await this.db.query<Row>(`${LEARNER_SELECT} where l.profile_id = $1`, [profileId]))[0] ?? null) : null;
      const account: Account = { profileId: row.id, role: row.role, displayName: row.display_name, adultConfirmed: row.adult_confirmed_at !== null, clientId: row.client_id, learner: learner ? toLearner(learner) : null };
      return account;
    },
    ensureClient: async (profileId) => {
      const rows = await this.db.query<Row>(
        `with ins as (
           insert into public.clients (owner_profile_id)
           select id from public.profiles p where p.id = $1 and not exists (select 1 from public.learner_identities l where l.profile_id = p.id)
           on conflict (owner_profile_id) do nothing returning id)
         select id from ins union all select id from public.clients where owner_profile_id = $1 limit 1`,
        [profileId],
      );
      if (!rows[0]) throw new Error("no such profile");
      return rows[0].id;
    },
    domainRef: async (profileId) => {
      const rows = await this.db.query<Row>(
        `select coalesce(
           (select t.id from public.tutors t where t.profile_id = $1),
           (select c.id from public.clients c where c.owner_profile_id = $1),
           (select l.student_id from public.learner_identities l where l.profile_id = $1 and l.status = 'active')
         )::text as id`,
        [profileId],
      );
      return rows[0]?.id ?? null;
    },
    getEmail: async (profileId) => {
      // Through a function: the site's database role has no access to the auth schema (migration 0009).
      const rows = await this.db.query<Row>(`select public.auth_email($1) as email`, [profileId]);
      return rows[0]?.email ?? null;
    },
    getOwnerProfileId: async (clientId) => {
      const rows = await this.db.query<Row>(`select owner_profile_id from public.clients where id = $1`, [clientId]);
      return rows[0]?.owner_profile_id ?? null;
    },
    updateDisplayName: async (profileId, displayName) => {
      const rows = await this.db.query<Row>(`update public.profiles set display_name = $2 where id = $1 returning id`, [profileId, displayName]);
      if (!rows[0]) throw new Error("no such profile");
    },
  };

  resources: ResourceRepository = {
    list: async (query: ResourceQuery, now = new Date()): Promise<ResourcePage> => {
      const params: unknown[] = [now];
      const where: string[] = [PUBLISHED];
      const add = (clause: (placeholder: string) => string, value: unknown) => {
        params.push(value);
        where.push(clause(`$${params.length}`));
      };
      let rank = "0::real";
      if (query.q?.trim()) {
        params.push(query.q);
        const ref = `$${params.length}`;
        where.push(`search @@ websearch_to_tsquery('english', ${ref})`);
        rank = `ts_rank_cd(search, websearch_to_tsquery('english', ${ref}))`;
      }
      if (query.subject) add((p) => `subject = ${p}`, query.subject);
      if (query.level) add((p) => `level = ${p}`, query.level);
      if (query.examBoard) add((p) => `exam_board = ${p}`, query.examBoard);
      if (query.topic) add((p) => `topic = ${p}`, query.topic);
      if (query.resourceType) add((p) => `resource_type = ${p}`, query.resourceType);
      if (query.tier) add((p) => `access_tier = ${p}`, query.tier);
      const clause = where.join(" and ");
      const total = await this.db.query<Row>(`select count(*)::int as n from public.resources where ${clause}`, params);
      const limit = clamp(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
      const offset = clamp(query.offset, 0, 1_000_000);
      const rows = await this.db.query<Row>(
        `select * from public.resources where ${clause} order by ${rank} desc, published_at desc, title asc limit ${limit} offset ${offset}`,
        params,
      );
      return { total: total[0]?.n ?? 0, items: rows.map(toResource) };
    },
    getBySlug: async (slug, now = new Date()) => {
      const rows = await this.db.query<Row>(`select * from public.resources where slug = $2 and ${PUBLISHED}`, [now, slug]);
      return rows[0] ? toResource(rows[0]) : null;
    },
    findBySlug: async (slug) => {
      const rows = await this.db.query<Row>(`select * from public.resources where slug = $1`, [slug]);
      return rows[0] ? toResource(rows[0]) : null;
    },
    getById: async (id) => {
      const rows = await this.db.query<Row>(`select * from public.resources where id = $1`, [id]);
      return rows[0] ? toResource(rows[0]) : null;
    },
    facets: async (now = new Date(), scope: FacetScope = {}): Promise<ResourceFacets> => {
      const one = async (column: "subject" | "level" | "resource_type" | "exam_board" | "topic"): Promise<Facet[]> => {
        const params: unknown[] = [now];
        if (scope.subject) params.push(scope.subject);
        const rows = await this.db.query<Row>(
          `select ${column} as value, count(*)::int as count from public.resources where ${PUBLISHED} and ${column} is not null${scope.subject ? " and subject = $2" : ""} group by 1 order by 2 desc, 1 asc`,
          params,
        );
        return rows.map((r) => ({ value: r.value, count: r.count }));
      };
      return {
        subjects: await one("subject"),
        levels: await one("level"),
        resourceTypes: await one("resource_type"),
        examBoards: await one("exam_board"),
        topics: await one("topic"),
      };
    },
    upsert: async (input) => {
      const rows = await this.db.query<Row>(
        `insert into public.resources
           (slug, title, description, subject, level, exam_board, topic, resource_type, year_group, tags, version, access_tier, authorship, published_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11::int,1),$12,$13,$14)
         on conflict (slug) do update set
           title = excluded.title, description = excluded.description, subject = excluded.subject, level = excluded.level,
           exam_board = excluded.exam_board, topic = excluded.topic, resource_type = excluded.resource_type,
           year_group = excluded.year_group, tags = excluded.tags, version = coalesce($11::int, public.resources.version),
           access_tier = excluded.access_tier, authorship = excluded.authorship, published_at = excluded.published_at
         returning *`,
        [
          input.slug, input.title, input.description, input.subject, input.level, input.examBoard, input.topic, input.resourceType,
          input.yearGroup, input.tags, input.version ?? null, input.accessTier, input.authorship, input.publishedAt,
        ],
      );
      return toResource(rows[0]);
    },
    files: async (resourceId) => {
      const rows = await this.db.query<Row>(`select * from public.resource_files where resource_id = $1 order by storage_path`, [resourceId]);
      return rows.map(toFile);
    },
    setFiles: async (resourceId, files) => {
      await this.db.query(`delete from public.resource_files where resource_id = $1`, [resourceId]);
      const out: ResourceFile[] = [];
      for (const f of files) {
        const rows = await this.db.query<Row>(
          `insert into public.resource_files (resource_id, storage_path, bytes, content_type, checksum_sha256) values ($1,$2,$3,$4,$5) returning *`,
          [resourceId, f.storagePath, f.bytes, f.contentType, f.checksumSha256],
        );
        out.push(toFile(rows[0]));
      }
      return out;
    },
  };

  access: AccessRepository = {
    facts: async (clientId, now = new Date()): Promise<AccessFacts> => {
      const rows = await this.db.query<Row>(
        `select
           exists (select 1 from public.client_students cs
                     join public.assignment_students a on a.student_id = cs.student_id
                     join public.tuition_assignments t on t.id = a.assignment_id
                    where cs.client_id = $1 and cs.status = 'active' and t.status = 'ACTIVE') as enrolled,
           exists (select 1 from public.entitlements e where e.client_id = $1 and e.source = 'subscription'
                      and e.starts_at <= $2 and (e.ends_at is null or e.ends_at > $2)) as subscription,
           exists (select 1 from public.entitlements e where e.client_id = $1 and e.source = 'admin_grant'
                      and e.starts_at <= $2 and (e.ends_at is null or e.ends_at > $2)) as admin_grant`,
        [clientId, now],
      );
      const r = rows[0] ?? {};
      return { enrolled: r.enrolled === true, subscription: r.subscription === true, adminGrant: r.admin_grant === true };
    },
    learnerFacts: async (studentId, now = new Date()): Promise<AccessFacts> => {
      const none: AccessFacts = { enrolled: false, subscription: false, adminGrant: false, ownTuition: false };
      const live = await this.db.query<Row>(
        `select s.client_id from public.students s
          where s.id = $1 and s.active
            and exists (select 1 from public.client_students cs where cs.client_id = s.client_id and cs.student_id = s.id and cs.status = 'active')`,
        [studentId],
      );
      if (!live[0]) return none;
      const family = await this.access.facts(live[0].client_id, now);
      const own = await this.db.query<Row>(
        `select exists (select 1 from public.assignment_students a join public.tuition_assignments t on t.id = a.assignment_id
                          where a.student_id = $1 and t.status = 'ACTIVE') as own`,
        [studentId],
      );
      return { ...family, ownTuition: own[0]?.own === true };
    },
  };

  identity: IdentityRepository = {
    getFamilyStudent: async (clientId, studentId) => {
      const rows = await this.db.query<Row>(
        `select s.* from public.students s join public.client_students cs on cs.student_id = s.id
          where s.id = $2 and s.active and cs.client_id = $1 and cs.status = 'active'`,
        [clientId, studentId],
      );
      return rows[0] ? toStudent(rows[0]) : null;
    },
    listFamilyStudents: async (clientId) => {
      const rows = await this.db.query<Row>(
        `select s.*, l.status as learner_status,
                exists (select 1 from public.learner_invitations i where i.student_id = s.id and i.accepted_at is null and i.revoked_at is null) as invitation_open
           from public.students s
           join public.client_students cs on cs.student_id = s.id and cs.client_id = $1 and cs.status = 'active'
           left join public.learner_identities l on l.student_id = s.id
          where s.active order by s.created_at, s.id`,
        [clientId],
      );
      return rows.map((r) => ({ ...toStudent(r), learnerStatus: (r.learner_status as LinkStatus | null) ?? null, invitationOpen: r.invitation_open === true }));
    },
    createStudent: async (clientId, input) => {
      const rows = await this.db.query<Row>(
        `insert into public.students (client_id, display_name, year_group, is_minor) values ($1, $2, $3, $4) returning *`,
        [clientId, input.displayName.trim(), input.yearGroup, input.isMinor],
      );
      return toStudent(rows[0]!);
    },
    setAccessMode: async (clientId, studentId, mode, actor, now) => {
      const rows = await this.db.query<Row>(
        `with u as (
           update public.students s set access_mode = $3
            where s.id = $2 and s.client_id = $1
              and ($3 <> 'direct' or exists (select 1 from public.learner_identities l where l.student_id = s.id and l.status <> 'revoked'))
           returning s.id)
         , a as (insert into public.identity_audit (at, actor_profile_id, action, client_id, student_id) select $5, $4, 'access_mode_' || $3, $1, id from u returning 1)
         select count(*)::int as n from u`,
        [clientId, studentId, mode, actor, now],
      );
      return (rows[0]?.n ?? 0) > 0;
    },
    getLearner: async (profileId) => {
      const rows = await this.db.query<Row>(`${LEARNER_SELECT} where l.profile_id = $1`, [profileId]);
      return rows[0] ? toLearner(rows[0]) : null;
    },
    getLearnerByStudent: async (studentId) => {
      const rows = await this.db.query<Row>(`${LEARNER_SELECT} where l.student_id = $1`, [studentId]);
      return rows[0] ? toLearner(rows[0]) : null;
    },
    createInvitation: async (input) => {
      const rows = await this.db.query<Row>(`select * from public.create_learner_invitation($1, $2, $3, $4, $5, $6, $7, $8)`, [
        input.clientId, input.studentId, input.invitedBy, input.email, input.tokenHash, input.expiresAt, input.maxPerDay, input.now,
      ]);
      const r = rows[0];
      if (!r || r.result !== "ok") return { ok: false, reason: (r?.result ?? "not_found") as "not_found" | "limit" | "already_learner" };
      const found = await this.db.query<Row>(`select * from public.learner_invitations where id = $1`, [r.invitation_id]);
      return { ok: true, invitation: toInvitation(found[0]!) };
    },
    listInvitations: async (clientId, studentId) =>
      (await this.db.query<Row>(`select * from public.learner_invitations where client_id = $1 and student_id = $2 order by created_at desc, id`, [clientId, studentId])).map(toInvitation),
    peekInvitation: async (tokenHash, now): Promise<InvitationPeek> => {
      const rows = await this.db.query<Row>(`select email, accepted_at, revoked_at, expires_at from public.learner_invitations where token_hash = $1`, [tokenHash]);
      const r = rows[0];
      if (!r) return { state: "invalid" };
      if (r.accepted_at) return { state: "used" };
      if (r.revoked_at) return { state: "revoked" };
      if (new Date(r.expires_at).getTime() <= now.getTime()) return { state: "expired" };
      return { state: "open", email: r.email };
    },
    revokeInvitation: async (clientId, invitationId, actor, now) => {
      const rows = await this.db.query<Row>(
        `with u as (
           update public.learner_invitations i set revoked_at = $4, revoked_by = $3
            where i.id = $2 and i.client_id = $1 and i.accepted_at is null and i.revoked_at is null returning i.student_id)
         , a as (insert into public.identity_audit (at, actor_profile_id, action, client_id, student_id) select $4, $3, 'invitation_revoked', $1, student_id from u returning 1)
         select count(*)::int as n from u`,
        [clientId, invitationId, actor, now],
      );
      return (rows[0]?.n ?? 0) > 0;
    },
    acceptInvitation: async (input) => {
      const rows = await this.db.query<Row>(`select * from public.accept_learner_invitation($1, $2, $3, $4)`, [input.tokenHash, input.profileId, input.email, input.now]);
      const r = rows[0];
      if (r?.result === "ok") return { ok: true, studentId: r.student_id, clientId: r.client_id };
      return { ok: false, reason: (r?.result ?? "invalid") as "invalid" | "expired" | "used" | "revoked" | "email_mismatch" | "not_eligible" };
    },
    setLearnerStatus: async ({ studentId, clientId, status, actor, now }) => {
      const rows = await this.db.query<Row>(
        `with u as (
           update public.learner_identities l set status = $3, status_changed_at = $5, status_changed_by = $4
             from public.students s
            where l.student_id = $1 and s.id = l.student_id and ($2::uuid is null or s.client_id = $2::uuid)
           returning l.student_id, s.client_id)
         , m as (update public.students s set access_mode = 'none' from u where $3 = 'revoked' and s.id = u.student_id returning 1)
         , a as (insert into public.identity_audit (at, actor_profile_id, action, client_id, student_id)
                 select $5, $4, case $3 when 'active' then 'learner_restored' else 'learner_' || $3 end, client_id, student_id from u returning 1)
         select count(*)::int as n from u`,
        [studentId, clientId, status, actor, now],
      );
      return (rows[0]?.n ?? 0) > 0;
    },
    setGuardianLinkStatus: async ({ ownerClientId, studentId, guardianClientId, status, actor, now }) => {
      const rows = await this.db.query<Row>(
        `with u as (
           update public.client_students cs set status = $4, status_changed_at = $6
             from public.students s
            where cs.student_id = $2 and cs.client_id = $3 and s.id = cs.student_id and s.client_id = $1 and cs.client_id <> s.client_id
           returning cs.student_id)
         , a as (insert into public.identity_audit (at, actor_profile_id, action, client_id, student_id) select $6, $5, 'guardian_' || $4, $1, student_id from u returning 1)
         select count(*)::int as n from u`,
        [ownerClientId, studentId, guardianClientId, status, actor, now],
      );
      return (rows[0]?.n ?? 0) > 0;
    },
    grantLearnerConsent: async ({ studentId, guardianProfileId, version, textSha256, now }) => {
      const rows = await this.db.query<Row>(
        `with ok as (
           select c.id as client_id from public.clients c
             join public.client_students cs on cs.client_id = c.id and cs.student_id = $1 and cs.status = 'active'
            where c.owner_profile_id = $2)
         , ins as (insert into public.consents (profile_id, student_id, kind, version, text_sha256) select $2, $1, 'learner_ai_use', $3, $4 from ok returning 1)
         , a as (insert into public.identity_audit (at, actor_profile_id, action, client_id, student_id) select $5, $2, 'learner_consent_granted', client_id, $1 from ok returning 1)
         select count(*)::int as n from ins`,
        [studentId, guardianProfileId, version, textSha256, now],
      );
      return (rows[0]?.n ?? 0) > 0;
    },
    withdrawLearnerConsent: async (studentId, now) => {
      const rows = await this.db.query<Row>(
        `with u as (update public.consents set withdrawn_at = greatest($2, granted_at) where student_id = $1 and kind = 'learner_ai_use' and withdrawn_at is null returning 1)
         , a as (insert into public.identity_audit (at, action, client_id, student_id)
                 select $2, 'learner_consent_withdrawn', (select client_id from public.students where id = $1), $1 where exists (select 1 from u) returning 1)
         select count(*)::int as n from u`,
        [studentId, now],
      );
      return rows[0]?.n ?? 0;
    },
    hasLearnerConsent: async (studentId) => {
      // Open, and given by a guardian whose link to the student is still active.
      const rows = await this.db.query<Row>(
        `select exists (
           select 1 from public.consents k
             join public.clients c on c.owner_profile_id = k.profile_id
             join public.client_students cs on cs.client_id = c.id and cs.student_id = k.student_id and cs.status = 'active'
            where k.student_id = $1 and k.kind = 'learner_ai_use' and k.withdrawn_at is null) as ok`,
        [studentId],
      );
      return rows[0]?.ok === true;
    },
    startSupervised: async ({ clientId, guardianProfileId, studentId, tokenHash, expiresAt, now }) => {
      const rows = await this.db.query<Row>(
        `with ok as (
           select s.id from public.students s
             join public.clients c on c.id = $1 and c.owner_profile_id = $2
             join public.client_students cs on cs.client_id = c.id and cs.student_id = s.id and cs.status = 'active'
            where s.id = $3 and s.active and s.access_mode = 'supervised')
         , ended as (update public.supervised_contexts x set ended_at = $6 where x.guardian_profile_id = $2 and x.ended_at is null and exists (select 1 from ok) returning 1)
         , ins as (insert into public.supervised_contexts (token_hash, guardian_profile_id, student_id, expires_at, created_at) select $4, $2, id, $5, $6 from ok returning 1)
         , a as (insert into public.identity_audit (at, actor_profile_id, action, client_id, student_id) select $6, $2, 'supervised_started', $1, id from ok returning 1)
         select count(*)::int as n from ins`,
        [clientId, guardianProfileId, studentId, tokenHash, expiresAt, now],
      );
      return (rows[0]?.n ?? 0) > 0;
    },
    getSupervised: async (tokenHash, guardianProfileId, now) => {
      const rows = await this.db.query<Row>(
        `select s.id as student_id, s.client_id as family_client_id, s.display_name, s.year_group, s.is_minor, s.access_mode, s.active, true as guardian_link, 'active' as status
           from public.supervised_contexts x
           join public.students s on s.id = x.student_id
           join public.clients c on c.owner_profile_id = x.guardian_profile_id
           join public.client_students cs on cs.client_id = c.id and cs.student_id = s.id and cs.status = 'active'
          where x.token_hash = $1 and x.guardian_profile_id = $2 and x.ended_at is null and x.expires_at > $3
            and s.active and s.access_mode = 'supervised'`,
        [tokenHash, guardianProfileId, now],
      );
      return rows[0] ? toLearner(rows[0]) : null;
    },
    endSupervised: async (tokenHash, guardianProfileId, now) => {
      const rows = await this.db.query<Row>(
        `with u as (update public.supervised_contexts x set ended_at = $3 where x.token_hash = $1 and x.guardian_profile_id = $2 and x.ended_at is null returning x.student_id)
         , a as (insert into public.identity_audit (at, actor_profile_id, action, client_id, student_id)
                 select $3, $2, 'supervised_ended', (select id from public.clients where owner_profile_id = $2), student_id from u returning 1)
         select count(*)::int as n from u`,
        [tokenHash, guardianProfileId, now],
      );
      return (rows[0]?.n ?? 0) > 0;
    },
    recordAudit: async ({ actor, action, clientId, studentId, now }) => {
      await this.db.query(`insert into public.identity_audit (at, actor_profile_id, action, client_id, student_id) values ($1, $2, $3, $4, $5)`, [now, actor, action, clientId ?? null, studentId ?? null]);
    },
    auditFor: async (studentId, limit = 50) =>
      (await this.db.query<Row>(`select at, actor_profile_id, action, client_id, student_id from public.identity_audit where student_id = $1 order by id desc limit $2`, [studentId, Math.min(Math.max(limit, 1), 500)])).map(
        (r): IdentityAuditEntry => ({ at: new Date(r.at), actorProfileId: r.actor_profile_id, action: r.action, clientId: r.client_id, studentId: r.student_id }),
      ),
  };

  billing: BillingRepository = {
    getStripeCustomerId: async (clientId) => {
      const rows = await this.db.query<Row>(`select stripe_customer_id from public.billing_customers where client_id = $1`, [clientId]);
      return rows[0]?.stripe_customer_id ?? null;
    },
    getClientByStripeCustomer: async (stripeCustomerId) => {
      const rows = await this.db.query<Row>(`select client_id from public.billing_customers where stripe_customer_id = $1`, [stripeCustomerId]);
      return rows[0]?.client_id ?? null;
    },
    linkCustomer: async (clientId, stripeCustomerId) => {
      let inserted: Row[];
      try {
        inserted = await this.db.query<Row>(`insert into public.billing_customers (client_id, stripe_customer_id) values ($1, $2) on conflict (client_id) do nothing returning client_id`, [clientId, stripeCustomerId]);
      } catch {
        throw new Error("that Stripe customer belongs to another account");
      }
      if (inserted[0]) return;
      const current = await this.db.query<Row>(`select stripe_customer_id from public.billing_customers where client_id = $1`, [clientId]);
      if (current[0]?.stripe_customer_id !== stripeCustomerId) throw new Error("this account already has a different Stripe customer");
    },
    upsertSubscription: async (clientId, input) => {
      const rows = await this.db.query<Row>(
        `insert into public.subscriptions
           (client_id, stripe_subscription_id, stripe_price_id, status, plan_interval, current_period_end, cancel_at_period_end, canceled_at, ended_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (stripe_subscription_id) do update set
           stripe_price_id = excluded.stripe_price_id, status = excluded.status, plan_interval = excluded.plan_interval,
           current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
           canceled_at = excluded.canceled_at, ended_at = excluded.ended_at
           where public.subscriptions.client_id = excluded.client_id
         returning *`,
        [clientId, input.stripeSubscriptionId, input.stripePriceId, input.status, input.planInterval, input.currentPeriodEnd, input.cancelAtPeriodEnd, input.canceledAt, input.endedAt],
      );
      if (!rows[0]) throw new Error("that subscription belongs to another account");
      return toSubscription(rows[0]);
    },
    getSubscriptionByStripeId: async (stripeSubscriptionId) => {
      const rows = await this.db.query<Row>(`select * from public.subscriptions where stripe_subscription_id = $1`, [stripeSubscriptionId]);
      return rows[0] ? toSubscription(rows[0]) : null;
    },
    listSubscriptions: async (clientId) => {
      const rows = await this.db.query<Row>(`select * from public.subscriptions where client_id = $1 order by created_at desc`, [clientId]);
      return rows.map(toSubscription);
    },
    listAllSubscriptions: async () => (await this.db.query<Row>(`select * from public.subscriptions order by created_at`)).map(toSubscription),
    markRefunded: async (stripeSubscriptionId, at) => {
      const rows = await this.db.query<Row>(`update public.subscriptions set refunded_at = coalesce(refunded_at, $2) where stripe_subscription_id = $1 returning id`, [stripeSubscriptionId, at]);
      return rows.length > 0;
    },
    syncEntitlement: async (subscription, now) => {
      const fresh = await this.db.query<Row>(`select * from public.subscriptions where id = $1`, [subscription.id]);
      const current = fresh[0] ? toSubscription(fresh[0]) : subscription;
      const window = deriveEntitlement(current, now);
      if (!window) {
        await this.db.query(`delete from public.entitlements where subscription_id = $1 and source = 'subscription'`, [subscription.id]);
        return null;
      }
      await this.db.query(
        `with upd as (
           update public.entitlements set starts_at = $3, ends_at = $4 where subscription_id = $2 and source = 'subscription' returning id)
         insert into public.entitlements (client_id, source, subscription_id, starts_at, ends_at)
         select $1, 'subscription', $2, $3, $4 where not exists (select 1 from upd)`,
        [subscription.clientId, subscription.id, window.startsAt, window.endsAt],
      );
      return window;
    },
    claimEvent: async (eventId, eventType, livemode, now) => {
      const rows = await this.db.query<Row>(
        `insert into public.stripe_webhook_events (event_id, event_type, livemode, received_at, attempts) values ($1, $2, $3, $4, 1)
         on conflict (event_id) do update set attempts = public.stripe_webhook_events.attempts + 1
           where public.stripe_webhook_events.processed_at is null
         returning event_id`,
        [eventId, eventType, livemode, now],
      );
      return rows.length > 0 ? "process" : "duplicate";
    },
    completeEvent: async (eventId, now) => {
      await this.db.query(`update public.stripe_webhook_events set processed_at = $2, last_error_code = null where event_id = $1`, [eventId, now]);
    },
    failEvent: async (eventId, errorCode) => {
      await this.db.query(`update public.stripe_webhook_events set last_error_code = $2 where event_id = $1`, [eventId, errorCode.slice(0, 80)]);
    },
    recordConsent: async (input) => {
      await this.db.query(`insert into public.consents (profile_id, kind, version, text_sha256, granted_at) values ($1, $2, $3, $4, $5)`, [input.profileId, input.kind, input.version, input.textSha256, input.at]);
    },
    createGrant: async (input) => {
      const startsAt = input.startsAt ?? new Date();
      const rows = await this.db.query<Row>(
        `with g as (
           insert into public.admin_grants (client_id, granted_by, reason, starts_at, ends_at) values ($1, $2, $3, $4, $5) returning *),
         e as (
           insert into public.entitlements (client_id, source, admin_grant_id, starts_at, ends_at)
           select client_id, 'admin_grant', id, starts_at, ends_at from g)
         select * from g`,
        [input.clientId, input.grantedBy ?? null, input.reason, startsAt, input.endsAt ?? null],
      );
      const row = rows[0]!;
      const grant: AdminGrantRecord = { id: row.id, clientId: row.client_id, reason: row.reason, startsAt: new Date(row.starts_at), endsAt: date(row.ends_at), revokedAt: date(row.revoked_at) };
      return grant;
    },
    revokeGrant: async (grantId, at) => {
      const rows = await this.db.query<Row>(
        `with g as (update public.admin_grants set revoked_at = $2 where id = $1 and revoked_at is null returning id, starts_at),
              gone as (delete from public.entitlements where admin_grant_id in (select id from g where starts_at >= $2)),
              cut as (update public.entitlements set ends_at = least(coalesce(ends_at, $2), $2) where admin_grant_id in (select id from g where starts_at < $2))
         select id from g`,
        [grantId, at],
      );
      return rows.length > 0;
    },
  };

  chat: ChatRepository = {
    createSession: async (owner, options, now) => {
      const rows = await this.db.query<Row>(
        `insert into public.chat_sessions (client_id, student_id, title, created_at, last_activity_at, delete_after)
         select $1, $2::uuid, $3, $4, $4, $4::timestamptz + interval '30 days'
          where $2::uuid is null or exists (select 1 from public.students st join public.client_students cs on cs.student_id = st.id
                                             where st.id = $2::uuid and cs.client_id = $1 and cs.status = 'active')
         returning *`,
        [owner.clientId, owner.studentId, options.title ?? "", now],
      );
      if (!rows[0]) throw new Error("that student is not in this family");
      return toSession(rows[0]);
    },
    renameSession: async (owner, sessionId, title) => {
      const rows = await this.db.query<Row>(
        `update public.chat_sessions s set title = $4 where s.id = $3 and ${OWN} returning s.id`,
        [owner.clientId, owner.studentId, sessionId, title.slice(0, 120)],
      );
      return rows.length === 1;
    },
    listSessions: async (owner) => {
      const rows = await this.db.query<Row>(`select * from public.chat_sessions s where ${OWN} order by s.last_activity_at desc`, [owner.clientId, owner.studentId]);
      return rows.map(toSession);
    },
    getSession: async (owner, sessionId) => {
      const rows = await this.db.query<Row>(`select * from public.chat_sessions s where ${OWN} and s.id = $3`, [owner.clientId, owner.studentId, sessionId]);
      return rows[0] ? toSession(rows[0]) : null;
    },
    listMessages: async (owner, sessionId) => {
      const rows = await this.db.query<Row>(
        `select m.* from public.chat_messages m join public.chat_sessions s on s.id = m.session_id where ${OWN} and s.id = $3 order by m.created_at, m.id`,
        [owner.clientId, owner.studentId, sessionId],
      );
      return rows.map(toMessage);
    },
    appendMessage: async (owner, sessionId, role, content, now, meta) => {
      // generated_by (0015) is named only when there is one, so ordinary turns do not depend on that migration having been applied.
      const generatedBy = role === "assistant" && meta?.generatedBy ? meta.generatedBy.slice(0, 120) : null;
      // activity (0016) likewise: named only when there is one, and only for an answer, within its bound.
      const activity = role === "assistant" && meta?.activity && meta.activity.length >= 2 && meta.activity.length <= 6000 ? meta.activity : null;
      const extraColumns = [generatedBy ? "generated_by" : null, activity ? "activity" : null].filter(Boolean) as string[];
      const extraValues = [generatedBy, activity].filter((v): v is string => Boolean(v));
      const rows = await this.db.query<Row>(
        `with s as (select id from public.chat_sessions s where ${OWN} and s.id = $3),
              t as (select greatest($5::timestamptz, coalesce((select max(created_at) + interval '1 millisecond' from public.chat_messages where session_id = $3), $5::timestamptz)) as ts),
              ins as (insert into public.chat_messages (session_id, role, content, created_at, delete_after${extraColumns.map((c) => `, ${c}`).join("")})
                      select s.id, $4, $6, t.ts, t.ts + interval '30 days'${extraValues.map((_, i) => `, $${7 + i}`).join("")} from s, t returning *),
              upd as (update public.chat_sessions set last_activity_at = (select ts from t), delete_after = (select ts from t) + interval '30 days'
                       where id in (select id from s))
         select * from ins`,
        [owner.clientId, owner.studentId, sessionId, role, now, content, ...extraValues],
      );
      if (!rows[0]) throw new Error("no such chat");
      return toMessage(rows[0]);
    },
    addFile: async (owner, sessionId, file, now) => {
      const rows = await this.db.query<Row>(
        `insert into public.chat_files (session_id, message_id, storage_path, bytes, content_type, created_at, delete_after)
         select s.id, null, $4, $5, $6, $7, $7::timestamptz + interval '7 days' from public.chat_sessions s where ${OWN} and s.id = $3
         returning *`,
        [owner.clientId, owner.studentId, sessionId, file.storagePath, file.bytes, file.contentType, now],
      );
      if (!rows[0]) throw new Error("no such chat");
      return toChatFile(rows[0]);
    },
    attachFiles: async (owner, sessionId, fileIds, messageId) => {
      if (fileIds.length === 0) return 0;
      const rows = await this.db.query<Row>(
        `update public.chat_files f set message_id = $5
           from public.chat_sessions s
          where f.session_id = s.id and ${OWN} and s.id = $3 and f.id = any($4::uuid[]) and f.message_id is null
            and exists (select 1 from public.chat_messages m where m.id = $5 and m.session_id = s.id)
         returning f.id`,
        [owner.clientId, owner.studentId, sessionId, fileIds, messageId],
      );
      return rows.length;
    },
    listFiles: async (owner, sessionId) => {
      const rows = await this.db.query<Row>(`select f.* from public.chat_files f join public.chat_sessions s on s.id = f.session_id where ${OWN} and s.id = $3 order by f.created_at`, [owner.clientId, owner.studentId, sessionId]);
      return rows.map(toChatFile);
    },
    getFile: async (owner, fileId) => {
      const rows = await this.db.query<Row>(`select f.* from public.chat_files f join public.chat_sessions s on s.id = f.session_id where ${OWN} and f.id = $3`, [owner.clientId, owner.studentId, fileId]);
      return rows[0] ? toChatFile(rows[0]) : null;
    },
    deleteUnattachedFile: async (owner, fileId) => {
      // Chunks go with the file (on delete cascade).
      const rows = await this.db.query<Row>(
        `delete from public.chat_files f using public.chat_sessions s
          where f.session_id = s.id and ${OWN} and f.id = $3 and f.message_id is null
         returning f.*`,
        [owner.clientId, owner.studentId, fileId],
      );
      return rows[0] ? toChatFile(rows[0]) : null;
    },
    getUnattachedFiles: async (owner, sessionId, fileIds) => {
      if (fileIds.length === 0) return [];
      const rows = await this.db.query<Row>(
        `select f.* from public.chat_files f join public.chat_sessions s on s.id = f.session_id where ${OWN} and s.id = $3 and f.id = any($4::uuid[]) and f.message_id is null order by f.created_at`,
        [owner.clientId, owner.studentId, sessionId, fileIds],
      );
      return rows.map(toChatFile);
    },
    setFileReading: async (owner, fileId, reading) => {
      const rows = await this.db.query<Row>(
        `update public.chat_files f set extracted_text = $4, pages = $5
           from public.chat_sessions s
          where f.session_id = s.id and ${OWN} and f.id = $3
         returning f.id`,
        [owner.clientId, owner.studentId, fileId, reading.extractedText.slice(0, 32_000), reading.pages],
      );
      return rows.length === 1;
    },
    replaceFileChunks: async (owner, sessionId, fileId, chunks, now) => {
      if (chunks.length === 0) return 0;
      const allowed = await this.db.query<Row>(
        `select f.id from public.chat_files f join public.chat_sessions s on s.id = f.session_id where ${OWN} and s.id = $3 and f.id = $4`,
        [owner.clientId, owner.studentId, sessionId, fileId],
      );
      if (allowed.length === 0) return 0;
      // Replace: the file's previous chunks go first, then this set. A failed insert leaves nothing behind for a retry to duplicate.
      await this.db.query(`delete from public.chat_file_chunks where file_id = $1`, [fileId]);
      const rows = await this.db.query<Row>(
        `insert into public.chat_file_chunks (file_id, session_id, page, label, ordinal, text, model, digest, dimension, chunk_config_version, embedding, created_at)
         select $1, $2, v.page, v.label, v.ordinal, v.text, v.model, v.digest, v.dimension, v.version, v.embedding::real[], $3
           from unnest($4::int[], $5::text[], $6::int[], $7::text[], $8::text[], $9::text[], $10::int[], $11::text[], $12::text[]) as v(page, label, ordinal, text, model, digest, dimension, version, embedding)
         returning id`,
        [
          fileId, sessionId, now,
          chunks.map((c) => c.page), chunks.map((c) => c.label), chunks.map((c) => c.ordinal), chunks.map((c) => c.text.slice(0, 4000)),
          chunks.map((c) => c.model), chunks.map((c) => c.digest), chunks.map((c) => c.embedding.length), chunks.map((c) => c.chunkConfigVersion),
          chunks.map((c) => `{${c.embedding.map((n) => (Number.isFinite(n) ? n : 0)).join(",")}}`),
        ],
      );
      return rows.length;
    },
    listFileChunks: async (owner, sessionId, options = {}) => {
      const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
      const rows = await this.db.query<Row>(
        `select c.* from public.chat_file_chunks c
           join public.chat_sessions s on s.id = c.session_id
           join public.chat_files f on f.id = c.file_id
          where ${OWN} and s.id = $3 and ($4::uuid is null or c.file_id = $4)
          order by f.created_at, c.ordinal limit $5`,
        [owner.clientId, owner.studentId, sessionId, options.fileId ?? null, limit],
      );
      return rows.map(toChatChunk);
    },
    deleteFileChunks: async (owner, sessionId, fileId) => {
      const rows = await this.db.query<Row>(
        `delete from public.chat_file_chunks c using public.chat_sessions s, public.chat_files f
          where c.session_id = s.id and c.file_id = f.id and ${OWN} and s.id = $3 and c.file_id = $4
          returning c.id`,
        [owner.clientId, owner.studentId, sessionId, fileId],
      );
      return rows.length;
    },
    requestDeletion: async (owner, sessionId, now) => {
      const rows = await this.db.query<Row>(`update public.chat_sessions s set deletion_requested_at = $4 where ${OWN} and s.id = $3 returning s.id`, [owner.clientId, owner.studentId, sessionId, now]);
      return rows.length > 0;
    },
    requestDeletionAll: async (owner, now) => {
      const rows = await this.db.query<Row>(`update public.chat_sessions s set deletion_requested_at = $3 where ${OWN} returning s.id`, [owner.clientId, owner.studentId, now]);
      return rows.length;
    },
    requestLearnerDeletionAll: async (clientId, studentId, now) => {
      const rows = await this.db.query<Row>(
        `update public.chat_sessions s set deletion_requested_at = $3
          where s.client_id = $1 and s.student_id = $2 and s.deletion_requested_at is null
            and exists (select 1 from public.client_students cs where cs.client_id = $1 and cs.student_id = $2 and cs.status = 'active')
         returning s.id`,
        [clientId, studentId, now],
      );
      return rows.length;
    },
    exportAll: async (owner, now): Promise<ChatExport> => {
      const sessions = await this.db.query<Row>(`select * from public.chat_sessions s where ${OWN} order by s.created_at`, [owner.clientId, owner.studentId]);
      const messages = await this.db.query<Row>(
        `select m.* from public.chat_messages m join public.chat_sessions s on s.id = m.session_id where ${OWN} order by m.created_at, m.id`,
        [owner.clientId, owner.studentId],
      );
      const files = await this.db.query<Row>(`select f.* from public.chat_files f join public.chat_sessions s on s.id = f.session_id where ${OWN} order by f.created_at`, [owner.clientId, owner.studentId]);
      return {
        exportedAt: now.toISOString(),
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          createdAt: new Date(s.created_at).toISOString(),
          lastActivityAt: new Date(s.last_activity_at).toISOString(),
          messages: messages.filter((m) => m.session_id === s.id).map((m) => ({ role: m.role, content: m.content, createdAt: new Date(m.created_at).toISOString() })),
          files: files.filter((f) => f.session_id === s.id).map((f) => ({ contentType: f.content_type, bytes: Number(f.bytes), createdAt: new Date(f.created_at).toISOString(), deleteAfter: new Date(f.delete_after).toISOString() })),
        })),
      };
    },
    dueStoragePaths: async (now) => {
      const rows = await this.db.query<Row>(
        `select f.storage_path from public.chat_files f join public.chat_sessions s on s.id = f.session_id
          where f.delete_after <= $1 or s.deletion_requested_at is not null or s.delete_after <= $1`,
        [now],
      );
      return [...new Set(rows.map((r) => r.storage_path as string))];
    },
    purgeDue: async (now) => {
      const counts = await this.db.query<Row>(
        `with due as (select id from public.chat_sessions where deletion_requested_at is not null or delete_after <= $1)
         select (select count(*)::int from due) as sessions,
                (select count(*)::int from public.chat_messages where session_id in (select id from due) or delete_after <= $1) as messages,
                (select count(*)::int from public.chat_files where session_id in (select id from due) or delete_after <= $1) as files`,
        [now],
      );
      await this.db.query(`delete from public.chat_files where delete_after <= $1`, [now]);
      await this.db.query(`delete from public.chat_messages where delete_after <= $1`, [now]);
      await this.db.query(`delete from public.chat_sessions where deletion_requested_at is not null or delete_after <= $1`, [now]);
      const c = counts[0] ?? {};
      return { sessions: c.sessions ?? 0, messages: c.messages ?? 0, files: c.files ?? 0 };
    },
    incrementUsage: async (clientId, kind, windowStart, by) => {
      const rows = await this.db.query<Row>(
        `insert into public.usage_counters (client_id, kind, window_start, count) values ($1, $2, $3, $4)
         on conflict (client_id, kind, window_start) do update set count = public.usage_counters.count + excluded.count returning count`,
        [clientId, kind, windowStart, by],
      );
      return rows[0]?.count ?? by;
    },
    usageCount: async (clientId, kind, windowStart) => {
      const rows = await this.db.query<Row>(`select count from public.usage_counters where client_id = $1 and kind = $2 and window_start = $3`, [clientId, kind, windowStart]);
      return rows[0]?.count ?? 0;
    },
  };

  papers: PaperJobRepository = {
    create: async (owner, input, worker, now) => {
      const rows = await this.db.query<Row>(
        `insert into public.paper_jobs (client_id, student_id, session_id, file_id, scheme_file_id, kind, state, attempts, lease_owner, lease_expires_at, created_at, updated_at, expires_at, blank_file_id)
         select $1, $2::uuid, $3, $4, $5, $6, 'extracting', 1, $7, $8, $9, $9, $10, $11::uuid
          where exists (select 1 from public.chat_sessions s where s.id = $3 and s.client_id = $1 and s.student_id is not distinct from $2::uuid and s.deletion_requested_at is null)
         on conflict (client_id) where state in ('extracting', 'solving') do nothing
         returning *`,
        [owner.clientId, owner.studentId, input.sessionId, input.fileId, input.schemeFileId, input.kind, worker.id, new Date(now.getTime() + worker.leaseMs), now, new Date(now.getTime() + PAPER_JOB_DAYS * 86_400_000), input.blankFileId ?? null],
      );
      if (rows[0]) return { ok: true, job: toPaperJob(rows[0]) };
      const mine = await this.db.query<Row>(`select 1 from public.chat_sessions s where s.id = $3 and ${OWN}`, [owner.clientId, owner.studentId, input.sessionId]);
      return { ok: false, code: mine[0] ? "busy" : "not_found" };
    },
    get: async (owner, id) => {
      const rows = await this.db.query<Row>(`select * from public.paper_jobs where id = $3 and client_id = $1 and student_id is not distinct from $2::uuid`, [owner.clientId, owner.studentId, id]);
      return rows[0] ? toPaperJob(rows[0]) : null;
    },
    getById: async (id) => {
      const rows = await this.db.query<Row>(`select * from public.paper_jobs where id = $1`, [id]);
      return rows[0] ? toPaperJob(rows[0]) : null;
    },
    amend: async (scope, jobId, questionId, change, now) => {
      const staff = scope.kind === "staff";
      const owner = scope.kind === "owner" ? scope.owner : { clientId: null, studentId: null };
      let rows: Row[];
      try {
        rows = await this.db.query<Row>(
          `with j as (
             select id, checkpoints, updated_at from public.paper_jobs
              where id = $1 and state = 'done' and ($2::boolean or (client_id = $3 and student_id is not distinct from $4::uuid)) and jsonb_exists(checkpoints, $5)
                for update),
           cur as (select coalesce(max(version), 0) as v from public.paper_assessment_versions where job_id = $1 and question_id = $5),
           base as (
             insert into public.paper_assessment_versions (job_id, question_id, version, kind, actor_kind, value, created_at)
             select $1, $5, 1, 'ai', 'system', j.checkpoints -> $5, j.updated_at from j, cur where cur.v = 0 returning version),
           nxt as (
             insert into public.paper_assessment_versions (job_id, question_id, version, kind, actor_kind, actor_id, value, note, created_at)
             select $1, $5, greatest(cur.v, 1) + 1, $6, $7, $8::uuid, $9::jsonb, $10, $11 from j, cur returning version),
           upd as (
             update public.paper_jobs set checkpoints = checkpoints || jsonb_build_object($5::text, $9::jsonb), updated_at = $11
              where id = $1 and exists (select 1 from nxt) returning id)
           select (select version from nxt) as version`,
          [jobId, staff, owner.clientId, owner.studentId, questionId, change.kind, change.actorKind, change.actorId, JSON.stringify(change.value), change.note, now],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") return { ok: false, code: "conflict" };
        throw error;
      }
      if (rows[0]?.version) return { ok: true, version: Number(rows[0].version) };
      const job = await this.db.query<Row>(`select state, jsonb_exists(checkpoints, $2) as has from public.paper_jobs where id = $1 and ($3::boolean or (client_id = $4 and student_id is not distinct from $5::uuid))`, [jobId, questionId, staff, owner.clientId, owner.studentId]);
      if (!job[0]) return { ok: false, code: "not_found" };
      return { ok: false, code: job[0].state !== "done" ? "not_done" : "no_question" };
    },
    setResult: async (scope, id, result, now) => {
      const staff = scope.kind === "staff";
      const owner = scope.kind === "owner" ? scope.owner : { clientId: null, studentId: null };
      const rows = await this.db.query<Row>(
        `update public.paper_jobs set result_file_id = $6::uuid,
           page_count = case when $7::boolean then $8::integer else page_count end,
           worked_pages = coalesce($9::integer[], worked_pages), updated_at = $10
          where id = $1 and state = 'done' and ($2::boolean or (client_id = $3 and student_id is not distinct from $4::uuid)) returning id`,
        [id, staff, owner.clientId, owner.studentId, null, result.resultFileId, result.pageCount !== undefined, result.pageCount ?? null, result.workedPages ?? null, now],
      );
      return rows.length === 1;
    },
    versions: async (scope, jobId, questionId) => {
      const staff = scope.kind === "staff";
      const owner = scope.kind === "owner" ? scope.owner : { clientId: null, studentId: null };
      const rows = await this.db.query<Row>(
        `select v.* from public.paper_assessment_versions v join public.paper_jobs j on j.id = v.job_id
          where v.job_id = $1 and v.question_id = $2 and ($3::boolean or (j.client_id = $4 and j.student_id is not distinct from $5::uuid)) order by v.version`,
        [jobId, questionId, staff, owner.clientId, owner.studentId],
      );
      return rows.map((r): AssessmentVersion => ({ jobId: r.job_id, questionId: r.question_id, version: Number(r.version), kind: r.kind, actorKind: r.actor_kind, actorId: r.actor_id, value: json<unknown>(r.value, null), note: r.note, createdAt: new Date(r.created_at) }));
    },
    listForSession: async (owner, sessionId) => {
      const rows = await this.db.query<Row>(
        `select * from public.paper_jobs where client_id = $1 and student_id is not distinct from $2::uuid and session_id = $3 order by created_at`,
        [owner.clientId, owner.studentId, sessionId],
      );
      return rows.map(toPaperJob);
    },
    activeForFamily: async (clientId) => {
      const rows = await this.db.query<Row>(`select * from public.paper_jobs where client_id = $1 and state in ('extracting', 'solving')`, [clientId]);
      return rows[0] ? toPaperJob(rows[0]) : null;
    },
    begin: async (owner, id, input, worker, now) => {
      let rows: Row[];
      try {
        rows = await this.db.query<Row>(
          `update public.paper_jobs set state = 'solving', mode = $4, selected_ids = $5::jsonb, lease_owner = $6, lease_expires_at = $7, attempts = 1, progress = '[]'::jsonb, updated_at = $8
            where id = $3 and client_id = $1 and student_id is not distinct from $2::uuid and state = 'ready' returning *`,
          [owner.clientId, owner.studentId, id, input.mode, input.selectedIds === null ? null : JSON.stringify(input.selectedIds), worker.id, new Date(now.getTime() + worker.leaseMs), now],
        );
      } catch (error) {
        // The one-active-job index: another job of the family is running.
        if ((error as { code?: string }).code === "23505") return { ok: false, code: "busy" };
        throw error;
      }
      if (rows[0]) return { ok: true, job: toPaperJob(rows[0]) };
      const existing = await this.db.query<Row>(`select 1 from public.paper_jobs where id = $3 and client_id = $1 and student_id is not distinct from $2::uuid`, [owner.clientId, owner.studentId, id]);
      return { ok: false, code: existing[0] ? "not_ready" : "not_found" };
    },
    save: async (id, workerId, patch, worker, now) => {
      const json = (value: unknown) => (value === undefined ? null : JSON.stringify(value));
      const rows = await this.db.query<Row>(
        `update public.paper_jobs set
           questions = coalesce($3::jsonb, questions),
           progress = coalesce($4::jsonb, progress),
           message = case when $5::boolean then $6 else message end,
           checkpoints = case when $7::text is null then checkpoints else checkpoints || jsonb_build_object($7::text, $8::jsonb) end,
           lease_expires_at = $9, updated_at = $10
          where id = $1 and lease_owner = $2 and state in ('extracting', 'solving') returning *`,
        [id, workerId, json(patch.questions), json(patch.progress), patch.message !== undefined, patch.message ?? null, patch.checkpoint?.questionId ?? null, json(patch.checkpoint?.value), new Date(now.getTime() + worker.leaseMs), now],
      );
      return rows[0] ? toPaperJob(rows[0]) : null;
    },
    finish: async (id, workerId, outcome, now) => {
      const rows = await this.db.query<Row>(
        `update public.paper_jobs set state = $3,
           message = case when $4::boolean then $5 else message end,
           result_file_id = case when $6::boolean then $7::uuid else result_file_id end,
           page_count = case when $8::boolean then $9::integer else page_count end,
           worked_pages = coalesce($10::integer[], worked_pages),
           lease_owner = null, lease_expires_at = null, updated_at = $11
          where id = $1 and lease_owner = $2 and state in ('extracting', 'solving') returning id`,
        [id, workerId, outcome.state, outcome.message !== undefined, outcome.message ?? null, outcome.resultFileId !== undefined, outcome.resultFileId ?? null, outcome.pageCount !== undefined, outcome.pageCount ?? null, outcome.workedPages ?? null, now],
      );
      return rows.length === 1;
    },
    cancel: async (owner, id, now) => {
      await this.db.query(
        `update public.paper_jobs set state = 'cancelled', message = 'Cancelled.', lease_owner = null, lease_expires_at = null, updated_at = $4
          where id = $3 and client_id = $1 and student_id is not distinct from $2::uuid and state in ('extracting', 'solving', 'ready')`,
        [owner.clientId, owner.studentId, id, now],
      );
      const mine = await this.db.query<Row>(`select 1 from public.paper_jobs where id = $3 and client_id = $1 and student_id is not distinct from $2::uuid`, [owner.clientId, owner.studentId, id]);
      return mine.length === 1;
    },
    claimStale: async (worker, now, maxAttempts = PAPER_JOB_MAX_ATTEMPTS) => {
      const failed = await this.db.query<Row>(
        `update public.paper_jobs set state = 'failed', message = 'Something went wrong with that paper more than once. Please try again.', lease_owner = null, lease_expires_at = null, updated_at = $1
          where state in ('extracting', 'solving') and lease_expires_at <= $1 and attempts >= $2 returning id`,
        [now, maxAttempts],
      );
      const claimed = await this.db.query<Row>(
        `update public.paper_jobs set attempts = attempts + 1, lease_owner = $2, lease_expires_at = $3, updated_at = $1
          where state in ('extracting', 'solving') and lease_expires_at <= $1 returning *`,
        [now, worker.id, new Date(now.getTime() + worker.leaseMs)],
      );
      return { claimed: claimed.map(toPaperJob), failed: failed.length };
    },
    purgeDue: async (now) => {
      const rows = await this.db.query<Row>(`delete from public.paper_jobs where expires_at <= $1 and state not in ('extracting', 'solving') returning id`, [now]);
      return rows.length;
    },
  };

  downloads: DownloadRepository = {
    record: async (event) => {
      await this.db.query(`insert into public.download_events (client_id, resource_id, at, flags) values ($1,$2,$3,$4)`, [event.clientId, event.resourceId, event.at, event.flags ?? []]);
    },
    countSince: async (clientId, since) => {
      const rows = await this.db.query<Row>(`select count(*)::int as n from public.download_events where client_id = $1 and at >= $2`, [clientId, since]);
      return rows[0]?.n ?? 0;
    },
    countForResourceSince: async (clientId, resourceId, since) => {
      const rows = await this.db.query<Row>(`select count(*)::int as n from public.download_events where client_id = $1 and resource_id = $2 and at >= $3`, [clientId, resourceId, since]);
      return rows[0]?.n ?? 0;
    },
  };
}
