import type { ParticipantRole, StaffTitle } from '@learnthrive/shared/protocol';

/** A staff meeting passes the person's real `title` (Admin / Tutor), so a colleague is never badged "Student"; a lesson shows its role. */
export function RoleBadge({ role, title }: { role: ParticipantRole | null; title?: StaffTitle }) {
  if (!role) return null;
  return <span className={`role-badge role-badge-${title ? 'staff' : role}`}>{title ?? (role === 'tutor' ? 'Tutor' : 'Student')}</span>;
}
