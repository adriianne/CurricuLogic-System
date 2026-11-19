// departmentprofile.test.mjs
// The Department's Profile page: the three small gaps found on 19 Nov 2026 while verifying Edit Profile.
//   1. leftover console.log('DEBUG: ...') lines in the save function
//   2. a name the database refuses showed the raw constraint text
//   3. the password dialog had no "same as your current password" check, so a dummy current password reached the server
//
//   node --test tests/departmentprofile.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const NameRules = require('../shared/js/accounts/namerules.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('features/department/departmentdashboard.js');
const html = read('features/department/departmentdashboard.html');

/* The body of one function of the page script. */
function bodyOf(name) {
    const start = js.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} not found`);
    const open = js.indexOf('{', js.indexOf(')', start));
    let depth = 0;
    for (let i = open; i < js.length; i++) {
        if (js[i] === '{') depth++;
        else if (js[i] === '}' && --depth === 0) return js.slice(open, i + 1);
    }
    throw new Error('unbalanced ' + name);
}

describe('no debug output is left in the page', () => {
    test('there are no DEBUG console lines in the Department script', () => {
        assert.ok(!/console\.log\(\s*['"`]DEBUG/.test(js));
        assert.ok(!js.includes('DEBUG:'));
    });
    test('the save function logs a failure to the console but never the staff id', () => {
        const save = bodyOf('saveProfile');
        assert.ok(!/console\.log\(/.test(save));
        assert.ok(!/console\.\w+\([^)]*STAFF_ID/.test(save));
    });
});

describe('the name check is the same one every other form uses', () => {
    const save = bodyOf('saveProfile');
    test('the page loads namerules.js before its own script', () => {
        const rules = html.indexOf('<script src="../../shared/js/accounts/namerules.js"></script>');
        const page = html.indexOf('<script src="departmentdashboard.js"></script>');
        assert.ok(rules > 0 && page > 0 && rules < page);
    });
    test('first and last name go through CurriculogicNameRules, with its plain sentences', () => {
        assert.ok(save.includes("CurriculogicNameRules.problem(first, 'first name')"));
        assert.ok(save.includes("CurriculogicNameRules.problem(last, 'last name')"));
        assert.ok(save.includes('CurriculogicNameRules.clean('));
    });
    test('what the rule says for the cases a person can hit', () => {
        assert.equal(NameRules.problem('', 'first name'), 'Enter a first name.');
        assert.equal(NameRules.problem('<b>x</b>', 'first name'), "The first name can only contain letters, spaces, and the characters ' . - ,");
        assert.equal(NameRules.problem('Pedro', 'first name'), null);
        assert.equal(NameRules.problem("Ma. Luisa de la Cruz-Reyes", 'first name'), null);
    });
    test('the check runs before anything is sent to the database', () => {
        assert.ok(save.indexOf('CurriculogicNameRules.problem(first') < save.indexOf("from('department_staff')"));
    });
    test('saving with nothing changed says so instead of writing', () => {
        assert.ok(save.includes("'Nothing to save: no details were changed.'"));
        assert.ok(save.indexOf('Nothing to save') < save.indexOf("from('department_staff')"));
    });
});

describe('a name the database refuses gets a friendly sentence', () => {
    const save = bodyOf('saveProfile');
    test('the constraint text is turned into the same sentence as the form', () => {
        assert.ok(save.includes("/check constraint .*_(first|last)_name_chars/"));
        assert.ok(save.includes("The name can only contain letters, spaces, and the characters ' . - ,"));
    });
    test('the pattern matches the real constraint message and nothing unrelated', () => {
        const re = /check constraint .*_(first|last)_name_chars/;
        assert.ok(re.test('new row for relation "department_staff" violates check constraint "department_staff_first_name_chars"'));
        assert.ok(re.test('new row for relation "department_staff" violates check constraint "department_staff_last_name_chars"'));
        assert.ok(!re.test('new row for relation "department_staff" violates check constraint "department_staff_employee_id_format"'));
        assert.ok(!re.test('permission denied for table department_staff'));
    });
    test('any other failure shows a plain message, not the raw database text', () => {
        assert.ok(save.includes("'Could not save your changes. Please try again.'"));
        assert.ok(!/finish\('Could not save changes\. ' \+ error\.message\)/.test(save));
    });
});

describe('the password dialog does not send a password that cannot work', () => {
    const submit = bodyOf('submitPasswordChange');
    test('a new password equal to the current one is refused in the page', () => {
        assert.ok(submit.includes("if (next === current) return showMsg('pw-msg', 'Choose a password different from your current one.');"));
    });
    test('every check comes before the sign-in that verifies the current password', () => {
        const signIn = submit.indexOf('signInWithPassword');
        assert.ok(signIn > 0);
        for (const check of ["'Enter your current password.'", 'CurriculogicPasswordRules.problem(next)', "'New passwords do not match.'", 'next === current']) {
            const at = submit.indexOf(check);
            assert.ok(at >= 0 && at < signIn, check);
        }
    });
    test('the page checks match the Admin\'s form in wording and order', () => {
        const admin = read('features/admin/admindashboard.js');
        for (const sentence of ['Enter your current password.', 'New passwords do not match.', 'Choose a password different from your current one.']) {
            assert.ok(submit.includes(sentence), sentence);
            assert.ok(admin.includes(sentence), sentence);
        }
    });
});
