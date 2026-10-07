import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { importOwnPrices, storageSnapshot, syntheticMarketCsv } from './helpers';

// All prices in this file are generated network fixtures. These tests verify the
// local-provider workflow and permissions, never live Yahoo availability or returns.
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const connection = (page: Page) => page.getByRole('combobox', { name: 'Price data connection', exact: true });
const metrics = (page: Page) => page.getByRole('region', { name: 'Snapshot metrics', exact: true });
type PriceRequest = { symbol: string; start: string; end: string };
const closed = new Set<string>(JSON.parse(readFileSync(new URL('../../src/data/us-equity-calendar.json', import.meta.url), 'utf8')).closedWeekdays);

async function localStatus(page: Page, enabled = true) {
  await page.route('**/api/providers/local/status', route => route.fulfill({ json: { enabled } }));
}

async function openHoldings(page: Page, multiple = false) {
  await page.goto('/design/');
  await expect(connection(page)).toHaveValue('yahoo-local');
  await expect(page.getByText('Local market connection ready', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Current portfolio symbol 1', exact: true }).fill('SOXL');
  await page.getByRole('spinbutton', { name: 'Current portfolio weight 1', exact: true }).fill(multiple ? '50' : '100');
  if (multiple) {
    await page.locator('.portfolio-editor.a').getByRole('button', { name: '+ Add holding', exact: true }).click();
    await page.getByRole('combobox', { name: 'Current portfolio symbol 2', exact: true }).fill('SPY');
    await page.getByRole('spinbutton', { name: 'Current portfolio weight 2', exact: true }).fill('50');
  }
  await page.getByRole('combobox', { name: 'Proposed portfolio symbol 1', exact: true }).fill('QQQ');
  await page.getByRole('spinbutton', { name: 'Proposed portfolio weight 1', exact: true }).fill('100');
  await expect(connection(page)).toHaveValue('yahoo-local');
}

async function fulfillGeneratedYahoo(route: Route): Promise<PriceRequest> {
  const request = route.request(), body = request.postDataJSON() as PriceRequest;
  expect(Object.keys(body).sort()).toEqual(['end', 'start', 'symbol']);
  expect(request.headers().authorization).toBeUndefined();
  expect(request.headers().cookie).toBeUndefined();
  const sessions: string[] = [];
  for (const cursor = new Date(`${body.start}T00:00:00Z`); cursor.toISOString().slice(0, 10) <= body.end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    if (![0, 6].includes(cursor.getUTCDay()) && !closed.has(date)) sessions.push(date);
  }
  const dates = sessions.slice(-600);
  expect(dates.length).toBeGreaterThanOrEqual(530);
  const factor = body.symbol.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const prices = dates.map((date, index) => ({ date, adjClose: 100 * Math.exp(index * .0002 + .01 * Math.sin(index * (.1 + factor % 17 / 100))) }));
  await route.fulfill({ json: { symbol: body.symbol, prices } });
  return body;
}

async function compare(page: Page) {
  await button(page, 'Compare portfolios').click();
  await expect(metrics(page)).toBeVisible();
  await expect(page.getByTestId('history-chart').locator('svg')).toBeVisible();
}

test('mock local no-key history automatically powers SOXL/SPY versus QQQ and preserves transient rights', async ({ page }) => {
  await localStatus(page);
  const requests: PriceRequest[] = [];
  await page.route('**/api/providers/yahoo/eod', async route => { requests.push(await fulfillGeneratedYahoo(route)); });
  await openHoldings(page, true);
  await expect(page.getByLabel('Tiingo API token', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'I may access this API for my own portfolio review', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'I confirm my selected ETF listings are quoted in USD', exact: true })).toHaveCount(0);
  await compare(page);
  expect(requests.map(request => request.symbol).sort()).toEqual(['QQQ', 'SOXL', 'SPY']);
  expect(new Set(requests.map(request => request.end)).size).toBe(1);
  await expect(page.locator('.dr-context-strip')).toContainText('Yahoo Finance');
  await expect(page.locator('.dr-context-strip')).toContainText(requests[0].end);
  await expect(page.locator('.dr-context-strip')).not.toContainText(/synthetic/i);
  const initialMetrics = await metrics(page).textContent();
  await button(page, 'Holdings').click();
  const holdings = page.getByRole('table', { name: 'Holdings comparison', exact: true });
  for (const symbol of ['SOXL', 'SPY', 'QQQ']) await expect(holdings).toContainText(symbol);
  for (const view of ['Risk', 'Scenarios', 'Report']) {
    await button(page, view).click();
    await expect(metrics(page)).toHaveText(initialMetrics!);
  }
  await expect(button(page, 'Save review')).toBeDisabled();
  await expect(button(page, 'Export review')).toBeDisabled();
  await expect(button(page, 'Download PDF report')).toHaveCount(0);
  await expect(button(page, 'Download decision-only PDF')).toBeEnabled();
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill('Generated local-provider workflow fixture; not observed market evidence.');
  const preview = page.getByRole('region', { name: 'Report preview', exact: true });
  await expect(preview).toContainText(/decision(?:\s+record)?[\s-]+only/i);
  const stored = await storageSnapshot(page);
  expect(stored.local).toEqual([]); expect(stored.session).toEqual([]); expect(stored.databases || []).toEqual([]);
});

test('mock local rate limit, cancellation and retry keep holdings and refetch changed assets without reconnection', async ({ page }) => {
  await localStatus(page);
  let status = 429, blocked = false, requestCount = 0, release!: () => void;
  const requests: PriceRequest[] = [], pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/providers/yahoo/eod', async route => {
    requestCount++; requests.push(route.request().postDataJSON() as PriceRequest);
    if (status !== 200) { await route.fulfill({ status, headers: { 'Retry-After': '60' }, json: { error: 'upstream_rate_limit' } }); return; }
    if (blocked) await pending;
    await fulfillGeneratedYahoo(route).catch(() => { /* Cancelled browser requests are expected to reject fulfillment. */ });
  });
  await openHoldings(page);
  await button(page, 'Compare portfolios').click();
  await expect(page.getByRole('alert')).toContainText('limit was reached');
  await expect(page.getByRole('alert')).toContainText('60 seconds');
  await expect(metrics(page)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Current portfolio symbol 1', exact: true })).toHaveValue('SOXL');
  await expect(page.getByRole('spinbutton', { name: 'Current portfolio weight 1', exact: true })).toHaveValue('100');
  await expect(page.locator('.demo-notice')).toHaveCount(0);
  status = 200; blocked = true;
  const beforeCancel = requestCount;
  await button(page, 'Compare portfolios').click();
  await expect.poll(() => requestCount).toBe(beforeCancel + 2);
  await button(page, 'Cancel calculation').click();
  await expect(page.getByRole('status').filter({ hasText: 'Calculation cancelled' })).toBeVisible();
  blocked = false; release();
  await expect(metrics(page)).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Proposed portfolio symbol 1', exact: true }).fill('BND');
  await expect(connection(page)).toHaveValue('yahoo-local');
  const beforeRetry = requestCount;
  await compare(page);
  expect(requestCount).toBe(beforeRetry + 2);
  expect(requests.slice(-2).map(request => request.symbol).sort()).toEqual(['BND', 'SOXL']);
  await button(page, 'Edit portfolios & data').click();
  await page.getByRole('combobox', { name: 'Current portfolio symbol 1', exact: true }).fill('SPY');
  await expect(connection(page)).toHaveValue('yahoo-local');
  await expect(page.getByText('Local market connection ready', { exact: true })).toBeVisible();
  const beforeEdit = requestCount;
  await compare(page);
  expect(requestCount).toBe(beforeEdit + 2);
  expect(requests.slice(-2).map(request => request.symbol).sort()).toEqual(['BND', 'SPY']);
});

