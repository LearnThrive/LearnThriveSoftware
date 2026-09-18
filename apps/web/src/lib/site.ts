export const siteConfig = {
  name: "LearnThrive Tuition",
  shortName: "LearnThrive",
  tagline: "Learn. Grow. Thrive.",
  url: "https://www.learnthrivetuition.co.uk",
  email: "info@learnthrivetuition.co.uk",
  phoneContacts: [
    {
      name: "Tahasin Hasan",
      phoneDisplay: "+44 7459 839595",
      phoneHref: "+447459839595",
    },
    {
      name: "Abdurrahman Mustafa",
      phoneDisplay: "+44 7883 745337",
      phoneHref: "+447883745337",
    },
  ],
  description:
    "Personalised online tuition in Maths, English and Science from KS2 to A Level, plus 11+ preparation.",
  social: {
    instagram: "https://www.instagram.com/learnthrivetuition/",
    linkedin: "https://www.linkedin.com/company/learnthrive-tuition/",
  },
  tutorLoginUrl: "https://secure.tutorcruncher.com/learnthrive-tuition/login/",
} as const;

export const navigation = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/subjects", label: "Subjects" },
  { href: "/faq", label: "FAQ" },
  { href: "/book", label: "Book" },
  { href: "/contact", label: "Contact" },
] as const;

export type IconName =
  | "personal"
  | "tutor"
  | "interactive"
  | "progress"
  | "results"
  | "maths"
  | "english"
  | "science"
  | "eleven"
  | "parent"
  | "discuss"
  | "match"
  | "learn"
  | "clarity"
  | "encouragement"
  | "partnership"
  | "growth";

export const trustPoints: Array<{
  title: string;
  text: string;
  icon: IconName;
}> = [
  {
    title: "Personalised learning",
    text: "Lessons shaped around the individual learner",
    icon: "personal",
  },
  {
    title: "Experienced tutors",
    text: "Clear teaching with patient, focused support",
    icon: "tutor",
  },
  {
    title: "Interactive online lessons",
    text: "Live teaching, feedback and shared learning tools",
    icon: "interactive",
  },
  {
    title: "Regular parent updates",
    text: "Clear notes on progress and next steps",
    icon: "progress",
  },
];

export const learningFeatures: Array<{
  title: string;
  text: string;
  icon: IconName;
}> = [
  {
    title: "Personalised teaching",
    text: "Every lesson responds to the student’s strengths, challenges and goals.",
    icon: "personal",
  },
  {
    title: "Expert tutors",
    text: "Subject-focused tutors make difficult ideas clearer and build confidence steadily.",
    icon: "tutor",
  },
  {
    title: "Interactive learning",
    text: "Live whiteboards, worked examples and real-time feedback keep sessions active.",
    icon: "interactive",
  },
  {
    title: "Progress tracking",
    text: "Lesson notes and regular updates help parents understand what comes next.",
    icon: "progress",
  },
  {
    title: "Results that matter",
    text: "The focus is on stronger understanding, confidence and independent learning habits.",
    icon: "results",
  },
];

export type SubjectLandingSlug =
  | "maths"
  | "english"
  | "science"
  | "11-plus";

type SubjectContentItem = {
  title: string;
  text: string;
};

type SubjectSupportItem = SubjectContentItem & {
  icon: IconName;
};

export type SubjectLandingConfig = {
  slug: SubjectLandingSlug;
  title: string;
  stage: string;
  icon: IconName;
  summary: string;
  detail: string;
  focus: readonly string[];
  path: `/${string}`;
  ctaLabel: string;
  seo: {
    title: string;
    description: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    intro: string;
    noteLabel: string;
    note: string;
  };
  support: {
    eyebrow: string;
    title: string;
    intro: string;
    items: readonly SubjectSupportItem[];
  };
  coverage: {
    eyebrow: string;
    title: string;
    intro: string;
    itemLabel: string;
    items: readonly SubjectContentItem[];
  };
  spotlight: {
    eyebrow: string;
    title: string;
    text: string;
    points: readonly SubjectContentItem[];
  };
  cta: {
    title: string;
    text: string;
  };
};

export const subjectLandingPages: Record<
  SubjectLandingSlug,
  SubjectLandingConfig
