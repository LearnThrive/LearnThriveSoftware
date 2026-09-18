# LearnThrive Tuition legal and safeguarding review

**Last checked:** 10 September 2026  
**Status:** Internal decision record. This is not legal advice or professional certification of compliance.

## Verified position

The verified public business details include the trading name **LearnThrive Tuition**, `https://www.learnthrivetuition.co.uk`, `info@learnthrivetuition.co.uk`, Tahasin Hasan's telephone number `+44 7459 839595`, Abdurrahman Mustafa's telephone number `+44 7883 745337`, and the social links in `src/lib/site.ts`. No registered legal entity, registered number or office, controller's legal identity, DPO, or named safeguarding lead has been verified.

The current site is a marketing and enquiry site. Form values exist only in React memory and the site prepares a `mailto:` draft; it does not submit the form to a backend, database, CRM, payment service, or portal. The repository contains no analytics, advertising pixels, cookies, browser storage, external embeds, or external font service. Instagram, LinkedIn, and tutor-login services are contacted only if a visitor follows their external links.

## Decisions required now

1. **Legal identity and controller.** Confirm whether the operator is a sole trader, partnership, limited company, or other entity; its full legal name; a service/contact address; and which person or entity is the UK GDPR controller. If it is a limited company, provide the registered number, registered office, jurisdiction of registration, and full “Limited” or “Ltd” name for the website disclosures. Decide who owns privacy requests, complaints, and personal-data-breach assessment. A DPO should be named only if one is actually appointed or legally required.

2. **Real data map and suppliers.** Identify where sent enquiry emails and later tuition records actually go, who can access them, and every provider used for hosting, email, document storage, communications/video lessons, scheduling, accounting, and any tutor or customer management. Confirm processor terms, security responsibilities, storage locations, and any international transfers and safeguards. The public privacy notice currently describes provider *categories* because none of these facts is verified.

3. **Lawful bases and children's information.** Confirm and document the lawful basis for each real activity, including enquiries, contract administration, progress records and safeguarding records; review marketing separately if introduced. Complete a legitimate-interests assessment where legitimate interests is relied upon, giving children's interests particular weight. Decide whether special-category information (for example health or SEND information) will be collected, why it is necessary, the Article 9 condition, and the safer collection route. Assess Children's Code scope and whether a data protection impact assessment is needed for the current site as well as future services. A parent-directed enquiry does not itself exclude the site from the Code.

4. **Retention and rights handling.** Approve a retention schedule for unsuccessful enquiries, customer correspondence, contracts and financial records, learner/progress records, safeguarding records, and tutor/personnel records. Assign a person and process for access, correction, erasure, restriction, objection, identity/authority checks, complaints, and breach recognition, escalation, documentation, and notification. Replace the public notice's general “only as long as necessary” wording with periods or clear criteria once these decisions exist.

5. **ICO fee.** Complete and retain the result of the ICO data-protection-fee self-assessment for the actual controller and processing activities; pay/register if required, or record the exemption relied upon.

6. **Tuition contract terms.** Before publishing comprehensive service terms or accepting bookings, approve prices and invoicing/payment timing; how and when a contract is formed; cancellation and cooling-off rights; refunds; missed or late lessons; tutor cancellation/replacement; rescheduling; lesson length/location; minimum commitments or subscriptions; ending tuition; complaints; liability wording; and the governing law/jurisdiction appropriate to the operator and customers. Terms must be prominent, fair, and transparent. The current facts do **not** justify a separate cancellations page: create one only if the agreed rules are substantial enough to need it, otherwise include them clearly in the service terms and booking journey.

7. **Safeguarding ownership and procedure.** Appoint the person responsible for safeguarding (and a deputy/escalation route where appropriate), publish a monitored concern channel, and approve procedures for receiving, recording, sharing, escalating, and securely retaining concerns. The procedure must cover immediate danger, referrals to children's social care/police, allegations about a tutor or staff member, confidentiality limits, and relevant local-authority/LADO contact routes. Confirm the jurisdiction(s) in which services operate, since referral arrangements differ across the UK.

