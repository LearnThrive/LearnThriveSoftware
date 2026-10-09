import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";
import { PhoneContacts } from "@/components/PhoneContacts";
import { suitableCertificateText } from "@/lib/careers";
import { careersConfig } from "@/lib/careers-config";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site";

/**
 * The applicant privacy notice (CAREERS_PROMPT.md). A DRAFT FOR THE OWNER TO APPROVE: it is not legally
 * reviewed. Lawful bases, the wording on transfers and the retention periods are the owner's to confirm
 * (docs/CAREERS_COMPLETION_REPORT.md lists each as an open item). Retention figures come from the config so the
 * notice, the FAQ and the emails cannot disagree.
 */
export const metadata = createMetadata({
  title: "Applicant privacy notice",
  description:
    "How LearnThrive Tuition handles information from people who apply to tutor with us, including documents, checks and the safeguarding agreement.",
  path: "/careers/privacy",
});

const { talentPool, unsuccessfulRetentionMonths } = careersConfig;

export default function CareersPrivacyPage() {
  return (
    <LegalPage
      path="/careers/privacy"
      eyebrow="Privacy"
      title="Applicant privacy notice"
      intro="What happens to the information you give us when you apply to tutor with LearnThrive Tuition, who sees it, how long we keep it and what you can ask us to do."
      reviewedOn="9 October 2026"
      scope={
        <>
          <p>
            This notice is for people who apply to tutor with us, by the online application or by email, and for tutors who reconfirm the
            safeguarding agreement. Our <Link href="/privacy">general privacy notice</Link> covers the rest of the website.
          </p>
          <p>
            The website itself stores nothing about your application. Your answers and files are sent to us by email and handled by hand, as
            described below.
          </p>
        </>
      }
      sections={[
        {
          id: "who-is-responsible",
          title: "Who is responsible for your information",
          content: (
            <>
              <p>
                {siteConfig.legalName}, company number {siteConfig.companyNumber}, registered in {siteConfig.registeredIn}. Correspondence address:{" "}
                {siteConfig.correspondenceAddress}. We decide how your information is used, so we are the data controller.
              </p>
              <p>
                Questions or requests: <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a> or <PhoneContacts />.
              </p>
            </>
          ),
        },
        {
          id: "what-we-collect",
          title: "What we collect, and why",
          content: (
            <>
              <p>We collect what we need to decide whether to take your application forward, and to carry out the checks that working with children requires:</p>
              <ul>
                <li>your name, email address, phone number and town or city;</li>
                <li>the role and subjects you are applying for, and your availability;</li>
                <li>your qualifications and results at GCSE, A Level and degree level, your experience, and your answers to our short questions;</li>
                <li>your CV, your cover letter if you send one, and any supporting documents you choose to upload;</li>
                <li>whether you are {careersConfig.minimumAge} or over, whether you can work in the UK, and whether you hold an Enhanced DBS certificate and use the Update Service;</li>
                <li>the record of the safeguarding agreement: the version, the name you typed, which parts you confirmed, that you passed the short questions, and when we received it.</li>
              </ul>
              <p>
                We do not ask for your date of birth, a photograph, your nationality, your marital status, or any health or disability
                information, and the form does not ask about criminal convictions or cautions. Please do not send bank details or health
                information.
              </p>
              <p>We use it to assess your application, to arrange and carry out identity, right-to-work, DBS and other suitability checks, and to keep a record of the safeguarding agreement and its yearly reconfirmation.</p>
            </>
          ),
        },
        {
          id: "identity-documents",
          title: "Identity and right-to-work documents",
          content: (
            <>
              <p>
                In the supporting documents step you can upload your identity and right-to-work documents now, until we put a separate secure
                process in place. This is optional: you can provide them later, when we ask.
              </p>
              <p>
                We use them to verify your identity and your right to work. They are handled by the hiring team. If you work with LearnThrive
                as a self-employed tutor they are kept while you do and for 12 months after, so you do not have to start again if you return,
                and then deleted; a returning tutor must always show current, valid documents, because documents expire. If your application is
                unsuccessful they are deleted {unsuccessfulRetentionMonths} months after the decision.
              </p>
            </>
          ),
        },
        {
          id: "dbs",
          title: "The DBS check",
          content: (
            <>
              <p>
                Every tutor must agree to an Enhanced DBS check including the Children’s Barred List, arranged by LearnThrive through the DBS
                process. LearnThrive pays for it, unless you already hold a suitable certificate or choose to pay for your own check.
              </p>
              <p>{suitableCertificateText}</p>
              <p>DBS certificate information is not collected through this website. Please do not upload a certificate.</p>
            </>
          ),
        },
        {
          id: "lawful-bases",
          title: "Our lawful bases",
          content: (
            <>
              <p>These are the reasons the law allows us to use your information:</p>
              <ul>
                <li>to take steps at your request before entering a contract with you (assessing your application and, if you are offered work, agreeing the work);</li>
                <li>our legitimate interests in recruiting safely, in keeping records of the checks and of the safeguarding agreement, and in protecting children, balanced against your rights;</li>
                <li>a legal obligation, where the law requires a check (for example, right to work);</li>
                <li>your consent, for keeping your application for future roles if you tick that box. You can withdraw it at any time.</li>
              </ul>
            </>
          ),
        },
        {
          id: "who-receives-it",
          title: "Who receives it",
          content: (
            <>
              <p>
                <strong>Resend</strong> delivers the emails the website sends. <strong>Render</strong> hosts the website. <strong>IONOS</strong> hosts our
                company mailbox, where your application arrives. The hiring team, led by Tahasin Hasan and Abdurrahman Mustafa, reads it. We
                do not sell your information, and we do not use it for automated decisions or profiling.
              </p>
              <p>
                Some of these providers may handle information outside the UK. We will explain the safeguards that apply as soon as they are
                confirmed. We may also share information where the law requires it, or where it is needed to protect a child, with the police,
                the DBS, the local authority or another appropriate body.
              </p>
            </>
          ),
        },
        {
          id: "how-long",
          title: "How long we keep it",
          content: (
            <>
              <div className="legal-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Information</th>
                      <th scope="col">How long</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>An unsuccessful application, and its agreement record</td>
                      <td>Up to {unsuccessfulRetentionMonths} months after the decision</td>
                    </tr>
                    <tr>
                      <td>An unsuccessful application, if you ticked the box to be kept for future roles</td>
                      <td>Up to {talentPool.retentionMonths} months after the decision (identity documents are still deleted at {unsuccessfulRetentionMonths} months)</td>
                    </tr>
                    <tr>
                      <td>Identity and right-to-work documents of a tutor</td>
                      <td>While you work with LearnThrive, and for 12 months after; then deleted</td>
                    </tr>
                    <tr>
                      <td>Safeguarding agreement and yearly reconfirmation records of a tutor</td>
                      <td>While you work with LearnThrive, and for 6 years after; longer, kept separately with restricted access, for anything linked to a safeguarding concern</td>
                    </tr>
                    <tr>
                      <td>Other tutor and personnel records</td>
                      <td>Normally up to 6 years after the working relationship ends</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>
                Your application arrives as an email in our company mailbox and is also held briefly by our email delivery provider. We delete
                both on the schedule above.
              </p>
            </>
          ),
        },
        {
          id: "your-rights",
          title: "Your rights, and how to withdraw",
          content: (
            <>
              <p>
                You can ask us for a copy of your information, to correct it, to delete it, to restrict how we use it, or to object to a use based
                on our legitimate interests. You can withdraw your application at any time. Email <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a> and
                quote the reference in your confirmation email. These rights are qualified by law; for example we may need to keep a safeguarding
                record.
              </p>
              <p>
                If you are unhappy with how we have used your information, please tell us first. You can also complain to the Information
                Commissioner’s Office, at{" "}
                <a href="https://ico.org.uk/make-a-complaint/data-protection-complaints/data-protection-complaints/">ico.org.uk</a>.
              </p>
            </>
          ),
        },
        {
          id: "this-website",
          title: "This website",
          content: (
            <p>
              The application page keeps what you type only in your browser while the page is open, and warns you if you try to leave with
              something unsent. It does not save a draft, set cookies or use browser storage for the application. A short check that you are a person runs in
              your browser and sends nothing to anyone else.
            </p>
          ),
        },
      ]}
    />
  );
}
