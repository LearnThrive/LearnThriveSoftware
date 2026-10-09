import Link from "next/link";
import { assessmentText, applyByEmailHref, fileLimitsSummary, suitableCertificateText } from "@/lib/careers";
import { careersConfig } from "@/lib/careers-config";
import type { FaqItem } from "@/lib/faqs";
import { siteConfig } from "@/lib/site";

/**
 * The applicant FAQ on /careers. Every answer restates only what the owner has confirmed, and must agree
 * with the applicant privacy notice (/careers/privacy) and the safeguarding agreement. Numbers (file limits,
 * retention, reply time) are read from the config so the page can never disagree with the server.
 */
const { talentPool, unsuccessfulRetentionMonths } = careersConfig;

export const careersFaqs: readonly FaqItem[] = [
  {
    id: "who-can-apply",
    question: "Who can apply?",
    answer: (
      <>
        <p>
          You must be {careersConfig.minimumAge} or over, have the right to work in the UK (including for self-employed work), and be
          confident in the subject you want to teach.
        </p>
        <p>We teach online and one to one, in Maths, English and Science from Year 3 to A Level, and in 11+ preparation.</p>
      </>
    ),
  },
  {
    id: "pay-and-hours",
    question: "What is the pay, and what are the hours?",
    answer: (
      <>
        <p>Pay is £10 an hour per student. Hours depend on student availability. Tutors are self-employed.</p>
        <p>No formal training is currently provided. Opportunities to progress may exist later; they are still being worked out, so we cannot promise anything yet.</p>
      </>
    ),
  },
  {
    id: "how-applications-are-assessed",
    question: "How are applications assessed?",
    answer: <p>{assessmentText}</p>,
  },
  {
    id: "how-to-apply",
    question: "How do I apply?",
    answer: (
      <>
        <p>
          Use the online application: one page, in eight numbered sections. Part of it is reading and agreeing to the safeguarding
          agreement. You can also apply by email at <a href={applyByEmailHref()}>{siteConfig.email}</a>; if you do, we will send you the
          safeguarding agreement to read and confirm before anything else happens.
        </p>
        <p>The application does not save what you type, so have your CV and details ready. If you leave the page before sending, your answers are lost.</p>
      </>
    ),
    link: { href: "/careers/apply", label: "Go to the application" },
  },
  {
    id: "what-to-include",
    question: "What should I include?",
    answer: (
      <p>
        Your CV is required. A cover letter is optional: upload a file, paste it into the box, or both. You also answer a few short
        questions, give your results at GCSE, A Level and degree level (at least one), and tell us your availability. You do not need to
        give referee details.
      </p>
    ),
  },
  {
    id: "files",
    question: "Which files can I upload, and how big can they be?",
    answer: (
      <>
        <p>{fileLimitsSummary()}</p>
        <p>
          We cannot accept older Word (.doc) files, files that can contain macros, compressed archives, or PDFs that are protected with a
          password or contain scripts. If a file is refused, use Save as PDF and try again. Please do not send bank details or health
          information.
        </p>
      </>
    ),
  },
  {
    id: "identity-documents",
    question: "Do I have to upload identity and right-to-work documents?",
    answer: (
      <>
        <p>
          No. In the supporting documents step you can upload them now, until we put a separate secure process in place, or you can
          provide them later when we ask. Uploading them now is optional.
        </p>
        <p>
          They are used to verify your identity and right to work, and are handled by the hiring team. If you work with LearnThrive they
          are kept while you do and for 12 months after, then deleted, so you do not have to start again if you return. If your
          application is unsuccessful they are deleted {unsuccessfulRetentionMonths} months after the decision. Please do not upload a DBS certificate.
        </p>
      </>
    ),
  },
  {
    id: "dbs",
    question: "What about the DBS check, and who pays?",
    answer: (
      <>
        <p>
          Every tutor must agree to an Enhanced DBS check including the Children’s Barred List. LearnThrive arranges it and pays for it,
          unless you already hold a suitable certificate or choose to pay for your own check. Any start is subject to the outcome.
        </p>
        <p>{suitableCertificateText}</p>
        <p>The application asks only whether you hold a certificate and whether you use the Update Service. Please do not upload a certificate or send any DBS information through the form.</p>
      </>
    ),
  },
  {
    id: "safeguarding-agreement",
    question: "What is the safeguarding agreement?",
    answer: (
      <>
        <p>
          It sets out what every tutor must do, and must never do, when working with children. Every applicant must read and agree to it
          as part of applying: you tick each part, answer six short questions about it (this is not training), and type your full name.
          The same expectations then form part of the tutor agreement you sign. Tutors reconfirm it every year, and whenever a new
          version is issued.
        </p>
        <p>
          <Link href="/careers/safeguarding-agreement">Read the safeguarding agreement</Link> before you apply.
        </p>
      </>
    ),
  },
  {
    id: "references",
    question: "Do you ask for references?",
    answer: <p>There is no fixed number of references. We look at your CV, your experience and your results at every level, all together.</p>,
  },
  {
    id: "what-happens-next",
    question: "What happens after I apply?",
    answer: (
      <>
        <p>{careersConfig.responseTime} The hiring steps are:</p>
        <ol>
          {careersConfig.hiringSteps.map((step) => (
            <li key={step.title}>{step.text}</li>
          ))}
        </ol>
      </>
    ),
  },
  {
    id: "how-long-is-my-information-kept",
    question: "How long do you keep my information?",
    answer: (
      <>
        <p>
          If your application is unsuccessful, we delete it up to {unsuccessfulRetentionMonths} months after the decision; if you ticked the
          box asking us to keep you in mind for future roles, up to {talentPool.retentionMonths} months. Identity documents are always
          deleted {unsuccessfulRetentionMonths} months after the decision, whichever you choose.
        </p>
        <p>
          If you become a tutor, identity and right-to-work documents are kept while you work with LearnThrive and for 12 months after.
          Agreement and reconfirmation records are kept for 6 years after, and longer where linked to a safeguarding concern.
        </p>
        <p>
          The <Link href="/careers/privacy">applicant privacy notice</Link> has the full detail.
        </p>
      </>
    ),
  },
  {
    id: "withdraw",
    question: "How do I withdraw my application, or ask about my information?",
    answer: (
      <p>
        Email <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a> and quote the reference in your confirmation email. You can ask
        us to withdraw your application, to delete your information or to tell you what we hold.
      </p>
    ),
  },
];
