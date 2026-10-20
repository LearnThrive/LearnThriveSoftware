import type { FaqItem } from "@/lib/faqs";
import { libraryConfig, PRICE_ANNOUNCED_AT_LAUNCH, type LibraryPhase, type LibraryPrices } from "@/lib/library-config";
import { subjects } from "@/lib/site";

/**
 * The words on /library and /pricing, in one place. DRAFT COPY for the owners to approve: every sentence traces to
 * a fact they confirmed (plan19.md section 0, phase B2 and section 9) and to nothing else. No launch date, no
 * counts, no claim about quality, results or exam boards, and no price unless one is set in configuration.
 */
export const LIBRARY_ITEMS = ["Worksheets", "Exam-style papers", "Mark schemes", "Notes"] as const;

export const LEVELS = "Key Stage 2 to A Level";

/** "Maths, English, Science and 11+ Preparation", from the same list the rest of the site uses. */
export const SUBJECT_TITLES = subjects.map((subject) => subject.title);
export const SUBJECT_SENTENCE = `${SUBJECT_TITLES.slice(0, -1).join(", ")} and ${SUBJECT_TITLES[SUBJECT_TITLES.length - 1]}`;

export const TERMS_NOTE = "Terms, price, renewal and cancellation details will be shown in full before anyone pays.";

/** What the pricing card lists: only the confirmed facts. */
export const CARD_FEATURES = [
  "Worksheets, exam-style papers, mark schemes and notes, all made by LearnThrive",
  `${SUBJECT_SENTENCE}, ${LEVELS}`,
  "Sign in, browse and download",
  "Included for students enrolled with LearnThrive",
] as const;

/** The price as one phrase: "£9.99 a month", both prices, or the plain "Price announced at launch". */
export function priceSummary(prices: LibraryPrices): string {
  const parts = [prices.monthly && `${prices.monthly} a month`, prices.annual && `${prices.annual} a year`].filter(Boolean);
  return parts.length > 0 ? parts.join(" or ") : PRICE_ANNOUNCED_AT_LAUNCH;
}

/** The overview page's hero and at-a-glance words for a phase. `info` is the coming-soon copy from phase B2, unchanged. */
export function heroCopy(phase: LibraryPhase) {
  if (phase === "live") {
    return {
      eyebrow: "Library",
      intro: "Worksheets, exam-style papers, mark schemes and notes, all made by LearnThrive. Included for enrolled students, and available to everyone else by subscription.",
      status: "Open",
      everyoneElse: "By subscription",
      howEyebrow: "How it works",
      howNote: "Sign in, browse and download. Free samples are open to anyone with an account. The price, renewal and cancellation details are shown in full before you pay.",
    };
  }
  const open = phase !== "info";
  return {
    eyebrow: open ? "Library · Open to enrolled students" : "Library · Coming soon",
    intro: open
      ? "Worksheets, exam-style papers, mark schemes and notes, all made by LearnThrive. Open now to enrolled students. A subscription for everyone else is coming soon."
      : "Worksheets, exam-style papers, mark schemes and notes, all made by LearnThrive. The Library is coming soon.",
    status: open ? "Open to enrolled students" : "Coming soon",
    everyoneElse: open ? "Subscription coming soon" : "By subscription",
    howEyebrow: open ? "How it works" : "How it will work",
    howNote: open
      ? `Enrolled students sign in with the account their family holds with LearnThrive. Free samples are open to anyone with an account. A subscription for everyone else is coming soon. ${TERMS_NOTE}`
      : `None of this is open yet. ${TERMS_NOTE}`,
  };
}

export function libraryFaqs(prices: LibraryPrices, phase: LibraryPhase = "info"): FaqItem[] {
  const priced = Boolean(prices.monthly || prices.annual);
  const live = phase === "live";
  const open = phase !== "info";
  return [
    {
      id: "library-what-is-it",
      question: "What is the Library?",
      answer: "The Library is a collection of worksheets, exam-style papers, mark schemes and notes, all made by LearnThrive.",
    },
    {
      id: "library-who-is-it-for",
      question: "Who is it for?",
      answer: live
        ? "It is included for students enrolled with LearnThrive. Anyone else can pay a subscription for all of it."
        : "It is included for students enrolled with LearnThrive. Anyone else will be able to pay a subscription for all of it.",
    },
    {
      id: "library-subjects-and-levels",
      question: "Which subjects and levels will it cover?",
      answer: `${SUBJECT_SENTENCE}, ${LEVELS}.`,
    },
    {
      id: "library-when",
      question: "When will it open?",
      answer: live
        ? "It is open now. Enrolled students have it included, and anyone else can subscribe."
        : open
          ? "It is open now to enrolled students. A subscription for everyone else is coming soon, and we do not have a date to give you yet. Join the waitlist and we will email you once, when subscriptions launch."
          : "It is coming soon, and we do not have a date to give you yet. Join the waitlist and we will email you once, when it launches.",
    },
    {
      id: "library-cost",
      question: "What will it cost?",
      answer: `${priced ? `The subscription is ${priceSummary(prices)}.` : "The price will be announced at launch."} It is included for enrolled students. ${TERMS_NOTE}`,
      link: { href: "/pricing", label: "See the plan" },
    },
    {
      id: "library-access",
      question: "How will I get access?",
      answer: live
        ? "Sign in, browse the Library and download what you need. It is included for enrolled students, free samples are open to anyone with an account, and anyone else can subscribe from the pricing page."
        : open
          ? "Sign in, browse the Library and download what you need. It is included for enrolled students, and free samples are open to anyone with an account. Anyone else will be able to subscribe once subscriptions open."
          : "You will sign in, browse the Library and download what you need. Enrolled students will have it included, and anyone else will be able to subscribe. None of this is open yet.",
    },
    {
      id: "library-waitlist-data",
      question: "Is anything stored when I join the waitlist?",
      answer: `No. Your email address is not stored on this website. It stays in our mailbox until we send the one launch email, or for ${libraryConfig.waitlist.retentionMonths} months, whichever comes first, and we delete it if you ask.`,
      link: { href: "/privacy", label: "Read our privacy notice" },
    },
  ];
}
