// bulkaccounts.js
//
// The rules of the admin's bulk account upload. Pure functions only, so they
// are testable without a browser.
//
// The Role and Programme dropdowns above the upload decide two things each:
//   - the template: its sample rows are only those of the chosen role, and
//     carry the chosen programme's code and college
//   - the upload: every row has to belong to the chosen role and programme.
//     A row that does not is rejected with a plain reason, instead of being
//     skipped without a word.
// "All roles" and "All programmes" leave the file unconstrained, so a mixed
// file still works.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicBulkAccounts = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* A dropdown's value is 'all' (or empty) when nothing is chosen. */
const chosen = (selected) => {
    const s = String(selected ?? '').trim();
    return s && s.toLowerCase() !== 'all' ? s : null;
};

const ROLE_LABEL = {
    student: 'student', faculty: 'faculty', registrar: 'registrar',
    department: 'department', admin: 'admin',
};
/* The sample rows of the unfiltered template. There is no admin row on
   purpose: a template that ships one invites someone to upload a real batch
   with a sample admin account still in it. An admin sample appears only when
   the admin role is chosen explicitly. */
const DEFAULT_SAMPLE_ROLES = ['faculty', 'registrar', 'department', 'student'];

/* The programme the template's sample rows should use: the chosen one, else
   the first that exists. null when there are no programmes at all. */
function templateProgram(programs, selected) {
    const list = programs ?? [];
    const want = chosen(selected);
    if (want) return list.find(p => p.code.toLowerCase() === want.toLowerCase()) ?? null;
    return list[0] ?? null;
}

/* Which roles get a sample row in the template. */
function sampleRoles(selectedRole) {
    const want = chosen(selectedRole);
    if (!want) return [...DEFAULT_SAMPLE_ROLES];
    const role = want.toLowerCase();
    return role in ROLE_LABEL ? [role] : [];
}

/* "accounts-template.xlsx", "accounts-template-BSIT.xlsx",
   "accounts-template-student.xlsx", "accounts-template-BSIT-student.xlsx". */
function templateFileName(selectedProgramme, selectedRole) {
    // An admin belongs to no programme, so the programme is left out of its name.
    const role = chosen(selectedRole)?.toLowerCase();
    const parts = [role === 'admin' ? null : chosen(selectedProgramme)?.toUpperCase(), role]
        .filter(Boolean);
    return ['accounts-template', ...parts].join('-') + '.xlsx';
}

/* May this row go through, given the role chosen above?
     {}                 no constraint, or the row already matches
     { error: '...' }   the row is for a different role */
function roleGate(selectedRole, rowRole) {
    const want = chosen(selectedRole);
    if (!want) return {};
    const typed = String(rowRole ?? '').trim().toLowerCase();
    if (typed === want.toLowerCase()) return {};
    return {
        error: `This row is ${/^[aeiou]/.test(typed) ? 'an' : 'a'} ${typed || 'blank'} account, but you selected ${want.toLowerCase()}. ` +
            `Change the role above, or correct the row.`,
    };
}

/* May this row go through, given the programme chosen above?
     {}                  no constraint, or the row already matches
     { value: 'BSIT' }   the row left its programme blank: it takes the chosen one
     { error: '...' }    the row does not belong here
   An admin account has no programme, so it cannot be part of a
   single-programme batch. */
function programmeGate(selected, role, rowCode) {
    const want = chosen(selected);
    if (!want) return {};

    if (role === 'admin') {
        return { error: 'Admin accounts do not belong to a programme. Choose "All programmes" to create them.' };
    }

    const typed = String(rowCode ?? '').trim();
    if (!typed) return { value: want };

    if (typed.toLowerCase() !== want.toLowerCase()) {
        return {
            error: `This row is for ${typed}, but you selected ${want}. ` +
                `Change the programme above, or correct the row.`,
        };
    }
    return {};
}

return { templateProgram, sampleRoles, templateFileName, roleGate, programmeGate };

}));
