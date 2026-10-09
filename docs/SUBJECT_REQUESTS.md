# Subject requests ("Can't see your subject?")

For the owners. On `/subjects`, families can ask for a subject LearnThrive does not offer yet (Computer Science, say). Nothing is stored by the website. Each request is **one email**, and you count them by hand. How many requests is enough to add a subject is **your decision**; the site promises no subject, no date and no number.

## What arrives

An email to `SUBJECT_REQUEST_EMAIL` (falling back to `ENQUIRY_EMAIL`, then `info@learnthrivetuition.co.uk`). The subject line is always one of:

- `Subject request: <subject> (<level>)` for a subject chosen from the list, for example `Subject request: Computer Science (Year 9)`;
- `Subject request [other]: <subject> (<level>)` for a subject the person typed in, for example `Subject request [other]: Latin (Year 8)`.

So searching the mailbox for `Subject request` finds them all, and `Subject request [other]` finds the typed-in ones. The body lists the subject, whether it was typed in or chosen, the level, whether a parent or a student asked, an optional note, and an email address **only if** the person ticked "Email me if this subject becomes available". A request with no address is anonymous and holds no personal information.

No child's name is asked for. If a note contains personal details anyway, delete them from the message and from your spreadsheet.

## Counting

1. Make a mailbox rule or folder for messages whose subject starts with `Subject request`.
2. Keep a simple spreadsheet: date, subject (tidied, see below), level, asked by, "wants to be told" (yes or no). One row per email.
3. Count with a pivot table or `COUNTIF` on the tidied subject. Look at levels too: ten requests for GCSE Computer Science are not the same as ten across five subjects.
4. **Typed-in subjects are spelled differently** ("Comp sci", "Computing", "Computer science"). Tidy them into one name in a separate column and keep the original wording in another, so nothing is lost. Treat obvious singular and plural variants as the same subject.
5. Match demand to supply. In the tutor application, section 2 asks "Other subjects you could teach that we do not offer yet". Compare the two lists before deciding.

## People who asked to be told

Do **not** add anyone to a list or a newsletter. The only thing they agreed to is one email if the subject becomes available. If you add a subject, email those who ticked the box for that subject once, by hand, then delete their addresses from your spreadsheet. If you decide not to add the subject, delete them without writing.

## How long to keep requests

Until the subject is added, or **12 months after the request** if it has not been added by then, whichever comes first, or sooner if the person asks you to delete it. Delete the email and the spreadsheet row together ([RETENTION_AND_DELETION.md](RETENTION_AND_DELETION.md)).

## How the form protects itself

An invisible honeypot, a minimum time to fill it, a shared "are you a person" check (a small proof of work in the visitor's browser, no third party), a limit on how many a visitor can send, and a check that the request comes from the site itself. A script that trips the honeypot or the timer is told it worked, and nothing is sent. If email is not set up, the form says so and offers the address instead. There is an email link for visitors with JavaScript turned off.
