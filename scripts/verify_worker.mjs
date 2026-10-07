/** Production Worker + Static Assets smoke, using actual response CSP and PDF downloads.
 * Start `npm run preview:full`, then `node scripts/verify_worker.mjs`.
 * Uses synthetic application examples, never live provider credentials.
 */
import { chromium, firefox, webkit } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const origin = process.env.WORKER_TEST_ORIGIN || 'http://127.0.0.1:8787';
const root = new URL('../', import.meta.url);
const packageInfo = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const reportUrl = process.env.WORKER_TEST_OUTPUT ? pathToFileURL(resolve(process.env.WORKER_TEST_OUTPUT)) : new URL(`verification/v${packageInfo.version}-worker-runtime.json`, root);
const output = new URL('./worker-smoke/', reportUrl);
await mkdir(dirname(fileURLToPath(reportUrl)), { recursive: true });
await mkdir(output, { recursive: true });
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };

await writeFile(reportUrl, JSON.stringify({status:'running', checkedAt:new Date().toISOString()})+'\n');
try {
const directives = policy => Object.fromEntries(policy.split(';').map(p=>p.trim().split(/\s+/)).filter(p=>p[0]).map(([name,...values])=>[name,values.sort().join(' ')]));
const pageResponse = await fetch(origin, { signal: AbortSignal.timeout(20_000) });
const policy = pageResponse.headers.get('content-security-policy') || '';
requireThat(pageResponse.ok && directives(policy)['script-src'] === "'self'" && directives(policy)['worker-src'] === "'self' blob:" && !policy.includes(','), 'Document security policy is missing or too broad');
const cases = [
  { name: 'method', path: '/api/providers/tiingo/eod', init: {}, status: 405 },
  { name: 'unknown', path: '/api/missing', init: {}, status: 404 },
  { name: 'origin', path: '/api/providers/tiingo/eod', init: { method: 'POST' }, status: 403 },
  { name: 'no-key', path: '/api/providers/tiingo/eod', init: { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' }, status: 401 },
  { name: 'ticker', path: '/api/providers/tiingo/eod', init: { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: 'Token NOT_A_REAL_KEY_LOCAL_INVALID_INPUT_ONLY' }, body: JSON.stringify({symbol:'UNSUPPORTED', start:'2025-01-01', end:'2025-12-31'}) }, status: 400 },
];
const api = [];
for (const c of cases) {
  const r = await fetch(origin + c.path, { ...c.init, signal: AbortSignal.timeout(20_000) });
  const cache = r.headers.get('cache-control') || '';
  requireThat(r.status === c.status && cache.includes('no-store'), `API ${c.name} unexpected ${r.status}`);
  requireThat(r.headers.get('x-content-type-options')==='nosniff' && r.headers.get('referrer-policy')==='no-referrer' && r.headers.get('x-frame-options')==='DENY' && (r.headers.get('content-security-policy')||'').includes("default-src 'none'"), `API ${c.name} missing security headers`);
  api.push({ name: c.name, status: r.status, cacheControl: cache });
}
for (const path of ['/licenses/index.html', '/licenses/THIRD_PARTY_NOTICES.md', '/licenses/upstream-licenses.json', '/sbom/runtime.cdx.json']) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(20_000) });
  requireThat(response.ok && !(await response.text()).includes('<title>Rebalance Review</title>'), `Missing deployed attribution asset: ${path}`);
}
const browsers = [];
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  const page = await browser.newPage({ acceptDownloads: true });
  const consoleErrors = [], violations = [];
  try {
    let pdfWorkerPolicy = '';
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('console', message => { if(message.type()==='error') consoleErrors.push(message.text()); });
    page.on('response', response => {
      if (/\/assets\/pdf\.worker-[A-Za-z0-9_-]+\.js$/.test(response.url())) pdfWorkerPolicy = response.headers()['content-security-policy'] || '';
    });
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', event => window.__csp.push(event.violatedDirective + ': ' + event.blockedURI));
    });
    await page.goto(origin);
    await page.getByRole('button', { name: 'Try an example' }).click();
    await page.getByRole('checkbox', { name: 'I understand cash earns 0% in this replay', exact: true }).check();
    await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
    await page.getByRole('heading', { name: 'Your review', exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill('检查完整部署的中文报告。Review source permissions and concentration before rebalancing.');
    await page.getByLabel('Next review date', { exact: true }).fill('2099-01-01');
    const downloading = page.waitForEvent('download', { timeout: 35000 });
    const started = Date.now();
    await page.getByRole('button', { name: 'Download PDF report', exact: true }).click();
    const download = await downloading;
    const path = new URL(`${name}.pdf`, output);
    await download.saveAs(fileURLToPath(path));
    const bytes = await readFile(path);
    requireThat(bytes.subarray(0,5).toString() === '%PDF-', 'Invalid downloaded PDF');
    requireThat(directives(pdfWorkerPolicy)['script-src'] === "'self' 'wasm-unsafe-eval'" && directives(pdfWorkerPolicy)['worker-src'] === "'self' blob:" && directives(pdfWorkerPolicy)['connect-src'] === "'self' blob: data:" && !pdfWorkerPolicy.includes(','), 'PDF Worker scoped policy was not served');
    violations.push(...await page.evaluate(() => window.__csp));
    requireThat(violations.length === 0 && consoleErrors.length === 0, `Browser errors: ${[...violations,...consoleErrors].join('; ')}`);
    browsers.push({ name, version: browser.version(), status:'passed', downloadMs:Date.now()-started, bytes:bytes.length, pdfSha256:createHash('sha256').update(bytes).digest('hex'), pdfWorkerPolicy, violations, consoleErrors });
    console.log(`${name}: real Worker headers, compute and PDF passed`);
  } catch(error) {
    const alerts = await page.getByRole('alert').allTextContents();
    throw new Error(`${name}: ${String(error)}; alerts=${JSON.stringify(alerts)}; console=${JSON.stringify(consoleErrors)}; CSP=${JSON.stringify(await page.evaluate(()=>window.__csp))}`);
  } finally { await browser.close(); }
}
const report = { status:'passed', checkedAt:new Date().toISOString(), version:packageInfo.version, scope:'Local Cloudflare Worker runtime with actual HTTP headers; synthetic example; no authenticated Tiingo upstream, public HTTPS, physical phone or rollback claim.', node:process.version, origin, documentPolicy:policy, api, browsers };
await writeFile(reportUrl, JSON.stringify(report,null,2)+'\n');
} catch(error) {
  await writeFile(reportUrl, JSON.stringify({status:'failed',checkedAt:new Date().toISOString(),error: error instanceof Error ? error.message : 'Unknown verification error'},null,2)+'\n');
  throw error;
}
