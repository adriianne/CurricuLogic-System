(function () {
'use strict';

console.log('auth.js loaded');

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CURRICULOGIC ?? {};

const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

if (!supabase) console.error('auth.js: Supabase client not created. Is config.js loaded?');

const $ = (id) => document.getElementById(id);
const ROLES = {
    university_student:   { label: 'University Student',   table: 'university_student',   home: 'studentdashboard.html' },
    faculty_staff:        { label: 'Faculty Staff',        table: 'faculty_staff',        home: 'facultydashboard.html' },
    registrar_staff:      { label: 'Registrar Staff',      table: 'registrar_staff',      home: 'registrardashboard.html' },
    department_staff:     { label: 'Department Staff',     table: 'department_staff',     home: 'departmentdashboard.html' },
    system_administrator: { label: 'System Administrator', table: 'system_administrator', home: 'admindashboard.html' },
};

const NO_PERSIST = ['registrar_staff', 'department_staff', 'system_administrator'];
const GENERIC_FAIL = 'Invalid username or password.';

const DEBUG_LOGIN = true;


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

    btn.disabled = true;
    btn.textContent = 'Signing in…';

    try {
        // Students sign in with uc-1234567, staff with EMP-00871. Both
        // resolve to an email server-side — the lookup is an RPC rather
        // than a client query, so the actor tables need no anon read
        // policy, which would expose the whole student list.
        let email = identifier;

        if (!identifier.includes('@')) {
            const { data: resolved, error: rpcError } =
                await supabase.rpc('resolve_login_identifier', { identifier });

            if (rpcError) {
                console.warn('[FAIL: rpc] identifier lookup failed:', rpcError.message);
                return showMsg(GENERIC_FAIL);
            }

            if (!resolved) {
                // Same message as a wrong password. A distinct one here
                // would confirm whether an ID exists.
                if (DEBUG_LOGIN) console.warn('[FAIL: identifier] no account for', identifier);
                return showMsg(GENERIC_FAIL);
            }

            email = resolved;
            if (DEBUG_LOGIN) console.log('[auth] identifier resolved to', email);
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error || !data?.user) {
            console.warn('[FAIL: credentials] sign-in rejected:', error?.message);
            return showMsg(GENERIC_FAIL);
        }

        if (DEBUG_LOGIN) console.log('[auth] authenticated. uid =', data.user.id);

        const resolved = await resolveRole(data.user.id);

        if (!resolved) {
            // Authenticated, but no actor row matched. Entirely different
            // from a credential failure, and it should not look the same
            // while developing.
            console.warn('[FAIL: no actor row] authenticated uid', data.user.id,
                         'has no row in any of the five actor tables');
            await supabase.auth.signOut();
            return showMsg(DEBUG_LOGIN
                ? 'Signed in, but no account record is linked to this user.'
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