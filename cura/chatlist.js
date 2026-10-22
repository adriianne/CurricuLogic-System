// chatlist.js
//
// The list of chats at the left of Cura's chat: which day heading each one sits
// under, and what to call a chat that has no title. Pure functions, so they are
// testable without a browser.
//
//   const groups = CurriculogicChatList.groupByDay(conversations, new Date());
//   // [{ label: 'Today', items: [...] }, { label: 'Yesterday', items: [...] },
//   //  { label: '12 Oct 2026', items: [...] }]
//
// Days are the student's own calendar days (local time), newest first. The
// conversations keep the order they were given in within a day.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicChatList = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dayKey = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

function dayLabel(date, now) {
    const today = dayKey(now);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const k = dayKey(date);
    if (k === today) return 'Today';
    if (k === dayKey(yesterday)) return 'Yesterday';
    return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/* Conversations -> [{ label, items }], one group per calendar day of updated_at. */
function groupByDay(conversations, now = new Date()) {
    const groups = [];
    let last = null;
    for (const c of conversations ?? []) {
        const when = new Date(c.updated_at);
        if (Number.isNaN(when.getTime())) continue;
        const key = dayKey(when);
        if (!last || last.key !== key) {
            last = { key, label: dayLabel(when, now), items: [] };
            groups.push(last);
        }
        last.items.push(c);
    }
    return groups.map(({ label, items }) => ({ label, items }));
}

/* What the list shows for a chat. */
function titleOf(conversation) {
    const t = String(conversation?.title ?? '').trim();
    return t || 'New chat';
}

return { groupByDay, titleOf, dayLabel };
}));
