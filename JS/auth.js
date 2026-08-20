// auth.js — shared by loginpage, staffloginpage, adminloginpage
// One handleLogin(). Role comes from the database, never from the page.
//
// Requires config.js to be loaded first.

(function () {
'use strict';

console.log('auth.js loaded');

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CURRICULOGIC ?? {};

const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

if (!supabase) console.error('auth.js: Supabase client not created. Is config.js loaded?');

const $ = (id) => document.getElementById(id);

/* Lookup order. `home` targets must match the actual filenames on disk.
   Only studentdashboard.html exists so far — the other four will 404
   until those pages are built. */
const ROLES = {
    university_student:   { label: 'University Student',   table: 'university_student',   home: 'studentdashboard.html' },
    faculty_staff:        { label: 'Faculty Staff',        table: 'faculty_staff',        home: 'facultydashboard.html' },
    registrar_staff:      { label: 'Registrar Staff',      table: 'registrar_staff',      home: 'registrardashboard.html' },
    department_staff:     { label: 'Department Staff',     table: 'department_staff',     home: 'departmentdashboard.html' },
    system_administrator: { label: 'System Administrator', table: 'system_administrator', home: 'admindashboard.html' },
};

/* Roles that never get a persistent session.
   NOTE: this currently only affects what is written to sessionStorage.
   Supabase itself still persists the session in localStorage. Either
   implement a non-persisting client on the admin page, or correct the
   "session ends when you close the browser" copy on adminloginpage.html. */
const NO_PERSIST = ['registrar_staff', 'department_staff', 'system_administrator'];

/* One failure message. Never varies by cause. */
const GENERIC_FAIL = 'Invalid username or password.';


/* ---------- messages ---------- */

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


/* ---------- role resolution ---------- */

async function resolveRole(userId) {
    for (const [key, role] of Object.entries(ROLES)) {
        // Select only columns known to exist. Selecting a missing column
        // errors the whole query, which used to fall through to a
        // misleading "Invalid username or password."
        const { data, error } = await supabase
            .from(role.table)
            .select('user_id, is_approved')
            .eq('user_id', userId)
            .maybeSingle();

        if (error) {
            console.warn('role lookup failed on', role.table, error.message);
            continue;
        }
        if (data) return { key, role, approved: data.is_approved !== false };
    }
    return null;
}


/* ---------- login ---------- */

async function handleLogin() {
    clearMsg();

    const identifier = $('identifier')?.value.trim();
    const password   = $('password')?.value;
    const btn        = $('login-btn');

    if (!identifier || !password) {
        return showMsg('Enter your username and password.');
    }

    if (!supabase) {
        return showMsg('Cannot reach the authentication service.');
    }

    // TODO: ID-number login needs an RPC that maps ID → email before this call.
    if (!identifier.includes('@')) {
        return showMsg('Please sign in with your school email address.');
    }

    btn.disabled = true;
    btn.textContent = 'Signing in…';

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: identifier,
            password,
        });

        if (error || !data?.user) {
            console.warn('sign-in failed:', error?.message);
            return showMsg(GENERIC_FAIL);
        }

        const resolved = await resolveRole(data.user.id);

        if (!resolved) {
            await supabase.auth.signOut();
            return showMsg(GENERIC_FAIL);
        }

        if (!resolved.approved) {
            await supabase.auth.signOut();
            return showMsg(
                'This account is awaiting verification. You will be notified once it is approved.'
            );
        }

        const rememberEl = $('remember');
        const persist = rememberEl?.checked && !NO_PERSIST.includes(resolved.key);

        sessionStorage.setItem('cl_role', resolved.key);
        if (!persist) sessionStorage.setItem('cl_no_persist', '1');

        showMsg(`Signed in as ${resolved.role.label}. Redirecting…`, 'success');
        setTimeout(() => { window.location.href = resolved.role.home; }, 700);
        return;

    } catch (err) {
        console.error(err);
        showMsg(GENERIC_FAIL);
    } finally {
        if (btn.textContent === 'Signing in…') {
            btn.disabled = false;
            btn.textContent = 'Log in';
        }
    }
}

$('login-btn')?.addEventListener('click', handleLogin);

['identifier', 'password'].forEach((id) => {
    $(id)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
});

})();