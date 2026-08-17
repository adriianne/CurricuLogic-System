// auth.js — shared by loginpage, staffloginpage, adminloginpage
// One handleLogin(). Role comes from the database, never from the page.

(function () {
'use strict';

console.log('auth.js loaded');

const SUPABASE_URL = 'https://kibleqlooeaetpbelhve.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYmxlcWxvb2VhZXRwYmVsaHZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzOTM1NjMsImV4cCI6MjEwMTk2OTU2M30.9XPjRgJh3rEuuX-fV0ZrtRiUnahfP8yl8yerzoSsnLk';

const supabase = window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const $ = (id) => document.getElementById(id);

/* Lookup order. `home` targets must exist or login lands on a 404. */
const ROLES = {
    university_student:   { label: 'University Student',   table: 'university_student',   home: 'student-dashboard.html' },
    faculty_staff:        { label: 'Faculty Staff',        table: 'faculty_staff',        home: 'faculty-dashboard.html' },
    registrar_staff:      { label: 'Registrar Staff',      table: 'registrar_staff',      home: 'registrar-dashboard.html' },
    department_staff:     { label: 'Department Staff',     table: 'department_staff',     home: 'department-dashboard.html' },
    system_administrator: { label: 'System Administrator', table: 'system_administrator', home: 'admin-dashboard.html' },
};

/* Roles that never get a persistent session. */
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
        const { data, error } = await supabase
            .from(role.table)
            .select('id, is_approved')
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