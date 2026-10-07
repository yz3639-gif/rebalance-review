import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { importOwnPrices, storageSnapshot, syntheticMarketCsv } from './helpers';
import { simulateLedger } from '../../src/engine/ledger';
import type { ReviewRecord } from '../../src/types';

// These local file and network fixtures verify wiring, not observed ETF returns
// or a real Tiingo account. Never relabel this fixture as market evidence.
const csv = syntheticMarketCsv(530, ['SOXL', 'BND']);
const csvEnd = csv.trim().split('\n').at(-1)!.split(',')[0];
const fakeToken = 'CONNECTED_WORKSPACE_QA_KEY_NEVER_PERSIST';
const closed = new Set<string>(JSON.parse(readFileSync(new URL('../../src/data/us-equity-calendar.json', import.meta.url), 'utf8')).closedWeekdays);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const metrics = (page: Page) => page.getByRole('region', { name: 'Snapshot metrics', exact: true });

async function openEditor(page: Page) {
  await page.goto('/design/');
  const start = button(page, 'Review my portfolio');
  if (await start.count()) await start.click();
  await expect(page.getByRole('combobox', { name: 'Current portfolio symbol 1', exact: true })).toBeVisible();
}

async function ownHoldings(page: Page) {
  await openEditor(page);
  const search = page.getByRole('combobox', { name: 'Current portfolio symbol 1', exact: true });
  await search.fill('SOXL');
  await expect(page.getByRole('option', { name: /^SOXL / })).toContainText(/Direxion.*Semiconductor/i);
  await search.press('Enter');
  await expect(search).toHaveValue('SOXL');
  await page.getByRole('spinbutton', { name: 'Current portfolio weight 1', exact: true }).fill('100');
  await page.getByRole('combobox', { name: 'Proposed portfolio symbol 1', exact: true }).fill('BND');
  await page.getByRole('spinbutton', { name: 'Proposed portfolio weight 1', exact: true }).fill('100');
}

async function compare(page: Page) {
  await button(page, 'Compare portfolios').click();
  await expect(metrics(page)).toBeVisible();
  await expect(page.getByTestId('history-chart').locator('svg')).toBeVisible();
}

async function textFromPdf(path: string) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: true, isEvalSupported: false });
  try {
    const pdf = await task.promise, pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    return pages.join('\n');
  } finally { await task.destroy(); }
}

