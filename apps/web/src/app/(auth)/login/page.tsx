import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LoginForm } from "@/components/LoginForm";
import { createMetadata } from "@/lib/metadata";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = createMetadata({
  title: "Log in",
  description: "Log in to the LearnThrive platform.",
  path: "/login",
});

/**
 * Plan6 sections 79-81: a two-panel sign-in of its own — brand and reassurance on one side, the
 * form on the other, collapsing to one column on mobile. Deliberately no role picker: the role
 * comes from the account, never from the person signing in.
 */
export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <div className="auth-layout">
      <aside className="auth-brand">
        <Link href="/" className="auth-brand__back">
          <ArrowLeft size={16} aria-hidden="true" />Back to learnthrivetuition.co.uk
        </Link>
        <div className="auth-brand__body">
          <Image
            className="auth-brand__mark auth-enter"
            src="/brand/learnthrive-mark.png"
            alt=""
            width={40}
            height={34}
            priority
          />
          <p className="auth-brand__tagline auth-enter" style={{ animationDelay: "60ms" }}>Learn. Grow. Thrive.</p>
          <h1 className="auth-brand__headline auth-enter" style={{ animationDelay: "100ms" }}>Everything for your tuition, in one place.</h1>
          <ul className="auth-brand__points">
            <li className="auth-enter" style={{ animationDelay: "170ms" }}>Your lessons and schedule, always up to date</li>
            <li className="auth-enter" style={{ animationDelay: "210ms" }}>Join the online classroom in one click</li>
            <li className="auth-enter" style={{ animationDelay: "250ms" }}>Reports and progress, shared when they&apos;re ready</li>
          </ul>
        </div>
        <p className="auth-brand__foot">Tutors, parents, students and administrators all sign in here.</p>
      </aside>

      <main id="main-content" className="auth-panel">
        <div className="auth-panel__inner auth-enter" style={{ animationDelay: "120ms" }}>
          <h2 className="auth-panel__title">Sign in</h2>
          <p className="auth-panel__subtitle">Use the email address LearnThrive set your account up with.</p>
          <LoginForm />
        </div>
      </main>
    </div>
  );
}
