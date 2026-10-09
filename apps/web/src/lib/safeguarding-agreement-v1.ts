import type { SafeguardingAgreement } from "@/lib/safeguarding-agreement";

/**
 * LearnThrive safeguarding agreement, version 1.0. A DRAFT until the owner approves it.
 *
 * NEVER EDIT A PUBLISHED VERSION IN PLACE. Once the owner has approved this wording and the agreement is
 * live, any change is a new file (safeguarding-agreement-v2.ts), a new version string, and an entry in the
 * registry in safeguarding-agreement.ts; every active tutor must then reconfirm. When this version is
 * published, record `publishedHash` (the value `npm test` prints on failure, or agreementHash() in
 * lib/agreement-record.ts) so tests/safeguardingAgreement.test.mjs fails if anyone edits it afterwards.
 *
 * `ownerApproved: true` is used only where a clause restates, and goes no further than, a rule the owner has
 * confirmed. Every other clause is a proposal. The `confirmed` note says which owner decision a clause
 * rests on; it is for the owners and the reviewer, and is not shown to applicants.
 *
 * Writing rules applied to every clause: one specific, checkable obligation, written as "I will" or "I will
 * not"; no "try", "where possible", "normally" or "appropriate" unless the term is defined; timing stated
 * exactly; terms defined once and used consistently.
 */
