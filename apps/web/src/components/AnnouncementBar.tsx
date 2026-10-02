import Link from "next/link";
import { Container } from "@/components/Container";
import { announcement as configured, type Announcement } from "@/lib/site";

/**
 * The announcement bar (lib/site.ts `announcement`). Renders nothing while that is null, which is the
 * default; a message and one optional link when the owner sets one. Takes the config as a prop only so
 * a story or test can show it on without editing site data.
 */
export function AnnouncementBar({ announcement = configured }: { announcement?: Announcement | null }) {
  if (!announcement) return null;
  return (
    <div className="announcement-bar" role="region" aria-label="Announcement">
      <Container className="announcement-bar__inner">
        <p>
          {announcement.text}
          {announcement.href && announcement.linkLabel ? (
            <>
              {" "}
              <Link href={announcement.href}>{announcement.linkLabel}</Link>
            </>
          ) : null}
        </p>
      </Container>
    </div>
  );
}
