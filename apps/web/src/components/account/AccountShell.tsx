import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { MotionRuntime } from "@/components/motion/MotionRuntime";

/**
 * The page around the account forms (sign in, sign up, reset, confirm): the same two-panel shell as the staff
 * sign-in, with words about the Library. It claims nothing the owners have not confirmed: no counts, no prices, no
 * promise of what is inside. Cookie-free until a person signs in.
 */
export function AccountShell({ title, intro, children }: { title?: string; intro?: string; children: ReactNode }) {
  return (
    <MotionRuntime>
      <div className="auth-layout">
        <aside className="auth-brand">
          <Link href="/library" className="auth-brand__back">
            <ArrowLeft size={16} aria-hidden="true" />
            Back to the Library
          </Link>
          <div className="auth-brand__body">
            <BrandMark className="auth-brand__mark auth-enter" />
            <p className="auth-brand__tagline auth-enter" style={{ animationDelay: "60ms" }}>
              Learn. Grow. Thrive.
            </p>
            <h1 className="auth-brand__headline auth-enter" style={{ animationDelay: "100ms" }}>
              The LearnThrive Library
            </h1>
            <ul className="auth-brand__points">
              <li className="auth-enter" style={{ animationDelay: "170ms" }}>
                Worksheets, papers and notes made by LearnThrive
              </li>
              <li className="auth-enter" style={{ animationDelay: "210ms" }}>
                Included for enrolled students
              </li>
              <li className="auth-enter" style={{ animationDelay: "250ms" }}>
                For parents, guardians and adult learners to sign in
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
