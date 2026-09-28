import { LegalPage } from "@/components/LegalPage";
import { PhoneContacts } from "@/components/PhoneContacts";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site";

export const metadata = createMetadata({
  title: "Complaints procedure",
  description:
    "How to raise a complaint with LearnThrive Tuition and what happens after you do.",
  path: "/complaints",
});

export default function ComplaintsPage() {
  return (
    <LegalPage
      eyebrow="Complaints"
      title="Our complaints procedure"
      intro="If something has not met your expectations, we want to know. This page explains how to raise a complaint and what happens next."
      reviewedOn="28 September 2026"
      scope={
        <p>
          This procedure covers complaints about LearnThrive Tuition&apos;s
          service — tuition arrangements, communication, billing or conduct.
          A safeguarding concern about a child&apos;s welfare should instead
          follow the steps on our{" "}
          <a href="/safeguarding">safeguarding page</a>, which are handled
          separately and as a priority.
        </p>
      }
      sections={[
        {
          id: "how-to-complain",
          title: "How to raise a complaint",
          content: (
            <>
              <p>
                Email <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>{" "}
                or call <PhoneContacts />, and let us know it&apos;s a complaint.
                Please include:
              </p>
              <ul>
                <li>your name and the student&apos;s name;</li>
                <li>what happened, and when;</li>
                <li>what you would like to see happen as a result.</li>
              </ul>
            </>
          ),
        },
        {
          id: "what-happens-next",
          title: "What happens next",
          content: (
            <>
              <p>
                We aim to acknowledge a complaint within 2 working days, and to
                give a full response within 10 working days. If a complaint is
                more complex and needs longer to look into properly, we will
                tell you and explain why.
              </p>
              <p>
                We will look into what happened, discuss it with anyone
                involved, and let you know the outcome and any action we are
                taking.
              </p>
            </>
          ),
        },
        {
          id: "not-resolved",
          title: "If a complaint is not resolved",
          content: (
            <p>
              If you are not satisfied with our response, let us know and we
              will review it again. We take every complaint seriously and see
              it as an opportunity to improve.
            </p>
          ),
        },
      ]}
    />
  );
}