test('manual CSV choice and explicit synthetic examples never trigger local Yahoo requests', async ({ page }) => {
  await localStatus(page);
  let requests = 0;
  await page.route('**/api/providers/yahoo/eod', route => { requests++; return route.fulfill({ status: 500, json: { error: 'unexpected_fixture_request' } }); });
  await openHoldings(page);
  await connection(page).selectOption('csv');
  await page.getByRole('combobox', { name: 'Current portfolio symbol 1', exact: true }).fill('SPY');
  await expect(connection(page)).toHaveValue('csv');
  await button(page, 'Compare portfolios').click();
  await expect(page.getByRole('alert')).toContainText('Import market prices first');
  expect(requests).toBe(0);
  await page.getByRole('combobox', { name: 'Example scenario', exact: true }).selectOption('stocks-bonds');
  page.once('dialog', dialog => dialog.accept());
  await button(page, 'Load example').click();
  await expect(page.locator('.demo-notice')).toContainText('Synthetic example');
  await expect(connection(page)).toHaveValue('csv');
  await compare(page);
  await expect(page.locator('.dr-context-strip')).toContainText(/synthetic/i);
  expect(requests).toBe(0);
});

test('disabled local service leaves CSV available and does not expose the Yahoo option', async ({ page }) => {
  await localStatus(page, false);
  let requests = 0;
  await page.route('**/api/providers/yahoo/eod', route => { requests++; return route.fulfill({ status: 404, json: { error: 'local_connection_disabled' } }); });
  await page.goto('/design/');
  await expect(connection(page)).toHaveValue('csv');
  await expect(connection(page).locator('option[value="yahoo-local"]')).toHaveCount(0);
  for (const [name, symbol] of [['Current portfolio', 'SOXL'], ['Proposed portfolio', 'QQQ']]) {
    await page.getByRole('combobox', { name: `${name} symbol 1`, exact: true }).fill(symbol);
    await page.getByRole('spinbutton', { name: `${name} weight 1`, exact: true }).fill('100');
  }
  await importOwnPrices(page, syntheticMarketCsv(530, ['SOXL', 'QQQ']));
  await compare(page);
  await expect(page.locator('.dr-context-strip')).toContainText(/synthetic/i);
  expect(requests).toBe(0);
});

test('late local capability discovery preserves an in-progress CSV draft without switching providers', async ({ page }) => {
  let release!: () => void, requested = false, yahooRequests = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/providers/local/status', async route => {
    requested = true; await pending; await route.fulfill({ json: { enabled: true } });
  });
  await page.route('**/api/providers/yahoo/eod', route => { yahooRequests++; return route.fulfill({ status: 500, json: { error: 'unexpected_fixture_request' } }); });
  await page.goto('/design/');
  await expect.poll(() => requested).toBe(true);
  await expect(connection(page)).toHaveValue('csv');
  const details = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Import price history' }) });
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  const draft = syntheticMarketCsv(530, ['SOXL', 'QQQ']);
  const input = page.getByRole('textbox', { name: 'Market prices CSV', exact: true });
  // Deliberately do not select CSV or apply/import the draft: typing into the
  // initial CSV mode alone must prevent a later capability probe from wiping it.
  await input.fill(draft);
  await expect(input).toHaveValue(draft);
  release();
  // This option appears only after the delayed response has been processed.
  await expect(connection(page).locator('option[value="yahoo-local"]')).toHaveCount(1);
  await expect(connection(page)).toHaveValue('csv');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(draft);
  expect(yahooRequests).toBe(0);
});
