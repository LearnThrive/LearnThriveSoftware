import { useState } from 'react';
import type { Announcement } from '@learnthrive/shared/protocol';
import { Icon } from './Icon';

// Deliberately distinct from the small `.participant-toast` used for routine "X joined"/"X
// muted" notices — an announcement is a pedagogical cue ("5 minutes remaining", "open question
// 4") the tutor wants everyone to actually notice, so it's rendered larger and full-width rather
// than as a transient corner toast. Auto-expires server-side (see shared/protocol.ts's
// ANNOUNCEMENT_TTL_MS); this only adds a *local* early-dismiss on top of that.
export function AnnouncementBanner({ announcement }: { announcement: Announcement }) {
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  if (announcement.id === dismissedId) return null;

  return (
    <div className="announcement-banner" role="status">
      <Icon name="spark" size={16} />
      <p>{announcement.text}</p>
      <button type="button" onClick={() => setDismissedId(announcement.id)} aria-label="Dismiss announcement"><Icon name="close" size={15} /></button>
    </div>
  );
}
