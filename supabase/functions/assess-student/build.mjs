// build.mjs -- bundles assess-student into the single file that gets deployed.
//
//   node supabase/functions/assess-student/build.mjs
//
// index.ts imports the website's own engine, preferences step, schedule
// helper and Cura summary straight from shared/ and ai-assist/. Bundling
// inlines them, so what runs on the server is byte-for-byte the code the
// website runs, and there is no second copy to keep in step. Run this again
// after changing any of those files, then redeploy dist/index.js.
//
// Needs Node and network access for npx to fetch esbuild the first time.
// Paths are relative to the repository root on purpose: the folder name has
// a space in it, which a shell would split into two arguments.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fn = 'supabase/functions/assess-student';

execFileSync('npx', [
    '--yes', 'esbuild',
    `${fn}/index.ts`,
    '--bundle',
    '--format=esm',
    '--target=es2022',
    '--minify',
    '--external:npm:*',
    '--external:https://*',
    `--outfile=${fn}/dist/index.js`,
    '--log-level=warning',
], { cwd: root, stdio: 'inherit', shell: true });

console.log(`built ${fn}/dist/index.js`);
