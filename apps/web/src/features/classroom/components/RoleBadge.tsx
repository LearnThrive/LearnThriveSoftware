import type { ParticipantRole, StaffTitle } from '@learnthrive/shared/protocol';

/** A staff meeting passes the person's real `title` (Admin / Tutor), so a colleague is never badged "Student"; a lesson shows its role. An
 * administrator supervising a lesson is always badged as one, so nobody in the lesson is unaware of who is there. */
export function RoleBadge({ role, title }: { role: ParticipantRole | null; title?: StaffTitle }) {
  if (!role) return null;
  if (role === 'supervisor') return <span className="role-badge role-badge-staff" title="An administrator supervising this lesson">Admin · supervising</span>;
  return <span className={`role-badge role-badge-${title ? 'staff' : role}`}>{title ?? (role === 'tutor' ? 'Tutor' : 'Student')}</span>;
}
