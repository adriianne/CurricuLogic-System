// linkerror.js
//
// What a login page says when someone arrives from an e-mail link that did not work (found 22 Nov 2026).
//
// A confirmation link is single use. Tap it twice (or let the mail app preview it first) and the second visit is refused: Supabase
// sends the person back to the login page with the reason in the address, after a "#":
//     login.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired
// The login page ignored that, so a student whose account WAS confirmed saw a plain login page, or a raw error, and thought
// registration had failed.
//
//   read(hash)  -> null when the address carries no link error, otherwise { code, message }
//                  message is a fixed sentence written here; the text in the address is never shown (anyone can write a link)
//
// "otp_expired" is also what Supabase reports for a link that was already used, so the message covers both.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicLinkError = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const USED_OR_EXPIRED =
    'That link was already used or has expired. If you already confirmed your e-mail, just log in below. ' +
    'If not, log in and we will offer to send you a new link.';

const OTHER =
    'That link could not be used. Try logging in below. If that does not work, contact the Registrar.';

/* The reason is after the "#" for the implicit flow and after the "?" for the PKCE flow; look in both. */
function read(hash, search) {
    for (const part of [hash, search]) {
        const raw = String(part ?? '').replace(/^[#?]/, '');
        if (!raw) continue;
        let params;
        try { params = new URLSearchParams(raw); } catch (e) { continue; }
        const error = params.get('error');
        const code = params.get('error_code');
        if (!error && !code) continue;

        const description = String(params.get('error_description') ?? '').toLowerCase();
        const expired = code === 'otp_expired'
            || /expired|already (been )?used|invalid/.test(description);
        return { code: code || error, message: expired ? USED_OR_EXPIRED : OTHER };
    }
    return null;
}

return { read, USED_OR_EXPIRED, OTHER };
}));