> = {
  maths: {
    slug: "maths",
    title: "Maths",
    stage: "KS2 to A Level",
    icon: "maths",
    summary:
      "Build secure understanding, sharper problem-solving and the confidence to approach unfamiliar questions.",
    detail:
      "Support develops from number skills and reasoning at KS2 through algebra, geometry and exam technique at KS3 and GCSE. At A Level, lessons can cover advanced areas including calculus, statistics and mechanics.",
    focus: ["Core understanding", "Problem-solving", "Exam confidence"],
    path: "/maths-tuition",
    ctaLabel: "Explore Maths Tuition",
    seo: {
      title: "Online Maths Tuition",
      description:
        "Personalised one-to-one online Maths tuition from KS2 to A Level, with clear explanations and focused support shaped around each learner.",
    },
    hero: {
      eyebrow: "Online Maths tuition · KS2 to A Level",
      title: "Personalised Maths Tuition",
      intro:
        "One-to-one online Maths tuition shaped around the learner’s current understanding, areas of difficulty and academic priorities. Clear explanations and focused practice give students time to work through concepts at an appropriate pace.",
      noteLabel: "Maths tuition",
      note: "Clear explanations, purposeful practice and support shaped around the learner.",
    },
    support: {
      eyebrow: "How we support Maths students",
      title: "Build understanding that students can use",
      intro:
        "Lessons focus on the ideas and questions in front of the learner, while keeping schoolwork and relevant assessments in view.",
      items: [
        {
          title: "Secure foundations",
          text: "Identify gaps in core understanding and revisit them before moving on to more demanding work.",
          icon: "clarity",
        },
        {
          title: "Clearer methods",
          text: "Break difficult ideas into manageable steps, with time to ask questions and work at an appropriate pace.",
          icon: "personal",
        },
        {
          title: "Stronger problem-solving",
          text: "Practise applying knowledge to unfamiliar questions rather than simply repeating a method.",
          icon: "growth",
        },
        {
          title: "Purposeful practice",
          text: "Direct lesson time towards weaker topics, school learning and relevant assessment priorities.",
          icon: "progress",
        },
      ],
    },
    coverage: {
      eyebrow: "Maths support by stage",
      title: "From strong foundations to advanced reasoning",
      intro:
        "The focus changes as students progress, but clear understanding remains central at every stage.",
      itemLabel: "Stage",
      items: [
        {
          title: "KS2",
          text: "Strengthen number skills, arithmetic, fractions and mathematical reasoning, with clear support around core concepts and problem-solving.",
        },
        {
          title: "KS3",
          text: "Consolidate foundations and develop number, algebra and geometry skills in preparation for more advanced work.",
        },
        {
          title: "GCSE",
          text: "Target weaker topics, connect methods to problem-solving and approach assessment questions with greater confidence.",
        },
        {
          title: "A Level",
          text: "Work through demanding areas—including calculus, statistics and mechanics where relevant—using deeper reasoning and structured practice.",
        },
      ],
    },
    spotlight: {
      eyebrow: "Why personalised Maths tuition?",
      title: "Maths support that meets the learner where they are",
      text: "A student may need another explanation, time to repair an earlier gap or more practice applying what they know. Individual tuition lets each lesson respond to that need while keeping academic priorities in view.",
      points: [
        {
          title: "More explanation",
          text: "Revisit a difficult idea and try another route until it becomes clearer.",
        },
        {
          title: "Earlier gaps",
          text: "Strengthen missing foundations that may be holding back current work.",
        },
        {
          title: "A different pace",
          text: "Make space to think, practise and ask questions without being rushed.",
        },
        {
          title: "Additional challenge",
          text: "Extend confident learners with more demanding reasoning and problems.",
        },
      ],
    },
    cta: {
      title: "Talk to us about Maths tuition",
      text: "Share the learner’s stage, current challenges and priorities so we can discuss the support they need.",
    },
  },
  english: {
    slug: "english",
    title: "English",
    stage: "KS2 to A Level",
    icon: "english",
    summary:
      "Become a more confident reader, writer and communicator through clear, purposeful teaching.",
    detail:
      "Younger learners can strengthen comprehension, vocabulary, grammar and writing. Older students can develop language analysis, literary interpretation, essay structure and confident written arguments.",
    focus: ["Reading and analysis", "Writing skills", "Clear expression"],
    path: "/english-tuition",
    ctaLabel: "Explore English Tuition",
    seo: {
      title: "Online English Tuition",
      description:
        "Personalised one-to-one online English tuition from KS2 to A Level, supporting reading, writing, communication and confidence.",
    },
    hero: {
      eyebrow: "Online English tuition · KS2 to A Level",
      title: "Personalised English Tuition",
      intro:
        "Personalised English lessons take place online and one-to-one, adapting to the student’s reading, writing and communication needs. Tuition can strengthen comprehension, develop clearer written expression and build confidence with the work they meet at school.",
      noteLabel: "English tuition",
      note: "Thoughtful support for reading, writing, interpretation and clearer expression.",
    },
    support: {
      eyebrow: "Areas of English support",
      title: "Make ideas clearer on the page",
      intro:
        "Support can move between understanding a text and communicating a response, depending on what the student is working towards.",
      items: [
        {
          title: "Reading with understanding",
          text: "Develop comprehension and make sense of meaning, detail and ideas within a text.",
          icon: "learn",
        },
        {
          title: "Clear, structured writing",
          text: "Organise written responses so ideas are easier to follow and arguments develop logically.",
          icon: "english",
        },
        {
          title: "Grammar and vocabulary",
          text: "Reinforce accurate language choices and build the vocabulary needed for confident expression.",
          icon: "clarity",
        },
        {
          title: "Analysis and interpretation",
          text: "Explore how language and texts communicate ideas, then express that thinking more clearly.",
          icon: "encouragement",
        },
      ],
    },
    coverage: {
      eyebrow: "English support by stage",
      title: "Reading and writing that develop with the learner",
      intro:
        "Lessons respond to the level of the work, from secure literacy foundations to sustained analytical writing.",
      itemLabel: "Stage",
      items: [
        {
          title: "KS2",
          text: "Strengthen comprehension, vocabulary, grammar and purposeful writing while building confidence with English.",
        },
        {
          title: "KS3",
          text: "Develop reading and language analysis, organise longer pieces of writing and express interpretations more clearly.",
        },
        {
          title: "GCSE",
          text: "Consolidate language analysis and literary interpretation, improve response structure and prepare for assessment work.",
        },
        {
          title: "A Level",
          text: "Develop deeper interpretation, sustained analytical writing and well-structured written arguments.",
        },
      ],
    },
    spotlight: {
      eyebrow: "Building confidence in English",
      title: "Helping students turn understanding into clear expression",
      text: "Some students need support making sense of a text; others know what they want to say but struggle to organise it. Lessons can move between comprehension, language, planning and feedback according to the work in front of the learner.",
      points: [
        {
          title: "Understand texts",
          text: "Pause over meaning, evidence and ideas before moving to a response.",
        },
        {
          title: "Shape ideas",
          text: "Talk through a line of thought and turn it into clear written communication.",
        },
        {
          title: "Improve structure",
          text: "Plan and organise writing so each point contributes to the whole response.",
        },
        {
          title: "Think independently",
          text: "Build the confidence to form and explain an interpretation in the student’s own words.",
        },
      ],
    },
    cta: {
      title: "Discuss English tuition for your child",
      text: "Tell us about the reading, writing or communication support they need and the work they are currently completing.",
    },
  },
  science: {
    slug: "science",
    title: "Science",
    stage: "KS2 to A Level",
    icon: "science",
    summary:
      "Make scientific ideas easier to understand and apply across biology, chemistry and physics.",
    detail:
      "Lessons connect key ideas with structured explanations and problem-solving. Support can progress from foundational scientific understanding to deeper analytical and exam-focused work at GCSE and A Level.",
    focus: ["Biology", "Chemistry", "Physics"],
    path: "/science-tuition",
    ctaLabel: "Explore Science Tuition",
    seo: {
      title: "Online Science Tuition",
      description:
        "Personalised one-to-one online Science tuition from KS2 to A Level, helping students understand concepts and apply scientific reasoning.",
    },
    hero: {
      eyebrow: "Online Science tuition · KS2 to A Level",
      title: "Personalised Science Tuition",
      intro:
        "Clear, structured explanations are central to one-to-one online Science tuition, making difficult ideas easier to understand. Support connects key concepts with questions, reasoning and the student’s current priorities.",
      noteLabel: "Science tuition",
      note: "Concept-led support in the science being studied, shaped around the student’s stage.",
    },
    support: {
      eyebrow: "How Science tuition helps",
      title: "Understand the idea, then apply it",
      intro:
        "Rather than treating Science as a list of facts, lessons connect knowledge with the reasoning and questions students meet.",
      items: [
        {
          title: "Key concepts",
          text: "Build understanding that can be applied, revisiting important foundations where gaps appear.",
          icon: "science",
        },
        {
          title: "Theory into questions",
          text: "Use focused practice to relate scientific ideas to the problems students need to solve.",
          icon: "interactive",
        },
        {
          title: "Scientific reasoning",
          text: "Develop the thinking needed to explain, analyse and work through unfamiliar questions.",
          icon: "clarity",
        },
        {
          title: "Subject-specific support",
          text: "Focus on Biology, Chemistry or Physics according to the student’s stage and priorities.",
          icon: "progress",
        },
      ],
    },
    coverage: {
      eyebrow: "Science support by stage",
      title: "Clear explanations as the ideas become more complex",
      intro:
        "Support progresses from foundational scientific understanding to deeper analytical work in the science being studied.",
      itemLabel: "Stage",
      items: [
        {
          title: "KS2",
          text: "Build foundational scientific understanding and confidence explaining core ideas in clear terms.",
        },
        {
          title: "KS3",
          text: "Connect ideas across Biology, Chemistry and Physics, strengthen foundations and prepare for more analytical work.",
        },
        {
          title: "GCSE",
          text: "Consolidate key knowledge, apply concepts to structured questions and target areas needing further explanation.",
        },
        {
          title: "A Level",
          text: "Work through more complex concepts and analytical problem-solving in the science being studied, using focused practice.",
        },
      ],
    },
    spotlight: {
      eyebrow: "Making difficult concepts clearer",
      title: "Untangle the topic one step at a time",
      text: "When a topic feels overwhelming, lessons can break it into manageable steps, adapt the explanation and make space for questions. Targeted practice then helps the student connect what they understand with the questions they need to answer.",
      points: [
        {
          title: "Break it down",
          text: "Separate a complex topic into smaller ideas that can be understood in sequence.",
        },
        {
          title: "Ask questions",
          text: "Make room to explore what is unclear before moving on to the next step.",
        },
        {
          title: "Connect knowledge",
          text: "See how individual facts and concepts relate within the wider topic.",
        },
        {
          title: "Practise with purpose",
          text: "Apply clearer understanding to appropriate questions and current priorities.",
        },
      ],
    },
    cta: {
      title: "Discuss Science tuition for your child",
      text: "Share the student’s stage, the science they are studying and difficult topics so we can discuss a suitable focus for tuition.",
    },
  },
  "11-plus": {
    slug: "11-plus",
    title: "11+ Preparation",
    stage: "Focused preparation",
    icon: "eleven",
    summary:
      "Develop accuracy, pace and exam technique through support tailored to the learner’s current needs.",
    detail:
      "Preparation can cover Maths, English, verbal reasoning and non-verbal reasoning. Lessons identify gaps, practise key question types and help learners approach the assessment with greater confidence.",
    focus: ["Maths and English", "Verbal reasoning", "Non-verbal reasoning"],
    path: "/11-plus-tuition",
    ctaLabel: "Explore 11+ Preparation",
    seo: {
      title: "Online 11+ Tuition and Preparation",
      description:
        "Personalised one-to-one online 11+ preparation in Maths, English and relevant reasoning skills, shaped around each pupil’s needs.",
    },
    hero: {
      eyebrow: "Online one-to-one 11+ support",
      title: "Personalised 11+ Preparation",
      intro:
        "Personalised 11+ preparation takes place online and one-to-one, shaped around the pupil’s current strengths and areas for development. Support can cover Maths, English, verbal reasoning and non-verbal reasoning, with structured practice to build accuracy, pace and confidence.",
      noteLabel: "Focused preparation",
      note: "The right focus depends on the pupil and the assessment they are preparing for.",
    },
    support: {
      eyebrow: "Areas of preparation",
      title: "Build skills, accuracy and a steady approach",
      intro:
        "The content and format of 11+ assessments vary, so support should reflect the pupil’s needs and the assessment in view.",
      items: [
        {
          title: "Maths and problem-solving",
          text: "Strengthen core skills and practise applying them to appropriate question types.",
          icon: "maths",
        },
        {
          title: "English and comprehension",
          text: "Develop careful reading and comprehension, and practise approaching English questions with confidence.",
          icon: "english",
        },
        {
          title: "Reasoning skills",
          text: "Work on verbal and non-verbal reasoning where they form part of the pupil’s assessment.",
          icon: "eleven",
        },
        {
          title: "Accuracy and pace",
          text: "Develop a steadier approach to familiar and unfamiliar questions without sacrificing careful thinking.",
          icon: "progress",
        },
      ],
    },
    coverage: {
      eyebrow: "Building strong foundations",
      title: "Preparation priorities that adapt to the pupil",
      intro:
        "Effective preparation starts with understanding, then uses consistent and focused practice to build readiness without creating unnecessary pressure.",
      itemLabel: "Priority",
      items: [
        {
          title: "Understand the starting point",
          text: "Identify current strengths, gaps and the areas that would benefit most from attention.",
        },
        {
          title: "Strengthen foundations",
          text: "Build secure Maths, English and reasoning skills according to the pupil’s needs.",
        },
        {
          title: "Practise question approaches",
          text: "Work through appropriate question types and learn how to handle unfamiliar tasks.",
        },
        {
          title: "Develop assessment readiness",
          text: "Build accuracy, pace and confidence through focused, consistent practice.",
        },
      ],
    },
    spotlight: {
      eyebrow: "Personalised preparation",
      title: "Focused support, not a one-size-fits-all programme",
      text: "Pupils do not begin with the same strengths, and 11+ requirements vary. Tuition can concentrate on areas requiring development while building on secure skills. Families can share school or assessment information during the consultation so the tuition focus can be discussed in the right context.",
      points: [
        {
          title: "Current strengths",
          text: "Build from the skills and question types the pupil already handles securely.",
        },
        {
          title: "Areas to develop",
          text: "Use lesson time where explanation and practice can make the most useful difference.",
        },
        {
          title: "Appropriate pace",
          text: "Balance accuracy with gradually developing a steadier pace for assessment work.",
        },
        {
          title: "Assessment context",
          text: "Keep preparation aligned with the information provided by the family.",
        },
      ],
    },
    cta: {
      title: "Discuss personalised 11+ preparation",
      text: "Tell us about the pupil, the assessment they are preparing for and the areas where support would be most useful.",
    },
  },
};

