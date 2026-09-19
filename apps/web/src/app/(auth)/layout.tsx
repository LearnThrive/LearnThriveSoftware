import type { ReactNode } from "react";

/**
 * Sign-in gets its own shell (plan6 sections 13 and 79): no marketing navbar to wander off into
 * mid-sign-in, and no app sidebar for a session that doesn't exist yet. The page itself provides
 * its brand panel and its own way back to the public site.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="auth-route">{children}</div>;
}
