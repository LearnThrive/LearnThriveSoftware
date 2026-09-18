import Link from "next/link";
import { Icon } from "@/components/Icon";
import type { IconName } from "@/lib/site";

type SubjectCardProps = {
  title: string;
  stage: string;
  summary: string;
  slug: string;
  icon: IconName;
  path: string;
  ctaLabel: string;
};

export function SubjectCard({
  title,
  stage,
  summary,
  slug,
  icon,
  path,
  ctaLabel,
}: SubjectCardProps) {
  return (
    <article className={`subject-card subject-card--${slug}`}>
      <div className="subject-card__header">
        <span className="subject-card__icon">
          <Icon name={icon} />
        </span>
        <span className="subject-card__stage">{stage}</span>
      </div>
      <h3>{title}</h3>
      <p>{summary}</p>
      <Link href={path}>
        {ctaLabel}
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 10h11M11 6l4 4-4 4" />
        </svg>
      </Link>
    </article>
  );
}