export const subjects = Object.values(subjectLandingPages);

export const howItWorks: Array<{
  title: string;
  text: string;
  icon: IconName;
}> = [
  {
    title: "Tell us about your child",
    text: "Share their year group, subject and the support you are looking for.",
    icon: "parent",
  },
  {
    title: "Discuss their needs",
    text: "A consultation helps clarify current challenges, priorities and goals.",
    icon: "discuss",
  },
  {
    title: "Find the right support",
    text: "LearnThrive considers the subject, level and learner when arranging tuition.",
    icon: "match",
  },
  {
    title: "Learn and track progress",
    text: "Lessons begin with a clear focus, with progress shared along the way.",
    icon: "learn",
  },
];

export const testimonials = [
  {
    title: "Confidence booster",
    quote:
      "LearnThrive Tuition has made such a difference to my son’s confidence. He used to struggle with maths, but now approaches it calmly and explains his thinking. The support has been patient and genuinely caring.",
    attribution: "Mohammed M, parent of a Year 6 pupil",
  },
  {
    title: "Real learning growth",
    quote:
      "My daughter’s grades improved within a few months, but more importantly her confidence grew. She understands the work instead of memorising it, and that has changed how she feels about school.",
    attribution: "James H, parent of a Year 9 student",
  },
  {
    title: "Bespoke tutoring",
    quote:
      "What I appreciate most is the clear communication. We are always kept informed about progress and next steps. It feels professional while still being very personal to our child.",
    attribution: "Aisha K, parent of a GCSE student",
  },
  {
    title: "The best choice",
    quote:
      "We tried other tutors before, but LearnThrive stood out immediately. Lessons are well structured and focused on exactly what my child needs. Exam confidence has improved a lot.",
    attribution: "Daniel P, parent of a Year 8 student",
  },
  {
    title: "Engaging and effective",
    quote:
      "My son struggles to stay focused, but from the first session he was engaged. The tutor built a strong relationship with him, and we have seen real improvement in both effort and results.",
    attribution: "Emma R, parent of a Year 8 student",
  },
] as const;

export const values: Array<{
  title: string;
  text: string;
  icon: IconName;
}> = [
  {
    title: "Clarity",
    text: "Complex ideas are broken down into manageable, understandable steps.",
    icon: "clarity",
  },
  {
    title: "Encouragement",
    text: "Patient teaching helps learners ask questions, make mistakes and keep going.",
    icon: "encouragement",
  },
  {
    title: "Partnership",
    text: "Students, parents and tutors stay connected around shared priorities.",
    icon: "partnership",
  },
  {
    title: "Progress",
    text: "Lessons focus on useful next steps and more independent learning over time.",
    icon: "growth",
  },
];

export const yearGroups = [
  "Year 3",
  "Year 4",
  "Year 5",
  "Year 6",
  "Year 7",
  "Year 8",
  "Year 9",
  "Year 10",
  "Year 11",
  "Year 12",
  "Year 13",
  "Other / not sure",
] as const;

export const subjectOptions = [
  "Maths",
  "English",
  "Science",
  "11+ Preparation",
  "More than one subject",
  "Not sure yet",
] as const;
