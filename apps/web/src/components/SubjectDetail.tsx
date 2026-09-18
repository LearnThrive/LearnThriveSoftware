import { Icon } from "@/components/Icon";
import { ButtonLink } from "@/components/ButtonLink";
import type { IconName } from "@/lib/site";

type SubjectDetailProps = {
  slug: string;
  title: string;
  stage: string;
  icon: IconName;
  summary: string;
  detail: string;
  focus: readonly string[];
  path: string;
  ctaLabel: string;
  index: number;
};

export function SubjectDetail({
  slug,
  title,
  stage,
  icon,
  summary,
  detail,
  focus,
  path,
  ctaLabel,
  index,
}: SubjectDetailProps) {
  return (
    <article
      className={`subject-detail ${index % 2 === 1 ? "subject-detail--reverse" : ""}`}
      id={slug}
    >
      <div className={`subject-detail__visual subject-detail__visual--${slug}`}>
        <span className="subject-detail__number" aria-hidden="true">
          0{index + 1}
        </span>
        <Icon name={icon} />
        <strong>{stage}</strong>
      </div>
      <div className="subject-detail__copy">
        <p className="eyebrow">{stage}</p>
        <h2>{title}</h2>
        <p className="subject-detail__summary">{summary}</p>
        <p>{detail}</p>
        <ul className="tag-list" aria-label={`${title} areas of focus`}>
          {focus.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <ButtonLink href={path}>{ctaLabel}</ButtonLink>
      </div>
    </article>
  );
}
