// uploadlimits.js
//
// What a file may be before the app reads it, and what to tell the person when
// it is not. Pure functions only, so they are testable without a browser.
//
// These are the first line: a person gets a plain sentence at once instead of
// a frozen tab or a server error. The edge functions enforce their own size
// limits again (analyze-curriculum-document 10 MB, analyze-schedule-document
// 5 MB) because a request does not have to come from this page.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicUploadLimits = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const MB = 1024 * 1024;

/* bytes: largest file. rows: most data rows. ext: accepted file endings.
   photo: the page shrinks a photo to 2000 px before sending it, so the limit
   on the original only has to keep the browser from choking on it. */
const LIMITS = {
    pdf:      { noun: 'PDF',          bytes: 10 * MB, ext: ['.pdf'] },
    photo:    { noun: 'photo',        bytes: 25 * MB, image: true },
    grades:   { noun: 'grade file',   bytes:  5 * MB, rows: 5000, ext: ['.csv', '.xlsx', '.xls'] },
    schedule: { noun: 'schedule file', bytes: 5 * MB, rows: 1000, ext: ['.csv', '.xlsx', '.xls'] },
    accounts: { noun: 'accounts file', bytes: 2 * MB, rows:  500, ext: ['.csv', '.xlsx', '.xls'] },
};

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < MB)   return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / MB).toFixed(1)} MB`;
}

const formatCount = (n) => Number(n).toLocaleString('en-US');

const endsWith = (name, exts) => {
    const lower = String(name ?? '').toLowerCase();
    return exts.some((e) => lower.endsWith(e));
};

/* null when the file is acceptable, otherwise a sentence. `file` needs name,
   size and type, which is what a browser File has. */
function fileProblem(file, kind) {
    const limit = LIMITS[kind];
    if (!limit) throw new Error(`Unknown upload kind: ${kind}`);
    if (!file) return 'Choose a file first.';

    if (limit.image) {
        if (!String(file.type ?? '').startsWith('image/')) return 'That is not an image. Use a photo (JPEG, PNG or WebP).';
    } else if (kind === 'pdf') {
        const isPdf = file.type === 'application/pdf' || endsWith(file.name, limit.ext);
        if (!isPdf) return 'Only PDF files can be used here.';
    } else if (!endsWith(file.name, limit.ext)) {
        return `Use a ${limit.ext.join(', ')} file.`;
    }

    if (!file.size) return 'That file is empty.';
    if (file.size > limit.bytes) {
        return `That ${limit.noun} is ${formatBytes(file.size)}. The limit is ${formatBytes(limit.bytes)}.`;
    }
    return null;
}

/* How many rows of a sheet hold anything. `aoa` is an array of rows, each an
   array of cells (what sheet_to_json with header:1 returns). */
function dataRows(aoa) {
    let n = 0;
    for (const row of aoa ?? []) {
        if (Array.isArray(row) ? row.some((c) => String(c ?? '').trim() !== '') : !!row) n++;
    }
    return n;
}

/* null when the row count is acceptable, otherwise a sentence. */
function rowsProblem(count, kind) {
    const limit = LIMITS[kind];
    if (!limit) throw new Error(`Unknown upload kind: ${kind}`);
    if (limit.rows && count > limit.rows) {
        return `That ${limit.noun} has ${formatCount(count)} rows. The limit is ${formatCount(limit.rows)}. ` +
               'Split it into smaller files.';
    }
    return null;
}

/* What to tell the person when one of the AI functions refuses a request.
   null for any other status: the caller keeps its own wording. */
function aiProblem(status) {
    switch (Number(status)) {
        case 401: return 'Your session has expired. Sign in again and retry.';
        case 403: return 'This account is not allowed to use this tool.';
        case 413: return 'That file is too large for the reader.';
        default:  return null;
    }
}

return { LIMITS, formatBytes, fileProblem, dataRows, rowsProblem, aiProblem };
}));
