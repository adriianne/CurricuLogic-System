(function () {
'use strict';

const { SUPABASE_URL, SUPABASE_ANON_KEY, authStorageKey } = window.CURRICULOGIC ?? {};

/* Which roles this specific login page will accept. Read from the page
   itself via <body data-allowed-roles="..."> rather than hardcoded here,
   since auth.js is shared by every login page and has no idea on its own
   which one it is currently loaded into.

   Without this, resolveRole() below matched against every actor table in
   ROLES regardless of page -- a student typing real credentials into the
   staff login page authenticated successfully and was sent to their own
   dashboard, because nothing ever checked that a student should not be
   allowed to authenticate from that page at all.

   Falls back to allowing every role if the attribute is missing, so a
   page that has not been updated yet still behaves as before -- the
   restriction is opt-in per page. Computed before the client below, since
   that also needs it (to pick this page's storage bucket). */
const PAGE_ALLOWED_ROLES = (() => {
    const raw = document.body?.dataset?.allowedRoles;
    if (!raw) return null;
    return raw.split(',').map(r => r.trim()).filter(Boolean);
})();

// Bucketed by role (see config.js) so a sign-in here lands in the same
// storage slot the destination dashboard's own client will read from --
// without this, every role shared one localStorage key, so signing in
// as a second role in a new tab silently logged the first tab in as
// that second role too, on its next refresh.
const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { storageKey: authStorageKey?.(PAGE_ALLOWED_ROLES) },
    })
    : null;

if (!supabase) console.error('auth.js: Supabase client not created. Is config.js loaded?');

const $ = (id) => document.getElementById(id);

// home is relative to whatever login page is on screen when the redirect
// fires — features/auth/html/<page>.html — not to this file. That is why
// these changed when the dashboards moved into features/<role>/ folders:
// the old bare filenames only worked when everything sat in one folder.
const ROLES = {
    university_student:   { label: 'University Student',   table: 'university_student',   home: '../../student/studentdashboard.html' },
    faculty_staff:        { label: 'Faculty Staff',        table: 'faculty_staff',        home: '../../faculty/facultydashboard.html' },
    registrar_staff:      { label: 'Registrar Staff',      table: 'registrar_staff',      home: '../../registrar/registrardashboard.html' },
    department_staff:     { label: 'Department Staff',     table: 'department_staff',     home: '../../department/departmentdashboard.html' },
    system_administrator: { label: 'System Administrator', table: 'system_administrator', home: '../../admin/admindashboard.html' },
};

const NO_PERSIST = ['registrar_staff', 'department_staff', 'system_administrator'];
const GENERIC_FAIL = 'Invalid username or password.';

/* What each login page accepts in the username box:
     student page  -> school email or uc-1234567
     staff page    -> school email or EMP-00123
     admin page    -> email only
   A page with no data-allowed-roles accepts every shape. The server
   (sign-in edge function) enforces the same shapes; this only gives a useful
   message before anything is sent. Returns null when the shape is fine. */
const EMAIL_SHAPE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STUDENT_SHAPE = /^uc-\d{1,7}$/i;
const STAFF_SHAPE   = /^emp-[a-z0-9]{1,10}$/i;
const STAFF_ROLES   = ['faculty_staff', 'registrar_staff', 'department_staff'];

function identifierProblem(identifier) {
    if (EMAIL_SHAPE.test(identifier)) return null;

    const roles = PAGE_ALLOWED_ROLES;
    const takesStudentId = !roles || roles.includes('university_student');
    const takesStaffId   = !roles || roles.some(r => STAFF_ROLES.includes(r));

    if (takesStudentId && STUDENT_SHAPE.test(identifier)) return null;
    if (takesStaffId   && STAFF_SHAPE.test(identifier))   return null;

    if (takesStudentId && !takesStaffId) return 'Enter your school email or your student ID (for example uc-2401187).';
    if (takesStaffId && !takesStudentId) return 'Enter your school email or your employee ID (for example EMP-00123).';
    if (!takesStudentId && !takesStaffId) return 'Enter your administrator email address.';
    return 'Enter your school email or your ID.';
}

/* DEBUG_LOGIN must be OFF in production. It exists purely to make local
   development easier: verbose console logging of auth internals, and
   more specific failure text (e.g. "this account exists but is not a
   faculty account") instead of the generic message below. That
   specific text is exactly the account-enumeration leak GENERIC_FAIL
   exists to prevent -- it confirms to an attacker which login page a
   given email "belongs" to. So this is derived from the hostname the
   same way admindashboard.js's PREVIEW flag is, never hardcoded true:
   it only turns on for localhost/127.0.0.1, and is off for the real
   deployed origin regardless of what happens to this file afterward. */
