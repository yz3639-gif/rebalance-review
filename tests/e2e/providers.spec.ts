import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { storageSnapshot } from './helpers';


// Deterministic synthetic network fixtures, never observations from a live provider.
const closed = new Set<string>(JSON.parse(readFileSync(new URL('../../src/data/us-equity-calendar.json', import.meta.url), 'utf8')).closedWeekdays);
const todayParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
const datePart=(kind:string)=>todayParts.find(p=>p.type===kind)!.value;
const cursorEnd=new Date(`${datePart('year')}-${datePart('month')}-${datePart('day')}T00:00:00Z`);
do {cursorEnd.setUTCDate(cursorEnd.getUTCDate()-1);} while([0,6].includes(cursorEnd.getUTCDay())||closed.has(cursorEnd.toISOString().slice(0,10)));
const requestedEnd=cursorEnd.toISOString().slice(0,10);
const dates: string[] = [];
for (const cursor = new Date('2024-01-02T00:00:00Z'); cursor.toISOString().slice(0, 10) <= requestedEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
  const date = cursor.toISOString().slice(0, 10);
  if (![0, 6].includes(cursor.getUTCDay()) && !closed.has(date)) dates.push(date);
}
const fakeToken = 'PROVIDER_E2E_FAKE_KEY_DO_NOT_PERSIST';
function prices(symbol: string) {
  return dates.map((date, i) => ({ date, adjClose: 100 * Math.exp(i * .0002 + .01 * Math.sin(i * (symbol === 'SPY' ? .19 : .13))) }));
}
async function ownPortfolios(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Review my portfolio', exact: true }).click();
  await page.getByLabel('Current portfolio symbol 1', { exact: true }).fill('SPY');
  await page.getByRole('spinbutton', { name: 'Current portfolio weight 1', exact: true }).fill('100');
  await page.getByLabel('Proposed portfolio symbol 1', { exact: true }).fill('BND');
  await page.getByRole('spinbutton', { name: 'Proposed portfolio weight 1', exact: true }).fill('100');
}
async function tiingo(page: Page) {
  await ownPortfolios(page);
  await page.getByRole('combobox', { name: 'Price data connection', exact: true }).selectOption('tiingo');
  await page.getByLabel('Tiingo API token', { exact: true }).fill(fakeToken);
  await page.getByRole('checkbox', { name: 'I may access this API for my own portfolio review', exact: true }).check();
  await page.getByRole('button', { name: 'Use these API settings', exact: true }).click();
}
async function fulfillTiingo(route: Route) {
  const body = route.request().postDataJSON();
  expect(Object.keys(body).sort()).toEqual(['end', 'start', 'symbol']);
  expect(route.request().headers().authorization).toBe(`Token ${fakeToken}`);
  await route.fulfill({ json: { symbol: body.symbol, coverage: { startDate: dates[0], endDate: dates.at(-1) }, prices: prices(body.symbol) } });
}
async function compare(page: Page) {
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toBeVisible();
}

