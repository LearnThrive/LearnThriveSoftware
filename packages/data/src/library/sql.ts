import { deriveEntitlement, type AdminGrantRecord, type PlanInterval, type SubscriptionRecord, type SubscriptionStatus } from "./billing";
import type { AccessRepository, AccountRepository, BillingRepository, DownloadRepository, LibraryStore, ResourceRepository, SqlExecutor } from "./ports";
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
      const account: Account = { profileId: row.id, role: row.role, displayName: row.display_name, adultConfirmed: row.adult_confirmed_at !== null, clientId: row.client_id };
      return account;
    },
    ensureClient: async (profileId) => {
      const rows = await this.db.query<Row>(
        `with ins as (
           insert into public.clients (owner_profile_id)
           select id from public.profiles where id = $1
           on conflict (owner_profile_id) do nothing returning id)
         select id from ins union all select id from public.clients where owner_profile_id = $1 limit 1`,
        [profileId],
      );
      if (!rows[0]) throw new Error("no such profile");
      return rows[0].id;
    },
    getEmail: async (profileId) => {
      const rows = await this.db.query<Row>(`select email from auth.users where id = $1`, [profileId]);
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
                    where cs.client_id = $1 and t.status = 'ACTIVE') as enrolled,
           exists (select 1 from public.entitlements e where e.client_id = $1 and e.source = 'subscription'
                      and e.starts_at <= $2 and (e.ends_at is null or e.ends_at > $2)) as subscription,
           exists (select 1 from public.entitlements e where e.client_id = $1 and e.source = 'admin_grant'
                      and e.starts_at <= $2 and (e.ends_at is null or e.ends_at > $2)) as admin_grant`,
        [clientId, now],
      );
      const r = rows[0] ?? {};
      return { enrolled: r.enrolled === true, subscription: r.subscription === true, adminGrant: r.admin_grant === true };
    },
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
