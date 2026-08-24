// register.js — student account request
// Two paths: new student, or claim an existing record. Both submit as pending.
//
// Requires config.js to be loaded first.

(function () {
'use strict';

console.log('register.js loaded');

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CURRICULOGIC ?? {};

const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

if (!supabase) console.error('register.js: Supabase client not created. Is config.js loaded?');

const $ = (id) => document.getElementById(id);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let path = 'new';


/* ---------- messages ---------- */

function showMsg(text, type = 'error') {
    const box = $('msg');
    if (!box) return;
    box.textContent = text;
    box.className = 'msg ' + type;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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


/* ---------- validation ---------- */

function validate() {
    clearInvalid();

    const mark = (id, message) => { $(id)?.classList.add('invalid'); return message; };

    if (path === 'new') {
        if (!$('first-name').value.trim()) return mark('first-name', 'Enter your first name.');
        if (!$('last-name').value.trim())  return mark('last-name', 'Enter your last name.');
    } else {
        if (!$('student-id').value.trim()) return mark('student-id', 'Enter your student ID.');
    }

    const email = $('email').value.trim();
    if (!email)                return mark('email', 'Enter your university email.');
    if (!EMAIL_RE.test(email)) return mark('email', 'That does not look like a valid email address.');

    if ($('password').value.length < 8)             return mark('password', 'Password must be at least 8 characters.');
    if ($('password').value !== $('confirm').value) return mark('confirm', 'The two passwords do not match.');
    if (!$('consent').checked) return 'Please confirm your details and accept the data privacy notice.';

    return null;
}


/* ---------- submit ---------- */

async function handleRegister() {
    clearMsg();

    const problem = validate();
    if (problem) return showMsg(problem);

    if (!supabase) return showMsg('Cannot reach the service. Please try again later.');

    const btn = $('register-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    const email = $('email').value.trim();

    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password: $('password').value,
        });

        if (error || !data?.user) {
            console.error('signUp failed:', error);
            return showMsg('We could not submit your request. Please check your details and try again.');
        }

        // Supabase returns a phantom user with an empty identities array when the
        // address is already registered. Stop here — the insert would fail on the FK.
        if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            return showMsg(
                'If this email is eligible, a confirmation message has been sent. Please check your inbox.',
                'success'
            );
        }

        const row = {
            user_id: data.user.id,
            email,
            is_approved: false,
            record_verified: false,
            declared_path: path,
        };

        if (path === 'new') {
            row.first_name = $('first-name').value.trim();
            row.last_name  = $('last-name').value.trim();
            row.student_id = $('student-id-new').value.trim() || null;
        } else {
            row.student_id = $('student-id').value.trim();
        }

        // NOTE: the #program select on the form is not read. Either wire it to
        // a program_id column here, or remove the control from registerpage.html
        // so users are not filling in a field that has no effect.

        const { error: insertError } = await supabase
            .from('university_student')
            .insert([row]);

        if (insertError) {
            console.error('insert failed:', insertError.code, insertError.message, insertError.details);
            return showMsg('We could not submit your request. Please contact the Registrar for assistance.');
        }

        showMsg(
            'Request submitted. Check your inbox to confirm your email address, then the Office of the Registrar will verify your details and notify you once your account is ready.',
            'success'
        );

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