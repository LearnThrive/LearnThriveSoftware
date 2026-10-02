import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { requireRoleForApi } from "@/lib/auth/guard";
import { buildIcs, type IcsLesson } from "@/lib/calendar/ics";
import { formatLessonDayTime, formatTimeRange } from "@/lib/format";
import { visibleLessonsFor } from "@/lib/scheduling/visibleLessons";
import { siteConfig } from "@/lib/site";

/**
 * "Add to calendar" for one lesson, or for the rest of its series with `?series=1` (plan15 feature A4).
 *
 * VISIBILITY: the lessons offered come only from `visibleLessonsFor`, the same reader every page uses, so a
 * person can download exactly the lessons they can already see and a lesson they cannot see is a 404 that
 * looks the same as one that does not exist (no IDOR, no existence oracle). The user comes from the session
 * cookie; nothing in the URL or query can widen what is returned. For a series, only the visible lessons that
 * share the requested lesson's recurrence id, never a cancelled one and none in the past.
 *
 * The file contains the minimum (lib/calendar/ics.ts): no notes, no report text, no other people's names.
 */
export const dynamic = "force-dynamic";

const NOT_FOUND = () => Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireRoleForApi(["ADMIN", "TUTOR", "CLIENT", "STUDENT"]);
  if (!user) return Response.json({ error: "Sign in to download this lesson." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const { id } = await params;
  const data = getDataProvider();
  const visible = await visibleLessonsFor(data, user);
  const lesson = visible.find((l) => l.id === id);
  if (!lesson) return NOT_FOUND();

  const wantsSeries = new URL(request.url).searchParams.get("series") === "1" && Boolean(lesson.recurrenceId);
  const nowIso = new Date().toISOString();
  const chosen = wantsSeries
    ? visible
        .filter((l) => l.recurrenceId === lesson.recurrenceId && l.status !== "CANCELLED" && l.startAt >= nowIso)
        .sort((a, b) => a.startAt.localeCompare(b.startAt))
    : [lesson];

  const tutorNames = new Map((await data.tutors.list()).map((t) => [t.id, t.name]));
  const entries: IcsLesson[] = chosen.map((l) => ({
    id: l.id,
    title: l.title,
    subject: l.subject,
    startAt: l.startAt,
    durationMinutes: l.durationMinutes,
    online: l.locationType === "ONLINE",
    ...(l.location ? { location: l.location } : {}),
    tutorName: tutorNames.get(l.tutorId),
    cancelled: l.status === "CANCELLED",
    url: `${siteConfig.url}/dashboard/lessons/${l.id}`,
    whenLocal: `${formatLessonDayTime(l.startAt)}, ${formatTimeRange(l.startAt, l.durationMinutes)} (UK time)`,
  }));

  const day = lesson.startAt.slice(0, 10);
  const filename = wantsSeries ? `learnthrive-lesson-series-${day}.ics` : `learnthrive-lesson-${day}.ics`;
  return new Response(buildIcs(entries), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
