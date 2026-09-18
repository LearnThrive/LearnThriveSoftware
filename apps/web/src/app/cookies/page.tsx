import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
  title: "Cookie notice",
  description:
    "How the current LearnThrive Tuition website uses cookies and similar browser technologies.",
  path: "/cookies",
});

export default function CookiesPage() {
  return (
    <LegalPage
      eyebrow="Website information"
      title="Cookie notice"
      intro="A plain-language explanation of the cookies and similar technologies used by the current LearnThrive Tuition website."
      scope={
        <>
          <p>
            This notice covers the features LearnThrive Tuition currently
            provides on its public marketing website. It does not cover a
            third-party website after you follow a link away from this site.
          </p>
        </>
      }
      sections={[
        {
          id: "what-these-technologies-are",
          title: "What cookies and similar technologies are",
          content: (
            <p>
              Cookies are small pieces of information stored on a device by a
              website. Similar technologies include browser local storage,
              tracking pixels and device fingerprinting. They can support
              essential features, remember choices, measure use or track
              activity, depending on how they are configured.
            </p>
          ),
        },
        {
          id: "current-use",
          title: "What this website currently uses",
          content: (
            <>
              <p>
                The current LearnThrive website features do not set cookies or
                use browser storage. The site does not include analytics,
                advertising pixels, embedded third-party media, external font
                services or other tracking features.
              </p>
              <p>
                The enquiry form holds your answers temporarily while the page is
                open. It prepares a draft email on your device and does not use
                cookies or browser storage to save the answers. Closing or
                reloading the page clears those in-page values.
              </p>
            </>
          ),
        },
        {
          id: "hosting-and-requests",
          title: "Website delivery and request information",
          content: (
            <>
              <p>
                Delivering any website involves technical requests passing
                through hosting and network services. Those services may
                receive basic request information such as an IP address,
                browser details, requested pages, and date and time. That is
                server-side request handling rather than this website placing
                information on your device; our{" "}
                <Link href="/privacy">privacy notice</Link> explains it further.
              </p>
              <p>
                This notice describes the technologies intentionally used by
                the site’s current features. Hosting configurations can change,
                so we review the deployed site when features or providers
                change and update this notice where needed.
              </p>
            </>
          ),
        },
        {
          id: "external-links",
          title: "External links",
          content: (
            <p>
              Footer links to Instagram, LinkedIn and the separate tutor login
              do not load those services into this website. Their own websites
              are contacted only after you choose a link. Once opened, the
              destination service may use cookies or similar technologies under
              its own notice and controls.
            </p>
          ),
        },
        {
          id: "cookie-banner",
          title: "Why there is no cookie banner",
          content: (
            <p>
              The current website does not ask for cookie choices because its
              features do not use non-essential storage or access technologies.
              We will reassess this before adding analytics, embedded services
              or any other feature that may require information, consent or an
              objection control.
            </p>
          ),
        },
        {
          id: "your-controls",
          title: "Your browser controls",
          content: (
            <p>
              Most browsers let you view, block or delete cookies and other site
              data. The help section in your browser explains these controls.
              Blocking essential storage can affect some websites, although the
              current LearnThrive website features do not depend on it.
            </p>
          ),
        },
        {
          id: "changes",
          title: "Changes to this notice",
          content: (
            <p>
              We may update this notice when the website or relevant rules
              change. The current version date appears at the top of the page.
            </p>
          ),
        },
      ]}
    />
  );
}
