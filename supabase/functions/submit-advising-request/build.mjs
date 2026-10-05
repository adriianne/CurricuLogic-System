// build.mjs -- bundles submit-advising-request into the single file that gets deployed.
//
//   node supabase/functions/submit-advising-request/build.mjs
//

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fn = 'supabase/functions/submit-advising-request';

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
