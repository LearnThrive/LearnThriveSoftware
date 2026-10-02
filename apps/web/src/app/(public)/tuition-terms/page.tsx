import { LegalPage } from "@/components/LegalPage";
import { PhoneContacts } from "@/components/PhoneContacts";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site";

export const metadata = createMetadata({
  title: "Tuition terms",
  description:
    "How LearnThrive Tuition's tuition service terms are agreed, separately from this website's own terms of use.",
  path: "/tuition-terms",
});

export default function TuitionTermsPage() {
  return (
    <LegalPage
      path="/tuition-terms"
      eyebrow="Tuition terms"
      title="Terms for LearnThrive tuition"
      intro="These are the terms that apply once tuition is arranged — separate from the website terms that govern browsing and enquiring here."
      reviewedOn="28 September 2026"
      scope={
        <p>
          This page explains how LearnThrive&apos;s tuition terms work.
          It is not itself the full tuition agreement: the specific terms
          for a student&apos;s lessons — including pricing, payment,
          scheduling, rescheduling and cancellation — are confirmed
          directly with you, in writing, before tuition begins. See our{" "}
          <a href="/terms">website terms</a> for the separate rules that
          cover using this site and making an initial enquiry.
        </p>
      }
      sections={[
        {
          id: "why-separate",
          title: "Why tuition terms are separate",
          content: (
            <p>
              This website provides information and a route to make an
              enquiry — it does not itself book or contract a tuition
              service. Once we&apos;ve discussed a student&apos;s needs, the
              specific arrangement is confirmed directly with you in a form
              you can keep, so the terms that actually apply to your
              lessons are clear and specific to your situation, rather than
              a generic set of terms written for every family in advance.
            </p>
          ),
        },
        {
          id: "what-it-covers",
          title: "What a tuition agreement typically covers",
          content: (
            <>
              <p>
                When we confirm tuition arrangements with you, we&apos;ll set
                out things like:
              </p>
              <ul>
                <li>the subject, level and format of lessons;</li>
                <li>pricing and how and when payment is taken;</li>
                <li>how to reschedule or cancel a lesson;</li>
                <li>what happens if a lesson is missed; and</li>
                <li>how either side can end the arrangement.</li>
              </ul>
              <p>
                These details are confirmed with you directly rather than
                published here, since they can vary by subject, level and
                circumstance.
              </p>
            </>
          ),
        },
        {
          id: "questions",
          title: "Questions before you commit",
          content: (
            <p>
              If you&apos;d like to see the specific terms before deciding
              whether to go ahead, ask us — email{" "}
              <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>{" "}
              or call <PhoneContacts />. We&apos;d rather you had the full
              picture before committing than find out something unexpected
              afterwards.
            </p>
          ),
        },
      ]}
    />
  );
}
