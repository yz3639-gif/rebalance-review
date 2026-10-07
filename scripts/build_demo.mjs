/** Build the public synthetic terminal without exposing the connected local app. */
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = (script, args = []) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${script} exited ${signal || code}`)));
});
await run('node_modules/typescript/bin/tsc', ['-b']);
await run('scripts/prepare_notices.mjs');
await run('node_modules/vite/bin/vite.js', ['build', '--config', 'vite.demo.config.ts']);
const out = new URL('../dist-demo/', import.meta.url);
await rename(new URL('demo/index.html', out), new URL('index.html', out));
await rm(new URL('demo/', out), { recursive: true, force: true });
await cp(new URL('../public/licenses/', import.meta.url), new URL('licenses/', out), { recursive: true });
await mkdir(new URL('sbom/', out), { recursive: true });
await cp(new URL('../public/sbom/runtime.cdx.json', import.meta.url), new URL('sbom/runtime.cdx.json', out));
const notices = new URL('licenses/index.html', out);
await writeFile(notices, (await readFile(notices, 'utf8'))
  .replaceAll('href="/"', 'href="/rebalance-review/"')
  .replaceAll('href="/sbom/', 'href="/rebalance-review/sbom/'));
await writeFile(new URL('.nojekyll', out), '');
console.log('Public demo built in dist-demo. Preview with npm run preview:demo at http://127.0.0.1:4175/rebalance-review/.');