test('SOXL catalog selection and imported history drive all views, saving and historical JSON/PDF', async ({ page }, info) => {
  test.setTimeout(90_000);
  await ownHoldings(page);
  await importOwnPrices(page, csv, true);
  await compare(page);
  // The date belongs to this imported file, not the design study's fixed date.
  await expect(page.locator('.dr-context-strip')).toContainText(csvEnd);
  await expect(page.locator('.dr-context-strip')).not.toContainText('2026-09-30');
  await expect(page.locator('.dr-context-strip')).toContainText(/synthetic/i);
  await expect(page.getByRole('combobox', { name: 'Example dataset', exact: true })).toHaveCount(0);
  const frozenMetrics = await metrics(page).textContent();
  await button(page, 'Holdings').click();
  const holdings = page.getByRole('table', { name: 'Holdings comparison', exact: true });
  await expect(holdings).toContainText('SOXL');
  await expect(holdings).toContainText('BND');
  await holdings.getByRole('button', { name: 'SOXL', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Asset inspector', exact: true })).toContainText(/Direxion.*Semiconductor/i);
  for (const view of ['Risk', 'Scenarios', 'Report']) {
    await button(page, view).click();
    await expect(metrics(page)).toHaveText(frozenMetrics!);
  }
  await expect(page.getByRole('textbox', { name: 'Why this change?', exact: true })).toHaveValue('');
  await expect(page.getByRole('region', { name: 'Report preview', exact: true })).not.toContainText('Compare a more balanced proposed allocation');
  const reason = '验证自己的 SOXL 配置。 Imported-file review, not live provider verification.';
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill(reason);
  await page.getByLabel('Next review date', { exact: true }).fill('2099-01-01');
  await expect(page.getByRole('region', { name: 'Report preview', exact: true })).toContainText(reason);
  await expect(page.getByRole('region', { name: 'Report preview', exact: true })).toContainText('2099-01-01');
  await page.getByRole('checkbox', { name: 'Allow local storage on this device', exact: true }).check();
  await button(page, 'Save review').click();
  await expect(page.getByRole('status').filter({ hasText: 'Review saved on this device.' })).toBeVisible();
  const jsonPending = page.waitForEvent('download');
  await button(page, 'Export review').click();
  const jsonFile = await jsonPending, jsonPath = info.outputPath('connected-review.json');
  await jsonFile.saveAs(jsonPath);
  const record = JSON.parse(await readFile(jsonPath, 'utf8'));
  expect(record.a.holdings[0].symbol).toBe('SOXL');
  expect(record.manifest.asOf).toBe(csvEnd);
  expect(record.manifest.synthetic).toBe(true);
  expect(record.rationale).toBe(reason);
  expect(record.dataset).toBeUndefined();
  await button(page, 'Saved reviews').click();
  await button(page, 'View old report').click();
  await button(page, 'Report').click();
  const pdfPending = page.waitForEvent('download', { timeout: 35_000 });
  await button(page, 'Download PDF report').click();
  const pdfFile = await pdfPending, pdfPath = info.outputPath('connected-historical-review.pdf');
  await pdfFile.saveAs(pdfPath);
  const text = await textFromPdf(pdfPath);
  for (const value of ['SOXL', 'BND', csvEnd, '2099-01-01', '验证自己的', 'SYNTHETIC EXAMPLE', 'Maximum historical drawdown']) expect(text).toContain(value);
  await info.attach('connected historical report', { path: pdfPath, contentType: 'application/pdf' });
});

test('returning to inputs preserves allocations and editing cannot retain a stale analysis', async ({ page }) => {
  await ownHoldings(page);
  await importOwnPrices(page, csv, true);
  await compare(page);
  await button(page, 'Edit portfolios & data').click();
  await expect(page.getByRole('combobox', { name: 'Current portfolio symbol 1', exact: true })).toHaveValue('SOXL');
  await page.getByRole('spinbutton', { name: 'Current portfolio weight 1', exact: true }).fill('80');
  await expect(metrics(page)).toHaveCount(0);
  await button(page, 'Compare portfolios').click();
  await expect(page.getByRole('alert')).toContainText('100%');
  await expect(metrics(page)).toHaveCount(0);
  await page.getByRole('spinbutton', { name: 'Current portfolio weight 1', exact: true }).fill('100');
  await compare(page);
  await button(page, 'Edit portfolios & data').click();
  const importDetails = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Import price history' }) });
  if ((await importDetails.getAttribute('open')) === null) await importDetails.locator('summary').click();
  await page.getByRole('textbox', { name: 'Market prices CSV', exact: true }).fill(syntheticMarketCsv(520, ['SOXL', 'BND']));
  await expect(metrics(page)).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'I have permission to store and export this file and its derived results on my device', exact: true })).not.toBeChecked();
  await button(page, 'Compare portfolios').click();
  await expect(page.getByRole('alert')).toContainText('Import market prices first');
  await expect(page.getByRole('combobox', { name: 'Current portfolio symbol 1', exact: true })).toHaveValue('SOXL');
});

test('cash-only connected review needs neither market file nor provider and displays zero-return assumptions', async ({ page }) => {
  await openEditor(page);
  for (const name of ['Current portfolio', 'Proposed portfolio']) {
    await page.getByRole('combobox', { name: `${name} symbol 1`, exact: true }).fill('CASH');
    await page.getByRole('spinbutton', { name: `${name} weight 1`, exact: true }).fill('100');
  }
  await page.getByLabel('Cash replay start', { exact: true }).fill('2024-01-02');
  await page.getByLabel('Cash replay end', { exact: true }).fill('2025-01-31');
  await page.getByRole('checkbox', { name: 'I understand cash earns 0% in this replay', exact: true }).check();
  await compare(page);
  await expect(metrics(page)).toContainText('0.00%');
  await expect(page.locator('.dr-context-strip')).toContainText('2025-01-31');
  await button(page, 'Risk').click();
  await expect(page.getByTestId('correlation-chart')).toContainText(/undefined|not applicable|zero|N\/A/i);
  await button(page, 'Report').click();
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill('Cash-only assumption for a locally entered comparison.');
  await expect(page.getByRole('region', { name: 'Report preview', exact: true })).toContainText(/cash_zero|cash assumption|assumption-only/i);
  const stored = await storageSnapshot(page);
  expect(stored.local).toEqual([]); expect(stored.session).toEqual([]);
  expect(stored.databases || []).toEqual([]);
});

