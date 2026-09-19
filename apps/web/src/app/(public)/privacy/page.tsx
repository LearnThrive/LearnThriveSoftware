import { LegalPage } from "@/components/LegalPage";
import { PhoneContacts } from "@/components/PhoneContacts";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site";

export const metadata = createMetadata({
  title: "Privacy notice",
  description:
    "How LearnThrive Tuition handles information provided through this website and related enquiries.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="Privacy notice"
      intro="This notice explains what personal information is involved when you browse this website or contact LearnThrive Tuition, and the choices and rights available to you."
      scope={
        <>
          <p>
            LearnThrive Tuition provides online tuition information and an
            enquiry route through {siteConfig.url}. This notice covers the
            public website, enquiries prepared through it, and the related
            correspondence that you choose to send to us.
          </p>
          <p>
            The current website is not a student, parent or tutor portal. It
            does not take payments, deliver lessons, or submit information to a
            customer database.
          </p>
        </>
      }
      sections={[
        {
          id: "who-we-are",
          title: "Who we are",
          content: (
            <p>
              In this notice, “LearnThrive Tuition”, “we”, “us” and “our” refer
              to the tuition service operating this website. For privacy
              questions or requests, contact{" "}
              <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a> or
              call{" "}
              <PhoneContacts />
              .
            </p>
          ),
        },
        {
          id: "information-we-handle",
          title: "Information we handle",
          content: (
            <>
              <p>The enquiry form asks for:</p>
              <ul>
                <li>the parent or guardian’s name and email address;</li>
                <li>
                  a phone number, which is optional unless phone contact is
                  selected;
                </li>
                <li>the student’s year group and subject;</li>
                <li>
                  a short description of the student’s goals or support needs;
                  and
                </li>
                <li>the parent or guardian’s preferred contact method.</li>
              </ul>
              <p>
                The form keeps these answers temporarily in your browser while
                you complete it. It then prepares a draft email on your device.
                The website does not send or store the answers. If you choose
                to send the email, your email service and ours will handle the
                message and its contents as part of normal email delivery.
              </p>
              <p>
                Our website host and the networks used to deliver the site may
                necessarily receive basic request information, such as an IP
                address, browser and device details, requested pages, and the
                date and time of a request. We may also receive information you
                provide in later emails or telephone conversations.
              </p>
              <p>
                Please do not include medical information or other sensitive
                personal details in the general enquiry form. If particular
                information may be needed to support a learner, first ask us
                about an appropriate way to discuss it.
              </p>
            </>
          ),
        },
        {
          id: "purposes-and-lawful-bases",
          title: "Why we use information and our lawful bases",
          content: (
            <>
              <p>We use personal information only where there is a lawful reason:</p>
              <div className="legal-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Purpose</th>
                      <th scope="col">Lawful basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        Replying to a parent or guardian, discussing support,
                        and taking requested steps before tuition is arranged
                      </td>
                      <td>
                        Steps at your request before a contract, or performance
                        of a contract, where this applies to your own information
                      </td>
                    </tr>
                    <tr>
                      <td>
                        Managing enquiries, related correspondence, and the
                        learner information a parent or guardian provides
                      </td>
                      <td>
                        Our legitimate interests in responding, understanding
                        the requested support, and operating the tuition service,
                        balanced against the rights and interests of the people
                        involved, especially children
                      </td>
                    </tr>
                    <tr>
                      <td>Delivering, maintaining and protecting this website</td>
                      <td>
                        Legitimate interests in providing a reliable website
                        and protecting it from misuse
                      </td>
                    </tr>
                    <tr>
                      <td>
                        Meeting legal responsibilities or responding lawfully
                        to regulators, courts or safeguarding authorities
                      </td>
                      <td>Compliance with a legal obligation, where applicable</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>
                We do not treat submitting an enquiry as blanket consent for
                unrelated uses. The current website does not use personal
                information for automated decision-making or profiling.
              </p>
            </>
          ),
        },
        {
          id: "childrens-information",
          title: "Children’s information",
          content: (
            <>
              <p>
                Tuition concerns children and young people, so their privacy
                and best interests require particular care. The website enquiry
                is designed for a parent or guardian to complete. We ask for
                only a year group, subject and brief description of support
                needs at this stage, not the child’s name.
              </p>
              <p>
                Data protection rights belong to the child as well as applying
                to adults. Depending on the child’s age, understanding and the
                nature of a request, a child may exercise those rights directly
                or a parent or guardian may help them or act with appropriate
                authority. We will take reasonable steps to understand who is
                making a request before disclosing information.
              </p>
            </>
          ),
        },
        {
          id: "sharing-information",
          title: "Who information may be shared with",
          content: (
            <>
              <p>
                Information may be handled by service-provider categories
                needed to run the website and communications, such as website
                hosting, technical support and email providers. We share only
                what is needed for the relevant purpose.
              </p>
              <p>
                We may also disclose information where the law requires it, to
                establish or protect legal rights, or to an appropriate
                authority or professional when necessary to respond to a
                safeguarding concern. We do not sell personal information.
              </p>
            </>
          ),
        },
        {
          id: "retention-and-security",
          title: "Retention and security",
          content: (
            <>
              <p>
                We retain personal information only for as long as it is
                reasonably needed for the purpose for which it was collected,
                to manage related correspondence, and to meet applicable legal
                responsibilities. The appropriate period depends on the nature
                of the enquiry and whether tuition is arranged. Information
                that is no longer needed should be securely deleted or
                anonymised.
              </p>
              <p>
                We use reasonable organisational and technical measures suited
                to the nature of the information. No website or email system is
                completely secure, so please use care when deciding what to
                include in an email.
              </p>
            </>
          ),
        },
        {
          id: "your-rights",
          title: "Your data protection rights",
          content: (
            <>
              <p>
                Depending on the circumstances, you may have rights to ask us
                for access to personal information, to correct or erase it, to
                restrict its use, and to receive certain information in a portable
                form. You may also have rights concerning automated decisions,
                although the current website does not make them.
              </p>
              <p>
                These rights are qualified by law and do not apply in exactly
                the same way in every situation. Contact us using the details
                on this page. We may need information to verify identity and
                authority before acting on a request.
              </p>
            </>
          ),
        },
        {
          id: "right-to-object",
          title: "Your right to object",
          content: (
            <p>
              Where we rely on legitimate interests, you have the right to
              object to our use of your personal information for reasons
              relating to your particular situation. To object, email{" "}
              <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.
              We will consider your objection and stop the relevant use unless
              there are lawful grounds to continue.
            </p>
          ),
        },
        {
          id: "questions-and-complaints",
          title: "Questions and complaints",
          content: (
            <p>
              Please contact us first if you have a privacy question or concern
              so that we can consider it. You also have the right to complain
              to the Information Commissioner’s Office. Guidance on making a
              complaint is available on the{" "}
              <a href="https://ico.org.uk/make-a-complaint/data-protection-complaints/data-protection-complaints/">
                ICO website
              </a>
              .
            </p>
          ),
        },
        {
          id: "changes-to-this-notice",
          title: "Changes to this notice",
          content: (
            <p>
              We may update this notice when the website, our services or the
              law changes. The current version date appears at the top of the
              page. Material new uses of personal information will be explained
              before they begin where required.
            </p>
          ),
        },
      ]}
    />
  );
}
