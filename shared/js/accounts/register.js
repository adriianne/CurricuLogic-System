// register.js — student account request
// Two paths: new student, or claim an existing record. Both submit as pending.
//
// Requires config.js to be loaded first.

(function () {
'use strict';

console.log('register.js loaded');

const { SUPABASE_URL, SUPABASE_ANON_KEY, authStorageKey } = window.CURRICULOGIC ?? {};

// Bucketed the same way auth.js's client is -- see config.js. This page
// only ever registers a student, so the bucket is always 'student'.
const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { storageKey: authStorageKey?.(['university_student']) },
    })
    : null;

if (!supabase) console.error('register.js: Supabase client not created. Is config.js loaded?');

const $ = (id) => document.getElementById(id);

/* A student ID is 8 digits. A leading "uc-" (the sign-in prefix) is accepted
   and dropped, the same as the database does. null when it is not valid. */
const studentIdDigits = (raw) => {
    const digits = String(raw ?? '').trim().replace(/^uc-/i, '');
    return /^\d{8}$/.test(digits) ? digits : null;
};

let path = 'new';


/* ---------- messages ---------- */

function showMsg(text, type = 'error') {
    const box = $('msg');
    if (!box) return;
    box.textContent = text;
    box.className = 'msg ' + type;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearMsg() {
    const box = $('msg');
    if (box) box.className = 'msg';
}

function clearInvalid() {
    document.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
}


/* ---------- path switching ---------- */

document.querySelectorAll('.path input').forEach((radio) => {
    radio.addEventListener('change', () => {
        clearMsg();
        clearInvalid();
        path = radio.value;

        document.querySelectorAll('.path').forEach((p) => {
            const input = p.querySelector('input');
            p.classList.toggle('selected', input.checked);
        });

        $('pane-new').hidden      = path !== 'new';
        $('pane-existing').hidden = path !== 'existing';

        $('email-hint').textContent = path === 'existing'
            ? 'Must match the address on your student record.'
            : 'Must be the address on file with the university.';
    });
});


/* ---------- password visibility ---------- */

document.querySelectorAll('.toggle-pw').forEach((btn) => {
    btn.addEventListener('click', () => {
        const input = $(btn.dataset.target);
        if (!input) return;
        const hidden = input.type === 'password';
        input.type = hidden ? 'text' : 'password';
        const icon = btn.querySelector('i');
        if (icon) icon.className = hidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
        btn.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
    });
});


/* ---------- degree programs ---------- */

/* The programs come from the database, so the form offers exactly the
   programs the university has set up rather than a hardcoded one. The list
   is readable without signing in. If it cannot be loaded, registration
   still works without a program (as it did before): the Registrar confirms
   it when verifying the account. */
let PROGRAMS_LOADED = false;

async function loadPrograms() {
    const sel = $('program');
    if (!sel) return;

    // The hint under the field follows what the field can actually do, so it
    // never says "choose" over a list that has nothing to choose.
    const hint = sel.closest('.field')?.querySelector('.hint');
    const fallback = (text) => {
        sel.replaceChildren(new Option(text, ''));
        sel.disabled = true;
        if (hint) hint.textContent = 'The Office of the Registrar will confirm your degree program when it verifies your account.';
    };

    if (!supabase) return fallback('To be confirmed by the Registrar');

    const { data, error } = await supabase
        .from('program')
        .select('id, code, name')
        .order('code');

    if (error || !data?.length) {
        console.warn('register.js: could not load programs.', error?.message);
        return fallback('To be confirmed by the Registrar');
    }

    PROGRAMS_LOADED = true;
    const options = data.map(p => new Option(p.name, String(p.id)));
    // With one program it is preselected; with several the student chooses,
    // so nobody is registered under whichever happens to be listed first.
    if (data.length > 1) options.unshift(new Option('Select your program', ''));
    sel.replaceChildren(...options);
}

loadPrograms();


/* ---------- validation ---------- */

function validate() {
    clearInvalid();

    const mark = (id, message) => { $(id)?.classList.add('invalid'); return message; };

    if (path === 'new') {
        const firstProblem = CurriculogicNameRules.problem($('first-name').value, 'first name');
        if (firstProblem) return mark('first-name', firstProblem);
        const lastProblem = CurriculogicNameRules.problem($('last-name').value, 'last name');
        if (lastProblem) return mark('last-name', lastProblem);
        const middleProblem = CurriculogicNameRules.middleProblem($('middle-name')?.value);
        if (middleProblem) return mark('middle-name', middleProblem);
    } else {
        if (!$('student-id').value.trim()) return mark('student-id', 'Enter your student ID.');
        if (!studentIdDigits($('student-id').value)) return mark('student-id', 'Student ID is 8 digits, for example 24001187.');
    }

    const email = CurriculogicEmailRules.clean($('email').value);
    if (!email) return mark('email', 'Enter your university email.');
    const emailProblem = CurriculogicEmailRules.problem(email);
    if (emailProblem) return mark('email', emailProblem);

    // Checked here, before the account is created: failing after signUp
    // would leave a sign-in with no student record behind it.
    if (PROGRAMS_LOADED && !$('program').value) return mark('program', 'Choose your degree program.');

    const pwProblem = CurriculogicPasswordRules.problem($('password').value);
    if (pwProblem)                                  return mark('password', pwProblem);
    if ($('password').value !== $('confirm').value) return mark('confirm', 'The two passwords do not match.');
    if (!$('consent').checked) return 'Please confirm your details and accept the data privacy notice.';

    return null;
}


/* ---------- submit ---------- */

/* What to tell the student when signUp() itself failed (not the separate
   "already registered" case just below, which deliberately stays vague to
   avoid confirming an email exists). Most failures still get the same
   generic sentence as before — a signUp error can mean almost anything,
   and most of those reasons are either sensitive (leaking which emails
   exist, details of an internal failure) or not actionable by the student
   anyway. Rate limiting is the one case worth calling out by name: it is
   safe to say (it reveals nothing about any account), and unlike the
   others it tells the student the honest, correct thing to do — wait,
   rather than re-check details that were never wrong. */
function signUpFailureMessage(error) {
    const text = String(error?.message ?? '').toLowerCase();
    if (error?.status === 429 || text.includes('rate limit')) {
        return 'Too many requests right now. Please wait a few minutes and try again.';
    }
    // The e-mail sender failed: the details were fine, so say so (it reveals nothing about any account).
    if (text.includes('sending confirmation email') || text.includes('error sending')) {
        return 'We could not send your confirmation e-mail right now, so the account was not created. Please try again in a few minutes, or contact the EDP office.';
    }
    return 'We could not submit your request. Please check your details and try again.';
}

/* Asks the database whether these details match the EDP list, e-mail included (db/095). The EDP list now decides
   who may have an account, so this is checked BEFORE the sign-in account is created: a registration that does not
   match leaves nothing behind. The database checks again when the row is saved. Returns 'match', 'no_match',
   'no_list', or null when the check itself failed. */
async function expectedStudentResult() {
    try {
        const { data, error } = await supabase.rpc('check_registration_match', {
            p_student_id: path === 'existing' ? studentIdDigits($('student-id').value) : null,
            p_first_name: path === 'new' ? CurriculogicNameRules.clean($('first-name').value) : null,
            p_last_name:  path === 'new' ? CurriculogicNameRules.clean($('last-name').value) : null,
            p_program_id: Number($('program')?.value) > 0 ? Number($('program').value) : null,
            p_email:      CurriculogicEmailRules.clean($('email').value),
        });
        return error ? null : data;
    } catch {
        return null;
    }
}

const SUBMITTED_MESSAGE =
    'Your details match the EDP student list, so your account is approved. Check your inbox and confirm your email address, then log in with your school email.';

// Shown when the email already has an account (the page says so plainly, by design).
const EMAIL_EXISTS_MESSAGE =
    'This email already exists. Log in instead, or use "Forgot password?" on the login page. If it is not your account, use a different email.';

// Shown when a new student's name matches someone who already has an account or a pending request.
const NAME_TAKEN_MESSAGE =
    'A student with this name already has an account or a pending request, so this request cannot be sent. If that is you, log in or use "Forgot password?". If you are a different person with the same name, contact the Office of the Registrar.';

/* Asks the database whether a student with this first and last name already has an account or a pending
   request (db/093). Only the "new student" path is checked. Any failure counts as "no", so a broken check
   can never stop a registration; the database trigger enforces the same rule on insert. */
async function nameAlreadyRegistered() {
    if (path !== 'new') return false;
    try {
        const { data, error } = await supabase.rpc('name_already_registered', {
            p_first_name:  CurriculogicNameRules.clean($('first-name').value),
            p_last_name:   CurriculogicNameRules.clean($('last-name').value),
            p_middle_name: CurriculogicNameRules.clean($('middle-name')?.value) || null,
        });
        return !error && data === true;
    } catch {
        return false;
    }
}

async function handleRegister() {
    clearMsg();

    // The hidden bot-trap field (honeypot.js) is filled: show the usual success message so the bot
    // learns nothing, and send nothing. A person never sees this field, so never reaches this.
    if (CurriculogicHoneypot.tripped($('contact-ref')?.value)) {
        showMsg(SUBMITTED_MESSAGE, 'success');
        document.querySelectorAll('.field input, .field select, #consent, .path input')
            .forEach((el) => { el.disabled = true; });
        const done = $('register-btn');
        done.disabled = true;
        done.textContent = 'Request submitted';
        return;
    }

    const problem = validate();
    if (problem) return showMsg(problem);

    if (!supabase) return showMsg('Cannot reach the service. Please try again later.');

    const btn = $('register-btn');

    // The EDP list decides: nothing is created unless the details (and the e-mail on file) match.
    btn.disabled = true;
    btn.textContent = 'Checking…';
    const gate = CurriculogicExpectedStudents.registrationCheck(await expectedStudentResult());
    if (!gate.allow) {
        btn.disabled = false;
        btn.textContent = 'Submit request';
        return showMsg(gate.message, 'error');
    }

    btn.disabled = true;
    btn.textContent = 'Submitting…';

    const email = CurriculogicEmailRules.clean($('email').value);

    try {
        // Same first and last name as someone who already has an account or a pending request: stop BEFORE
        // the sign-in account is created, so a rejected request leaves nothing behind.
        if (await nameAlreadyRegistered()) {
            return showMsg(NAME_TAKEN_MESSAGE, 'error');
        }

        // After the student taps the link in the confirmation e-mail, they land on the login page
        // (the address must be in Supabase > Authentication > URL Configuration > Redirect URLs).
        const loginUrl = new URL('loginpage.html?confirmed=1', window.location.href).href;
        const { data, error } = await supabase.auth.signUp({
            email,
            password: $('password').value,
            options: { emailRedirectTo: loginUrl },
        });

        if (error || !data?.user) {
            console.error('signUp failed:', error);
            return showMsg(signUpFailureMessage(error));
        }

        // Supabase returns a phantom user with an empty identities array when the
        // address is already registered. Stop here — the insert would fail on the FK.
        // The student is told plainly that the email already exists (a product choice, 2 Nov 2026: the
        // page does reveal whether an email is registered, so a student knows to log in instead).
        if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            return showMsg(EMAIL_EXISTS_MESSAGE, 'error');
        }

        const row = {
            user_id: data.user.id,
            email,
            is_approved: false,
            record_verified: false,
            declared_path: path,
        };

        if (path === 'new') {
            row.first_name = CurriculogicNameRules.clean($('first-name').value);
            row.last_name  = CurriculogicNameRules.clean($('last-name').value);
            // Optional; left out when blank so the column stays empty (null), not an empty string.
            const middleName = CurriculogicNameRules.clean($('middle-name')?.value);
            if (middleName) row.middle_name = middleName;
            // No student ID is sent: the database issues one when the
            // Registrar approves the request (db/045).
        } else {
            row.student_id = studentIdDigits($('student-id').value);
        }

        // The chosen program. Left out when none could be chosen (the list
        // failed to load), so registration is never blocked by it.
        const programId = Number($('program')?.value);
        if (Number.isInteger(programId) && programId > 0) row.program_id = programId;

        const { error: insertError } = await supabase
            .from('university_student')
            .insert([row]);

        if (insertError) {
            console.error('insert failed:', insertError.code, insertError.message, insertError.details);
            // The database guard (db/093) caught a same-name request the page check missed.
            if (insertError.code === '23505' && /already has an account/i.test(insertError.message || '')) {
                return showMsg(NAME_TAKEN_MESSAGE, 'error');
            }
            // The database refuses a registration that does not match the EDP list (db/095).
            const why = insertError.message || '';
            if (/EDP student list/i.test(why)) return showMsg(CurriculogicExpectedStudents.NOT_ON_LIST_MESSAGE, 'error');
            if (/not open yet/i.test(why)) return showMsg(CurriculogicExpectedStudents.NOT_OPEN_MESSAGE, 'error');
            if (/already has an account/i.test(why)) return showMsg(EMAIL_EXISTS_MESSAGE, 'error');
            return showMsg('We could not submit your request. Please contact the EDP office for assistance.');
        }

        showMsg(SUBMITTED_MESSAGE, 'success');

        document.querySelectorAll('.field input, .field select, #consent, .path input')
            .forEach((el) => { el.disabled = true; });

        btn.textContent = 'Request submitted';
        return;

    } catch (err) {
        console.error(err);
        showMsg('Something went wrong. Please try again.');
    } finally {
        if (btn.textContent === 'Submitting…') {
            btn.disabled = false;
            btn.textContent = 'Submit request';
        }
    }
}

$('register-btn')?.addEventListener('click', handleRegister);

document.querySelectorAll('.field input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleRegister();
    });
});

})();