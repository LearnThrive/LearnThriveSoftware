import { LegalPage } from "@/components/LegalPage";
import { PhoneContacts } from "@/components/PhoneContacts";
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
      eyebrow="Safeguarding"
      title="Safeguarding information"
      intro="Children’s welfare comes first. This page explains how to raise a concern and the safety considerations that matter around online tuition."
      scope={
        <p>
          This information is for parents, guardians, students and anyone
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
                Before lessons begin, parents and guardians should discuss the
                platform, contact arrangements, supervision and any recording
                arrangements with LearnThrive. Do not assume lessons are recorded.
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
                For a concern connected with LearnThrive that is not an
                immediate emergency, contact us as soon as possible:
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