test('Tiingo errors preserve inputs; retry and repeated comparisons refetch without storing credentials or raw data', async ({ page }) => {
  let status = 401, calls = 0;
  await page.route('**/api/providers/tiingo/eod', async route => {
    calls++;
    if (status !== 200) await route.fulfill({ status, json: { error: `unsafe upstream ${fakeToken}` } });
    else await fulfillTiingo(route);
  });
  await tiingo(page);
  await expect(page.getByText('Awaiting market data: SPY, BND')).toHaveCount(0);
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('rejected the API key');
  await expect(page.getByRole('alert')).not.toContainText(fakeToken);
  await expect(page.getByLabel('Current portfolio symbol 1', { exact: true })).toHaveValue('SPY');
  status = 429;
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('limit was reached');
  status = 200;
  await compare(page);
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export review', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Download PDF report', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download decision-only PDF', exact: true })).toBeEnabled();
  await expect(page.getByRole('checkbox', { name: 'Include permitted market data for later reproduction', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Calculation-only raw history was released' })).toBeVisible();
  const before = calls;
  await compare(page);
  expect(calls).toBe(before + 2);
  const snapshot = await storageSnapshot(page);
  expect(snapshot.local).toEqual([]); expect(snapshot.session).toEqual([]);
  expect(snapshot.databases || []).toEqual([]); expect(snapshot.cookies).toBe('');
});

test('cancelling a pending API fetch ignores its late response and allows a fresh comparison', async ({ page }) => {
  let release!: () => void, pending = true, requests = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/providers/tiingo/eod', async route => {
    requests++;
    if (pending) await gate;
    await fulfillTiingo(route).catch(() => { /* The deliberately cancelled request may already be closed. */ });
  });
  await tiingo(page);
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await page.getByRole('button', { name: 'Cancel calculation', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Calculation cancelled' })).toBeVisible();
  pending = false; release();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Tiingo API token', { exact: true })).toHaveValue(fakeToken);
  await compare(page);
  expect(requests).toBe(4);
  await page.getByRole('button', { name: 'Disconnect and use CSV', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Price data connection', exact: true }).selectOption('tiingo');
  await expect(page.getByLabel('Tiingo API token', { exact: true })).toHaveValue('');
  await expect(page.getByRole('checkbox', { name: 'I may access this API for my own portfolio review', exact: true })).not.toBeChecked();
});

test('custom operation-only data can export authorized derived results, while templates and archives exclude the key and raw prices', async ({ page }) => {
  let requests = 0;
  await page.route('https://market.example/history**', async route => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization', 'Access-Control-Allow-Methods': 'GET' } });
      return;
    }
    requests++;
    const url = new URL(route.request().url());
    expect(route.request().headers().authorization).toBe(`Bearer ${fakeToken}`);
    await route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: prices(url.searchParams.get('symbol')!) });
  });
  await ownPortfolios(page);
  await page.getByRole('combobox', { name: 'Price data connection', exact: true }).selectOption('custom');
  await page.getByLabel('Custom API endpoint', { exact: true }).fill('https://market.example/history');
  await page.getByLabel('Custom API source name', { exact: true }).fill('Explicit synthetic API fixture for QA');
  await page.getByRole('combobox', { name: 'API authentication', exact: true }).selectOption('bearer');
  await page.getByLabel('Custom API credential', { exact: true }).fill(fakeToken);
  await page.getByRole('checkbox', { name: 'Custom API prices are USD and use the selected adjusted basis', exact: true }).check();
  await page.getByRole('checkbox', { name: 'My provider permits saving these derived results locally', exact: true }).check();
  await page.getByRole('checkbox', { name: 'My provider permits exporting the permitted review content, including PDF', exact: true }).check();
  await page.getByRole('checkbox', { name: 'I may access this API for my own portfolio review', exact: true }).check();
  const templateDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export API template without credentials', exact: true }).click();
  const template = await readFile((await (await templateDownload).path())!, 'utf8');
  expect(template).not.toContain(fakeToken);
  expect(JSON.parse(template).configuration.permissions).toEqual({ rawPersistence: false, derivedPersistence: false, export: false });
  await page.getByRole('button', { name: 'Use these API settings', exact: true }).click();
  await compare(page);
  expect(requests).toBe(2);
  await expect(page.getByRole('checkbox', { name: 'Include permitted market data for later reproduction', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Download PDF report', exact: true })).toBeEnabled();
  await page.getByLabel('Why this change?', { exact: true }).fill('QA checks permitted derived export independently of transient raw history.');
  const archiveDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export review', exact: true }).click();
  const text = await readFile((await (await archiveDownload).path())!, 'utf8'), archive = JSON.parse(text);
  expect(text).not.toContain(fakeToken); expect(archive.dataset).toBeUndefined();
  expect(archive.manifest.retention).toBe('operation'); expect(archive.manifest.policy).toBe('user-declared');
  expect(archive.result.history.a.dates.length).toBeGreaterThan(252);
  await page.getByRole('checkbox', { name: 'Allow local storage on this device', exact: true }).check();
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Review saved on this device' })).toBeVisible();
  const saved = await page.evaluate(() => new Promise<unknown[]>((resolve, reject) => {
    const request = indexedDB.open('rebalance-review-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, query = db.transaction('reviews', 'readonly').objectStore('reviews').getAll();
      query.onerror = () => { db.close(); reject(query.error); };
      query.onsuccess = () => { db.close(); resolve(query.result); };
    };
  }));
  expect(saved).toHaveLength(1);
  expect((saved[0] as { dataset?: unknown }).dataset).toBeUndefined();
  expect(JSON.stringify(saved)).not.toContain(fakeToken);
  await page.getByLabel('Custom API source name', { exact: true }).fill('Another provider identity');
  await expect(page.getByRole('checkbox', { name: 'My provider permits saving these derived results locally', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'My provider permits exporting the permitted review content, including PDF', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'I may access this API for my own portfolio review', exact: true })).not.toBeChecked();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Configure your API connection first');
  expect(requests).toBe(2);
});
