# Account verification: assumptions and limitations (paper notes)

Paste-ready paragraphs for the paper. Everything below describes what the system does today. Lines in
[square brackets] are places where an answer from the EDP office belongs; fill them in from their reply
before pasting. Nothing here is a claim about the school's own rules beyond what EDP told us.

## 1. How a student gets an account

An account can come into being in two ways. The first is that the Admin uploads the list of students the EDP
office has confirmed and creates accounts from it. Each listed student receives a pre-approved account and an
emailed link to choose a password. The second is that a student registers on their own, and the request goes to
the Registrar. The first route is meant for students on the EDP list; the second is the route for everyone else,
such as transferees, returnees and late additions. The Registrar's approval is therefore a review of exceptions
and not a step every student must pass through. We treat it as a design choice: [EDP / Registrar: confirm that
no school rule requires the Registrar to approve every student account].

## 2. What the EDP list proves, and what it does not

The EDP list is the system's reference for who is a real student. A student on the list has been confirmed by
the office that holds enrolment data. We assume that the list is accurate and current when it is uploaded. We
also assume that the email address on the list is one the student controls. Opening the emailed setup link and
choosing a password is the only proof of identity the system asks for in the first route: control of the mailbox
EDP has on file. The system does not check an ID card, a birth date, or any document. A person who controls a
listed student's mailbox would be able to take over that student's account.

## 3. Quality of the source data

EDP told us that [Q6: status errors are very frequent in their records]. Because of this, the system never
treats the list as the final word. A student who is not on the list is not refused at registration. They see a
warning, may still submit, and the request reaches the Registrar, who decides by hand. The list is also uploaded
manually, so it is only as current as its last upload. A student who enrolled after the upload will not match
until the list is updated. [Q1: EDP's answer was a "manual flag"; confirm what exactly is flagged and by whom, then state it here.]

## 4. How a registering student is matched

A student who registers as an existing record is matched on student ID and programme. A student who registers as
new has no ID yet, so the match is on first name, last name and programme. Names are compared ignoring case,
extra spaces and common accents. There is no fuzzy matching: a middle name, a suffix such as Jr., a different
spelling, or a married or hyphenated surname will not match, and the student will be flagged as not on the list
even though they are real. Two different students with the same name in the same programme cannot be told apart.
The check can also confirm to a visitor that a given name and programme appear on the list, because it answers yes
or no. We did not add rate limiting to it, and we accept this as a small exposure.

## 5. What is enforced, and where

Three controls are in place. First, the Register page warns a student who is not on the list. Second, the
Registrar's Approve button is disabled for a request that is not on the list, and is checked again at the moment
of approving. This second control is enforced by the page and not by the database, so a person with direct access
to the database interface could bypass it; we accept this because the Registrar is a trusted, authenticated
role and the control is meant to prevent mistakes and ghost accounts, not insider misuse. Third, a hidden field
on the Register page catches simple form-filling bots. A bot written for this exact page could avoid it. It is a
first guard and not a replacement for the Registrar's review. While no list has been uploaded, none of these
controls blocks anything.

## 6. A verified account is not yet a usable record

Approving an account and verifying a student's academic record are separate steps. After sign-in, a student sees
"being verified" and no eligibility results until the Registrar marks the record verified, which in practice
follows the Department uploading the student's grades. The EDP list may carry a year level (1 to 4), which is
optional, so that staff can see which students above first year need grades uploaded first. The system does not
model transferees, returnees or students who shift programme: credited subjects are ordinary passed records, and
there is no shift approval or old-to-new subject matching. [Registrar: confirm how credited subjects are
recorded.]

## 7. Access, privacy and limits of the sender

The list holds names and email addresses, so only the Admin can read or change it. The Registrar sees only a
status for each student, on the list or not, and never the list. The check run at registration returns only
a yes or no. The privacy notice should state that the university's student list is used to verify accounts.
Setup emails are sent through an email provider with hourly and daily limits, so accounts are created at most 50
at a time and a person whose email fails can ask for a new link with "Forgot password". If the address on the list
is wrong or out of date, that student never receives the link, and the Admin has to correct the list.
[Q8: EDP's answer was "read-only"; confirm who has read-only access to what. If it is EDP, corrections to the list come from EDP and the Admin uploads them.]

## 8. Summary of limitations

- The list is uploaded by hand and may be out of date.
- Identity rests on control of the mailbox on file, not on any document.
- Matching is exact apart from case, spaces and accents. Different spellings of a name will not match.
- Two students with the same name and programme cannot be told apart by name.
- The Approve block is enforced by the page, not the database.
- The bot guard is basic and the name check is not rate-limited.
- The system does not model transferees, returnees or shiftees.
- Accounts made from the list depend on the EDP email being right and on the email provider's limits.

## 9. Where EDP's answers go

| EDP question | Their answer |
|---|---|
| Q1 | "Manual flag" (confirm exact wording). |
| Q2 | [fill in] |
| Q3 | [fill in] |
| Q4 | [fill in] |
| Q5 | [fill in] |
| Q6 | Status errors are very frequent (confirm exact wording). |
| Q7 | [fill in] |
| Q8 | "Read-only" (confirm who has read-only access to what). |
| Q9 | [fill in] |
