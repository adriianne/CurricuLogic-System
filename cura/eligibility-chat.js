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
let CONVERSATION_ID = null; // ai_chat_conversation.id of the open chat; null until its first message is sent

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

const MESSAGE_COLUMNS = 'role, text, show_recommended_table, show_schedule_table, schedule_option';

// Opens the student's most recent conversation (db/074) and returns its rows so the
// caller can replay them into the chat UI; HISTORY becomes what Cura is sent as
// context. Call once per page load, after initEligibilityChat(). Silently returns []
// on any failure -- a student should never be blocked from chatting because history
// didn't load.
async function loadChatHistory(supabaseClient, studentId) {
    STUDENT_ID = studentId ?? null;
    CONVERSATION_ID = null;
    HISTORY = [];
    if (!STUDENT_ID) return [];

    const { data: latest, error: listError } = await supabaseClient
        .from('ai_chat_conversation')
        .select('id')
        .eq('student_id', STUDENT_ID)
        .order('updated_at', { ascending: false })
        .limit(1);

    if (listError) {
        console.warn('eligibility-chat: could not load chat history:', listError.message);
        return [];
    }
    if (!latest?.length) return [];
    return openConversation(supabaseClient, latest[0].id);
}

// The student's conversations, newest first: [{ id, title, updated_at }].
async function listConversations(supabaseClient) {
    if (!STUDENT_ID) return [];
    const { data, error } = await supabaseClient
        .from('ai_chat_conversation')
        .select('id, title, updated_at')
        .eq('student_id', STUDENT_ID)
        .order('updated_at', { ascending: false });
    if (error) {
        console.warn('eligibility-chat: could not list chats:', error.message);
        return [];
    }
    return data;
}

// Makes one conversation the open one: Cura is sent its messages from now on, and the
// rows are returned for the page to show. Returns [] (and leaves a blank chat open)
// if it cannot be read.
async function openConversation(supabaseClient, conversationId) {
    const { data, error } = await supabaseClient
        .from('ai_chat_message')
        .select(MESSAGE_COLUMNS)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

    if (error) {
        console.warn('eligibility-chat: could not load chat history:', error.message);
        CONVERSATION_ID = null;
        HISTORY = [];
        return [];
    }

    CONVERSATION_ID = conversationId;
    HISTORY = data.map(row => ({ role: row.role, text: row.text }));
    return data;
}

// Starts a blank conversation. The row is only created when the first message is
// sent, so pressing this repeatedly leaves nothing behind. Old chats stay as they were.
function startNewChat() {
    CONVERSATION_ID = null;
    HISTORY = [];
}

function getConversationId() {
    return CONVERSATION_ID;
}

// Renames a conversation. Returns the title that was saved; throws a message fit for
// the student if it was empty, too long or could not be saved.
async function renameConversation(supabaseClient, conversationId, title) {
    const clean = String(title ?? '').replace(/s+/g, ' ').trim();
    if (!clean) throw new Error('A chat needs a name.');
    if (clean.length > 60) throw new Error('Keep the name under 60 characters.');

    const { error } = await supabaseClient
        .from('ai_chat_conversation')
        .update({ title: clean })
        .eq('id', conversationId);
    if (error) {
        console.warn('eligibility-chat: could not rename the chat:', error.message);
        throw new Error('Could not rename this chat. Please try again.');
    }
    return clean;
}

// Deletes a conversation and, with it, its messages (db/075). If it was the open one the
// chat becomes blank. Throws a message fit for the student if it could not be deleted.
async function deleteConversation(supabaseClient, conversationId) {
    const { data, error } = await supabaseClient
        .from('ai_chat_conversation')
        .delete()
        .eq('id', conversationId)
        .select('id');
    if (error || !data?.length) {
        console.warn('eligibility-chat: could not delete the chat:', error?.message ?? 'no row deleted');
        throw new Error('Could not delete this chat. Please try again.');
    }
    if (CONVERSATION_ID === conversationId) startNewChat();
}

