// departmentfill.js
//
// "Department / college" on the Admin's Create account form follows the programme (24 Nov 2026).
//
// Every programme has a college (Admin -> Programs -> College). A faculty member or a department head is linked to programmes THROUGH that
// college name, so a college typed by hand that differs from the programme's puts the account under the wrong programmes. The box now takes
// the college of the chosen programme.
//
//   pick({ role, programmes, code, current, onlyIfEmpty }) -> the text to put in the box, or null for "leave it as it is"
//     role         'faculty' | 'department' | 'registrar' | 'student' | ''
//     programmes   [{ code, college }]  the programmes the Admin has set up
//     code         the chosen programme's code ('' while none is chosen)
//     current      what the box holds now
//     onlyIfEmpty  true when the role changed (fill a blank box, do not overwrite); false when the programme changed (always follow it)
//
// A student has no department box, and a Registrar's department is the Registrar's own office, not a college: neither is filled.
// Pure function, so it is unit-tested.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicDepartmentFill = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

function pick({ role, programmes, code, current, onlyIfEmpty = false } = {}) {
    if (role === 'student' || role === 'registrar') return null;
    const wanted = String(code ?? '').trim().toLowerCase();
    if (!wanted) return null;
    const program = (Array.isArray(programmes) ? programmes : []).find((p) => String(p?.code ?? '').trim().toLowerCase() === wanted);
    const college = String(program?.college ?? '').trim();
    if (!college) return null;                                  // the programme has no college set: nothing to follow
    const now = String(current ?? '').trim();
    if (onlyIfEmpty && now) return null;
    if (now === college) return null;                           // already right
    return college;
}

return { pick };
}));
