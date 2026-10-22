// config.js — shared Supabase configuration.
// Load this BEFORE auth.js, register.js, or studentdashboard.js.
//
// The anon key is public by design. It identifies the project, it does not
// grant access — Row Level Security is what protects the data. Keeping it
// in one file means rotating it is a single edit, not five.

// Every createClient() call in this app used to omit `auth.storageKey`,
// so every role fell back to the same default localStorage key. Since
// localStorage is shared by every tab on the same origin, signing in
// as a second role in a new tab silently overwrote the first tab's
// session there too -- refreshing the first tab then read the SECOND
// role's session back out, which is what looked like "auto logout" but
// was really "logged in as someone else." Splitting the three login
// surfaces (student / staff / admin -- staff covers faculty, registrar
// and department, which already share one login page and form) into
// their own storage keys means a tab logged in as one bucket is
// untouched by a login to a different bucket in another tab. Two tabs
// both signed in as, say, faculty and registrar still share the
// "staff" bucket and can still collide -- not the scenario reported,
// and splitting further would need each of those three to resolve
// which table matched before the key could be chosen.
const AUTH_ROLE_BUCKET = {
    university_student:   'student',
    faculty_staff:        'staff',
    registrar_staff:      'staff',
    department_staff:     'staff',
    system_administrator: 'admin',
};

// roleKeys: an array of ROLES keys (see auth.js), or omitted/empty for
// "don't know yet, or spans every role" -- callers in that position
// fall back to a fourth, catch-all bucket rather than guessing. A plain
// function, not a method -- callers destructure it off window.CURRICULOGIC
// (const { authStorageKey } = window.CURRICULOGIC), which drops any `this`
// binding, so it must not depend on one.
function authStorageKey(roleKeys) {
    const buckets = new Set(
        (roleKeys ?? [])
            .map(k => AUTH_ROLE_BUCKET[k])
            .filter(Boolean));
    const bucket = buckets.size === 1 ? [...buckets][0] : 'shared';
    return `sb-curriculogic-${bucket}-auth`;
}

// Where a signed-in session is kept. A login that was NOT "remembered" (see
// auth.js) keeps its session in sessionStorage, which the browser discards when
// the tab closes; a remembered one stays in localStorage. Before this, every
// session went to localStorage whatever the person chose, so "Remember me" did
// nothing and a registrar, department or admin session outlived the tab.
function authStorage() {
    try {
        return window.sessionStorage.getItem('cl_no_persist') === '1'
            ? window.sessionStorage
            : window.localStorage;
    } catch {
        return undefined;   // storage blocked: the library falls back to memory
    }
}

// The `auth` options a dashboard passes to createClient().
function authOptions(roleKeys) {
    const options = { storageKey: authStorageKey(roleKeys) };
    const storage = authStorage();
    if (storage) options.storage = storage;
    return options;
}

window.CURRICULOGIC = {
    SUPABASE_URL: 'https://kibleqlooeaetpbelhve.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYmxlcWxvb2VhZXRwYmVsaHZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzOTM1NjMsImV4cCI6MjEwMTk2OTU2M30.9XPjRgJh3rEuuX-fV0ZrtRiUnahfP8yl8yerzoSsnLk',
    AUTH_ROLE_BUCKET,
    authStorageKey,
    authOptions,
};