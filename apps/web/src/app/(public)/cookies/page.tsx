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
      path="/cookies"
      eyebrow="Website information"
      title="Cookie notice"
      intro="A plain-language explanation of the cookies and similar technologies used by the current LearnThrive Tuition website."
      reviewedOn="10 September 2026"
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
                The current LearnThrive website does not set cookies. It keeps
                two small things in your own browser, each only because of
                something you choose to do, and neither is sent to LearnThrive
                or to anyone else:
              </p>
              <ul>
                <li>
                  <strong>Your appearance and motion choices.</strong> If you
                  pick Light or Dark with the theme control, that choice is
                  saved in your browser’s local storage (under the name
                  “lt-theme”) so the site looks the same next time. In the same
                  way, choosing Reduce with the motion control saves “lt-motion”
                  so the site stays calm on your next visit. If you leave a
                  control on System, nothing is saved for it.
                </li>
                <li>
                  <strong>Your recent searches.</strong> If you use the site
                  search (Ctrl K or ⌘K), the pages you open from it are
                  remembered in your browser’s session storage so they can be
                  offered first the next time you open it. Closing the tab clears
                  them.
                </li>
              </ul>
              <p>
                The site does not include analytics, advertising pixels,
                embedded third-party media, external font services or other
                tracking features.
              </p>
              <p>
                The enquiry form holds your answers temporarily while the page is
                open, and sends them directly to LearnThrive by email when you
                submit. It does not use cookies or browser storage to save the
                answers. Closing or reloading the page before submitting clears
                those in-page values.
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
              The current website does not ask for cookie choices because it sets
              no cookies, and the only browser storage it uses is the appearance
              choices and recent-search list described above, which exist only
              because you used those controls.
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
