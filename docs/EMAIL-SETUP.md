# Email setup: password-setup links

CurricuLogic sends no email of its own. When an administrator creates an account, or someone
uses **Forgot password**, the website asks **Supabase Auth** to email a one-time link
(`resetPasswordForEmail`). The link opens `features/auth/html/setpassword.html`, where the person
chooses their own password. Nobody is ever emailed a password.

Supabase's built-in mailer only sends to your own team's addresses and is heavily rate-limited, so
for real users you must connect an SMTP sender (step 2). These steps are done in the Supabase
dashboard; nothing here goes in the repository.

## 1. Run the migration

Run `db/072_setup_link_accounts.sql` in the SQL editor. Until then, "Email a setup link" on the
admin's Create account page fails, because the database still insists on a typed password.

Check: `select proname from pg_proc where proname = '_random_password';` returns one row.

## 2. Connect an SMTP sender (Authentication > Emails > SMTP Settings)

Turn on **Enable custom SMTP**. Pick one:

| | Gmail (for testing with one Gmail address) | Brevo (later, with a school address or domain) |
|---|---|---|
| Host | `smtp.gmail.com` | `smtp-relay.brevo.com` |
| Port | `587` | `587` |
| Username | the full Gmail address | the SMTP login Brevo shows |
| Password | a 16-character **app password** (see below), not the Gmail password | the SMTP key Brevo shows |
| Sender email | the same Gmail address | a sender address you verified in Brevo |
| Sender name | `CurricuLogic` | `CurricuLogic` |

A Gmail **app password**: Google Account > Security > turn on **2-Step Verification**, then search
"App passwords", create one named "CurricuLogic", copy the 16 characters. It is shown once.

Do not send *from* a Gmail address through Brevo (or any third party): Gmail rejects or spam-folders
it. Use Gmail's own SMTP for a Gmail sender.

Limits to know: a personal Gmail account sends about 500 emails a day. Supabase starts custom SMTP at
30 emails an hour (step 5 raises it).

## 3. Site URL and redirect list (Authentication > URL Configuration)

- **Site URL**: `http://localhost:8123` while testing. When the site is hosted, change it to the real
  address (this is one of the hosting steps; links in emails use it).
- **Redirect URLs**: add `http://localhost:8123/**` (and, when hosted, `https://YOUR-DOMAIN/**`).

If the address is not in this list, Supabase sends people to the Site URL instead and the set-password
page will not open from the link.

## 4. Reword the emails (Authentication > Emails > Templates)

Two templates are used. Both keep `{{ .ConfirmationURL }}`: it is the link. The styling is inline and
image-free so it looks the same in Gmail, Outlook and phones. If you change the link lifetime in step 5,
change "24 hours" in both.

### Reset Password (new accounts made by an administrator, and "Forgot password")

Subject: `Password reset requested: CurricuLogic`

```html
<div style="background:#f4f4f7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#111111;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;">
    <div style="padding:24px 28px;border-bottom:1px solid #d4d4d8;">
      <span style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:bold;letter-spacing:0.5px;"><span style="color:#0f8f6a;">C</span><span style="color:#111111;">urricu</span><span style="color:#1e3a8a;">L</span><span style="color:#111111;">ogic</span></span>
    </div>
    <div style="padding:36px 28px 28px;">
      <h1 style="margin:0 0 28px;font-size:24px;line-height:1.25;font-weight:bold;color:#111111;">Password Reset Requested</h1>
      <p style="margin:0 0 10px;font-size:14px;">Hey there,</p>
      <p style="margin:0 0 18px;font-size:13px;line-height:1.5;">We received a request to set a password for this CurricuLogic account. Press the button to choose it.</p>
      <ul style="margin:0 0 36px;padding-left:22px;font-size:13px;line-height:1.6;color:#333333;">
        <li style="margin-bottom:8px;">This link works <strong>once</strong> and is only valid for <strong>24 hours</strong>. If it has expired, press <em>Forgot password</em> on the Log in page.</li>
        <li>If you didn't expect this message, you can ignore it. Nothing changes until you open the link.</li>
      </ul>
      <p style="margin:0 0 40px;">
        <a href="{{ .ConfirmationURL }}"
           style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;
                  padding:12px 26px;border-radius:999px;font-size:13px;font-weight:bold;">
          Choose my password
        </a>
      </p>
      <p style="margin:0 0 20px;font-size:12px;color:#6b7280;word-break:break-all;">
        Button not working? Copy this link into your browser:<br>{{ .ConfirmationURL }}
      </p>
      <div style="border-top:1px solid #d4d4d8;padding-top:20px;font-size:12px;line-height:1.5;color:#6b7280;">
        We never ask for your password by email. Questions? Write to
        <a href="mailto:curriculogicph@gmail.com" style="color:#4f46e5;">curriculogicph@gmail.com</a>.<br>
        CurricuLogic · University of Cebu
      </div>
    </div>
  </div>
</div>
```

