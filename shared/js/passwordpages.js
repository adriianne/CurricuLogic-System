// passwordpages.js — the two pages behind "choose your password by email link"
//
//   forgotpassword.html  (data-page="forgot")  asks for an email address and has
//                        Supabase send a one-time link to it.
//   setpassword.html     (data-page="set")     opened from that link: lets the
//                        person choose a password, then sends them to log in.
//
// Needs, in this order: supabase-js, config.js, emailrules.js, passwordrules.js,
// passwordreset.js.

(function () {
'use strict';

const { SUPABASE_URL, SUPABASE_ANON_KEY, authOptions } = window.CURRICULOGIC ?? {};
const PR = window.CurriculogicPasswordReset;
const PW = window.CurriculogicPasswordRules;

/* The link in the email signs the person in for a moment, before we know which
   role they have, so this page uses the shared session slot. */
const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: authOptions?.([]) ?? {} })
    : null;

const $ = (id) => document.getElementById(id);
const page = document.body.dataset.page;

/* The link puts the session in the address; the library removes it from there
   as soon as it has read it, so note now whether this page was opened from one. */
const OPENED_FROM_LINK =
    /[#&]type=recovery/.test(window.location.hash) ||
    new URLSearchParams(window.location.search).has('code');

function showMsg(text, type = 'error') {
    const box = $('msg');
    if (!box) return;
    box.textContent = text;
    box.className = 'msg ' + type;
}

function clearMsg() {
    const box = $('msg');
    if (box) box.className = 'msg';
}

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


/* ---------- Forgot password ---------- */

if (page === 'forgot') {
    const btn = $('send-btn');
    let cooling = false;

    function cooldown(seconds) {
        cooling = true;
        let left = seconds;
        btn.disabled = true;
        const tick = () => {
            if (left <= 0) {
                cooling = false;
                btn.disabled = false;
                btn.textContent = 'Send me a link';
                return;
            }
            btn.textContent = `Send again in ${left}s`;
            left -= 1;
            setTimeout(tick, 1000);
        };
        tick();
    }

    async function send() {
        if (cooling) return;
        clearMsg();

        const email = CurriculogicEmailRules.clean($('email').value);
        if (!email) return showMsg('Enter your email address.');
        const problem = CurriculogicEmailRules.problem(email);
        if (problem) return showMsg(problem);
        if (!supabase) return showMsg('Cannot reach the service. Please try again later.');

        btn.disabled = true;
        btn.textContent = 'Sending…';

        const result = await PR.sendSetupLink(supabase, email, PR.setPasswordUrl(window.location.href));

        if (result.ok) {
            // The same answer whether or not the address has an account, so this
            // page cannot be used to find out who has one.
            showMsg(PR.FORGOT_MESSAGE, 'success');
            cooldown(60);
        } else {
            showMsg(result.message);
            btn.disabled = false;
            btn.textContent = 'Send me a link';
        }
    }

    btn.addEventListener('click', send);
    $('email').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
}


/* ---------- Choose your password ---------- */

if (page === 'set') {
    const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };

    function problemState(text) {
        $('sub').textContent = '';
        show('form', false);
        show('done', false);
        show('problem', true);
        showMsg(text);
    }

    /* Which kind of account this is, so the right password rule applies and the
       right log-in page is offered. Reading your own row is allowed for each. */
    const TABLES = [
        ['university_student',   'student'],
        ['faculty_staff',        'faculty'],
        ['registrar_staff',      'registrar'],
        ['department_staff',     'department'],
        ['system_administrator', 'admin'],
    ];

    async function detectRole(userId) {
        const hits = await Promise.all(TABLES.map(async ([table, role]) => {
            const { data } = await supabase.from(table).select('id').eq('user_id', userId).maybeSingle();
            return data ? role : null;
        }));
        return hits.find(Boolean) ?? null;
    }

    const LOGIN_PAGE = {
        student: 'loginpage.html', faculty: 'staffloginpage.html', registrar: 'staffloginpage.html',
        department: 'staffloginpage.html', admin: 'adminloginpage.html',
    };

    let ROLE = null;
    let READY = false;

    async function showForm(session) {
        if (READY) return;
        READY = true;

        ROLE = await detectRole(session.user.id);
        $('sub').textContent = 'Choose a password for your account.';
        $('pw-hint').textContent = PW.hint(ROLE ?? 'student');
        clearMsg();
        show('problem', false);
        show('form', true);
        $('password').focus();
    }

    async function save() {
        clearMsg();
        const password = $('password').value;
        const confirm  = $('confirm').value;

        const problem = PW.problem(password, ROLE ?? 'student');
        if (problem) return showMsg(problem);
        if (password !== confirm) return showMsg('The two passwords do not match.');

        const btn = $('set-btn');
        btn.disabled = true;
        btn.textContent = 'Saving…';

        try {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) {
                const text = /same|different/i.test(error.message || '')
                    ? 'Choose a password different from the one before.'
                    : (error.message || 'Could not save the password.');
                return showMsg(text);
            }

            // The temporary password is replaced (db/057). Failing to clear the
            // flag only means the "choose a password" box shows once more.
            await supabase.rpc('clear_must_change_password');
            await supabase.auth.signOut();

            $('title').textContent = 'Password saved';
            $('sub').textContent = '';
            show('form', false);
            show('done', true);
            if (ROLE && LOGIN_PAGE[ROLE]) {
                $('login-link').href = LOGIN_PAGE[ROLE];
            } else {
                show('other-logins', true);
            }
            showMsg('Your password has been saved. You can log in with it now.', 'success');
        } catch (err) {
            console.error('setpassword failed:', err);
            showMsg('Something went wrong. Please try again.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Save password';
        }
    }

    async function start() {
        // A bad or used link is reported in the address.
        const bad = PR.linkProblem(window.location.href);
        if (bad) return problemState(bad);

        // Anyone already signed in who opens this page directly must not get a
        // password-change form without their old password: only the link counts.
        if (!OPENED_FROM_LINK) {
            return problemState('This page opens from the link in your email. Open that link, or ask for a new one.');
        }
        if (!supabase) return problemState('Cannot reach the service. Please try again later.');

        supabase.auth.onAuthStateChange((event, session) => {
            if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
                showForm(session);
            }
        });

        // The library may have finished before the listener was added.
        setTimeout(async () => {
            if (READY) return;
            const { data } = await supabase.auth.getSession();
            if (data?.session) showForm(data.session);
            else problemState('This link could not be used. Ask for a new one.');
        }, 2500);
    }

    $('set-btn').addEventListener('click', save);
    $('confirm').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    start();
}

})();