8. **Online-session safety and workforce controls.** Decide and document parent/guardian expectations, communication channels and boundaries, one-to-one online-session rules, conduct standards, use of personal accounts/devices, and what happens if a child discloses a concern. Confirm the actual role-by-role vetting and safer-recruitment checks (including eligibility and level of DBS check), reference/identity checks, safeguarding induction, refresher training, supervision, and responsibility for self-employed or agency tutors. Do not publish blanket DBS or training claims until evidence and ownership exist.

9. **Recording.** Decide whether lessons, calls, chat, or screenshots are prohibited or permitted. If any recording is planned, define purpose, necessity, lawful basis, access, security, retention/deletion, notices and permissions, child-welfare controls, and supplier processing before enabling it.

10. **Testimonials.** Confirm that every published testimonial is genuine and that LearnThrive has permission to publish its wording and attribution. Record the permission, any edits, whether the name is real or anonymised, and withdrawal handling—especially where a child could be identifiable.

## Privacy and cookie page audit

The current Privacy and Cookie notices are substantive and broadly match the repository implementation. In particular, they accurately distinguish temporary in-page form state from a user-sent email and do not invent analytics, advertising, storage, or a database.

Outstanding factual qualifications:

- The identity of the controller and its contact/service address are missing because the business identity is unverified. “LearnThrive Tuition” alone may be insufficient once the operator is confirmed.
- Provider categories, retention principles, lawful bases, transfer wording, and safeguarding disclosure language cannot be final until the data map and responsibilities above are approved.
- The source and local production-browser checks found no cookies, local/session storage or third-party requests. This does not verify the live hosting/CDN configuration. Audit response headers, deployed scripts, consent-exempt storage, and third-party requests on the live domain before publication and after each hosting or feature change.
- Re-check both notices before adding analytics, pixels, embeds, chat, booking, payment, CRM, portals, video platforms, or recording. Non-essential storage/access must not run before any required consent or other control is implemented.
- The shared legal-page component displays **10 September 2026** as its last-reviewed date. This is an editorial review date, not evidence of company or professional legal approval.

## Future-change gate

Before deploying a new provider or feature, record what data it receives, purpose, lawful basis, children's-data impact, processor/controller role, transfer mechanism, retention, security/access, and whether privacy information or storage/access choices must change. Repeat the production audit after deployment. This is particularly important for analytics, CRM, booking/payment, portals, lesson platforms, chat, and recording.

## Authoritative sources consulted

- ICO, [Individual rights guidance and the right to be informed](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/)
- ICO, [Children and the UK GDPR](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/children-and-the-uk-gdpr/), updated 15 May 2026
- ICO, [Guidance on storage and access technologies](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/), finalised 29 April 2026
- ICO, [Data protection fee self-assessment](https://ico.org.uk/fee-checker)
- Department for Education, [Working Together to Safeguard Children 2026](https://www.gov.uk/government/publications/working-together-to-safeguard-children--2), updated 18 March 2026 (applies to England)
- NSPCC Learning, [Safeguarding and child protection for tutors](https://learning.nspcc.org.uk/safeguarding-child-protection/tutors), updated 2 April 2026
- GOV.UK, [Report child abuse](https://www.gov.uk/report-child-abuse)
- Competition and Markets Authority, [Unfair contract terms guidance](https://www.gov.uk/government/publications/unfair-contract-terms-cma37), updated 22 July 2026
- GOV.UK, [Limited-company website and promotional-material disclosures](https://www.gov.uk/running-a-limited-company/signs-stationery-and-promotional-material)
- ICO, [What privacy information should we provide?](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/) — used to make the right to object explicit and separate in the public notice.

## FAQ search decision

No FAQPage structured data was added. [Google Search Central's documentation updates](https://developers.google.com/search/updates) record that FAQ rich results stopped appearing on 7 May 2026 and the documentation was removed on 15 June 2026. The visible FAQ remains indexable with standard metadata and a sitemap entry.
