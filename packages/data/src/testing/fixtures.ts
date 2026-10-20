/**
 * Small seed helpers for tests that run on the PGlite harness (./pglite.ts).
 *
 *   const alice = await createFamily(db, { name: "Alice", students: ["Ava"] });
 *   // -> { userId, clientId, studentIds: [...] }   adult profile + family account + student profiles,
 *   //    created the way the app does it (as the signed-in user, through RLS)
 *
 *   const id = await createResource(db, { title: "Quadratic equations", published: true });
 *   // -> resource id; defaults are a valid published members-only GCSE Maths worksheet
 */
import type { TestDb } from "./pglite";

export interface Family {
  userId: string;
  clientId: string;
  studentIds: string[];
}

export async function createFamily(
  db: TestDb,
  options: { name?: string; students?: string[]; role?: "ADMIN" | "TUTOR" | "CLIENT" | "STUDENT" } = {},
): Promise<Family> {
  const userId = await db.createUser({ displayName: options.name ?? "Parent", adult: true, role: options.role });
  const clientId = await db.asUser(userId, async (q) => {
    const rows = await q.query<{ id: string }>(
      "insert into public.clients (owner_profile_id) values ($1) returning id",
      [userId],
    );
    return rows[0]!.id;
  });
  const studentIds: string[] = [];
  for (const name of options.students ?? []) {
    studentIds.push(
      await db.asUser(userId, async (q) => {
        const rows = await q.query<{ id: string }>(
          "insert into public.students (client_id, display_name) values ($1, $2) returning id",
          [clientId, name],
        );
        return rows[0]!.id;
      }),
    );
  }
  return { userId, clientId, studentIds };
}

export interface ResourceSeed {
  slug?: string;
  title?: string;
  description?: string;
  subject?: string;
  level?: string;
  exam_board?: string | null;
  topic?: string;
  resource_type?: string;
  year_group?: string | null;
  tags?: string[];
  access_tier?: string;
  authorship?: string;
  /** true = published a minute ago (default); false = draft; or an explicit ISO timestamp. */
  published?: boolean | string;
}

let resourceCounter = 0;

export async function createResource(db: TestDb, o: ResourceSeed = {}): Promise<string> {
  resourceCounter += 1;
  const published =
    o.published === undefined || o.published === true
      ? new Date(Date.now() - 60_000).toISOString()
      : o.published === false
        ? null
        : o.published;
  return db.asService(async (q) => {
    const rows = await q.query<{ id: string }>(
      `insert into public.resources
         (slug, title, description, subject, level, exam_board, topic, resource_type, year_group, tags, access_tier, authorship, published_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning id`,
      [
        o.slug ?? `resource-${resourceCounter}`,
        o.title ?? `Resource ${resourceCounter}`,
        o.description ?? "",
        o.subject ?? "Maths",
        o.level ?? "GCSE",
        o.exam_board ?? null,
        o.topic ?? "Algebra",
        o.resource_type ?? "worksheet",
        o.year_group ?? null,
        o.tags ?? [],
        o.access_tier ?? "members",
        o.authorship ?? "LearnThrive Tuition",
        published,
      ],
    );
    return rows[0]!.id;
  });
}
