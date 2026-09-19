import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";

/**
 * One linked record as a row — an assignment, a report, anything that is "a titled thing with a
 * line of context and usually a status".
 *
 * This markup had been hand-written ten times across eight files (assignments, reports, and every
 * profile page), which is how the rows drifted apart: the ones on profile pages had no chevron
 * while the otherwise-identical lesson and person rows beside them did, so equally clickable rows
 * advertised themselves differently on the same screen. Everything shared lives here now, and the
 * chevron comes with it (plan7: reusable primitives over repeated raw styles).
 */
export function RecordRow({ href, title, meta, excerpt, aside, avatarName }: {
  href: string;
  title: ReactNode;
  /** The supporting line — who it's with, when, whatever identifies it. */
  meta?: ReactNode;
  /** An optional longer snippet, clamped to two lines (report summaries use this). */
  excerpt?: ReactNode;
  /** Trailing content, almost always a <StatusBadge>. */
  aside?: ReactNode;
  /** When set, the row leads with this person's initials avatar. */
  avatarName?: string;
}) {
  return (
    <li className="record-list__item">
      <Link href={href} className="record-list__link">
        {avatarName && <Avatar name={avatarName} size="md" />}
        <span className="record-list__body">
          <span className="record-list__title">{title}</span>
          {meta && <span className="record-list__meta">{meta}</span>}
          {excerpt && <span className="record-list__excerpt">{excerpt}</span>}
        </span>
        <span className="record-list__aside">
          {aside}
          <ChevronRight size={16} aria-hidden="true" className="record-list__chevron" />
        </span>
      </Link>
    </li>
  );
}

export function RecordList({ children }: { children: ReactNode }) {
  return <ul className="record-list">{children}</ul>;
}
