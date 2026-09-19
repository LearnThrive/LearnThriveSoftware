import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Breadcrumbs (plan6 section 27). Deliberately only rendered where a page is genuinely nested —
 * a trail on a top-level page is noise, which is why this is opt-in per page rather than
 * derived automatically from the URL.
 */
export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  if (trail.length === 0) return null;
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={`${crumb.label}-${index}`}>
              {crumb.href && !last
                ? <Link href={crumb.href}>{crumb.label}</Link>
                : <span aria-current={last ? "page" : undefined}>{crumb.label}</span>}
              {!last && <ChevronRight size={14} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * An explicit, contextual way back out of a detail page (plan6 section 26) — "← Back to Tutors"
 * rather than relying on the browser's Back button, which has no idea what the page is nested
 * under when someone arrived by direct link.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="back-link">
      <ArrowLeft size={16} aria-hidden="true" />{label}
    </Link>
  );
}

/**
 * The one page header every authenticated page uses (plan6 section 28): optional back link and
 * breadcrumbs, an eyebrow for context, the title, a supporting line, and the page's primary and
 * secondary actions — so headings never float without context and actions are always in the
 * same place.
 */
export function PageHeader({
  eyebrow, title, description, actions, backTo, breadcrumbs, meta,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  backTo?: { href: string; label: string };
  breadcrumbs?: Crumb[];
  meta?: ReactNode;
}) {
  return (
    <header className="page-header">
      {(backTo || breadcrumbs) && (
        <div className="page-header__nav">
          {backTo && <BackLink href={backTo.href} label={backTo.label} />}
          {breadcrumbs && <Breadcrumbs trail={breadcrumbs} />}
        </div>
      )}
      <div className="page-header__main">
        <div className="page-header__text">
          {eyebrow && <p className="page-header__eyebrow">{eyebrow}</p>}
          <h1 className="page-header__title">{title}</h1>
          {description && <p className="page-header__description">{description}</p>}
          {meta && <div className="page-header__meta">{meta}</div>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
    </header>
  );
}
