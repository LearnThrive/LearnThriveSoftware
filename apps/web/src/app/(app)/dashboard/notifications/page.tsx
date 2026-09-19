import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { markNotificationReadAction } from "@/lib/actions/notifications";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatLessonDateTime, formatRelative } from "@/lib/format";

export const metadata: Metadata = createMetadata({
  title: "Notifications",
  description: "Everything LearnThrive has let you know about.",
  path: "/dashboard/notifications",
});

export default async function NotificationsPage() {
  const user = await requireSession();
  const notifications = await getDataProvider().notifications.forUser(user.id);
  const unread = notifications.filter((notification) => !notification.read);

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Notifications"
        description={unread.length > 0
          ? `${unread.length} unread.`
          : "You're all caught up."}
      />

      <Card>
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
