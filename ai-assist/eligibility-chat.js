// eligibility-chat.js
//
// Manages the in-browser conversation state for the eligibility chatbot
// and calls the eligibility-chat Edge Function. HISTORY drives what gets
// sent to the model; it is loaded from and appended to ai_chat_message
// (via loadChatHistory / sendChatMessage) so the conversation survives
// a reload, not just the sending of the next message.

(function () {
'use strict';

let HISTORY = [];    // [{ role: 'user' | 'model', text: string }]
let SUMMARY = null;  // set once via initEligibilityChat()
let STUDENT_ID = null; // university_student.id -- set via loadChatHistory()

function initEligibilityChat(summary) {
    SUMMARY = summary;
    HISTORY = [];
}

// Replaces only the data Cura reads, leaving the conversation alone. Used
// when something the student can change (their preferences) changes while
// a chat is already open; initEligibilityChat() would wipe HISTORY.
function updateSummary(summary) {
    if (summary) SUMMARY = summary;
}

function getChatHistory() {
    return HISTORY.slice();   // a copy -- callers should not mutate this directly
}

// Loads this student's saved conversation (oldest first) into HISTORY so
// it's included as context on the next message, and returns the rows so
// the caller can replay them into the chat UI. Call once per page load,
// after initEligibilityChat(). Silently returns [] on any failure -- a
// student should never be blocked from chatting because history didn't load.
async function loadChatHistory(supabaseClient, studentId) {
    STUDENT_ID = studentId ?? null;
    if (!STUDENT_ID) return [];

    const { data, error } = await supabaseClient
        .from('ai_chat_message')
        .select('role, text, show_recommended_table, show_schedule_table, schedule_option')
        .eq('student_id', STUDENT_ID)
        .order('created_at', { ascending: true });

    if (error) {
        console.warn('eligibility-chat: could not load chat history:', error.message);
        return [];
    }

    HISTORY = data.map(row => ({ role: row.role, text: row.text }));
    return data;
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

    if (STUDENT_ID) {
        const { error: saveError } = await supabaseClient.from('ai_chat_message').insert([
            { student_id: STUDENT_ID, role: 'user', text: trimmed, show_recommended_table: false, show_schedule_table: false, schedule_option: null },
            { student_id: STUDENT_ID, role: 'model', text: data.reply, show_recommended_table: !!data.showRecommendedTable, show_schedule_table: !!data.showScheduleTable, schedule_option: data.showScheduleTable ? (data.scheduleOption ?? null) : null },
        ]);
        // A failed save should not break the conversation the student is
        // having right now -- it just won't be there next time they visit.
        if (saveError) console.warn('eligibility-chat: could not save chat history:', saveError.message);
    }

    // The table, if Gemini decided this answer calls for one, is built
    // here from SUMMARY.recommended -- the same real array the rest of
    // the dashboard already renders -- never from anything Gemini wrote.
    // Gemini only ever supplies the yes/no decision, not the numbers.
    // The schedule table (subject, section, days, times) is built the same way, by
    // shared/js/scheduletable.js from the summary; Gemini only says whether to show it.
    return {
        text: data.reply,
        table: data.showRecommendedTable ? tableFor(SUMMARY) : null,
        schedule: data.showScheduleTable ? scheduleFor(SUMMARY, data.scheduleOption ?? null) : null,
    };
}

/* The plan table's rows for a summary: the suggested subjects, each with the section and
   when it meets once a schedule is published (shared/js/scheduletable.js). */
function tableFor(summary) {
    const T = (typeof window !== 'undefined') ? window.CurriculogicScheduleTable : null;
    return T ? T.planRows(summary) : (summary?.recommended ?? []);
}

/* The schedule table for a summary, or null when there is nothing to show. */
function scheduleFor(summary, option = null) {
    const T = (typeof window !== 'undefined') ? window.CurriculogicScheduleTable : null;
    if (!T) return null;
    const t = T.build(summary, option);
    return t.rows.length || t.notInPlan.length ? t : null;
}

window.EligibilityChat = { initEligibilityChat, updateSummary, loadChatHistory, getChatHistory, sendChatMessage, scheduleFor, tableFor };

})();