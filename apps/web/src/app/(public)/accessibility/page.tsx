import { LegalPage } from "@/components/LegalPage";
import { PhoneContacts } from "@/components/PhoneContacts";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site";

export const metadata = createMetadata({
  title: "Accessibility statement",
  description:
    "LearnThrive Tuition's commitment to an accessible website, and how to report an accessibility issue.",
  path: "/accessibility",
});

export default function AccessibilityPage() {
  return (
    <LegalPage
      eyebrow="Accessibility"
      title="Accessibility statement"
      intro="We want this website to be usable by everyone, including parents, guardians, students and tutors using assistive technology."
      reviewedOn="28 September 2026"
      scope={
        <p>
          This statement covers the LearnThrive Tuition public website at{" "}
          {siteConfig.url}. It does not cover third-party services we link to,
          such as social media platforms.
        </p>
      }
      sections={[
        {
          id: "our-approach",
          title: "Our approach",
          content: (
            <>
              <p>
                We aim to meet WCAG 2.2 AA — the widely-used standard for web
                accessibility. In practice, that means we work to make sure:
              </p>
              <ul>
                <li>text has sufficient colour contrast to read comfortably;</li>
                <li>every page can be navigated and used with a keyboard alone;</li>
                <li>interactive elements show a clear visible focus state;</li>
                <li>images have meaningful alternative text;</li>
                <li>
                  the site remains usable when browser zoom or reduced-motion
                  preferences are turned on; and
                </li>
                <li>
                  headings, forms and page structure are marked up in a way
                  screen readers can understand.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "known-limitations",
          title: "Known limitations",
          content: (
            <p>
              Accessibility is an ongoing effort rather than a one-off task. If
              you find something on this website that is difficult to use,
              please tell us — see &ldquo;Reporting an issue&rdquo; below. We
              would rather hear about a real problem directly than assume
              everything already works for everyone.
            </p>
          ),
        },
        {
          id: "reporting-an-issue",
          title: "Reporting an issue",
          content: (
            <p>
              Email <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>{" "}
              or call <PhoneContacts />. Please describe what you were trying
              to do, the page you were on, and the device, browser or
              assistive technology you were using — it helps us find and fix
              the problem faster.
            </p>
          ),
        },
      ]}
    />
  );
}
