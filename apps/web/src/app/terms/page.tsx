import { LegalPage } from "@/components/LegalPage";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "Website terms",
  description:
    "Terms for using the LearnThrive Tuition public website and making an initial tuition enquiry.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Website terms"
      title="Terms for using this website"
      intro="The ground rules for using LearnThrive’s public information and enquiry features."
      scope={
        <>
          <p>
            These terms apply to the LearnThrive Tuition public marketing
            website. Please use the site lawfully and in line with these terms.
          </p>
          <p>
            Tuition arrangements require separate agreement. These website terms
            do not set lesson prices, payment dates, cancellation or rescheduling
            rules, refunds, missed-lesson arrangements or minimum commitments.
            The relevant terms should be confirmed directly before tuition begins.
          </p>
        </>
      }
      sections={[
        {
          id: "website-information",
          title: "Website information",
          content: (
            <>
              <p>
                The site describes LearnThrive’s subjects and approach to
                tuition. Information may change as the service develops. Please
                contact us to confirm the support and arrangements relevant to
                your enquiry.
              </p>
              <p>
                Website information does not guarantee that a particular tutor,
                lesson time or place is available. Educational progress depends
                on many factors; the site does not promise a particular grade,
                examination result or school place.
              </p>
            </>
          ),
        },
        {
          id: "enquiries",
          title: "Enquiries and bookings",
          content: (
            <>
              <p>
                The consultation form prepares an email draft on your device.
                The website does not send the enquiry: you review and send it
                using your email app. Preparing a draft alone does not contact
                LearnThrive.
              </p>
              <p>
                Sending an enquiry starts a discussion. It does not itself
                confirm a tuition contract, reserve a place or guarantee
                availability. Any service, price, timetable and applicable
                tuition terms should be confirmed directly in a form you can
                keep before lessons start.
              </p>
            </>
          ),
        },
        {
          id: "acceptable-use",
          title: "Acceptable use",
          content: (
            <>
              <p>You must not use this website to:</p>
              <ul>
                <li>break the law or infringe another person’s rights;</li>
                <li>introduce malicious code or attempt unauthorised access;</li>
                <li>disrupt the site or place an unreasonable load on it;</li>
                <li>send abusive, fraudulent or harmful communications; or</li>
                <li>collect or misuse information about other people.</li>
              </ul>
              <p>
                Access may be restricted where reasonably necessary to protect
                the website, its users or LearnThrive’s legal rights.
              </p>
            </>
          ),
        },
        {
          id: "content-rights",
          title: "Content and intellectual property",
          content: (
            <>
              <p>
                Website text, branding, images, design and other materials are
                protected by applicable intellectual-property rights belonging
                to LearnThrive or their respective owners and licensors.
                Relevant third-party licences and notices continue to apply.
              </p>
              <p>
                You may view the site and make a reasonable personal copy for
                non-commercial reference. You must not reproduce, sell or
                republish substantial content for commercial use without the
                relevant rights holder’s permission, except where the law or an
                applicable licence permits it.
              </p>
            </>
          ),
        },
        {
          id: "external-services",
          title: "Links to external services",
          content: (
            <p>
              Links to social media, the separate tutor login and guidance from
              other organisations are provided for convenience. Those services
              control their own content, availability and privacy practices.
              Read their information before using them or sharing personal details.
            </p>
          ),
        },
        {
          id: "availability-and-rights",
          title: "Availability and your rights",
          content: (
            <>
              <p>
                LearnThrive aims to keep the site useful and available, but
                cannot promise uninterrupted or error-free access. Content or
                access may be changed, suspended or withdrawn where reasonably
                necessary.
              </p>
              <p>
                Nothing in these terms excludes or limits responsibility where
                doing so would be unlawful, including liability for fraud or
                for death or personal injury caused by negligence. Your
                mandatory consumer and data protection rights are unaffected.
                Any responsibility for loss depends on the circumstances and
                applicable law.
              </p>
            </>
          ),
        },
        {
          id: "questions-and-changes",
          title: "Questions and changes",
          content: (
            <>
              <p>
                Contact LearnThrive using the details below if you have a
                question or concern about the website or these terms.
              </p>
              <p>
                These terms may be updated when the website or relevant law
                changes. The review date appears at the top. Changes to website
                terms do not retrospectively replace separately agreed tuition
                terms or remove rights you already have.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
