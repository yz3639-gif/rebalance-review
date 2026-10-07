/** The only end-user launcher: build and serve the complete local Worker app. */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const expected = (await readFile(new URL('../.nvmrc', import.meta.url), 'utf8')).trim();
if (process.versions.node !== expected) {
  console.error(`Rebalance Review requires Node ${expected}; found ${process.versions.node}. Install the version in .nvmrc, run npm ci, then npm start.`);
  process.exit(1);
}
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--port')) {
  console.error('Usage: npm start [-- --port 8788]'); process.exit(1);
}
const port = Number(args[1] ?? process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('Choose a port between 1024 and 65535.'); process.exit(1);
}
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(port, '127.0.0.1', () => probe.close(resolve));
}).catch(error => {
  console.error(`Cannot use http://127.0.0.1:${port}: ${error.code}. Stop the existing service or use npm start -- --port ${port === 65535 ? 8788 : port + 1}.`);
  process.exit(1);
});
let active;
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stopping = true;
  active?.kill(signal);
});
const run = (script, argv) => new Promise((resolve, reject) => {
  active = spawn(process.execPath, [script, ...argv], { cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  active.once('error', reject);
  active.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${script} exited ${signal || code}`)));
});
try {
  console.log('Building the complete application. No API key or Python installation is required.');
  await run('node_modules/typescript/bin/tsc', ['-b']);
  await run('scripts/prepare_notices.mjs', []);
  await run('node_modules/vite/bin/vite.js', ['build']);
  if (stopping) process.exit(130);
  console.log(`Starting Rebalance Review at http://127.0.0.1:${port}. Press Ctrl+C to stop.`);
  await run('node_modules/wrangler/bin/wrangler.js', ['dev', '--ip', '127.0.0.1', '--port', String(port), '--var', 'LOCAL_MARKET_DATA:enabled']);
} catch (error) {
  if (!stopping) console.error(`Startup failed: ${error.message}. Check the preceding error, then retry npm start.`);
  process.exitCode = stopping ? 130 : 1;
}
