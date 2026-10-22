// build.mjs -- bundles eligibility-chat into the single file that gets deployed.
//
//   node supabase/functions/eligibility-chat/build.mjs
//
// index.ts imports ./core.js (the part that can be tested in Node). Bundling
// inlines it, so the deployed file is one self-contained index.js. Run this again
// after changing core.js or index.ts, then redeploy dist/index.js.
//
// Needs Node and network access for npx to fetch esbuild the first time.
// Paths are relative to the repository root on purpose: the folder name has
// a space in it, which a shell would split into two arguments.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fn = 'supabase/functions/eligibility-chat';

execFileSync('npx', [
    '--yes', 'esbuild',
    `${fn}/index.ts`,
    '--bundle',
    '--format=esm',
    '--target=es2022',
    '--external:npm:*',
    '--external:https://*',
    `--outfile=${fn}/dist/index.js`,
    '--log-level=warning',
], { cwd: root, stdio: 'inherit', shell: true });

console.log(`built ${fn}/dist/index.js`);
