import type { ParticipantRole } from '../../shared/protocol';

export function RoleBadge({ role }: { role: ParticipantRole | null }) {
  if (!role) return null;
  return <span className={`role-badge role-badge-${role}`}>{role === 'tutor' ? 'Tutor' : 'Student'}</span>;
}
