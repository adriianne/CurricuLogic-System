// bulkapplyhint.js
//
// What the "Set programmes" dialog (Admin -> Staff management) says about the next step (24 Nov 2026).
//
// Apply is greyed out until the choice has been previewed AND the preview found something to change. That is on purpose (Preview does the
// work and undoes it, Apply keeps it), but a greyed button with no reason looked broken: "when I assign several programmes it cannot be
// applied". The footer now says what to do.
//
//   nextStep({ chosen, busy, done, previewKey, key, previewChanged }) -> a short phrase to put after the count, or '' for nothing to add
//     chosen          how many programmes are ticked
//     busy / done     a preview or an apply is running / the change was applied
//     previewKey      what was last previewed; key: what is chosen now (equal when the preview is still current)
//     previewChanged  how many accounts the last preview said would change
//
// Pure function, so it is unit-tested.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicBulkApplyHint = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

function nextStep({ chosen = 0, busy = false, done = false, previewKey = null, key = null, previewChanged = 0 } = {}) {
    if (done || busy || !(chosen > 0)) return '';
    if (previewKey === null || previewKey !== key) return 'press Preview first, then Apply';
    if (!(previewChanged > 0)) return 'nothing would change, so there is nothing to apply';
    return 'ready: press Apply';
}

return { nextStep };
}));
