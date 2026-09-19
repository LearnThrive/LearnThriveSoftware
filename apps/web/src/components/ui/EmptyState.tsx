import type { ReactNode } from "react";

/**
 * Purposeful empty states (plan6 section 68): say what would be here, why it matters, and offer
 * the action that fills it — never a bare "Tutors (0)" over blank space.
 */
export function EmptyState({ title, description, action, icon }: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon" aria-hidden="true">{icon}</div>}
      <p className="empty-state__title">{title}</p>
      {description && <p className="empty-state__description">{description}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
