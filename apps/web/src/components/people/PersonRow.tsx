import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";

export interface PersonColumn {
  label: string;
  value: ReactNode;
}

/**
 * One person as a row (plan6 sections 40 and 83). Desktop lays the columns out side by side;
 * on narrow screens the same markup stacks into a card with each column labelled, so there's no
 * horizontal-scrolling table and no second component to keep in sync.
 */
export function PersonRow({ name, subtitle, href, columns, active = true }: {
  name: string;
  subtitle?: string;
  href?: string;
  columns?: PersonColumn[];
  active?: boolean;
}) {
  const body = (
    <>
      <span className="person-row__identity">
        <Avatar name={name} size="md" />
        <span className="person-row__names">
          <span className="person-row__name">{name}</span>
          {subtitle && <span className="person-row__subtitle">{subtitle}</span>}
        </span>
      </span>
      {columns?.map((column) => (
        <span className="person-row__cell" key={column.label}>
          <span className="person-row__cell-label">{column.label}</span>
          <span className="person-row__cell-value">{column.value}</span>
        </span>
      ))}
      <span className="person-row__aside">
        {!active && <Badge tone="muted">Inactive</Badge>}
        {href && <ChevronRight size={16} aria-hidden="true" className="person-row__chevron" />}
      </span>
    </>
  );

  return (
    <li className="person-row">
      {href ? <Link href={href} className="person-row__link">{body}</Link> : <div className="person-row__link">{body}</div>}
    </li>
  );
}

/**
 * Column headings for the desktop layout. Without these the values read as anonymous — a date
 * in a column means nothing until it's labelled "Next lesson". Hidden on narrow screens, where
 * each row carries its own inline labels instead.
 */
export function PersonList({ children, columnLabels, identityLabel = "Name" }: {
  children: ReactNode;
  columnLabels?: string[];
  identityLabel?: string;
}) {
  return (
    <>
      {columnLabels && (
        <div className="person-list__head" aria-hidden="true">
          <span className="person-row__identity">{identityLabel}</span>
          {columnLabels.map((label) => <span className="person-row__cell" key={label}>{label}</span>)}
          <span className="person-row__aside" />
        </div>
      )}
      <ul className="person-list">{children}</ul>
    </>
  );
}
