import { chromium, firefox, webkit } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const symbols = 'SPY VOO VTI QQQ VEA VWO VXUS SHY IEF TLT BND TIP LQD HYG GLD VNQ AGG BIL BIV BLV BNDX BSV DIA DVY EEM EFA EMB EWA EWC EWG EWJ EWL EWM EWT EWU EWY EWZ GDX IAU IBB ICF IEI IGV IJH IJR IJT IUSG IUSV IVV IWB'.split(' ');
  const dates = [], date = new Date('2006-01-02T00:00:00Z');
  while (dates.length < 5000) {
    if (![0, 6].includes(date.getUTCDay())) dates.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return {
    a: { id: 'a', name: 'Synthetic A', holdings: symbols.map(symbol => ({ symbol, weight: 1 / 50 })) },
    b: { id: 'b', name: 'Synthetic B', holdings: symbols.map((symbol, i) => ({ symbol, weight: (i + 1) / 1275 })) },
    dataset: { dates, symbols, prices: dates.map((_, i) => symbols.map((_, j) => 100 * Math.exp(.00015 * i + .12 * Math.sin(i * .037 + j * .2)))),
      manifest: { id: 'browser-synthetic-performance', source: 'Deterministic synthetic browser performance fixture', currency: 'USD', basis: 'total_return_index', synthetic: true,
        asOf: dates.at(-1), rights: { display: true, rawPersistence: true, derivedPersistence: true, export: true, publicDisplay: true, evidence: 'Generated synthetic benchmark; no observed market prices', verifiedAt: '2026-10-05' } } },
    frequency: 'monthly', costBps: 5, initialNav: 100000, cashReturnConfirmed: true, partialCoverageConfirmed: false,
  };
}

export async function runBrowserPerformance(baseUrl = 'http://127.0.0.1:4173') {
  const assets = await readdir(resolve(root, 'dist/assets'));
  const workers = assets.filter(name => /^review\.worker-.*\.js$/.test(name));
  if (workers.length !== 1) throw new Error('Expected exactly one production review Worker in frozen dist.');
  const workerAsset = workers[0], workerPath = resolve(root, 'dist/assets', workerAsset);
  const frozenWorker = await readFile(workerPath), frozenIndex = await readFile(resolve(root, 'dist/index.html'));
  const spec = fixture();
  const record = {
    generatedAt: new Date().toISOString(), serverOrigin: baseUrl, environment: { node: process.version, platform: os.platform(), architecture: os.arch(), memoryBytes: os.totalmem(), cpu: os.cpus()[0]?.model },
    build: { workerAsset, workerSha256: sha256(frozenWorker), indexSha256: sha256(frozenIndex) },
    input: { synthetic: true, symbols: spec.dataset.symbols, assetCount: 50, suppliedPriceDates: 5000, start: spec.dataset.dates[0], end: spec.dataset.dates.at(-1) },
    scope: 'Supported 50-asset production Worker A/B calculation, including input postMessage cloning and output roundtrip. Product applies its five-year historical cap. This is not a full UI paint benchmark, mobile test, load test, or real-user trial.',
    methodology: 'Fetch the exact frozen production Worker bytes once, execute as a same-origin Blob module Worker; reuse the Worker after 3 warmups, measure 30 serialized calls in performance.now(). Also measure 30 fresh Workers from the preloaded Blob to represent app startup without network transfer. Browser engines run sequentially. No remote network requests permitted.',
    browsers: [],
  };
  for (const [name, browserType] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
    let browser;
    try {
      browser = await browserType.launch({ headless: true });
      const context = await browser.newContext();
      const denied = [];
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === new URL(baseUrl).origin) return route.continue();
        denied.push(route.request().url()); return route.abort();
      });
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      const values = await page.evaluate(async ({ workerUrl, spec }) => {
        const response = await fetch(workerUrl);
        if (!response.ok) throw new Error(`Cannot fetch production Worker: HTTP ${response.status}`);
        const code = await response.text();
        const hashBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)));
        const fetchedWorkerSha256 = Array.from(hashBytes, value => value.toString(16).padStart(2, '0')).join('');
        const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        const summary = samples => {
          const sorted = [...samples].sort((a, b) => a - b);
          return { warmups: 3, runs: 30, milliseconds: samples, p50: sorted[14], p95: sorted[28], maximum: sorted[29] };
        };
        let finalResult;
        const call = worker => new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Worker roundtrip timed out at 30 seconds')), 30000);
          worker.onmessage = event => {
            clearTimeout(timeout);
            if (!event.data.ok) reject(new Error(event.data.error));
            else { finalResult = event.data.result; resolve(event.data.result); }
          };
          worker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message || 'Worker failed')); };
          worker.postMessage(spec);
        });
        const worker = new Worker(blobUrl, { type: 'module' });
        try {
          for (let i = 0; i < 3; i++) await call(worker);
          const warmSamples = [];
          for (let i = 0; i < 30; i++) { const start = performance.now(); await call(worker); warmSamples.push(performance.now() - start); }
          worker.terminate();
          const coldSamples = [];
          for (let i = 0; i < 33; i++) {
            const start = performance.now(), fresh = new Worker(blobUrl, { type: 'module' });
            try { await call(fresh); if (i >= 3) coldSamples.push(performance.now() - start); }
            finally { fresh.terminate(); }
          }
          return { fetchedWorkerSha256, warmWorker: summary(warmSamples), freshWorkerPreloadedAsset: summary(coldSamples),
            output: { symbols: finalResult.symbols, observations: finalResult.observations, start: finalResult.start, end: finalResult.end,
              riskWindows: finalResult.risk.windows.map(w => ({ window: w.window, available: w.available })),
              costScenarios: finalResult.costSensitivity.length, endingNavA: finalResult.history.a.nav.at(-1), endingNavB: finalResult.history.b.nav.at(-1) },
            browserEnvironment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency } };
        } finally { worker.terminate(); URL.revokeObjectURL(blobUrl); }
      }, { workerUrl: `/assets/${workerAsset}`, spec });
      if (values.fetchedWorkerSha256 !== record.build.workerSha256) throw new Error('Browser Worker bytes differ from frozen dist.');
      if (denied.length) throw new Error(`Unexpected external network requests: ${denied.length}`);
      record.browsers.push({ name, version: browser.version(), status: 'passed', ...values,
        supported50WarmP95Within2Seconds: values.warmWorker.p95 <= 2000, supported50FreshWorkerP95Within2Seconds: values.freshWorkerPreloadedAsset.p95 <= 2000 });
    } catch (error) {
      record.browsers.push({ name, status: 'failed', error: error instanceof Error ? error.message : String(error) });
    } finally { if (browser) await browser.close(); }
  }
  if (sha256(await readFile(workerPath)) !== record.build.workerSha256 || sha256(await readFile(resolve(root, 'dist/index.html'))) !== record.build.indexSha256) throw new Error('Production dist changed during performance measurement.');
  await writeFile(resolve(root, 'oracle/browser-performance-v1.2.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runBrowserPerformance(process.env.BROWSER_PERF_BASE_URL || 'http://127.0.0.1:4173');
  console.log(JSON.stringify(result.browsers.map(b => ({ browser: b.name, status: b.status, warmP95: b.warmWorker?.p95, freshP95: b.freshWorkerPreloadedAsset?.p95, error: b.error })), null, 2));
  if (result.browsers.some(b => b.status !== 'passed' || !b.supported50WarmP95Within2Seconds || !b.supported50FreshWorkerP95Within2Seconds)) process.exitCode = 1;
}
