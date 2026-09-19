import Link from "next/link";
import type { ReactNode } from "react";

/** The one surface primitive: a white card on the neutral app background (plan6 section 30 —
 * mint is an accent here, never the whole page). */
export function Card({ children, className = "", as: Tag = "section" }: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "li";
}) {
  return <Tag className={`card ${className}`.trim()}>{children}</Tag>;
}

export function CardHeader({ title, description, action }: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="card__header">
      <div>
        <h2 className="card__title">{title}</h2>
        {description && <p className="card__description">{description}</p>}
      </div>
      {action && <div className="card__action">{action}</div>}
    </header>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card__body ${className}`.trim()}>{children}</div>;
}

/** A labelled figure — the dashboard "stat tile" (plan6 sections 44, 50). Real numbers only. */
export function StatTile({ label, value, hint, href }: {
  label: string;
  value: ReactNode;
  hint?: string;
  href?: string;
}) {
  const inner = (
    <>
      <span className="stat-tile__value">{value}</span>
      <span className="stat-tile__label">{label}</span>
      {hint && <span className="stat-tile__hint">{hint}</span>}
    </>
  );
  if (href) {
    return <Link className="stat-tile stat-tile--link" href={href}>{inner}</Link>;
  }
  return <div className="stat-tile">{inner}</div>;
}
