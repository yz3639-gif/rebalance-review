/** Opt-in, private observed-CSV UI check. No traces, screenshots, HAR or exports.
 * Called by verify_observed_workflow.py with temporary validated CSV input.
 * Errors contain only stage names; Playwright diagnostic text is never printed.
 */
import { chromium, firefox, webkit } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [requestPath, outputPath] = process.argv.slice(2);
if (!requestPath || !outputPath) {
  console.error('Use the opt-in Python wrapper with OBSERVED_MARKET_DIR.');
  process.exit(2);
}
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
let stage = 'read private request';
let browser;
let activeContext;
let privatePage;
const report = { status: 'running', checkedAt: new Date().toISOString(), scope: 'Private observed CSV through the actual own-portfolio browser workflow. No prices, return results, screenshots, traces or report exports retained.', browsers: [] };
try {
  const request = JSON.parse(await readFile(requestPath, 'utf8'));
  const origin = new URL(request.origin).origin;
  requireThat(['http://127.0.0.1', 'http://localhost'].some(local => origin.startsWith(local + ':')), 'local origin required');
  const csv = await readFile(request.csvPath);
  const response = await fetch(origin, { signal: AbortSignal.timeout(20_000) });
  requireThat(response.ok && (response.headers.get('content-security-policy') || '').includes("script-src 'self'"), 'actual Worker required');
  const initialHtml = await response.text();
  report.servedHtmlSha256 = createHash('sha256').update(initialHtml).digest('hex');
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    stage = `${name}: launch isolated browser`;
    browser = await engine.launch();
    activeContext = await browser.newContext({ acceptDownloads: false });
    let externalRequests = 0, browserErrors = 0, downloads = 0;
    await activeContext.route('**/*', async route => {
      const url = route.request().url();
      if (/^https?:/.test(url) && new URL(url).origin !== origin) {
        externalRequests++;
        await route.abort();
      } else await route.continue();
    });
    const page = await activeContext.newPage();
    privatePage = page;
    page.setDefaultTimeout(15_000);
    page.on('pageerror', () => browserErrors++);
    page.on('download', () => downloads++);
    stage = `${name}: own-portfolio entry`;
    await page.goto(origin);
    await page.getByRole('button', { name: 'Review my portfolio', exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Import holdings' }).click();
    for (const [target, text] of [
      ['a', 'symbol,weight\nSPY,55\nIEF,30\nCASH,15'],
      ['b', 'symbol,weight\nSPY,35\nIEF,30\nGLD,20\nCASH,15'],
    ]) {
      stage = `${name}: preview and apply holdings ${target}`;
      await page.getByRole('combobox', { name: 'Import into', exact: true }).selectOption(target);
      await page.getByLabel('Holdings CSV file', { exact: true }).setInputFiles({ name: 'verification-holdings.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
      await page.getByRole('combobox', { name: 'Symbol column', exact: true }).selectOption('symbol');
      await page.getByRole('combobox', { name: 'Weight or value column', exact: true }).selectOption('weight');
      await page.getByRole('button', { name: 'Preview holdings', exact: true }).click();
      await page.getByRole('button', { name: 'Import holdings', exact: true }).click();
    }
    stage = `${name}: private observed price upload`;
    await page.locator('summary').filter({ hasText: 'Import price history' }).click();
    await page.getByLabel('Market prices CSV file', { exact: true }).setInputFiles({ name: 'private-observed-verification.csv', mimeType: 'text/csv', buffer: csv });
    await page.getByRole('combobox', { name: 'Date column', exact: true }).selectOption('date');
    await page.getByRole('combobox', { name: 'CSV shape', exact: true }).selectOption('wide');
    await page.getByRole('combobox', { name: 'Data provenance', exact: true }).selectOption('observed');
    await page.getByRole('textbox', { name: 'Data source', exact: true }).fill('Private retained historical adjusted-price snapshot; local verification only');
    await page.getByRole('checkbox', { name: 'All prices are in USD and use the selected adjusted-price basis', exact: true }).check();
    const grant = page.getByRole('checkbox', { name: 'I have permission to store and export this file and its derived results on my device', exact: true });
    requireThat(!await grant.isChecked(), 'storage and export consent must remain absent');
    stage = `${name}: price preview coverage`;
    await page.getByRole('button', { name: 'Preview prices', exact: true }).click();
    const preview = page.getByLabel('Price import preview', { exact: true });
    await preview.waitFor();
    const coverage = await preview.locator('p').first().textContent();
    requireThat(coverage.includes(`${request.observations} common prices per asset`) && coverage.includes(`${request.symbolCount} assets`) && coverage.includes(request.start) && coverage.includes(request.end), 'observed preview coverage mismatch');
    stage = `${name}: apply and compare`;
    await page.getByRole('button', { name: 'Import prices', exact: true }).click();
    stage = `${name}: confirm cash assumption`;
    await page.getByRole('checkbox', { name: 'I understand cash earns 0% in this replay', exact: true }).check();
    stage = `${name}: click compare`;
    await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
    stage = `${name}: wait for review`;
    await page.getByRole('heading', { name: 'Your review', exact: true }).waitFor({ timeout: 30_000 });
    stage = `${name}: confirm observed return coverage`;
    await page.locator('.report:visible').getByText(`${request.observations - 1} common returns`, { exact: true }).waitFor();
    stage = `${name}: observed provenance label`;
    requireThat(!await page.locator('.demo-notice').count(), 'observed data relabeled synthetic');
    stage = `${name}: complete observed coverage`;
    requireThat(!await page.locator('.report-banner').getByText('PARTIAL PORTFOLIOS', { exact: false }).count(), 'unexpected partial coverage');
    stage = `${name}: session-only privacy and export gates`;
    requireThat(await page.getByRole('button', { name: 'Save review', exact: true }).isDisabled(), 'saving must remain disabled');
    requireThat(await page.getByRole('button', { name: 'Export review', exact: true }).isDisabled(), 'archive export must remain disabled');
    requireThat(await page.getByRole('button', { name: 'Print report', exact: true }).isDisabled(), 'analysis printing must remain disabled');
    requireThat(await page.getByRole('button', { name: 'Download decision-only PDF', exact: true }).count() === 1, 'decision-only PDF must be explicit');
    const storage = await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, cookies: document.cookie.length,
      databases: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).length : null }));
    requireThat(storage.local === 0 && storage.session === 0 && storage.cookies === 0 && (storage.databases === null || storage.databases === 0), 'observed session persisted browser state');
    requireThat(externalRequests === 0 && downloads === 0 && browserErrors === 0, 'unexpected network, download or page error');
    report.browsers.push({ name, version: browser.version(), status: 'passed', observations: request.observations,
      returnObservations: request.observations - 1, assets: request.symbolCount, fullCoverage: true,
      storageEntries: 0, externalRequests: 0, downloads: 0, browserErrors: 0 });
    await activeContext.close();
    activeContext = undefined;
    await browser.close();
    browser = undefined;
  }
  stage = 'same served build throughout verification';
  const finalHtml = await (await fetch(origin, { signal: AbortSignal.timeout(20_000) })).text();
  requireThat(initialHtml === finalHtml, 'served build changed during verification');
  report.status = 'passed';
} catch {
  report.displayedReturnObservationCounts = privatePage ? await privatePage.locator('.report .status-pill').allTextContents().then(values => values.map(text => text.match(/([0-9,]+) common returns/)).filter(Boolean).map(match => Number(match[1].replaceAll(',', '')))).catch(() => []) : [];
  report.status = 'failed';
  report.failedStage = stage;
  report.error = 'Private verification failed at the named stage; raw browser diagnostics suppressed.';
  process.exitCode = 1;
} finally {
  await activeContext?.close().catch(() => {});
  await browser?.close().catch(() => {});
  report.completedAt = new Date().toISOString();
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, browsersPassed: report.browsers.length, failedStage: report.failedStage }));
}
