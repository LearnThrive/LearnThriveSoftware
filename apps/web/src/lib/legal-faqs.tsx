import { PhoneContacts } from "@/components/PhoneContacts";
import type { FaqItem } from "@/lib/faqs";

// LearnThrive-supplied wording. Preserve proposed and working-policy qualifiers.
export const legalFaqs: readonly FaqItem[] = [
  {
    id: "company-and-data-controller",
    question: "Who operates LearnThrive Tuition and who is responsible for personal data?",
    answer: (
      <>
        <p>{"LearnThrive Tuition is operated by "}<strong>{"LearnThrive Tuition Ltd"}</strong>{", a private limited company."}</p>
        <p><strong>{"Company number:"}</strong>{" 16680738"}<br /><strong>{"Registered office:"}</strong>{" 71–75 Shelton Street, Covent Garden, London, WC2H 9JQ"}<br /><strong>{"Contact email:"}</strong>{" "}<a href="mailto:info@learnthrivetuition.co.uk">{"info@learnthrivetuition.co.uk"}</a><br /><strong>{"Telephone:"}</strong>{" "}<PhoneContacts /></p>
        <p>{"LearnThrive Tuition Ltd acts as the "}<strong>{"data controller"}</strong>{" for personal information processed in connection with the website and tuition services."}</p>
        <p>{"Operational responsibility for privacy and data-protection matters is assigned to "}<strong>{"Abdurrahman Mustafa"}</strong>{", with "}<strong>{"Tahasin Hasan"}</strong>{" acting as the escalation point."}</p>
        <p>{"This does not mean either person is formally appointed as a statutory Data Protection Officer."}</p>
        <p>{"Privacy requests, complaints or concerns about personal information should initially be sent to:"}</p>
        <p><strong><a href="mailto:info@learnthrivetuition.co.uk">{"info@learnthrivetuition.co.uk"}</a></strong></p>
        <p>{"LearnThrive will record, review and respond to relevant requests in accordance with applicable UK data-protection law."}</p>
      </>
    ),
  },
  {
    id: "information-storage-and-access",
    question: "Where does LearnThrive store information and who can access it?",
    answer: (
      <>
        <p>{"LearnThrive primarily uses "}<strong>{"Google Workspace"}</strong>{" for business communications and records."}</p>
        <p>{"This includes services such as:"}</p>
        <ul>
          <li>{"Gmail for company email"}</li>
          <li>{"Google Drive for files and records"}</li>
          <li>{"Google Docs and Sheets where appropriate"}</li>
          <li>{"Google Meet for online tuition sessions"}</li>
        </ul>
        <p>{"Enquiries sent to LearnThrive are received through company-controlled communication channels."}</p>
        <p>{"Business, parent and learner records should be stored within company-controlled systems rather than personal accounts."}</p>
        <p>{"Routine administrative access to central LearnThrive records is currently restricted to "}<strong>{"Abdurrahman Mustafa and Tahasin Hasan"}</strong>{", except where information needs to be shared with another authorised person for a legitimate business or safeguarding purpose."}</p>
        <p>{"Tutors should only receive the information reasonably required to support the students they teach."}</p>
        <p>{"LearnThrive should maintain a record of the external providers it relies upon and review this whenever a new service is introduced."}</p>
        <p>{"Current key providers include:"}</p>
        <ul>
          <li><strong>{"Google Workspace"}</strong>{" — email, documents, file storage and administration"}</li>
          <li><strong>{"Google Meet"}</strong>{" — online tuition sessions and communications"}</li>
        </ul>
        <p>{"Additional providers must be added to the record when services such as website hosting, payments, accounting, scheduling or other management systems are introduced."}</p>
      </>
    ),
  },
  {
    id: "personal-information-purposes",
    question: "Why does LearnThrive process personal information?",
    answer: (
      <>
        <p>{"LearnThrive only processes personal information where there is a legitimate reason for doing so."}</p>
        <p>{"Depending on the activity, this may include:"}</p>
        <ul>
          <li>{"responding to an enquiry or taking steps requested before tuition begins"}</li>
          <li>{"administering and delivering tuition"}</li>
          <li>{"maintaining appropriate learner and progress records"}</li>
          <li>{"communicating with parents or guardians"}</li>
          <li>{"maintaining financial and accounting records"}</li>
          <li>{"keeping the website and company systems secure"}</li>
          <li>{"fulfilling legal or safeguarding responsibilities"}</li>
          <li>{"protecting somebody's vital interests in an emergency"}</li>
        </ul>
        <p>{"Where LearnThrive relies on legitimate interests, those interests must be balanced against the rights and interests of the individual, with particular care where children are involved."}</p>
        <p>{"Marketing communications should only be sent where the appropriate consent or another lawful basis under applicable electronic-marketing rules exists."}</p>
        <h3>{"What about health, disability or SEND information?"}</h3>
        <p>{"Health information and some SEND-related information may constitute particularly sensitive personal information."}</p>
        <p>{"LearnThrive should not request unnecessary medical or SEND details through a general enquiry form."}</p>
        <p>{"Where such information is genuinely required to adapt tuition or support a learner appropriately, LearnThrive should:"}</p>
        <ul>
          <li>{"collect only what is necessary"}</li>
          <li>{"explain why the information is needed"}</li>
          <li>{"restrict access"}</li>
          <li>{"identify the appropriate legal basis for processing it"}</li>
          <li>{"use a more controlled method of collection where appropriate"}</li>
        </ul>
        <p>{"Children's privacy must receive particular consideration when new digital services or learner-facing systems are introduced."}</p>
      </>
    ),
  },
  {
    id: "information-retention",
    question: "How long does LearnThrive keep information?",
    answer: (
      <>
        <p>{"LearnThrive should not keep personal information indefinitely."}</p>
        <p>{"The working retention schedule is:"}</p>
        <h3>{"Enquiries"}</h3>
        <p>{"Unsuccessful enquiries should normally be retained for up to "}<strong>{"12 months after the last meaningful contact"}</strong>{"."}</p>
        <h3>{"Customer correspondence"}</h3>
        <p>{"Routine customer correspondence should normally be retained for up to "}<strong>{"2 years after tuition ends"}</strong>{"."}</p>
        <h3>{"Lesson and progress records"}</h3>
        <p>{"General learner and progress records should normally be retained for up to "}<strong>{"2 years after tuition ends"}</strong>{", unless there is a legitimate reason requiring longer retention."}</p>
        <h3>{"Contracts, invoices and financial records"}</h3>
        <p>{"Relevant company accounting and financial records should normally be retained for "}<strong>{"6 years"}</strong>{", subject to applicable legal and tax requirements."}</p>
        <h3>{"Tutor applications"}</h3>
        <p>{"Unsuccessful tutor applications should normally be retained for up to "}<strong>{"6 months after the recruitment decision"}</strong>{"."}</p>
        <h3>{"Tutor and personnel records"}</h3>
        <p>{"Relevant personnel records may normally be retained for up to "}<strong>{"6 years after the working relationship ends"}</strong>{", subject to the type of record and applicable requirements."}</p>
        <h3>{"Safeguarding records"}</h3>
        <p>{"Safeguarding records may require significantly longer retention."}</p>
        <p>{"They should be kept separately from routine learner records and stored with restricted access."}</p>
        <h3>{"Data requests and breaches"}</h3>
        <p>{"LearnThrive should also maintain appropriate records of:"}</p>
        <ul>
          <li>{"data-protection requests"}</li>
          <li>{"complaints"}</li>
          <li>{"security incidents"}</li>
          <li>{"personal-data breaches"}</li>
        </ul>
        <p>{"Retention should be periodically reviewed rather than applied mechanically where circumstances require a different period."}</p>
      </>
    ),
  },
  {
    id: "personal-data-requests",
    question: "What happens if someone asks to see, correct or delete their information?",
    answer: (
      <>
        <p>{"Requests relating to personal data may include requests to:"}</p>
        <ul>
          <li>{"access information"}</li>
          <li>{"correct inaccurate information"}</li>
          <li>{"erase information"}</li>
          <li>{"restrict processing"}</li>
          <li>{"object to certain uses"}</li>
          <li>{"obtain further information about how data is used"}</li>
        </ul>
        <p>{"Requests may be made by contacting:"}</p>
        <p><strong><a href="mailto:info@learnthrivetuition.co.uk">{"info@learnthrivetuition.co.uk"}</a></strong></p>
        <p>{"LearnThrive should:"}</p>
        <ol>
          <li>{"Record when the request was received."}</li>
          <li>{"Verify identity where reasonably necessary."}</li>
          <li>{"Confirm parental authority where somebody is making a request on behalf of a child."}</li>
          <li>{"Search relevant company systems."}</li>
          <li>{"Consider whether any legal exemptions apply."}</li>
          <li>{"Respond within the applicable legal timeframe."}</li>
        </ol>
        <p>{"Most straightforward UK GDPR rights requests should normally be answered within "}<strong>{"one calendar month"}</strong>{"."}</p>
      </>
    ),
  },
  {
    id: "personal-data-breaches",
    question: "What happens if LearnThrive experiences a personal-data breach?",
    answer: (
      <>
        <p>{"Any suspected loss, accidental disclosure, unauthorised access or other compromise involving personal information should be reported internally as soon as it is discovered."}</p>
        <p>{"LearnThrive should:"}</p>
        <ol>
          <li>{"Contain the incident where possible."}</li>
          <li>{"Determine what information was affected."}</li>
          <li>{"Determine whose information was affected."}</li>
          <li>{"Assess the potential risk to individuals."}</li>
          <li>{"Record the incident and the decision taken."}</li>
          <li>{"Escalate serious incidents appropriately."}</li>
          <li>{"Notify the ICO where legally required."}</li>
          <li>{"Inform affected individuals where the level of risk requires it."}</li>
        </ol>
        <p>{"Where a breach is reportable to the ICO, LearnThrive should aim to report it without undue delay and, where feasible, within "}<strong>{"72 hours of becoming aware of it"}</strong>{"."}</p>
      </>
    ),
  },
  {
    id: "ico-registration",
    question: "Is LearnThrive registered with the ICO?",
    answer: (
      <>
        <p><strong>{"Yes. LearnThrive Tuition Ltd is registered with the Information Commissioner's Office and has paid the £52 data-protection fee."}</strong></p>
        <p>{"The company should maintain its ICO registration and keep its details up to date where required."}</p>
        <p>{"Evidence of registration and payment should be retained with LearnThrive's compliance records."}</p>
        <p>{"The company should review its registration details whenever its data-processing activities or organisational circumstances materially change."}</p>
      </>
    ),
  },
  {
    id: "bookings-payments-cancellations",
    question: "What are LearnThrive's rules for bookings, payments and cancellations?",
    answer: (
      <>
        <p>{"Tuition prices should be communicated clearly to the parent or guardian before tuition begins."}</p>
        <p>{"A tuition arrangement is normally formed once:"}</p>
        <ul>
          <li>{"the relevant terms have been provided"}</li>
          <li>{"the parent or guardian accepts them"}</li>
          <li>{"LearnThrive confirms the tuition arrangement"}</li>
        </ul>
        <p>{"Invoices may be issued in advance, including on a monthly basis where appropriate."}</p>
        <p>{"Unless otherwise agreed, payment should be made by the stated invoice due date."}</p>
        <h3>{"How much notice is required to cancel a lesson?"}</h3>
        <p>{"The working cancellation policy is:"}</p>
        <p><strong>{"At least 24 hours' notice"}</strong>{" should normally be provided where a lesson needs to be cancelled or rearranged."}</p>
        <p>{"Where sufficient notice is provided, LearnThrive may:"}</p>
        <ul>
          <li>{"rearrange the lesson, subject to availability, or"}</li>
          <li>{"provide an appropriate lesson credit"}</li>
        </ul>
        <p>{"A cancellation made with less than 24 hours' notice, or a failure to attend without notice, may normally be charged in full."}</p>
        <p>{"LearnThrive may exercise reasonable discretion in genuine emergencies."}</p>
        <h3>{"What happens if LearnThrive or the tutor cancels?"}</h3>
        <p>{"Where LearnThrive or the assigned tutor cannot provide the agreed lesson, the parent should normally be offered one of the following:"}</p>
        <ul>
          <li>{"a rearranged lesson"}</li>
          <li>{"an appropriate account credit"}</li>
          <li>{"a refund for the affected lesson"}</li>
        </ul>
        <h3>{"What happens if a student is late?"}</h3>
        <p>{"A lesson will normally still finish at its scheduled end time where a student joins late."}</p>
        <p>{"If LearnThrive or the tutor causes a material delay, the affected time should normally be made up or credited appropriately."}</p>
        <h3>{"Can tuition be ended?"}</h3>
        <p>{"Ongoing tuition may normally be ended by either party with "}<strong>{"7 days' written notice"}</strong>{", unless different arrangements have been expressly agreed."}</p>
        <p>{"Any refund relating to prepaid but unused tuition should take into account amounts legitimately due to LearnThrive."}</p>
        <h3>{"What about the statutory cooling-off period?"}</h3>
        <p>{"Where a consumer contract is entered into remotely, applicable consumer law may provide a "}<strong>{"14-day cancellation period"}</strong>{"."}</p>
        <p>{"If a parent asks LearnThrive to begin providing tuition during that period, the appropriate statutory acknowledgement and consent process should be followed."}</p>
      </>
    ),
  },
  {
    id: "safeguarding-concerns",
    question: "How does LearnThrive handle safeguarding concerns?",
    answer: (
      <>
        <p>{"LearnThrive places the safety and welfare of children and young people at the centre of its tuition services."}</p>
        <p>{"The proposed internal safeguarding responsibilities are:"}</p>
        <p><strong>{"Safeguarding Lead:"}</strong>{" Tahasin Hasan"}<br /><strong>{"Deputy Safeguarding Lead:"}</strong>{" Abdurrahman Mustafa"}</p>
        <p>{"These appointments should be formally approved and kept under review."}</p>
        <p>{"Safeguarding concerns can be reported through:"}</p>
        <p><strong><a href="mailto:info@learnthrivetuition.co.uk">{"info@learnthrivetuition.co.uk"}</a></strong></p>
        <p>{"Urgent safeguarding messages should be clearly marked as such."}</p>
        <h3>{"What should happen when a safeguarding concern is raised?"}</h3>
        <p>{"The person receiving the concern should:"}</p>
        <ol>
          <li>{"Listen carefully."}</li>
          <li>{"Avoid leading or investigative questioning."}</li>
          <li>{"Record the information factually."}</li>
          <li>{"Use the child's own words where possible."}</li>
          <li>{"Avoid promising complete confidentiality."}</li>
          <li>{"Pass the information to the Safeguarding Lead promptly."}</li>
          <li>{"Share information only with those who reasonably need it."}</li>
          <li>{"Consider whether external referral is necessary."}</li>
        </ol>
        <p>{"Where somebody is in immediate danger or there is an emergency, "}<strong>{"999 should be contacted"}</strong>{"."}</p>
        <p>{"Where appropriate, concerns may need to be referred to:"}</p>
        <ul>
          <li>{"children's social care"}</li>
          <li>{"the police"}</li>
          <li>{"the relevant local authority"}</li>
          <li>{"the Local Authority Designated Officer where an allegation concerns an adult working with children"}</li>
        </ul>
        <p>{"The correct authority should be identified based on the circumstances and location involved."}</p>
      </>
    ),
  },
  {
    id: "online-tuition-rules",
    question: "What rules apply to online tuition sessions?",
    answer: (
      <>
        <p>{"LearnThrive currently uses "}<strong>{"Google Meet"}</strong>{" for online tuition."}</p>
        <p>{"Tutors should use approved LearnThrive systems wherever reasonably possible and maintain clear professional boundaries."}</p>
        <p>{"Tutors should not use personal social-media accounts to communicate privately with learners."}</p>
        <p>{"Parents or guardians should know when one-to-one online tuition is taking place and should remain reasonably contactable."}</p>
        <p>{"Learners should participate from an appropriate environment where practicable."}</p>
        <p>{"Parents or guardians should be permitted to remain nearby or observe where appropriate."}</p>
        <p>{"Tutors must maintain professional behaviour at all times."}</p>
        <h3>{"What happens if a learner discloses a safeguarding concern?"}</h3>
        <p>{"The tutor should:"}</p>
        <ul>
          <li>{"listen calmly"}</li>
          <li>{"not promise secrecy"}</li>
          <li>{"avoid investigating the allegation"}</li>
          <li>{"avoid leading questions"}</li>
          <li>{"make an accurate written record"}</li>
          <li>{"escalate it promptly through the safeguarding procedure"}</li>
        </ul>
      </>
    ),
  },
  {
    id: "tutor-checks",
    question: "What checks should LearnThrive carry out before a tutor teaches students?",
    answer: (
      <>
        <p>{"LearnThrive should maintain a documented safer-recruitment process."}</p>
        <p>{"Before allowing a tutor to provide unsupervised tuition, appropriate checks should include:"}</p>
        <ul>
          <li>{"identity verification"}</li>
          <li>{"verification of relevant qualifications where those qualifications are relied upon"}</li>
          <li>{"appropriate references"}</li>
          <li>{"right-to-work checks where applicable"}</li>
          <li>{"an assessment of eligibility for the appropriate level of DBS check"}</li>
          <li>{"safeguarding induction"}</li>
          <li>{"agreement to the Tutor Code of Conduct"}</li>
        </ul>
        <p>{"LearnThrive should not request a level of DBS information that it is not legally entitled to obtain."}</p>
        <p>{"The same safeguarding standards should apply regardless of whether a tutor is:"}</p>
        <ul>
          <li>{"employed"}</li>
          <li>{"self-employed"}</li>
          <li>{"contracted"}</li>
          <li>{"supplied through another arrangement"}</li>
        </ul>
        <p>{"Tutors should receive safeguarding refresher training periodically, with "}<strong>{"annual refresher training"}</strong>{" used as the working standard."}</p>
      </>
    ),
  },
  {
    id: "lesson-recordings",
    question: "Are LearnThrive tuition sessions recorded?",
    answer: (
      <>
        <p><strong>{"No. LearnThrive lessons are not recorded by default."}</strong></p>
        <p>{"Tutors and learners should not make:"}</p>
        <ul>
          <li>{"audio recordings"}</li>
          <li>{"video recordings"}</li>
          <li>{"meeting transcripts"}</li>
          <li>{"screenshots"}</li>
          <li>{"automatic AI meeting notes"}</li>
        </ul>
        <p>{"without prior authorisation and an appropriate parent/guardian process."}</p>
        <p>{"Where technically possible, recording, transcription and automatic meeting-note functionality should remain disabled for normal tuition sessions."}</p>
        <p>{"If LearnThrive later decides to introduce recording, the company must first establish:"}</p>
        <ul>
          <li>{"why recording is necessary"}</li>
          <li>{"what legal basis applies"}</li>
          <li>{"who can access recordings"}</li>
          <li>{"where recordings are stored"}</li>
          <li>{"how long they are retained"}</li>
          <li>{"how they are deleted"}</li>
          <li>{"what parents and learners will be told"}</li>
          <li>{"what safeguarding controls apply"}</li>
          <li>{"what supplier is processing the recordings"}</li>
        </ul>
        <p>{"The Privacy Policy and relevant safeguarding documentation would also need to be updated before recording is enabled."}</p>
      </>
    ),
  },
  {
    id: "testimonial-permissions",
    question: "How does LearnThrive handle testimonials?",
    answer: (
      <>
        <p>{"LearnThrive should only publish genuine testimonials where it has appropriate evidence and permission to use them."}</p>
        <p>{"For each testimonial, LearnThrive should retain where practicable:"}</p>
        <ul>
          <li>{"the original feedback"}</li>
          <li>{"who provided it"}</li>
          <li>{"when it was received"}</li>
          <li>{"the wording approved for publication"}</li>
          <li>{"the agreed attribution"}</li>
          <li>{"evidence of permission"}</li>
          <li>{"whether a student or child could be identifiable"}</li>
          <li>{"any later request to withdraw permission"}</li>
        </ul>
        <p>{"Where a child could reasonably be identified, appropriate parent or guardian permission should be obtained."}</p>
        <p>{"Testimonials must not be edited in a way that materially changes what the person originally said."}</p>
        <p>{"LearnThrive should also avoid presenting testimonials as evidence of guaranteed or universal academic results."}</p>
        <p>{"Suggested testimonial permission wording:"}</p>
        <blockquote><p>{"I confirm that this testimonial reflects my genuine experience with LearnThrive Tuition Ltd and give LearnThrive permission to publish the approved wording on its website and marketing channels using the attribution shown to me. I understand that I can ask LearnThrive to stop future use by contacting "}<a href="mailto:info@learnthrivetuition.co.uk">{"info@learnthrivetuition.co.uk"}</a>{"."}</p></blockquote>
        <p>{"Existing testimonials should be checked against available permission records. Where LearnThrive cannot demonstrate that a testimonial is genuine and appropriately authorised, it should be removed until permission is confirmed."}</p>
      </>
    ),
  },
];
