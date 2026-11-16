// staffemployeeid.test.mjs
// Faculty, registrar and department staff may be given their official employee ID (db/115).
// The accepted shape is EMP- followed by 3 to 12 letters or digits, single hyphens between groups.
// The same shape lives in the database, the sign-in function, the login page and the Admin page.
//   node --test tests/staffemployeeid.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const admin = read('features/admin/admindashboard.js');
const html = read('features/admin/admindashboard.html');
const auth = read('shared/js/accounts/auth.js');
const edge = read('supabase/functions/sign-in/index.ts');
const sql = read('db/115_staff_employee_id_typed.sql');

// The Admin page's shape, taken from its source so the test follows the code.
const adminShape = new RegExp(admin.match(/const STAFF_EMPLOYEE_ID = \/(.+)\/;/)[1]);
// The sign-in shapes accept either case and are a little more lenient (1 to 12).
const authShape = new RegExp(auth.match(/const STAFF_SHAPE\s+= \/(.+)\/i;/)[1], 'i');
const edgeShape = new RegExp(edge.match(/const STAFF_ID = \/(.+)\/i;/)[1], 'i');
// The database shape, as written in the guard.
const dbShape = new RegExp(sql.match(/new\.employee_id !~ '(.+)' then/)[1]);

describe('the shape of a typed staff ID (Admin page and database)', () => {
    const good = ['EMP-00871', 'EMP-00001', 'EMP-2019-0123', 'EMP-ABC', 'EMP-A1B2C3D4E5F6', 'EMP-12-34-56'];
    const bad = ['EMP-12', 'EMP--123', 'EMP-12-', 'EMP--', 'EMP-12_3', 'EMP-1234567890123', 'EMP-', 'emp-00871',
                 'SYS-ADMIN01', '00871', 'EMP-12 34', 'EMP-12.34', 'EMP-12-34-56-78-90'];
    for (const id of good) test(`${id} is accepted`, () => {
        assert.ok(adminShape.test(id), 'admin page');
        assert.ok(dbShape.test(id), 'database guard');
    });
    for (const id of bad) test(`${id} is refused`, () => {
        assert.ok(!adminShape.test(id), 'admin page');
        assert.ok(!dbShape.test(id), 'database guard');
    });
    test('the Admin page and the database agree on a spread of strings', () => {
        const samples = ['EMP-1', 'EMP-12', 'EMP-123', 'EMP-1-2', 'EMP-1-23', 'EMP-12-3', 'EMP-123456789012', 'EMP-1234567890123',
                         'EMP-12345678901-', 'EMP-A-B-C', 'EMP-A--B', 'EMP--A', 'EMP-A-'];
        for (const s of samples) assert.equal(adminShape.test(s), dbShape.test(s), s);
    });
});

describe('every place that reads an ID at sign-in accepts a typed one', () => {
    for (const id of ['EMP-00871', 'emp-00871', 'EMP-2019-0123', 'emp-2019-0123']) {
        test(`${id} gets through the login page and the sign-in function`, () => {
            assert.ok(authShape.test(id), 'login page');
            assert.ok(edgeShape.test(id), 'sign-in function');
        });
    }
    test('the two sign-in shapes are the same', () => {
        assert.equal(authShape.source, edgeShape.source);
    });
    test('an email-less, prefix-less number is still refused', () => {
        assert.ok(!authShape.test('00871'));
        assert.ok(!edgeShape.test('00871'));
        assert.ok(!authShape.test('EMP--1'));
    });
    test('the database lookup recognises a staff ID with inner hyphens', () => {
        assert.match(sql, /cleaned ~ '\^EMP-\[A-Z0-9-\]\+\$'/);
    });
});

describe('the migration', () => {
    test('is a draft that renumbers nothing', () => {
        assert.match(sql, /DRAFT, NOT APPLIED/);
        assert.doesNotMatch(sql, /update public\.(faculty|registrar|department)_staff/i);
    });
    test('compares IDs with hyphens removed, in the guard and in the counter', () => {
        const hits = sql.match(/replace\(employee_id, '-', ''\) = replace\((new\.employee_id|v_id), '-', ''\)/g) || [];
        assert.ok(hits.length >= 6, 'six comparisons across the guard and the counter, found ' + hits.length);
    });
    test('replaces all three format constraints', () => {
        for (const t of ['faculty_staff', 'registrar_staff', 'department_staff']) {
            assert.match(sql, new RegExp(`drop constraint if exists ${t}_employee_id_format`));
            assert.match(sql, new RegExp(`add constraint ${t}_employee_id_format`));
        }
    });
    test('_provision_account uses a typed staff ID and still demands SYS- for admins', () => {
        assert.match(sql, /v_emp_in := upper\(trim\(p_employee_id\)\)/);
        assert.doesNotMatch(sql, /are assigned automatically\. Leave it blank/);
        assert.match(sql, /An employee ID \(SYS-\.\.\.\) is required for administrator accounts/);
        assert.equal((sql.match(/v_uid, v_emp_in, p_first_name/g) || []).length, 3);
    });
    test('keeps the access rules of the functions it replaces', () => {
        assert.match(sql, /revoke execute on function public\.resolve_login_identifier\(text\) from public, anon, authenticated/);
        assert.match(sql, /grant\s+execute on function public\.resolve_login_identifier\(text\) to service_role/);
        assert.match(sql, /if not is_system_admin\(\) then/);
    });
});

describe('the Admin page', () => {
    test('the bulk upload accepts a staff row with an ID and checks its shape', () => {
        assert.doesNotMatch(admin, /Leave employee_id blank for faculty, registrar and department staff/);
        assert.match(admin, /employeeId && !STAFF_EMPLOYEE_ID\.test\(employeeId\)/);
        assert.match(admin, /p_employee_id: row\.employeeId \|\| null/);
    });
    test('the single form lets staff type the ID and sends it', () => {
        assert.match(admin, /p_employee_id: employeeId \|\| null/);
        assert.doesNotMatch(html, /id="a-employee-id"[^>]*\bdisabled\b/);
        assert.match(html, /id="a-employee-id"[^>]*maxlength="16"/);
    });
    test('an administrator still has to type a SYS- ID in the bulk file', () => {
        assert.match(admin, /\^SYS-\[A-Z0-9\]\{3,12\}\$/);
    });
});