// The conversation messages are saved to: the open one, or a new one made now.
// Returns null when the chat cannot be saved (the conversation still works).
async function ensureConversation(supabaseClient) {
    if (CONVERSATION_ID) return CONVERSATION_ID;
    if (!STUDENT_ID) return null;
    const { data, error } = await supabaseClient
        .from('ai_chat_conversation')
        .insert({ student_id: STUDENT_ID })
        .select('id')
        .single();
    if (error) {
        console.warn('eligibility-chat: could not start a chat:', error.message);
        return null;
    }
    CONVERSATION_ID = data.id;
    return CONVERSATION_ID;
}

async function sendChatMessage(supabaseClient, message) {
    if (!SUMMARY) {
        throw new Error('eligibility-chat: call initEligibilityChat(summary) first.');
    }

    const trimmed = String(message ?? '').trim();
    if (!trimmed) return null;

    // The summary is NOT sent: the function works out the student's standing itself
    // (assess-student, on the server) so Cura never narrates facts the browser
    // supplied. SUMMARY stays here only to draw the plan and schedule tables and
    // to choose the suggested questions on this page.
    const { data, error } = await supabaseClient.functions.invoke('eligibility-chat', {
        body: { history: HISTORY, message: trimmed, client: 'web' },
    });

    if (error) {
        console.warn('eligibility-chat failed:', error);
        HISTORY.push({ role: 'user', text: trimmed });
        const failure = new Error('eligibility-chat request failed');
        failure.studentMessage = await serverMessage(error);
        throw failure;
    }

    HISTORY.push({ role: 'user', text: trimmed });
    HISTORY.push({ role: 'model', text: data.reply });

    const conversationId = await ensureConversation(supabaseClient);
    if (STUDENT_ID && conversationId) {
        const { error: saveError } = await supabaseClient.from('ai_chat_message').insert([
            { student_id: STUDENT_ID, conversation_id: conversationId, role: 'user', text: trimmed, show_recommended_table: false, show_schedule_table: false, schedule_option: null },
            { student_id: STUDENT_ID, conversation_id: conversationId, role: 'model', text: data.reply, show_recommended_table: !!data.showRecommendedTable, show_schedule_table: !!data.showScheduleTable, schedule_option: data.showScheduleTable ? (data.scheduleOption ?? null) : null },
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
    // shared/js/schedule/scheduletable.js from the summary; Gemini only says whether to show it.
    return {
        text: data.reply,
        conversationId,
        table: data.showRecommendedTable ? tableFor(SUMMARY) : null,
        schedule: data.showScheduleTable ? scheduleFor(SUMMARY, data.scheduleOption ?? null) : null,
        scheduleLayout: data.scheduleLayout === 'byDay' ? 'byDay' : 'bySubject',
        // What the student asked of a plan, already checked by the function (null when nothing),
        // and what it could not use, with the reason.
        wishes: data.wishes ?? null,
        wishesIgnored: Array.isArray(data.wishesIgnored) ? data.wishesIgnored : [],
    };
}

/* The message the function itself answered with ({ error: "..." }), such as "Your academic
   record has not been verified yet...", or the generic line when there is none (network
   down, function unreachable). The function's messages are written for students. */
async function serverMessage(error) {
    const generic = 'Could not reach the assistant. Please try again.';
    try {
        const body = await error?.context?.json?.();
        if (body && typeof body.error === 'string' && body.error.trim()) return body.error.trim().slice(0, 300);
    } catch (_) { /* no readable body: fall through */ }
    return generic;
}

/* The plan table's rows for a summary: the suggested subjects, each with the section and
   when it meets once a schedule is published (shared/js/schedule/scheduletable.js). */
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

window.EligibilityChat = { initEligibilityChat, updateSummary, loadChatHistory, listConversations, openConversation, startNewChat, getConversationId, renameConversation, deleteConversation, getChatHistory, sendChatMessage, scheduleFor, tableFor };

})();