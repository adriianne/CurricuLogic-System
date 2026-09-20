// eligibility-chat.js
//
// Manages the in-browser conversation state for the eligibility chatbot
// and calls the eligibility-chat Edge Function. History lives only in
// this module's memory -- it resets on page reload, which is a
// deliberate simplification for a first version, not an oversight.

(function () {
'use strict';

let HISTORY = [];   // [{ role: 'user' | 'model', text: string }]
let SUMMARY = null; // set once via initEligibilityChat()

function initEligibilityChat(summary) {
    SUMMARY = summary;
    HISTORY = [];
}

function getChatHistory() {
    return HISTORY.slice();   // a copy -- callers should not mutate this directly
}

async function sendChatMessage(supabaseClient, message) {
    if (!SUMMARY) {
        throw new Error('eligibility-chat: call initEligibilityChat(summary) first.');
    }

    const trimmed = String(message ?? '').trim();
    if (!trimmed) return null;

    const { data, error } = await supabaseClient.functions.invoke('eligibility-chat', {
        body: { summary: SUMMARY, history: HISTORY, message: trimmed },
    });

    if (error) {
        console.warn('eligibility-chat failed:', error);
        HISTORY.push({ role: 'user', text: trimmed });
        throw new Error('Could not reach the assistant. Please try again.');
    }

    HISTORY.push({ role: 'user', text: trimmed });
    HISTORY.push({ role: 'model', text: data.reply });

    // The table, if Gemini decided this answer calls for one, is built
    // here from SUMMARY.recommended -- the same real array the rest of
    // the dashboard already renders -- never from anything Gemini wrote.
    // Gemini only ever supplies the yes/no decision, not the numbers.
    return {
        text: data.reply,
        table: data.showRecommendedTable ? (SUMMARY.recommended ?? []) : null,
    };
}

window.EligibilityChat = { initEligibilityChat, getChatHistory, sendChatMessage };

})();