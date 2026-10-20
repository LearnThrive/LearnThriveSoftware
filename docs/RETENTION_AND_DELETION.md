# Retention and deletion: what is kept, where, and who deletes it

For the owners. The website stores **nothing** about applications, reconfirmations, subject requests, Library waitlist sign-ups or enquiries: each is sent by email and then handled by hand. So deleting means deleting emails and copies. This page sets out the rules you chose, where each kind of data actually lives, and a log to keep. It is a draft for the owners and their adviser to approve, not legal advice.

## Where the data is

| Place | What is in it |
| --- | --- |
| The **info@ mailbox on IONOS** (or the careers address, when there is one) | Every application with its attachments, every reconfirmation, every subject request, Library waitlist sign-up and enquiry. This is the main place. (Waitlist sign-ups go to `LIBRARY_WAITLIST_EMAIL`, then `ENQUIRY_EMAIL`, then the site address. Someone who uses the page's "email us" link instead of the form writes to the site address, so check that mailbox too.) |
| **Resend's sending log** | A copy of each email the website sent through Resend, including the applicant's files attached to the message to you. Check Resend's own retention setting and what you can delete from its dashboard: it was not verified here. |
| Your **spreadsheets and devices** | The tutor list, the reconfirmation tracker, the subject-request tally, anything downloaded or forwarded. |
| **Render's logs** | Only outcomes: a reference, a status, counts and sizes. No names, addresses, answers or file content. |

Holding identity scans in a shared mailbox is a real security risk. Limit who can open it, use a strong password and two-step verification on every account that can, do not forward identity documents, and end the practice when a proper secure store exists.

## The rules

| Data | Kept | Then |
| --- | --- | --- |
| An **unsuccessful application** and its agreement record | Up to **6 months** after the decision | Delete the email and attachments, here and in Resend's log. |
| An unsuccessful application where the applicant **ticked the box to be kept for future roles** | Up to **12 months** after the decision | Delete as above. Their **identity documents are still deleted at 6 months**. |
| **Identity and right-to-work documents** of an unsuccessful applicant | **6 months** after the decision | Delete the message they arrived in, or the attachments, and any copy. |
| **Identity and right-to-work documents** of a tutor | While they work with LearnThrive, and **12 months after** they stop, so a returning tutor need not start again | Then delete the message and any copy. A returning tutor must always show current, valid documents: never rely on an old copy. |
| **Agreement and reconfirmation records** of a tutor | While they work with LearnThrive and **6 years after** | Then delete. |
| Anything **linked to a safeguarding concern, allegation or investigation** | Longer, as the safeguarding lead and legal advice require | Kept separately, with restricted access. |
| **Other tutor and personnel records** | Normally up to 6 years after the working relationship ends | Review each type. |
| A **subject request** | Until the subject is added, or **12 months** after the request, whichever comes first, or sooner if the person asks | Delete the email and the spreadsheet row. |
| A **Library waitlist sign-up** (an email address and a ticked consent box) | Until the launch email has been sent, or **12 months** after the sign-up, whichever comes first, or sooner if the person asks | Delete the email, any copy in a spreadsheet or mailing tool, and Resend's log copy. Delete everyone's at once after the launch email has gone out. The confirmation email tells people they can reply to be removed: do it promptly. The launch email is one message to people who ticked the box, and to no one else. |
| An **enquiry** | As the existing schedule says: up to 12 months after the last meaningful contact if it did not become tuition | Delete. |

The privacy notices (`/careers/privacy`, `/privacy`) state the same periods. If you change a period, change the notice, the FAQ and `careers-config.ts` together (for the Library waitlist, the notice and `retentionMonths` in `apps/web/src/lib/library-config.ts`).

## Who does what

- **Each applicant** is dated from the day you tell them the decision. Put the decision date, and the deletion date it gives, in the log below the same day.
- **A named person** (suggest the privacy lead, Abdurrahman Mustafa, with Tahasin Hasan as the escalation point, as in the company's own working schedule) checks the log **once a month** and deletes what is due. Put it in a calendar.
- Deletion is done in two places every time: **the mailbox, and Resend's log**. Empty the mailbox's deleted-items folder too. Then record it.

## The log

Keep a spreadsheet with one row per person or batch: who, what kind of data, the message(s) it is in (date and subject), the date it arrived, the date it is due for deletion and why, the date it was deleted, who deleted it, and the places checked (mailbox, deleted items, Resend, other copies).

For tutors with identity documents on file, add a row when they start and **a due date of 12 months after they stop working with LearnThrive** the day they stop. For unsuccessful applicants the due date is 6 months after the decision, and 12 months for an application kept for future roles. When someone asks you to delete their information, or withdraws, do it promptly and say so; keep only what the law or a safeguarding duty requires you to keep.

## A note on DBS information

The website does not collect DBS certificate information. The application only asks whether an applicant already holds a suitable certificate and uses the Update Service, and tells them not to upload a certificate. The check itself is arranged through the DBS process. Do not store certificates in the mailbox either.