### Confirm signup (people who register themselves)

Subject: `Confirm your CurricuLogic account`

```html
<div style="background:#f4f4f7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#111111;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;">
    <div style="padding:24px 28px;border-bottom:1px solid #d4d4d8;">
      <span style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:bold;letter-spacing:0.5px;"><span style="color:#0f8f6a;">C</span><span style="color:#111111;">urricu</span><span style="color:#1e3a8a;">L</span><span style="color:#111111;">ogic</span></span>
    </div>
    <div style="padding:36px 28px 28px;">
      <h1 style="margin:0 0 28px;font-size:24px;line-height:1.25;font-weight:bold;color:#111111;">Confirm Your Email</h1>
      <p style="margin:0 0 10px;font-size:14px;">Hey there,</p>
      <p style="margin:0 0 18px;font-size:13px;line-height:1.5;">Thank you for registering with CurricuLogic. Press the button to confirm your email address. After that, the Registrar checks your details before your account can be used.</p>
      <ul style="margin:0 0 36px;padding-left:22px;font-size:13px;line-height:1.6;color:#333333;">
        <li style="margin-bottom:8px;">This link works <strong>once</strong> and is only valid for <strong>24 hours</strong>. If it has expired, press <em>Forgot password</em> on the Log in page.</li>
        <li>If you didn't expect this message, you can ignore it. Nothing changes until you open the link.</li>
      </ul>
      <p style="margin:0 0 40px;">
        <a href="{{ .ConfirmationURL }}"
           style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;
                  padding:12px 26px;border-radius:999px;font-size:13px;font-weight:bold;">
          Confirm my email
        </a>
      </p>
      <p style="margin:0 0 20px;font-size:12px;color:#6b7280;word-break:break-all;">
        Button not working? Copy this link into your browser:<br>{{ .ConfirmationURL }}
      </p>
      <div style="border-top:1px solid #d4d4d8;padding-top:20px;font-size:12px;line-height:1.5;color:#6b7280;">
        We never ask for your password by email. Questions? Write to
        <a href="mailto:curriculogicph@gmail.com" style="color:#4f46e5;">curriculogicph@gmail.com</a>.<br>
        CurricuLogic · University of Cebu
      </div>
    </div>
  </div>
</div>
```

The support address (`curriculogicph@gmail.com`) is the same one shown on the website pages.

## 5. Link lifetime and rate limit

- **Authentication > Sign In / Providers > Email > Email OTP expiration**: set `86400` (24 hours). This
  one setting covers every email link (setup, forgot password and the sign-up confirmation), so
  they all last 24 hours. The default is 1 hour, which is short for a new account.
- **Authentication > Rate Limits**: raise **emails sent per hour** to about 100 so a bulk upload of a
  class is not stopped part-way.

## 6. Test it (about 15 minutes)

Use plus-addresses: mail to `you+t1@gmail.com` and `you+t2@gmail.com` lands in the inbox of
`you@gmail.com`, and the website accepts them as different accounts.

1. Sign in as admin > Create account > **Email a setup link** > a faculty or student with email
   `you+t1@gmail.com`. Expect: "account created ... A link ... was emailed".
