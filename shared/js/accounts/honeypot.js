// honeypot.js
//
// A basic bot guard for the Register page. The page carries one extra field that a person never sees
// and never fills in. A script that fills in every field it finds fills this one too, and the request is
// quietly dropped. It stops simple form-filling bots only; a bot written for this exact page can skip
// it, so it is a first guard, not a replacement for the Registrar's review.
//
// Pure function only, so it is testable without a browser.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicHoneypot = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* True when the hidden field holds anything but whitespace. */
const tripped = (value) => String(value ?? '').trim() !== '';

return { tripped };

}));
