import {
  Activity, BookOpen, CalendarDays, ClipboardList, Cog, GraduationCap,
  Home, Users, UserRound, Bell, CalendarClock, FileText, Library, MessagesSquare, Search, Inbox,
  Video, ShieldCheck, KeyRound, ReceiptPoundSterling, ShieldAlert, Shapes,
} from "lucide-react";
import type { AppNavIcon } from "@/lib/navigation/appNavigation";

// One icon system across the whole authenticated product (plan6 section 82: no mixing emoji,
// ad-hoc SVGs and text arrows). Lucide, sized and stroked consistently from one place.
const ICONS: Record<AppNavIcon, typeof Home> = {
  home: Home,
  calendar: CalendarDays,
  lessons: BookOpen,
  students: GraduationCap,
  clients: Users,
  tutors: UserRound,
  assignments: ClipboardList,
  reports: FileText,
  notifications: Bell,
  activity: Activity,
  settings: Cog,
  availability: CalendarClock,
  "study-buddy": MessagesSquare,
  library: Library,
  search: Search,
  account: UserRound,
  applications: Inbox,
  // One glyph per destination: Meetings, Tutor checks, Roles, Billing/Fees, Concerns and My subjects used to borrow another item's icon.
  meetings: Video,
  vetting: ShieldCheck,
  roles: KeyRound,
  billing: ReceiptPoundSterling,
  concerns: ShieldAlert,
  subjects: Shapes,
};

export function NavIcon({ name, size = 18 }: { name: AppNavIcon; size?: number }) {
  const Glyph = ICONS[name];
  return <Glyph size={size} strokeWidth={1.75} aria-hidden="true" />;
}
