// reportfile.js
// Turns a report's rows into a file the person can save: CSV (opens anywhere) or a real Excel workbook (.xlsx, through the
// SheetJS library the Admin pages already load). Every report (student, programme, analytics) uses it, so they all export
// the same way.
//
//   ReportFile.csv([['Code','Title'],['IT 101','Intro']])      -> 'Code,Title\r\nIT 101,Intro' (quoted where needed)
//   ReportFile.safeName('Report: Sarmiento, Mark')             -> 'Report-Sarmiento-Mark'
//   ReportFile.download(name, text, mime)                      saves a text file          (browser only)
//   ReportFile.downloadXlsx(name, [{ name, rows }])            saves a workbook           (browser only, needs XLSX)
//
// A cell that starts with = + - @ is written with a leading apostrophe so Excel never runs it as a formula (a student name
// or a note could otherwise carry one). A real number is left alone.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ReportFile = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const FORMULA = /^[=+\-@\t\r]/;

function plain(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? v : '';
    const s = String(v);
    // a number written as text (a grade such as "1.75" or "-") is not a formula; "-5" typed by a person is treated as text
    return FORMULA.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? "'" + s : s;
}

function cell(v) {
    const s = String(plain(v));
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csv(rows) {
    return (rows ?? []).map((r) => (r ?? []).map(cell).join(',')).join('\r\n');
}

function safeName(text) {
    return String(text ?? 'report').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'report';
}

function saveBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function download(name, text, mime = 'text/csv;charset=utf-8', { bom = true } = {}) {
    // the BOM makes Excel read accents and the en dash correctly; a JSON file must not have one
    saveBlob(name, new Blob(bom ? ['﻿', text] : [text], { type: mime }));
}

function downloadXlsx(name, sheets) {
    if (typeof XLSX === 'undefined') throw new Error('The Excel library did not load.');
    const wb = XLSX.utils.book_new();
    for (const [i, s] of (sheets ?? []).entries()) {
        const ws = XLSX.utils.aoa_to_sheet((s.rows ?? []).map((r) => (r ?? []).map(plain)));
        XLSX.utils.book_append_sheet(wb, ws, String(s.name || 'Sheet' + (i + 1)).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
    }
    XLSX.writeFile(wb, name);
}

/* The signed-in client that records exports (log_report_export, db/122). Each page hands it over once, like the term helper. */
let client = null;
function setClient(c) { client = c ?? null; }

/* Record one export in the audit log: who, which report, which format (and a student's ID for a student report). Never the
   report's content. Best effort, like the form-print log: the person already has the report, so a failure is only noted. */
async function logExport(report, format, target = null, rows = null) {
    try {
        if (!client) return false;
        const { error } = await client.rpc('log_report_export', { p_report: report, p_format: format, p_target: target, p_rows: rows });
        if (error) console.warn('export log failed:', error.message);
        return !error;
    } catch (e) {
        console.warn('export log failed:', e.message);
        return false;
    }
}

return { csv, safeName, download, downloadXlsx, plain, setClient, logExport };
}));