2. Open the email, click the button: the page "Choose your password" opens. Choose one with a special
   character. Expect "Password saved", then log in with it.
3. Click the same link again: expect "This link has expired or has already been used".
4. On the login page click **Forgot password?**, enter `you+t1@gmail.com`: another email arrives.
   Enter an address with no account: the same on-screen answer, and no email.
5. Bulk: upload a file with two rows, `you+t2@gmail.com` and `you+t3@gmail.com`, password column
   blank. Expect "2 setup links emailed".
6. Break it on purpose once: wrong app password in the SMTP settings. Expect "The email service could
   not send the message", and the account still created.

## 7. Clean up the test accounts

The test accounts use real mailboxes, so `db/tools/e2e-cleanup.sql` (which targets
`zz.e2e.*@example.com`) does not touch them. After testing, delete them in the SQL editor, with a
preview first:

```sql
-- 1. look
select 'faculty' as kind, email from faculty_staff where email like 'you+t%@gmail.com'
union all select 'student', email from university_student where email like 'you+t%@gmail.com';

-- 2. delete (the auth user goes with it; the staff/student row follows by cascade)
-- delete from auth.users where email like 'you+t%@gmail.com';
```

Replace `you` with the real prefix, and look at the preview before you run the delete.

## How this fits the rest of the security work

- A password chosen through the link is checked **in the browser** (8 characters, one special
  character; 12 for administrators). Supabase sets it itself, so the database cannot enforce the
  special-character rule here. This is the same limit as students' own password changes.
- The administrator's login page has no "Forgot password" link yet. Recovery for that account goes
  through another administrator. Say so if you want it added (it needs a decision: an inbox that is
  compromised could then reset the most powerful account).
- The sender address and the Site URL both change when the university gives you a domain.

## What happened when this was first tested (14 Oct 2026)

Tested with the built-in sender and one test account. Written down so the next person does not repeat it.

**Result:** the whole flow works end to end. Admin created a faculty account with "Email a setup link"; a
link was emailed; the link opened "Choose your password"; saving the password cleared
`must_change_password`; the new password signed in; the link could not be used a second time.

**Gmail SMTP did not work.** Supabase reached `smtp.gmail.com:465` and Gmail answered
`535 5.7.8 Username and Password not accepted` for four different app passwords, so the failure was
on Google's side of the login (account, app password or a block on the server's address), not in
CurricuLogic or Supabase. The causes not ruled out: the app password made under a different Google
account than the Username box; 2-Step Verification; the unlock page
(`accounts.google.com/DisplayUnlockCaptcha`); an account that blocks app passwords. Turning custom SMTP
off fixed delivery for the test address at once, because Supabase's built-in sender delivers to
the addresses of your Supabase team.

**What the built-in sender is and is not.** It reaches only Supabase team addresses, from a generic
sender (check Spam), and sends **2 emails an hour**. Good enough to test single account creation and
"Forgot password" with your own address. Not enough for the bulk upload test, and it cannot send to
students or staff, so a real sender is needed before real users (the university's mail server,
or a Resend/Brevo account on the university's domain).

**Reading the failure.** Supabase > Logs > Auth shows the real reason for a failed send in the
`error` field of the `/recover` request: `535 ... BadCredentials` (login refused), `context deadline
exceeded` (cannot connect: wrong host or port), or HTTP 429 (rate limit). The pages only say "the
email service could not send the message".

**Easy mistakes**
- The Department / college box is required for faculty, registrar and department accounts; leaving
  it blank stops the form before anything is created.
- A link works **once**. Opening it on a phone sends the phone to its own `localhost`, which does not exist, and
  uses the link up. Test on the computer that runs the site; phones work only after the site is hosted.
- Do not paste an app password or SMTP key into the chat, a file or a screenshot.

**Not tested yet:** bulk upload with emails; "Forgot password" for an address with no account; the
admin form's success message ("... was emailed to ..."); any real sender other than the built-in one.
