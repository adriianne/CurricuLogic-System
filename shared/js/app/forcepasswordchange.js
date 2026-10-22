// forcepasswordchange.js
//
// An account an administrator creates comes with a temporary password. The first
// time that person opens their dashboard they must choose their own: a box covers
// the page until they do (db/057 provides the flag reader and clearer).
//
// Each dashboard calls it once, after it has confirmed the person is signed in:
//     window.CurriculogicForcePassword?.run(supabase, 'student');
//
// This is a browser-side gate: it stops the normal use of an account that still
// has its temporary password, but it is not a server rule.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicForcePassword = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* What to tell the person about a proposed new password, or null when fine.
   Pure, so it can be tested without a browser. */
function checkNewPassword(next, confirm, role, rules) {
    if (!next) return 'Enter a new password.';
    const problem = rules && rules.problem ? rules.problem(next, role) : null;
    if (problem) return problem;
    if (next !== confirm) return 'The two passwords do not match.';
    return null;
}

function build(doc, onSubmit, onLogout, hint) {
    const el = (tag, props = {}, text) => {
        const n = doc.createElement(tag);
        Object.assign(n, props);
        if (text != null) n.textContent = text;
        return n;
    };

    const overlay = el('div', { id: 'force-password-overlay' });
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'force-password-title');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.72);display:flex;align-items:center;justify-content:center;padding:1rem;';

    const card = el('form', { noValidate: true });
    card.style.cssText = 'background:#fff;border-radius:14px;max-width:26rem;width:100%;padding:1.5rem;box-shadow:0 20px 50px rgba(0,0,0,.3);font:inherit;color:#0f172a;';

    const title = el('h2', { id: 'force-password-title' }, 'Choose a new password');
    title.style.cssText = 'margin:0 0 .35rem;font-size:1.2rem;';
    const lead = el('p', {}, 'You signed in with a temporary password. Choose your own before you continue.');
    lead.style.cssText = 'margin:0 0 1rem;font-size:.9rem;color:#64748b;line-height:1.5;';

    const field = (id, label) => {
        const wrap = el('div');
        wrap.style.cssText = 'margin-bottom:.8rem;';
        const l = el('label', { htmlFor: id }, label);
        l.style.cssText = 'display:block;font-size:.8rem;font-weight:600;margin-bottom:.25rem;';
        const i = el('input', { id, type: 'password', autocomplete: 'new-password', maxLength: 72 });
        i.style.cssText = 'width:100%;box-sizing:border-box;padding:.6rem .7rem;border:1px solid #cbd5e1;border-radius:8px;font:inherit;';
        wrap.append(l, i);
        return { wrap, input: i };
    };
    const a = field('force-pw-new', 'New password');
    const b = field('force-pw-confirm', 'Confirm new password');

    const note = el('p', {}, hint || '');
    note.style.cssText = 'margin:0 0 .8rem;font-size:.78rem;color:#64748b;';
    const msg = el('p', { id: 'force-pw-msg' });
    msg.setAttribute('role', 'alert');
    msg.style.cssText = 'margin:0 0 .8rem;font-size:.85rem;color:#b91c1c;min-height:1.1em;';

    const save = el('button', { type: 'submit' }, 'Save and continue');
    save.style.cssText = 'background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:.65rem 1rem;font:inherit;font-weight:600;cursor:pointer;';
    const out = el('button', { type: 'button' }, 'Log out');
    out.style.cssText = 'background:none;border:0;color:#64748b;margin-left:.75rem;font:inherit;cursor:pointer;';

    card.append(title, lead, a.wrap, b.wrap, note, msg, save, out);
    overlay.append(card);

    card.addEventListener('submit', async (e) => {
        e.preventDefault();
        save.disabled = true;
        msg.textContent = '';
        const error = await onSubmit(a.input.value, b.input.value);
        if (error) { msg.textContent = error; save.disabled = false; }
    });
    out.addEventListener('click', onLogout);
    return { overlay, focus: () => a.input.focus() };
}

async function run(supabase, role, opts = {}) {
    const doc = opts.document || (typeof document !== 'undefined' ? document : null);
    if (!supabase || !doc) return false;
    if (doc.getElementById('force-password-overlay')) return true;

    let needed = false;
    try {
        const { data, error } = await supabase.rpc('my_must_change_password');
        needed = !error && data === true;
    } catch (_) { return false; }
    if (!needed) return false;

    const rules = opts.rules || (typeof window !== 'undefined' ? window.CurriculogicPasswordRules : null);

    const ui = build(
        doc,
        async (next, confirm) => {
            const problem = checkNewPassword(next, confirm, role, rules);
            if (problem) return problem;
            const { error: upErr } = await supabase.auth.updateUser({ password: next });
            if (upErr) return upErr.message || 'Could not change the password.';
            const { error: clrErr } = await supabase.rpc('clear_must_change_password');
            if (clrErr) return 'Your password was changed, but we could not finish. Please sign in again.';
            ui.overlay.remove();
            return null;
        },
        async () => {
            try { await supabase.auth.signOut(); } catch (_) { /* leave anyway */ }
            if (typeof location !== 'undefined') location.reload();
        },
        rules && rules.hint ? rules.hint(role) : ''
    );
    doc.body.appendChild(ui.overlay);
    ui.focus();
    return true;
}

return { run, checkNewPassword };
}));
