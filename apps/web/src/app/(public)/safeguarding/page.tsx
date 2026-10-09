import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";
import { PhoneContacts } from "@/components/PhoneContacts";
import { SafeguardingTrustPath } from "@/components/motion/scenes/SafeguardingTrustPath";
import { agreementCommitmentSummary, safeguardingTeam } from "@/lib/careers";
import { agreementOpen } from "@/lib/careers-config";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site";

export const metadata = createMetadata({
  title: "Safeguarding information",
  description:
    "Student welfare, online tuition safety and routes for raising a safeguarding concern with LearnThrive Tuition or independent services.",
  path: "/safeguarding",
});

export default function SafeguardingPage() {
  return (
    <LegalPage
      path="/safeguarding"
      eyebrow="Safeguarding"
      title="Safeguarding information"
      intro="Children’s welfare comes first. This page explains who is responsible for safeguarding, what every tutor must do before teaching, how to raise a concern and the safety considerations that matter around online tuition."
      reviewedOn="9 October 2026"
      scope={
        <p>
          This information is for parents, guardians, students, tutors and anyone
          concerned about a child’s safety. The public website provides
          information and an enquiry route; it is not an online classroom,
          private messaging service or lesson-recording system.
        </p>
      }
      sections={[
        {
          id: "student-welfare",
          title: "A commitment to student welfare",
          content: (
            <>
              <p>
                LearnThrive Tuition is committed to treating concerns about a
                child’s safety or wellbeing seriously and acting in line with
                applicable law and safeguarding guidance. Children should be
                treated with respect, listened to and supported to raise concerns.
              </p>
              <p>
                Safeguarding concerns may involve abuse, neglect, bullying,
                exploitation, inappropriate behaviour or online harm. No adult
                working with a child should inflict physical or psychological harm.
              </p>
            </>
          ),
        },
        {
          id: "who-is-responsible",
          title: "Who is responsible",
          content: (
            <>
              <p>
                LearnThrive’s <strong>safeguarding lead is {safeguardingTeam.lead}</strong> and its{" "}
                <strong>deputy safeguarding lead is {safeguardingTeam.deputy}</strong>. Every tutor must report any
                safeguarding concern to the safeguarding lead, or to the deputy if the lead cannot be reached.
              </p>
              <p>
                You can reach them on <PhoneContacts /> or at{" "}
                <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.
              </p>
            </>
          ),
        },
        {
          id: "tutor-checks",
          title: "Tutor checks and the safeguarding agreement",
          content: (
            <>
              <p>
                <strong>No tutor teaches any student, or has any contact with one, until every check is complete.</strong>
              </p>
              <SafeguardingTrustPath />
              <p>Every tutor must:</p>
              <ul>
                <li>pass identity checks and right-to-work checks;</li>
                <li>
                  agree to an Enhanced DBS check including the Children’s
                  Barred List, arranged by LearnThrive. LearnThrive pays for it
                  unless the tutor already holds a suitable certificate or
                  chooses to pay for their own check;
                </li>
                <li>
                  read and agree to the safeguarding agreement as part of
                  applying, and agree to the same expectations in the tutor
                  agreement they sign; and
                </li>
                <li>
                  reconfirm the safeguarding agreement every year, and whenever a
                  new version is issued.
                </li>
              </ul>
              {agreementOpen() ? (
                <>
                  <p>In plain language, the agreement requires every tutor to:</p>
                  <ul>
                    {agreementCommitmentSummary.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              <p>
                <Link href="/careers/safeguarding-agreement">Read the safeguarding agreement</Link>. It helps LearnThrive to:
              </p>
              <ul>
                <li>make safe recruitment decisions;</li>
                <li>
                  protect children and adults at risk from harm, and minimise
                  threats to staff, clients, assets, data and reputation; and
                </li>
                <li>meet its legal and regulatory obligations.</li>
              </ul>
            </>
          ),
        },
        {
          id: "online-tuition-safety",
          title: "Safe online tuition",
          content: (
            <>
              <p>Appropriate online tuition arrangements should include:</p>
              <ul>
                <li>professional language, behaviour and boundaries;</li>
                <li>age-appropriate communication focused on learning;</li>
                <li>a suitable learning environment and safe use of devices;</li>
                <li>
                  clear information for parents and guardians about how lessons
                  and contact take place; and
                </li>
                <li>a way for a child or adult to say when something feels unsafe.</li>
              </ul>
              <p>
                <strong>LearnThrive lessons are not recorded by default.</strong>{" "}
                Before lessons begin, parents and guardians should discuss the
                platform, contact arrangements, supervision and any recording
                arrangements with LearnThrive.
              </p>
            </>
          ),
        },
        {
          id: "parents-and-guardians",
          title: "Parents and guardians",
          content: (
            <>
              <p>
                A parent or guardian should normally make the initial tuition
                enquiry. Use the general form for a brief description of
                learning support and avoid unnecessary sensitive or medical
                information. It is not an emergency reporting service.
              </p>
              <p>
                Take an interest in your child’s online learning, help them use
                devices safely and encourage them to tell a trusted adult if
                something worries them. Ask questions about safeguarding
                arrangements before deciding whether tuition is suitable.
              </p>
            </>
          ),
        },
        {
          id: "raising-a-concern",
          title: "Raising a concern with LearnThrive",
          content: (
            <>
              <p>
                <strong>If a child is in immediate danger, call 999 first.</strong> For a concern connected with
                LearnThrive that is not an immediate emergency, a parent, a
                student, a tutor or anyone else can contact the safeguarding
                lead as soon as possible:
              </p>
              <ul>
                <li>
                  email <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>,
                  making clear that your message concerns safeguarding; or
                </li>
                <li>
                  call <PhoneContacts />.
                </li>
              </ul>
              <p>
                Give enough information to explain the concern and how you can
                be contacted. LearnThrive will take the concern seriously and
                consider appropriate action, including referral to relevant
                safeguarding services where necessary.
              </p>
              <p>
                A concern should be recorded factually, and safeguarding records
                should be kept separately from routine learner records, with
                restricted access.
              </p>
              <p>
                Information should be handled sensitively, but complete
                confidentiality cannot be promised when sharing is needed to
                protect a child or meet a legal obligation.
              </p>
            </>
          ),
        },
        {
          id: "urgent-and-independent-help",
          title: "Urgent and independent help",
          content: (
            <>
              {/* plan12.md task 9: "present real reporting routes more clearly" — the one section
                  on this page a reader might need in a hurry gets a visually distinct, calm
                  (not alarming-red) treatment rather than reading identically to the others. */}
              <div className="safeguarding-urgent-box">
              <ul>
                <li>
                  If a child is in immediate danger, <strong>call 999</strong>.
                </li>
                <li>
                  For other concerns about a child, contact the children’s
                  social care team at their local council. GOV.UK explains how to{" "}
                  <a href="https://www.gov.uk/report-child-abuse">report child abuse</a>.
                </li>
                <li>
                  Adults can contact the NSPCC helpline on{" "}
                  <a href="tel:08088005000">0808 800 5000</a>.
                </li>
                <li>
                  Children and young people can contact Childline free on{" "}
                  <a href="tel:08001111">0800 1111</a>.
                </li>
              </ul>
              <p>
                Do not wait for a response from LearnThrive if urgent help is
                needed. You do not need our permission to contact an independent
                or statutory safeguarding service.
              </p>
              </div>
            </>
          ),
        },
        {
          id: "further-guidance",
          title: "Further guidance",
          content: (
            <p>
              Parents and guardians can read the Department for Education’s{" "}
              <a href="https://www.gov.uk/government/publications/guidance-for-parents-and-carers-on-safeguarding-children-in-out-of-school-settings/using-after-school-clubs-tuition-and-community-activities">
                guidance on choosing tuition and other out-of-school activities
              </a>
              . Safeguarding guidance for providers includes{" "}
              <a href="https://www.gov.uk/government/publications/working-together-to-safeguard-children--2">
                Working Together to Safeguard Children
              </a>{" "}
              in England and the{" "}
              <a href="https://learning.nspcc.org.uk/safeguarding-child-protection/tutors">
                NSPCC’s guidance for tutors
              </a>
              .
            </p>
          ),
        },
      ]}
    />
  );
}
