import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { MotionRuntime } from "@/components/motion/MotionRuntime";

/**
 * The page around the sign-in forms (sign in, sign up, reset, confirm): the platform's one front door. The same two-panel shell the
 * staff sign-in always had, with the Library's account forms inside it. It claims nothing the owners have not confirmed: no counts,
 * no prices, no promise of what is inside. Cookie-free until a person signs in.
 */
export function AccountShell({ title, intro, children }: { title?: string; intro?: string; children: ReactNode }) {
  return (
    <MotionRuntime>
      <div className="auth-layout">
        <aside className="auth-brand">
          <Link href="/" className="auth-brand__back">
            <ArrowLeft size={16} aria-hidden="true" />
            Back to learnthrivetuition.co.uk
          </Link>
          <div className="auth-brand__body">
            <BrandMark className="auth-brand__mark auth-enter" />
            <p className="auth-brand__tagline auth-enter" style={{ animationDelay: "60ms" }}>
              Learn. Grow. Thrive.
            </p>
            <h1 className="auth-brand__headline auth-enter" style={{ animationDelay: "100ms" }}>
              Everything for your tuition, in one place.
            </h1>
            <ul className="auth-brand__points">
              <li className="auth-enter" style={{ animationDelay: "170ms" }}>
                Your lessons, schedule and reports in one place
              </li>
              <li className="auth-enter" style={{ animationDelay: "210ms" }}>
                Study Buddy and the Library, included for enrolled students
              </li>
              <li className="auth-enter" style={{ animationDelay: "250ms" }}>
                Parents, guardians, adult learners, tutors and administrators sign in here
              </li>
            </ul>
          </div>
          <p className="auth-brand__foot">Students under 18 use a profile under a parent or guardian’s account.</p>
        </aside>

        <main id="main-content" className="auth-panel">
          <div className="auth-panel__inner auth-enter" style={{ animationDelay: "120ms" }}>
            {title ? <h2 className="auth-panel__title">{title}</h2> : null}
            {intro ? <p className="auth-panel__subtitle">{intro}</p> : null}
            {children}
          </div>
        </main>
      </div>
    </MotionRuntime>
  );
}
