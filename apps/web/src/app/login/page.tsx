import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { PageHero } from "@/components/PageHero";
import { LoginForm } from "@/components/LoginForm";
import { createMetadata } from "@/lib/metadata";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const metadata: Metadata = createMetadata({
  title: "Log in",
  description: "Log in to the LearnThrive platform.",
  path: "/login",
});

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <>
      <PageHero
        eyebrow="LearnThrive platform"
        title="Log in to your account"
        intro="For LearnThrive tutors, parents/guardians, students and administrators."
      />
      <section className="section">
        <Container>
          <div className="login-panel">
            <LoginForm />
          </div>
        </Container>
      </section>
    </>
  );
}
