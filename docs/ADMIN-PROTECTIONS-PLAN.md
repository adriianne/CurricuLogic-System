# Admin protections: plan for later

Written 28 Oct 2026. NOTHING in this file is built yet. It is a plan to choose from, one item at a time.
The Admin account can create, stop and read everything, so it is the most valuable thing to attack. This plan
adds protection around it without making it easy to lock the school out of its own system.

## What was considered and rejected: automatic password change by email

The idea: the Admin password changes every hour or day and the new password is emailed to the Admin's Google account.
**Not recommended**, for these reasons (useful to say at the defense):

- The password would sit in an email. Anyone who gets into that mailbox gets the Admin at every rotation, so the mailbox
  becomes the real key and the weakest link.
- It contradicts what the pages promise today ("Passwords are never emailed", "Nobody ... can see the password you choose").
- Current guidance (NIST SP 800-63B) says not to force periodic password changes: they push people to weaker, predictable
  passwords. Change a password when there is evidence it is compromised.
- Lock-out risk: a late email or a rotation that fails half way leaves nobody able to sign in, and the Admin is the account
  that repairs everything. Hourly rotation would make that likely.

The goal behind the idea (a stolen password should not be enough) is met better by item 1 below.

## What is already in place

Separate Admin sign-in page, a longer password rule for administrators (12 characters, `db/049`), a password-setup link
instead of an emailed password, stop and restore with a reason (`db/088`, Admin cannot stop themselves), an audit log of who
changed what (`audit_log`), and the Admin-only System logs page (Administrator > System logs, built 28 Oct 2026).

## The plan, in order of value

### 1. Two-step sign-in for Admin accounts (authenticator app)
- **What:** after the password, the Admin types a 6-digit code from an authenticator app. Supabase Auth supports this (TOTP MFA).
- **Why first:** a stolen or guessed password is no longer enough. This is the proper version of "the password should not be
  enough".
- **Changes:** the Admin sign-in page asks for the code when the account has a second step; a one-time enrolment screen on the
  Admin profile (QR code, confirm with one code, show recovery information); the Admin session must be at the second-step level
  before Admin screens load; `is_system_admin()` (database) can also require it, so the rule holds even if a page is bypassed.
- **Lock-out risk:** losing the phone. Mitigation: enrol TWO factors (two phones, or phone plus a saved secret kept offline), keep
  one Admin account that is only used for recovery, and write the recovery steps in `docs/SECURITY-OPERATIONS.md` before turning
  it on for everyone. Test with a throwaway Admin first.
- **Does not need:** SMTP.
- **Variant:** a one-time code by email instead of an app. Works, but depends on the mailbox, so it is weaker than the app.

### 2. Sign-in alerts to the Admin's email
- **What:** every new Admin sign-in sends a short email ("Admin sign-in at 14:02, if this was not you ..."). Also: a new Admin
  or staff account was created, an account was stopped or restored, several failed Admin sign-ins in a row.
- **Why:** if the second step ever fails or is bypassed, the Admin hears about it within minutes.
- **Changes:** a database trigger on the sensitive audit events calls a small function that sends the email; no personal data in
  the message, only who, what, when. Needs a way to record Admin sign-ins (Auth logs are not readable by the site, so the
  sign-in page would write an audit row after a successful Admin sign-in).
- **Depends on:** the SMTP setup (`docs/EMAIL-SETUP.md`), which is still pending.
- **Risk:** low. Worst case, an alert is missed or sent twice.

### 3. Lock after repeated failed Admin sign-ins
- **What:** after 5 failed attempts the Admin sign-in waits 15 minutes (or needs the reset link), and an alert is sent (item 2).
- **Why:** stops password guessing.
- **Lock-out risk:** an attacker could keep the real Admin locked out by failing on purpose. Mitigation: short wait (not permanent),
  per-account and per-address limits, and the recovery path from item 1.
- **Note:** this is security item 3 in the hardening list ("not now"); Supabase also applies its own rate limits.

### 4. Housekeeping (no code)
- Keep the number of Admin accounts to the minimum (two: the daily one and a recovery one).
- Keep the Admin sign-in link off the public pages (the landing page links students and staff only).
- Review the Admin list and the audit log monthly (the System logs page makes this a two-minute job).
- Turn on Supabase's leaked-password protection if the plan allows it (open item from the 28 Oct advisor review).

## Suggested order and effort

1. Item 4 now (free, no code).
2. Item 1 (two-step sign-in): the most value, about a day of work plus testing with a throwaway Admin.
3. Item 2 (alerts): after SMTP works.
4. Item 3 (lock): last, because it needs the alerts and the recovery path to be safe.

## Decisions needed from the owner

- Authenticator app (recommended) or email code for the second step?
- Which email address receives Admin alerts?
- How many Admin accounts, and who holds the recovery one?
- Is the school comfortable with a 15-minute wait after 5 failed sign-ins?

## Before turning anything on

Test with a throwaway Admin account, keep the existing Admin working until the new one is proven, and add the steps to
`docs/E2E-TEST-PLAN.md`.