async function fulfillSyntheticTiingo(route: Route) {
  const body = route.request().postDataJSON() as { symbol: string; start: string; end: string };
  expect(Object.keys(body).sort()).toEqual(['end', 'start', 'symbol']);
  expect(route.request().headers().authorization).toBe(`Token ${fakeToken}`);
  const prices: { date: string; adjClose: number }[] = [];
  for (const cursor = new Date('2024-01-02T00:00:00Z'); cursor.toISOString().slice(0, 10) <= body.end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    if (![0, 6].includes(cursor.getUTCDay()) && !closed.has(date)) {
      prices.push({ date, adjClose: 100 * Math.exp(prices.length * .0002 + .01 * Math.sin(prices.length * (body.symbol === 'SOXL' ? .19 : .13))) });
    }
  }
  await route.fulfill({ json: { symbol: body.symbol, coverage: { startDate: prices[0].date, endDate: body.end }, prices } });
}

test('mock Tiingo failure, cancellation and retry preserve SOXL weights and enforce transient export rights', async ({ page }) => {
  let status = 401, blocked = false, requests = 0, release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/providers/tiingo/eod', async route => {
    requests++;
    if (status !== 200) { await route.fulfill({ status, json: { error: `unsafe upstream ${fakeToken}` } }); return; }
    if (blocked) await pending;
    await fulfillSyntheticTiingo(route).catch(() => { /* The user cancelled the previous request. */ });
  });
  await ownHoldings(page);
  await page.getByRole('combobox', { name: 'Price data connection', exact: true }).selectOption('tiingo');
  await page.getByLabel('Tiingo API token', { exact: true }).fill(fakeToken);
  await page.getByRole('checkbox', { name: 'I confirm my selected ETF listings are quoted in USD', exact: true }).check();
  await page.getByRole('checkbox', { name: 'I may access this API for my own portfolio review', exact: true }).check();
  await button(page, 'Use these API settings').click();
  await button(page, 'Compare portfolios').click();
  await expect(page.getByRole('alert')).toContainText('rejected the API key');
  await expect(page.getByRole('alert')).not.toContainText(fakeToken);
  await expect(page.getByRole('combobox', { name: 'Current portfolio symbol 1', exact: true })).toHaveValue('SOXL');
  await expect(page.getByRole('spinbutton', { name: 'Current portfolio weight 1', exact: true })).toHaveValue('100');
  status = 429;
  await button(page, 'Compare portfolios').click();
  await expect(page.getByRole('alert')).toContainText('limit was reached');
  status = 200; blocked = true;
  const before = requests;
  await button(page, 'Compare portfolios').click();
  await expect.poll(() => requests).toBe(before + 2);
  await button(page, 'Cancel calculation').click();
  await expect(page.getByRole('status').filter({ hasText: 'Calculation cancelled' })).toBeVisible();
  blocked = false; release();
  await expect(metrics(page)).toHaveCount(0);
  await compare(page);
  await expect(page.locator('.dr-context-strip')).not.toContainText(/synthetic/i);
  await button(page, 'Report').click();
  await expect(button(page, 'Save review')).toBeDisabled();
  await expect(button(page, 'Export review')).toBeDisabled();
  await expect(button(page, 'Download PDF report')).toHaveCount(0);
  await expect(button(page, 'Download decision-only PDF')).toBeEnabled();
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill('Mock provider integration validation; not actual market evidence.');
  await expect(page.getByRole('region', { name: 'Report preview', exact: true })).toContainText(/decision(?:\s+record)?[\s-]+only/i);
  const stored = await storageSnapshot(page);
  expect(stored.local).toEqual([]); expect(stored.session).toEqual([]); expect(stored.databases || []).toEqual([]);
  expect(JSON.stringify(stored)).not.toContain(fakeToken);
  await button(page, 'Edit portfolios & data').click();
  await expect(page.getByRole('combobox', { name: 'Current portfolio symbol 1', exact: true })).toHaveValue('SOXL');
  await expect(page.getByLabel('Tiingo API token', { exact: true })).toHaveValue(fakeToken);
  await expect(page.getByRole('checkbox', { name: 'I may access this API for my own portfolio review', exact: true })).toBeChecked();
  const successfulCalls = requests;
  await compare(page);
  expect(requests).toBe(successfulCalls + 2);
  await button(page, 'Edit portfolios & data').click();
  await expect(page.getByLabel('Tiingo API token', { exact: true })).toHaveValue(fakeToken);
  await button(page, 'Disconnect and use CSV').click();
  await page.getByRole('combobox', { name: 'Price data connection', exact: true }).selectOption('tiingo');
  await expect(page.getByLabel('Tiingo API token', { exact: true })).toHaveValue('');
});

