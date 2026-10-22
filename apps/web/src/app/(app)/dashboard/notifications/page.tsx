import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@/lib/data/provider";
import { markNotificationReadAction } from "@/lib/actions/notifications";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatLessonDateTime, formatRelative } from "@/lib/format";
import { lessonsStartingSoon, reminderWording } from "@/lib/notifications/derivedReminders";
import { visibleLessonsFor } from "@/lib/scheduling/visibleLessons";

export const metadata: Metadata = createMetadata({
  title: "Notifications",
  description: "Everything LearnThrive has let you know about.",
  path: "/dashboard/notifications",
});

export default async function NotificationsPage() {
  const user = await requireSession();
  const notifications = await getDataProvider().notifications.forUser(user.id);
  const unread = notifications.filter((notification) => !notification.read);
  // Derived when the page is opened, not stored: see lib/notifications/derivedReminders.ts.
  const startingSoon = lessonsStartingSoon(await visibleLessonsFor(getDataProvider(), user), new Date());

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Notifications"
        description={unread.length > 0
          ? `${unread.length} unread.`
          : "You're all caught up."}
      />

      {startingSoon.length > 0 && (
        <Card className="starting-soon">
          <CardHeader
            title="Starting soon"
            description="Worked out when you open this page. LearnThrive does not send an email or message about it."
          />
          <CardBody>
            <ul className="starting-soon__list">
              {startingSoon.map((reminder) => (
                <li key={reminder.lessonId}>
                  <Link href={`/dashboard/lessons/${reminder.lessonId}`}>{reminder.title}</Link>
                  <span>{reminderWording(reminder.minutesUntil)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card className={notifications.length === 0 ? "card--empty" : ""}>
        {notifications.length === 0 ? (
          <EmptyState
            icon={<Bell size={22} />}
            title="No notifications yet"
            description="Rescheduled lessons, new reports and anything else needing your attention will appear here."
          />
        ) : (
          <ul className="notification-list">
            {notifications.map((notification) => (
              <li key={notification.id} className={`notification ${notification.read ? "" : "notification--unread"}`}>
                <span className="notification__dot" aria-hidden="true" />
                <div className="notification__body">
                  {notification.link
                    ? <Link href={notification.link} className="notification__message">{notification.message}</Link>
                    : <p className="notification__message">{notification.message}</p>}
                  <p className="notification__meta">
                    <time dateTime={notification.createdAt} title={formatLessonDateTime(notification.createdAt)}>
                      {formatRelative(notification.createdAt)}
                    </time>
                    {!notification.read && <span className="notification__unread-tag">Unread</span>}
                  </p>
                </div>
                {!notification.read && (
                  <form action={markNotificationReadAction}>
                    <input type="hidden" name="id" value={notification.id} />
                    <button type="submit" className="btn btn--ghost btn--sm">Mark read</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