export const agreementV1: SafeguardingAgreement = {
  version: "1.0",
  date: "2026-10-09",
  dateLabel: "9 October 2026",
  title: "LearnThrive safeguarding agreement",
  publishedHash: null,
  intro: [
    "This agreement sets out what every LearnThrive tutor must do, and must never do, when working with children and young people. It is firm on purpose. Children’s safety comes before everything else.",
    "Read every clause. You must agree to all of it to apply. If you do not understand any part, ask the safeguarding lead before you agree. These expectations then become part of the tutor agreement you sign if you are offered work.",
  ],
  definitions: [
    { term: "Student", meaning: "Any person I teach, or am asked to teach, through LearnThrive." },
    { term: "Family", meaning: "A student’s parent, guardian or any other family member." },
    {
      term: "LearnThrive channels",
      meaning: "The lesson platform, and the communication routes, that LearnThrive provides or approves in writing. Nothing else counts.",
    },
    {
      term: "Contact",
      meaning:
        "Any communication of any kind: voice, video, text, messaging apps, email, social media, gaming platforms, messages passed through other people, or meeting in person.",
    },
    { term: "Safeguarding concern", meaning: "Anything described in clause A4." },
    { term: "Safeguarding lead", meaning: "Tahasin Hasan." },
    { term: "Deputy safeguarding lead", meaning: "Abdurrahman Mustafa." },
    {
      term: "Checks",
      meaning:
        "The Enhanced DBS check including the Children’s Barred List, identity checks, right-to-work checks, and every other suitability check LearnThrive carries out.",
    },
    {
      term: "Private room",
      meaning: "A room with the door closed, where nobody other than me can see or hear the lesson or the student.",
    },
    { term: "Immediately", meaning: "Straight away, before I do anything else except what is needed to keep a child safe." },
    { term: "The same day", meaning: "Before midnight, UK time, on the day I first become aware." },
  ],
  parts: [
    {
      id: "A",
      heading: "Reporting and responding to concerns",
      clauses: [
        {
          id: "A1",
          text:
            "I will report any safeguarding concern to the safeguarding lead, Tahasin Hasan, immediately, and never later than the same day, using the contact route LearnThrive gives me. If I cannot reach the safeguarding lead, I will report it in the same way to the deputy safeguarding lead, Abdurrahman Mustafa.",
          ownerApproved: true,
          confirmed: "Owner decision: concerns are reported to the safeguarding lead (Tahasin Hasan) and deputy (Abdurrahman Mustafa).",
        },
        {
          id: "A2",
          text:
            "If my concern is about the safeguarding lead, I will report it to the deputy safeguarding lead. If it is about both of them, I will report it directly to the police or to the local authority’s children’s social care.",
          ownerApproved: false,
        },
        {
          id: "A3",
          text: "If a child is in immediate danger, I will call 999 first. I will then tell the safeguarding lead as soon as the child is safe.",
          ownerApproved: false,
        },
        {
          id: "A4",
          text: "A safeguarding concern includes all of the following. If I am unsure whether something counts, I will report it.",
          items: [
            "a child telling me, or hinting, that they or another child have been hurt, neglected, abused or frightened, or are at risk;",
            "signs of injury, neglect, distress, self-harm or fear that I see or hear in a lesson;",
            "a child saying they feel unsafe, or that an adult is behaving in a way that worries them;",
            "worrying behaviour by any adult that I see or hear during a lesson, including another adult in the room;",
            "signs that a child is being groomed or exploited, online or offline;",
            "anyone contacting a child in a way that worries me;",
            "any contact request, gift or inappropriate behaviour from a student or a family member towards me; and",
            "worrying or inappropriate behaviour by any adult connected with LearnThrive, including other tutors and the directors.",
          ],
          ownerApproved: false,
        },
        {
          id: "A5",
          text: "When a child tells me something worrying, I will listen calmly. I will not ask leading questions and I will not investigate.",
          ownerApproved: false,
        },
        {
          id: "A6",
          text:
            "I will never promise a child that I will keep something secret. I will tell the child that I may need to pass it on to keep them safe.",
          ownerApproved: false,
        },
        {
          id: "A7",
          text:
            "I will not discuss a safeguarding concern with anyone except the safeguarding lead, the deputy safeguarding lead or the emergency services.",
          ownerApproved: false,
        },
        {
          id: "A8",
          text:
            "I will write down what I saw or heard, with the date and time, using the child’s own words for anything the child said. I will give it to the safeguarding lead the same day.",
          ownerApproved: false,
        },
        {
          id: "A9",
          text: "After I have passed my written record to the safeguarding lead, I will delete my own copy unless LearnThrive tells me to keep it.",
          ownerApproved: false,
        },
        {
          id: "A10",
          text: "I will follow the safeguarding lead’s instructions on any safeguarding matter immediately.",
          ownerApproved: false,
        },
      ],
    },
    {
      id: "B",
      heading: "Contact and communication",
      clauses: [
        { id: "B1", text: "I will communicate with students and families only through LearnThrive channels.", ownerApproved: false },
        { id: "B2", text: "I will teach students only on the lesson platform that LearnThrive provides.", ownerApproved: false },
        {
          id: "B3",
          text:
            "I will not contact a student or any member of a family outside LearnThrive channels. This includes phone calls, texts, WhatsApp and other messaging apps, email, social media, direct messages and gaming platforms, and contact through friends or relatives.",
          ownerApproved: false,
        },
        {
          id: "B4",
          text:
            "If a student or a family member contacts me outside LearnThrive channels, I will not reply. I will report it to the safeguarding lead the same day.",
          ownerApproved: false,
        },
        {
          id: "B5",
          text:
            "I will not share my personal phone number, email address, social media or any other personal account details with a student or a family member, and I will not ask for theirs.",
          ownerApproved: false,
        },
        {
          id: "B6",
          text:
            "I will not follow, befriend, connect with or message a student or a family member on social media, and I will not accept their requests to connect.",
          ownerApproved: false,
        },
        {
          id: "B7",
          text:
            "I will not arrange, offer or agree private or unpaid lessons, extra sessions or any other tuition outside LearnThrive with any student I meet through LearnThrive.",
          ownerApproved: false,
        },
        { id: "B8", text: "I will not ask or encourage a student or a family to leave LearnThrive.", ownerApproved: false },
        {
          id: "B9",
          text:
            "I will not send, ask for or exchange photographs, videos, voice messages, links, files or any other content with a student, other than lesson materials shared through LearnThrive channels.",
          ownerApproved: false,
        },
        {
          id: "B10",
          text: "I will never ask or tell a student to keep a secret from their parent or guardian or from LearnThrive.",
          ownerApproved: false,
        },
        {
          id: "B11",
          text:
            "For as long as a student is under 18, I will not contact that student outside LearnThrive channels, even after I stop teaching them or stop working with LearnThrive.",
          ownerApproved: false,
        },
      ],
    },
    {
      id: "C",
      heading: "Lessons and setting",
      clauses: [
        {
          id: "C1",
          text:
            "Every lesson will take place online, on LearnThrive’s lesson platform. I will never meet a student in person, arrange to meet one, visit a student’s home, or invite a student or a family member to mine.",
          ownerApproved: false,
        },
        {
          id: "C2",
          text: "I will teach every lesson from a private room.",
          ownerApproved: false,
        },
        {
          id: "C3",
          text: "If anyone enters my room, or interrupts a lesson, I will pause the lesson immediately and will not resume until the room is private again.",
          ownerApproved: false,
        },
        {
          id: "C4",
          text:
            "I will keep my camera and microphone on for the whole lesson. I will not turn off my video or end the call early, unless the lesson platform fails or a safeguarding reason requires it.",
          ownerApproved: false,
        },
        {
          id: "C5",
          text:
            "I will dress as I would to teach in a school. Nothing that would be unsuitable around children will be visible or audible in my room, for example nudity, alcohol, drugs, weapons, offensive posters or offensive language.",
          ownerApproved: false,
        },
        {
          id: "C6",
          text: "I will not record, photograph, screenshot, transcribe or otherwise capture any lesson or any student, and I will not allow anyone else to.",
          ownerApproved: false,
        },
        {
          id: "C7",
          text: "I will not use AI note-takers, transcription tools, bots or recording plug-ins in any lesson.",
          ownerApproved: false,
        },
        {
          id: "C8",
          text: "I will not teach while under the influence of alcohol or any drug, or while so unwell that it affects my judgement.",
          ownerApproved: false,
        },
        {
          id: "C9",
          text: "I will teach every lesson myself. I will not let anyone else teach, join or take over any part of a lesson for me.",
          ownerApproved: false,
        },
        {
          id: "C10",
          text:
            "I will not teach a student I have a personal connection with (a relative, friend, neighbour or any other personal relationship) unless the safeguarding lead has agreed in writing beforehand. If I find that a student is someone I know, I will tell the safeguarding lead the same day.",
          ownerApproved: false,
        },
      ],
    },
    {
      id: "D",
      heading: "Conduct and boundaries",
      clauses: [
        {
          id: "D1",
          text:
            "I will keep my language, behaviour, jokes and examples professional and suitable for children at all times. I will not use swearing, or discriminatory, sexual, violent or frightening language or material.",
          ownerApproved: false,
        },
        {
          id: "D2",
          text: "Where the curriculum covers a sensitive topic, I will deal with it factually and in a way that suits the student’s age.",
          ownerApproved: false,
        },
        {
          id: "D3",
          text: "I will not form, or attempt to form, any romantic, sexual or secret relationship with any student, whatever their age.",
          ownerApproved: false,
        },
        {
          id: "D4",
          text: "I will not say or do anything sexual or flirtatious to a student, or in front of a student.",
          ownerApproved: false,
        },
        {
          id: "D5",
          text: "I will not give or accept gifts, money, favours or special treatment, other than the agreed payment for tuition made through LearnThrive.",
          ownerApproved: false,
        },
        {
          id: "D6",
          text:
            "I will not ask a student about their private life, family, body, relationships, religion, health or home circumstances, beyond what I need to know in order to teach them.",
          ownerApproved: false,
        },
        { id: "D7", text: "I will not comment on a student’s appearance.", ownerApproved: false },
        {
          id: "D8",
          text: "I will treat every student fairly and with respect. I will not shout at, bully, humiliate, threaten or discriminate against any student.",
          ownerApproved: false,
        },
        {
          id: "D9",
          text: "I will not pressure a student, or make a student feel uncomfortable or afraid.",
          ownerApproved: false,
        },
        {
          id: "D10",
          text: "If a student tells me they are uncomfortable, I will stop that activity immediately.",
          ownerApproved: false,
        },
        {
          id: "D11",
          text:
            "I will not ask a student to show anything on camera other than their face and their schoolwork, and I will not ask a student to move the camera to show their room.",
          ownerApproved: false,
        },
        {
          id: "D12",
          text: "If I break any part of this agreement, however small, I will tell the safeguarding lead the same day.",
          ownerApproved: false,
        },
      ],
    },
    {
      id: "E",
      heading: "Information and data",
      clauses: [
        {
          id: "E1",
          text:
            "I will keep all information about students and families confidential. I will discuss a student only with LearnThrive, or with the student’s parent or guardian through LearnThrive channels. The only exceptions are where this agreement requires me to report a concern, and where the law requires me to disclose information.",
          ownerApproved: false,
        },
        {
          id: "E2",
          text: "I will keep only the student information I need in order to teach, and I will keep it on a password-protected device with up-to-date security.",
          ownerApproved: false,
        },
        {
          id: "E3",
          text: "I will not store student information in personal cloud accounts, messaging apps or social media accounts.",
          ownerApproved: false,
        },
        {
          id: "E4",
          text: "I will delete student information when I no longer need it, or when LearnThrive asks me to.",
          ownerApproved: false,
        },
        {
          id: "E5",
          text: "I will not share lesson links, login details or any materials that identify a student with anyone.",
          ownerApproved: false,
        },
        {
          id: "E6",
          text: "I will not post or share anything about LearnThrive students online, including on social media, even without names.",
          ownerApproved: false,
        },
      ],
    },
    {
      id: "F",
      heading: "Checks, honesty and changes",
      clauses: [
        {
          id: "F1",
          text:
            "I agree to an Enhanced DBS check including the Children’s Barred List, carried out by LearnThrive, if I am offered a place.",
          ownerApproved: true,
          confirmed:
            "Owner decision: every tutor must agree to an Enhanced DBS check including the Children’s Barred List, carried out by LearnThrive. (Eligibility to request it is an open item for the owner.)",
        },
        {
          id: "F2",
          text: "I agree to every other check LearnThrive carries out, including identity checks and right-to-work checks.",
          ownerApproved: true,
          confirmed: "Owner decision: identity, right-to-work, DBS and any other check LearnThrive carries out.",
        },
        {
          id: "F3",
          text: "I will give true and complete information for every check, promptly, and I will cooperate with it fully.",
          ownerApproved: false,
        },
        {
          id: "F4",
          text: "I will not teach, or have any contact with, any LearnThrive student until every check is complete.",
          ownerApproved: true,
          confirmed: "Owner decision: no tutor teaches any student, or has any contact with one, until every check is complete.",
        },
        {
          id: "F5",
          text: "I will treat the checks as complete only when LearnThrive has told me so in writing.",
          ownerApproved: false,
        },
        {
          id: "F6",
          text:
            "I confirm that I am not barred from working with children, that no order, restriction, disqualification or sanction prevents me from working with children, and that I will not work with children in any role from which I am barred.",
          ownerApproved: false,
        },
        {
          id: "F7",
          text:
            "Everything I have told LearnThrive in my application is true and complete, and I have not withheld anything relevant to my suitability to work with children.",
          ownerApproved: false,
        },
        {
          id: "F8",
          text:
            "I understand that false or incomplete information may lead to my application, or my work with LearnThrive, ending immediately.",
          ownerApproved: false,
        },
        {
          id: "F9",
          text:
            "I will tell the safeguarding lead immediately, and never later than the same day, if anything changes that could affect my suitability to work with children. This includes:",
          items: [
            "a police investigation, arrest, charge, caution, conviction, barring decision or disqualification;",
            "any allegation or concern about my conduct towards a child, anywhere; and",
            "any decision by an employer, school, regulator or other body about my suitability.",
          ],
          ownerApproved: false,
        },
      ],
    },
    {
      id: "G",
      heading: "Reconfirmation, cooperation and consequences",
      clauses: [
        {
          id: "G1",
          text: "I will reconfirm this agreement every year, and whenever LearnThrive issues a new version.",
          ownerApproved: true,
          confirmed: "Owner decision: tutors reconfirm the safeguarding agreement every year and whenever a new version is issued.",
        },
        {
          id: "G2",
          text: "I will reconfirm by the date LearnThrive sets. If I have not reconfirmed by that date, I must stop teaching until I have.",
          ownerApproved: false,
        },
        {
          id: "G3",
          text:
            "I will cooperate fully, honestly and promptly with any safeguarding review, investigation or request for information, including one from LearnThrive, the police, the DBS or the local authority.",
          ownerApproved: false,
        },
        {
          id: "G4",
          text:
            "I understand that if I break any part of this agreement, LearnThrive may suspend me immediately and without notice, end my work with LearnThrive, and report me to the police, the DBS, the local authority or any other body, where the law requires it or where LearnThrive believes it is needed to protect a child.",
          ownerApproved: false,
        },
        {
          id: "G5",
          text: "I understand that LearnThrive may share information about my conduct, this agreement and my checks where that is needed to protect children.",
          ownerApproved: false,
        },
        {
          id: "G6",
          text: "These expectations are part of the tutor agreement I will sign.",
          ownerApproved: true,
          confirmed: "Owner decision: the safeguarding expectations form part of the tutor agreement tutors sign.",
        },
        {
          id: "G7",
          text: "This agreement applies to everything I do as a LearnThrive tutor, at all times, in lessons and outside them, online and offline.",
          ownerApproved: false,
        },
        {
          id: "G8",
          text:
            "I have read this agreement in full, and I have read LearnThrive’s safeguarding page. If I do not understand any part of it, I will ask the safeguarding lead before I agree.",
          ownerApproved: false,
        },
      ],
    },
  ],
  understanding: [
    {
      id: "report-who-when",
      prompt: "A child tells you something that worries you. Who do you report it to, and by when?",
      clauseIds: ["A1"],
      options: [
        { id: "a", text: "The child’s parent, by the end of the week." },
        { id: "b", text: "Nobody, unless the child asks me to tell someone." },
        { id: "c", text: "The safeguarding lead, immediately, and never later than the same day." },
        { id: "d", text: "The safeguarding lead, at the end of the month." },
      ],
      correctOptionId: "c",
    },
    {
      id: "immediate-danger",
      prompt: "A child is in immediate danger. What do you do first?",
      clauseIds: ["A3"],
      options: [
        { id: "a", text: "Call 999." },
        { id: "b", text: "Email the safeguarding lead and wait for a reply." },
        { id: "c", text: "Ask the child questions to find out exactly what happened." },
        { id: "d", text: "Text the child’s parent." },
      ],
      correctOptionId: "a",
    },
    {
      id: "keep-it-secret",
      prompt: "A child asks you to keep something they have told you secret. What do you say?",
      clauseIds: ["A6"],
      options: [
        { id: "a", text: "“I promise I won’t tell anyone.”" },
        { id: "b", text: "“Tell me everything, and I will decide whether it matters.”" },
        { id: "c", text: "Nothing. I change the subject and carry on with the lesson." },
        { id: "d", text: "“I may need to pass this on to keep you safe, so I can’t promise to keep it secret.”" },
      ],
      correctOptionId: "d",
    },
    {
      id: "personal-number",
      prompt: "A student asks for your personal phone number so they can message you about homework. What do you do?",
      clauseIds: ["B3", "B5"],
      options: [
        { id: "a", text: "Give it to them if their parent agrees." },
        { id: "b", text: "Do not give it. I use LearnThrive channels only." },
        { id: "c", text: "Give it to them, but only for homework." },
        { id: "d", text: "Give them my personal email address instead." },
      ],
      correctOptionId: "b",
    },
    {
      id: "where-lessons-happen",
      prompt: "Where may a lesson take place?",
      clauseIds: ["B2", "C1"],
      options: [
        { id: "a", text: "Anywhere the student prefers, including at their home." },
        { id: "b", text: "On any video app that the student and I both like." },
        { id: "c", text: "Online, on the lesson platform LearnThrive provides, and nowhere else." },
        { id: "d", text: "In a public place such as a library." },
      ],
      correctOptionId: "c",
    },
    {
      id: "someone-walks-in",
      prompt: "Someone walks into your room during a lesson. What do you do?",
      clauseIds: ["C3"],
      options: [
        { id: "a", text: "Carry on, because they are probably a family member." },
        { id: "b", text: "Ask them to sit quietly until the lesson ends." },
        { id: "c", text: "Turn my camera off and carry on by voice." },
        { id: "d", text: "Pause the lesson immediately, and carry on only when the room is private again." },
      ],
      correctOptionId: "d",
    },
  ],
};