test('legacy archive without covariance retains historical reasoning and an applied 7 bps baseline', async ({ page }) => {
  await ownHoldings(page);
  await importOwnPrices(page, csv, true);
  await compare(page);
  await button(page, 'Report').click();
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill('Temporary source record for the legacy compatibility test.');
  const sourceDownload = page.waitForEvent('download');
  await button(page, 'Export review').click();
  const record = JSON.parse(await readFile((await (await sourceDownload).path())!, 'utf8')) as ReviewRecord;
  record.schemaVersion = 1; record.settings.costBps = 7;
  record.createdAt = '2025-10-01T12:00:00.000Z'; record.nextReview = '2025-11-01';
  record.rationale = 'Historical seven-basis-point reasoning must stay attached to this snapshot.';
  delete record.versions; delete record.catalog;
  for (const window of record.result.risk.windows) delete window.covariance;
  const sourceRows = csv.trim().split('\n').map(row => row.split(',')), header = sourceRows[0];
  const sourcePrices = new Map(sourceRows.slice(1).map(row => [row[0], row]));
  const prices = record.result.history.a.dates.map(date => record.result.symbols.map(symbol => Number(sourcePrices.get(date)![header.indexOf(symbol)])));
  for (const side of ['a', 'b'] as const) {
    const target = record.result.symbols.map(symbol => record[side].holdings.find(row => row.symbol === symbol)?.weight ?? 0);
    // Recalculate the historical ledger at 7 bps; changing only its label would
    // make a false baseline and would not exercise the intended compatibility.
    record.result.history[side] = simulateLedger(record.result.history.a.dates, prices, target, record.settings.frequency, 7, record.settings.initialNav, 1).result;
    record.result.delaySensitivity[side] = simulateLedger(record.result.history.a.dates, prices, target, record.settings.frequency, 7, record.settings.initialNav, 2).result;
  }
  await button(page, 'Saved reviews').click();
  await page.getByLabel('Import archive', { exact: true }).setInputFiles({ name: 'legacy-no-covariance.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(record)) });
  await expect(metrics(page)).toBeVisible();
  const frozenMetrics = await metrics(page).textContent();
  await button(page, 'Risk').click();
  await expect(page.getByText('Correlation unavailable: this window has no recorded covariance matrix.', { exact: false })).toBeVisible();
  await expect(button(page, 'Inspect pair')).toBeDisabled();
  await expect(page.getByTestId('risk-chart').locator('svg')).toBeVisible();
  await button(page, 'Scenarios').click();
  await expect(button(page, '7 bps')).toHaveAttribute('aria-pressed', 'true');
  await button(page, '20 bps').click();
  await expect(metrics(page)).toHaveText(frozenMetrics!);
  await button(page, 'Reset view').click();
  await expect(button(page, '7 bps')).toHaveAttribute('aria-pressed', 'true');
  await button(page, 'Report').click();
  const preview = page.getByRole('region', { name: 'Report preview', exact: true });
  await expect(preview).toContainText(record.rationale);
  await expect(preview).toContainText(record.nextReview);
  await expect(preview).toContainText(record.createdAt);
  const pending = page.waitForEvent('download');
  await button(page, 'Export review').click();
  const download = await pending;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.schemaVersion).toBe(1);
  expect(exported.settings.costBps).toBe(7);
  expect(exported.result.history).toEqual(record.result.history);
  expect(exported.result.risk.windows.every((window: { covariance?: unknown }) => window.covariance === undefined)).toBe(true);
});