const DEBUG_LOGIN = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);


/*  messages  */

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


/*  password visibility  */

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


/*  role resolution  */

async function resolveRole(userId) {
    for (const [key, role] of Object.entries(ROLES)) {

        // Skip any role this page does not accept, before even querying
        // its table -- a student's credentials must never resolve to a
        // student dashboard redirect from the staff login page.
        if (PAGE_ALLOWED_ROLES && !PAGE_ALLOWED_ROLES.includes(key)) continue;

        const { data, error } = await supabase
            .from(role.table)
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (error) {
            console.warn(`[resolveRole] ${role.table} errored:`, error.message);
            continue;
        }

        if (!data) {
            if (DEBUG_LOGIN) console.log(`[resolveRole] ${role.table}: no row`);
            continue;
        }
        const approved = data.is_approved === true;

        if (DEBUG_LOGIN) console.log(`[resolveRole] MATCH in ${role.table}, approved:`, approved);

        return { key, role, approved };
    }
    return null;
}


/*  login  */

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

    // Wrong shape: say what this page accepts, before anything is sent.
    // Which shapes are valid is a property of the page, not a secret.
    const shapeProblem = identifierProblem(identifier);
    if (shapeProblem) return showMsg(shapeProblem);

    btn.disabled = true;
    btn.textContent = 'Signing in…';

    try {
        // The email, a uc-1234567 or an EMP-00871 is sent to the sign-in edge
        // function, which finds the account and checks the password on the
        // server. The browser never learns an account's email from an ID,
        // and an unknown ID gets the same answer as a wrong password.
        let session;
        try {
            const res = await fetch(`${SUPABASE_URL}/functions/v1/sign-in`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: SUPABASE_ANON_KEY,
                    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                },
                body: JSON.stringify({ identifier, password }),
            });

            if (res.status === 429) {
                return showMsg('Too many attempts. Please wait a few minutes and try again.');
            }
            if (!res.ok) {
                if (DEBUG_LOGIN) console.warn('[FAIL: sign-in]', res.status);
                return showMsg(GENERIC_FAIL);
            }
            session = (await res.json())?.session;
        } catch (netErr) {
            console.warn('[FAIL: network] sign-in service unreachable:', netErr?.message);
            return showMsg('Cannot reach the sign-in service. Check your connection and try again.');
        }

        if (!session?.access_token || !session?.refresh_token) return showMsg(GENERIC_FAIL);

        const { data, error } = await supabase.auth.setSession({
            access_token:  session.access_token,
            refresh_token: session.refresh_token,
        });

        if (error || !data?.user) {
            if (DEBUG_LOGIN) console.warn('[FAIL: session] could not start session:', error?.message);
            return showMsg(GENERIC_FAIL);
        }

        if (DEBUG_LOGIN) console.log('[auth] authenticated. uid =', data.user.id);

        const resolved = await resolveRole(data.user.id);

        if (!resolved) {
            // Authenticated, but no actor row matched -- either genuinely
            // no account, or (just as likely now) a real account that
            // this specific page does not accept, e.g. a student on the
            // staff login page. Both must show the same generic message
            // outside of DEBUG_LOGIN: confirming "your credentials are
            // real, just not for this page" is still information leakage.
            if (DEBUG_LOGIN) console.warn('[FAIL: no actor row] authenticated uid', data.user.id,
                         'has no row in any allowed table for this page',
                         PAGE_ALLOWED_ROLES ?? '(all roles)');
            await supabase.auth.signOut();
            return showMsg(DEBUG_LOGIN
                ? (PAGE_ALLOWED_ROLES
                    ? 'This account exists but is not a ' +
                      PAGE_ALLOWED_ROLES.map(k => ROLES[k]?.label ?? k).join('/') +
                      ' account. Use the correct login page.'
                    : 'Signed in, but no account record is linked to this user.')
                : GENERIC_FAIL);
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
        if (!persist) {
            sessionStorage.setItem('cl_no_persist', '1');
            // The sign-in above just saved the session to localStorage. A login
            // that is not remembered keeps it for this tab only: move it, so it
            // is gone when the tab closes. (The dashboard reads from the same
            // place: authOptions() in config.js.)
            try {
                const slot = authStorageKey?.(PAGE_ALLOWED_ROLES);
                const raw = slot ? localStorage.getItem(slot) : null;
                if (raw) {
                    sessionStorage.setItem(slot, raw);
                    localStorage.removeItem(slot);
                }
            } catch { /* storage blocked: nothing to move */ }
        } else {
            sessionStorage.removeItem('cl_no_persist');
        }

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