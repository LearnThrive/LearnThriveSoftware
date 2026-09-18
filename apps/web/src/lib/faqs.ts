import type { ReactNode } from "react";
import { legalFaqs } from "@/lib/legal-faqs";

export type FaqItem = {
  id: string;
  question: string;
  answer: ReactNode;
  link?: {
    href: `/${string}`;
    label: string;
  };
};

export type FaqSection = {
  id: string;
  title: string;
  intro: string;
  items: readonly FaqItem[];
};

export const faqSections: readonly FaqSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    intro: "How to make an enquiry and what information is useful at the outset.",
    items: [
      {
        id: "how-to-get-started",
        question: "How do I get started with LearnThrive Tuition?",
        answer:
          "Begin with a free consultation enquiry. You can share the student’s year group, subject and a brief outline of the support required. The booking form prepares an email on your device for you to review and send.",
        link: { href: "/book", label: "Prepare a consultation enquiry" },
      },
      {
        id: "after-enquiry",
        question: "What happens after I make an enquiry?",
        answer:
          "LearnThrive can use the details you send to discuss the learner’s current needs, goals and possible next steps with you. Any tuition arrangements can then be confirmed directly rather than being set automatically by this website.",
        link: { href: "/about", label: "See how LearnThrive works" },
      },
      {
        id: "free-consultation",
        question: "Is the initial consultation free?",
        answer:
          "Yes. The website offers a free initial consultation so that you can describe the support you are looking for and discuss what may be appropriate before making any tuition arrangements.",
        link: { href: "/book", label: "Start a free consultation enquiry" },
      },
      {
        id: "enquiry-information",
        question: "What should I include in an enquiry?",
        answer:
          "Include the student’s current year group, the subject or subjects, any present challenges or near-term goals, and your preferred contact method. For an initial enquiry, avoid including sensitive personal or medical information that is not needed.",
        link: { href: "/contact", label: "View contact options" },
      },
    ],
  },
  {
    id: "lessons",
    title: "Lessons and learning",
    intro: "What LearnThrive’s one-to-one online tuition is designed to provide.",
    items: [
      {
        id: "online-one-to-one",
        question: "Are lessons online and one-to-one?",
        answer:
          "Yes. LearnThrive provides one-to-one online tuition. This gives the lesson room to respond to the individual learner’s understanding, questions and priorities.",
        link: { href: "/about", label: "Learn about the teaching approach" },
      },
      {
        id: "personalised-tuition",
        question: "How is tuition personalised?",
        answer:
          "Teaching can adapt to the learner’s strengths, areas of difficulty, pace and academic goals. The focus may change as their needs change, while remaining connected to schoolwork, the curriculum and relevant assessments.",
      },
      {
        id: "online-lesson",
        question: "What can an online lesson include?",
        answer:
          "Lessons can combine direct teaching, active practice and feedback. LearnThrive’s published approach includes tools such as live whiteboards, worked examples and real-time feedback to keep learning active.",
      },
      {
        id: "progress-updates",
        question: "How is progress shared with parents?",
        answer:
          "LearnThrive’s approach includes lesson notes and regular progress updates so that parents can understand what has been covered and what the next priorities are.",
        link: { href: "/contact", label: "Ask about parent communication" },
      },
    ],
  },
  {
    id: "subjects-and-stages",
    title: "Subjects and stages",
    intro: "The subjects, age ranges and areas of study described on this website.",
    items: [
      {
        id: "subjects-offered",
        question: "Which subjects does LearnThrive offer?",
        answer:
          "LearnThrive offers personalised tuition in Maths, English and Science, together with focused 11+ preparation.",
        link: { href: "/subjects", label: "Explore all subjects" },
      },
      {
        id: "stages-supported",
        question: "Which school stages are supported?",
        answer:
          "Maths, English and Science support is available from KS2 to A Level. LearnThrive also offers separate 11+ preparation for pupils working towards relevant entrance assessments.",
      },
      {
        id: "eleven-plus",
        question: "What can 11+ preparation cover?",
        answer:
          "Depending on the pupil’s needs and the relevant assessment, 11+ support can cover Maths, English, verbal reasoning and non-verbal reasoning, with structured practice for accuracy, pace and confidence.",
        link: { href: "/11-plus-tuition", label: "Read about 11+ preparation" },
      },
      {
        id: "unsure-subject-focus",
        question: "What if I am not sure which area of support is needed?",
        answer:
          "You do not need to define a fixed programme before contacting LearnThrive. Share the learner’s year group, subject and current challenges, and use the initial conversation to discuss a suitable focus.",
        link: { href: "/book", label: "Discuss the learner’s needs" },
      },
    ],
  },
  {
    id: "working-together",
    title: "Working together",
    intro: "How tuition can stay connected to the learner’s priorities and family communication.",
    items: [
      {
        id: "school-and-exams",
        question: "Can tuition support current schoolwork or exam preparation?",
        answer:
          "Yes. Lessons can remain connected to current schoolwork, curriculum content and relevant assessments. The exact focus depends on the learner’s stage, present understanding and academic priorities.",
      },
      {
        id: "changing-needs",
        question: "Can the lesson focus change over time?",
        answer:
          "Yes. Personalised tuition is intended to respond as needs change. A learner may need to revisit a foundation, spend longer on a difficult topic or move towards more exam-focused practice at a later point.",
      },
      {
        id: "outcomes",
        question: "Does LearnThrive guarantee a particular grade or result?",
        answer:
          "No particular grade or result is guaranteed on this website. LearnThrive’s published focus is on clearer understanding, growing confidence, purposeful practice and stronger independent learning habits.",
      },
      {
        id: "contact-learnthrive",
        question: "How can I contact LearnThrive?",
        answer:
          "You can contact LearnThrive using the published email address or telephone number. The contact page also links to the guided consultation enquiry.",
        link: { href: "/contact", label: "Contact LearnThrive" },
      },
    ],
  },
  {
    id: "legal-and-compliance",
    title: "Legal and compliance",
    intro: "Company information, privacy, bookings and safeguarding, including the working policies and proposed responsibilities described below.",
    items: legalFaqs,
  },
] as const;

const faqById = new Map(
  faqSections.flatMap((section) => section.items).map((item) => [item.id, item]),
);

const featuredFaqIds = [
  "how-to-get-started",
  "online-one-to-one",
  "subjects-offered",
  "personalised-tuition",
  "progress-updates",
] as const;

export const featuredFaqs = featuredFaqIds.map((id) => {
  const item = faqById.get(id);

  if (!item) {
    throw new Error(`Featured FAQ not found: ${id}`);
  }

  return item;
});
