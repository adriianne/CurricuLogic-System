// build-static.mjs
//
// Builds the folder that Vercel serves. The site is plain static files, so "building" only means COPYING the parts
// of the repository that a browser needs, and nothing else. The database scripts (db/), the notes (docs/), the tests,
// the edge-function sources (supabase/), the knowledge notes and the seed CSVs stay in the repository but are never
// published.
//
//   node scripts/build-static.mjs            -> writes ./dist
//   node scripts/build-static.mjs some/dir   -> writes that folder instead (the tests use this)
//
// Vercel runs it through vercel.json ("buildCommand") and serves ./dist ("outputDirectory").

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'dist'));

/* What the browser needs: the start page and the folders the pages load from. */
const PUBLISH = ['index.html', 'assets', 'cura', 'features', 'shared'];

const SKIP = new Set(['.DS_Store', 'Thumbs.db']);

if (out === root || root.startsWith(out + '/') || root.startsWith(out + '\\')) {
    throw new Error('The output folder cannot be the repository itself or one of its parents.');
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let files = 0;
for (const name of PUBLISH) {
    const from = join(root, name);
    if (!existsSync(from)) throw new Error(`Missing ${name}: the site cannot be built without it.`);
    cpSync(from, join(out, name), {
        recursive: true,
        filter: (src) => {
            const base = src.split(/[\\/]/).pop();
            if (SKIP.has(base)) return false;
            if (statSync(src).isFile()) files++;
            return true;
        },
    });
}

console.log(`Built ${files} files into ${out}`);
console.log('Published: ' + PUBLISH.join(', '));
console.log('Kept private: ' + readdirSync(root).filter(n => !PUBLISH.includes(n) && !n.startsWith('.') && n !== 'dist' && n !== 'scripts' && n !== 'node_modules').join(', '));
