/**
 * Every number and switch the careers section runs on, in one place: the file limits, the rate limits,
 * the human check, the retention figures the pages quote, and the two gates that decide whether
 * applications are open. Nothing here is personal data and nothing here is a secret.
 *
 * Read by the pages, the forms (so the browser checks the same limits the server enforces) and the three
 * routes (/api/careers/apply, /api/safeguarding/reconfirm, /api/subject-request). Change a limit here and
 * every one of them follows. The browser's copy of a limit is a courtesy; the server's copy is the rule.
 */

const MB = 1024 * 1024;

export const careersConfig = {
  /**
   * Master switch for online applications. Turn it off to close the form (the pages then say so and offer
   * email) without touching any other code.
   */
  acceptingApplications: true,

  /**
   * OWNER TO CONFIRM. The safeguarding agreement (lib/safeguarding-agreement-v1.ts) is a draft until the
   * owner has approved every clause. While this is false: the agreement page and the reconfirmation page
   * carry a draft notice, the application form and the reconfirmation form are not offered, and both
   * routes refuse submissions with a friendly "email us" message, so unapproved wording can never go live
   * by accident. Set it to true only when every clause in the agreement has `ownerApproved: true`;
   * tests/safeguardingAgreement.test.mjs fails the build if it is true while any clause is not.
   */
  agreementApprovedByOwner: false,

  /** The six-question understanding check (not training): on for applications, off for reconfirmations. */
  understandingCheck: { applications: true, reconfirmation: false },

  /**
   * OWNER TO CONFIRM (a default chosen on the owner's behalf). A separate, unticked, optional box lets an
   * unsuccessful applicant ask to be kept for future roles.
   */
  talentPool: { enabled: true, retentionMonths: 12 },

  /** Months an unsuccessful application (and its identity documents) is kept after the decision. */
  unsuccessfulRetentionMonths: 6,

  minimumAge: 18,

  /** Shown wherever the page promises a reply. */
  responseTime: "We will reply within 5 working days.",

  /** File and text limits. Deliberately cautious: see docs/RENDER.md for the upload-limit test. */
  limits: {
    cv: { maxBytes: 3 * MB, extensions: ["pdf", "docx"] },
    coverLetterFile: { maxBytes: 3 * MB, extensions: ["pdf", "docx"] },
    supporting: { maxFiles: 5, maxBytes: 3 * MB, extensions: ["pdf", "docx", "jpg", "jpeg", "png"] },
    totalBytes: 12 * MB,
    /** Room for the form fields and the multipart framing on top of the files. */
    bodyOverheadBytes: 512 * 1024,
    coverLetterTextMax: 4000,
    shortAnswerMax: 1500,
    whyTutorMin: 80,
    resultsBoxMax: 600,
    /** Photographs and scans larger than this are resized in the browser before upload. */
    imageResizeAboveBytes: 1 * MB,
    imageMaxEdgePx: 2200,
  },

  /**
   * The human check (lib/human-check.ts): a SHA-256 proof of work the visitor's browser solves in a Web
   * Worker. `difficultyBits` is the number of leading zero bits the hash must have, so each extra bit
   * doubles the work. Tuned by measurement (docs/RENDER.md records the timings) to take about a second on a
   * mid-range phone and a fraction of that on a laptop.
   */
  humanCheck: { difficultyBits: 17, ttlMs: 20 * 60 * 1000 },

  /**
   * In-memory rate limits (lib/rate-limit.ts). They are correct for ONE Render instance and reset when it
   * restarts; docs/RENDER.md says what to add if the service ever runs on several. `perClient` is per
   * visitor address, `global` caps the whole route so a forged address cannot flood the mailbox.
   */
  rateLimits: {
    apply: { perClient: { max: 3, windowMs: 60 * 60 * 1000 }, global: { max: 30, windowMs: 60 * 60 * 1000 } },
    reconfirm: { perClient: { max: 5, windowMs: 60 * 60 * 1000 }, global: { max: 60, windowMs: 60 * 60 * 1000 } },
    subjectRequest: { perClient: { max: 5, windowMs: 15 * 60 * 1000 }, global: { max: 120, windowMs: 60 * 60 * 1000 } },
    challenge: { perClient: { max: 40, windowMs: 15 * 60 * 1000 }, global: { max: 600, windowMs: 60 * 60 * 1000 } },
  },

  /**
   * The least time a person plausibly needs to fill each form, measured from when the page opened. A
   * script is faster. Applies in production only, so a developer or an e2e run may be quick.
   */
  minFillMs: { apply: 30_000, reconfirm: 15_000, subjectRequest: 4_000 },

  /**
   * The steps shown to the public, exactly as the owner set them. Only these steps: do not add others.
   */
  hiringSteps: [
    { title: "Apply online", text: "Fill in the application, including reading and agreeing to the safeguarding agreement." },
    { title: "We review your application", text: "The team reviews your CV, your experience and your results." },
    { title: "We contact you", text: "We get in touch about next steps." },
    { title: "Identity and right-to-work checks", text: "We check who you are and that you can work in the UK." },
    { title: "Enhanced DBS check", text: "An Enhanced DBS check including the Children’s Barred List, arranged by LearnThrive." },
    { title: "You sign the tutor agreement", text: "It includes the safeguarding expectations you agreed to when you applied." },
    { title: "You start teaching", text: "Once every check is complete. No tutor teaches any student before then." },
  ],
} as const;

type Env = Record<string, string | undefined>;

/**
 * Development and tests only: lets the dev server (and the e2e suite) exercise the application form while
 * the agreement is still a draft. Ignored in a production build, whatever the variable says.
 */
export function previewOpen(env: Env = process.env): boolean {
  return env.NODE_ENV !== "production" && env.CAREERS_OPEN_FOR_TESTING === "1";
}

/** Whether the agreement-dependent forms (application, reconfirmation) are offered and accepted. */
export function agreementOpen(env: Env = process.env): boolean {
  return careersConfig.agreementApprovedByOwner || previewOpen(env);
}

/** Whether online applications are open: switched on, and the agreement approved. */
export function applicationsOpen(env: Env = process.env): boolean {
  return careersConfig.acceptingApplications && agreementOpen(env);
}

/** The most bytes a careers request may carry: every file at the cap plus the fields. */
export function maxApplicationRequestBytes(): number {
  return careersConfig.limits.totalBytes + careersConfig.limits.bodyOverheadBytes;
}
