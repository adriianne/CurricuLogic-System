// profilephoto.js
//
// A profile photo for any account. The picking, checking and cropping are plain
// functions so they can be tested; the browser and Supabase parts are below them.
//
//   CurriculogicPhoto.problem(file)                       // '' or why it is refused
//   const blob = await CurriculogicPhoto.prepare(file)    // a 256 px square JPEG
//   await CurriculogicPhoto.upload(supabase, uid, blob)
//   const url = await CurriculogicPhoto.signedUrl(supabase, uid)   // null if none
//   await CurriculogicPhoto.remove(supabase, uid)
//   CurriculogicPhoto.paint(element, url, 'AV')           // picture, or the initials
//
// The photo is stored privately at  profile-photos/<user id>/avatar.jpg  (db/064).
// It is shrunk and re-encoded here before upload, which also drops the camera's
// location and other hidden data. The server only accepts JPEG up to 256 KB.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicPhoto = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const BUCKET     = 'profile-photos';
const SIZE       = 256;                         // finished picture: SIZE x SIZE
const MAX_PICKED = 10 * 1024 * 1024;            // refuse anything above 10 MB before we even look
const TYPES      = ['image/jpeg', 'image/png', 'image/webp'];

const pathFor = (uid) => `${uid}/avatar.jpg`;

/* A picture held as a data: address, as a Blob, without a network call. The
   Content-Security-Policy does not allow fetch() of a data: address, so
   fetch(dataUrl).blob() is not an option. Returns null for anything that is not
   a base64 data: address. */
function dataUrlToBlob(dataUrl) {
    const m = /^data:([^;,]+)?(;[^,]*)?,(.*)$/s.exec(String(dataUrl ?? ''));
    if (!m || !/;base64/i.test(m[2] ?? '')) return null;
    try {
        const bin   = atob(m[3]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
    } catch { return null; }
}

/* Why this file cannot be used, in a sentence for the person; '' when it is fine. */
function problem(file) {
    if (!file) return 'Choose a picture first.';
    if (!TYPES.includes(file.type)) return 'Use a JPEG, PNG or WebP picture.';
    if (file.size > MAX_PICKED) return 'That picture is over 10 MB. Choose a smaller one.';
    if (file.size === 0) return 'That file is empty.';
    return '';
}

/* The centred square to cut out of a width x height picture. */
function squareCrop(width, height) {
    const side = Math.min(width, height);
    return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}

/* The picture as a SIZE x SIZE JPEG (browser only). */
async function prepare(file) {
    const bad = problem(file);
    if (bad) throw new Error(bad);

    let bitmap;
    try { bitmap = await createImageBitmap(file); }
    catch { throw new Error('That file could not be read as a picture.'); }

    const { sx, sy, side } = squareCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';                       // a transparent PNG would turn black as a JPEG
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE);
    if (bitmap.close) bitmap.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('That picture could not be prepared.');
    return blob;
}

async function upload(supabase, uid, blob) {
    const { error } = await supabase.storage.from(BUCKET)
        .upload(pathFor(uid), blob, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' });
    if (error) throw new Error(error.message || 'The picture could not be saved.');
}

async function remove(supabase, uid) {
    const { error } = await supabase.storage.from(BUCKET).remove([pathFor(uid)]);
    if (error) throw new Error(error.message || 'The picture could not be removed.');
}

/* A link that works for an hour, or null when this person has no photo. */
async function signedUrl(supabase, uid) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pathFor(uid), 3600);
    return error || !data?.signedUrl ? null : data.signedUrl;
}

/* Links for several people at once (one request): a Map of user id -> link, with
   only the people who have a photo and whose photo this account may read. */
async function signedUrls(supabase, uids) {
    const ids = [...new Set((uids ?? []).filter(Boolean))];
    const out = new Map();
    if (!ids.length) return out;
    const { data, error } = await supabase.storage.from(BUCKET)
        .createSignedUrls(ids.map(pathFor), 3600);
    if (error || !Array.isArray(data)) return out;
    data.forEach((row, i) => { if (row?.signedUrl && !row.error) out.set(ids[i], row.signedUrl); });
    return out;
}

/* Show the picture inside `el`, or `initials` when there is none (browser only). */
function paint(el, url, initials) {
    if (!el) return;
    el.textContent = '';
    if (!url) { el.textContent = initials || ''; el.classList.remove('has-photo'); return; }
    const img = document.createElement('img');
    img.alt = '';
    img.src = url;
    img.addEventListener('error', () => { el.textContent = initials || ''; el.classList.remove('has-photo'); });
    el.appendChild(img);
    el.classList.add('has-photo');
}

return { BUCKET, SIZE, MAX_PICKED, TYPES, pathFor, dataUrlToBlob, problem, squareCrop, prepare, upload, remove, signedUrl, signedUrls, paint };
}));
