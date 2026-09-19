import type { ReactNode } from "react";

/**
 * The classroom is deliberately its own shell (plan6 section 61): full-bleed and immersive, with
 * no sidebar, topbar or marketing chrome competing with a live lesson. It's a route group rather
 * than a nested layout because a child layout can only add chrome, never remove the AppShell its
 * parent would impose. Brand continuity comes from shared tokens and the LearnThrive mark inside
 * the classroom UI itself, not from repeating the dashboard frame around it.
 */
export default function ClassroomLayout({ children }: { children: ReactNode }) {
  return <div className="classroom-route">{children}</div>;
}
