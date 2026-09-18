import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { markNotificationReadAction } from "@/lib/actions/notifications";
import { formatInTimeZone } from "@/lib/scheduling/timezone";

export const metadata: Metadata = createMetadata({
  title: "Notifications",
  description: "Your notifications.",
  path: "/dashboard/notifications",
});

export default async function NotificationsPage() {
  const user = await requireSession();
  const notifications = await getDataProvider().notifications.forUser(user.id);

  return (
    <div className="dashboard-page">
      <h1>Notifications</h1>
      <ul className="people-list">
        {notifications.length === 0 && <li className="people-list__empty">No notifications yet.</li>}
        {notifications.map((n) => (
          <li key={n.id}>
            <div>
              {n.link ? <Link href={n.link}>{n.message}</Link> : n.message}
              <span className="people-list__meta">{formatInTimeZone(n.createdAt, "Europe/London", { dateStyle: "medium", timeStyle: "short" })}{n.read ? "" : " · unread"}</span>
            </div>
            {!n.read && (
              <form action={markNotificationReadAction} style={{ marginLeft: "auto" }}>
                <input type="hidden" name="id" value={n.id} />
                <button type="submit" className="button-text">Mark read</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
