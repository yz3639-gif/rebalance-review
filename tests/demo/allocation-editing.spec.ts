import { expect, test, type Page } from '@playwright/test';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', error => errors.get(page)!.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/^https:\/\//, route => route.abort('blockedbyclient'));
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function openEditor(page: Page) {
  await page.goto('./');
  await expect(page.getByLabel('A weight SPY', { exact: true })).toBeVisible();
  await expect(page.getByTestId('transition-fee')).toBeVisible();
  await expect(page.getByTestId('active-risk')).toHaveText(/\d.*%/);
}
async function setWeight(page: Page, side: 'A' | 'B', symbol: string, value: string) {
  const input = page.getByLabel(`${side} weight ${symbol}`, { exact: true });
  await input.fill(value);
  await input.press('Tab');
}
async function navigate(page: Page, name: 'Market Pulse' | 'Rebalance') {
  await page.getByRole('navigation', { name: 'Demo workspace' }).getByRole('button', { name, exact: true }).click();
}
async function addSoxl(page: Page) {
  await page.getByLabel('Add ETF or cash', { exact: true }).fill('SOXL');
  await page.getByRole('button', { name: 'Add holding', exact: true }).click();
  await expect(page.getByLabel('B weight SOXL', { exact: true })).toBeVisible();
}
async function expectInvalid(page: Page) {
  await expect(page.getByText('Complete both allocations', { exact: false })).toBeVisible();
  await expect(page.getByTestId('transition-fee')).toHaveCount(0);
  await expect(page.getByTestId('transition-gross')).toHaveCount(0);
  await expect(page.getByTestId('active-risk')).toHaveCount(0);
}
async function expectNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
}
async function expectCashFullyVisible(page: Page) {
  const viewport = page.getByRole('region', { name: 'Allocation weights', exact: true });
  const cash = viewport.locator('tbody tr').filter({ hasText: 'CASH' });
  const bounds = await viewport.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top + element.clientTop, bottom: rect.top + element.clientTop + element.clientHeight };
  });
  const row = await cash.boundingBox();
  expect(row).not.toBeNull();
  expect(row!.y).toBeGreaterThanOrEqual(bounds.top - .5);
  expect(row!.y + row!.height).toBeLessThanOrEqual(bounds.bottom + .5);
}

test('homepage A/B edits rebalance cash and Keep allocation copies the edited current portfolio', async ({ page }) => {
  await openEditor(page);
  await expectCashFullyVisible(page);
  await expect(page.getByLabel('A weight SPY', { exact: true })).toHaveValue('40');
  await expect(page.getByLabel('B weight SPY', { exact: true })).toHaveValue('30');
  await setWeight(page, 'A', 'SPY', '35');
  await expectInvalid(page);
  await page.getByRole('button', { name: 'Balance A with cash', exact: true }).click();
  await expect(page.getByLabel('A weight CASH', { exact: true })).toHaveValue('10');
  await expect(page.getByTestId('transition-fee')).toBeVisible();
  await setWeight(page, 'B', 'SPY', '35');
  await expectInvalid(page);
  await page.getByRole('button', { name: 'Balance B with cash', exact: true }).click();
  await expect(page.getByLabel('B weight CASH', { exact: true })).toHaveValue('0');
  await expect(page.getByRole('combobox', { name: 'Target allocation', exact: true }).locator('option:checked')).toHaveText('Custom allocation');
  await expect(page.getByTestId('transition-fee')).toBeVisible();
  await page.getByRole('combobox', { name: 'Target allocation', exact: true }).selectOption({ label: 'Keep allocation' });
  await expect(page.getByLabel('B weight SPY', { exact: true })).toHaveValue('35');
  await expect(page.getByLabel('B weight CASH', { exact: true })).toHaveValue('10');
  await expect(page.getByTestId('transition-gross')).toHaveText('$0');
  await expect(page.getByTestId('transition-fee')).toHaveText('$0.00');
  await expect(page.getByTestId('active-risk')).toHaveText('0.00%');
});

test('empty and overweight drafts withdraw stale results; leading zeroes normalize on blur and recovery retains the draft', async ({ page }) => {
  await openEditor(page);
  const weight = page.getByLabel('A weight SPY', { exact: true });
  await weight.fill('');
  await expect(weight).toHaveValue('');
  await expectInvalid(page);
  await weight.fill('050');
  await weight.press('Tab');
  await expect(weight).toHaveValue('50');
  await expectInvalid(page);
  await weight.fill('120');
  await weight.press('Tab');
  await expectInvalid(page);
  await weight.fill('35');
  await weight.press('Tab');
  await page.getByRole('button', { name: 'Balance A with cash', exact: true }).click();
  await expect(weight).toHaveValue('35');
  await expect(page.getByLabel('A weight CASH', { exact: true })).toHaveValue('10');
  await expect(page.getByTestId('transition-fee')).toBeVisible();
});

test('SOXL supports dollar transition without inventing unavailable covariance, and removing it restores the supported study', async ({ page }) => {
  await openEditor(page);
  await addSoxl(page);
  await expect(page.getByLabel('A weight SOXL', { exact: true })).toHaveValue('0');
  await setWeight(page, 'B', 'SOXL', '10');
  await expectInvalid(page);
  await setWeight(page, 'B', 'SPY', '20');
  await expect(page.getByTestId('transition-fee')).toBeVisible();
  await expect(page.getByTestId('transition-fee')).not.toHaveText('$0.00');
  await expect(page.getByText('Risk unavailable', { exact: false })).toBeVisible();
  await expect(page.getByTestId('active-risk')).not.toHaveText(/\d.*%/);
  await page.getByRole('button', { name: 'Remove SOXL', exact: true }).click();
  await expect(page.getByLabel('B weight SOXL', { exact: true })).toHaveCount(0);
  await expectInvalid(page);
  await setWeight(page, 'B', 'SPY', '30');
  await expect(page.getByTestId('transition-fee')).toBeVisible();
  await expect(page.getByTestId('active-risk')).toHaveText(/\d.*%/);
  await expect(page.getByText('Risk unavailable', { exact: false })).toHaveCount(0);
});

test('reordered asset rows retain the same covariance mapping and dormant SOXL does not disable known-asset risk', async ({ page }) => {
  await openEditor(page);
  const originalRisk = await page.getByTestId('active-risk').textContent();
  const originalFee = await page.getByTestId('transition-fee').textContent();
  await page.getByRole('button', { name: 'Remove BND', exact: true }).click();
  await expectInvalid(page);
  await page.getByLabel('Add ETF or cash', { exact: true }).fill('BND');
  await page.getByRole('button', { name: 'Add holding', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Allocation weights', exact: true }).locator('tbody tr').last()).toContainText('BND');
  await setWeight(page, 'A', 'BND', '20');
  await setWeight(page, 'B', 'BND', '25');
  await expect(page.getByTestId('active-risk')).toHaveText(originalRisk!);
  await expect(page.getByTestId('transition-fee')).toHaveText(originalFee!);
  await addSoxl(page);
  await expect(page.getByLabel('A weight SOXL', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('B weight SOXL', { exact: true })).toHaveValue('0');
  await expect(page.getByTestId('active-risk')).toHaveText(originalRisk!);
  await expect(page.getByTestId('transition-fee')).toHaveText(originalFee!);
  await expect(page.getByText('Risk unavailable', { exact: false })).toHaveCount(0);
});

test('custom allocation drafts survive Pulse, expanded Rebalance and blocked external Market navigation', async ({ page }) => {
  const requests: { url: string; method: string; body: string | null }[] = [];
  page.on('request', request => requests.push({ url: request.url(), method: request.method(), body: request.postData() }));
  await openEditor(page);
  await setWeight(page, 'A', 'SPY', '35');
  await page.getByRole('button', { name: 'Balance A with cash', exact: true }).click();
  await setWeight(page, 'B', 'SPY', '35');
  await page.getByRole('button', { name: 'Balance B with cash', exact: true }).click();
  const fee = await page.getByTestId('transition-fee').textContent();
  await navigate(page, 'Rebalance');
  await expect(page.getByLabel('A weight SPY', { exact: true })).toHaveValue('35');
  await expect(page.getByLabel('B weight CASH', { exact: true })).toHaveValue('0');
  await expect(page.getByTestId('transition-fee')).toHaveText(fee!);
  // Even an unfinished draft survives view changes; it never revives the previous calculation.
  await page.getByLabel('B weight SPY', { exact: true }).fill('');
  await navigate(page, 'Market Pulse');
  await expect(page.getByLabel('B weight SPY', { exact: true })).toHaveValue('');
  await expectInvalid(page);
  await page.getByRole('group', { name: 'Data mode', exact: true }).getByRole('button', { name: 'Market', exact: true }).click();
  await expect(page.getByRole('region', { name: 'External market explorer', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Return to the interactive replay' }).click();
  await expect(page.getByLabel('A weight SPY', { exact: true })).toHaveValue('35');
  await expect(page.getByLabel('B weight SPY', { exact: true })).toHaveValue('');
  await expectInvalid(page);
  await setWeight(page, 'B', 'SPY', '35');
  await expect(page.getByTestId('transition-fee')).toHaveText(fee!);
  const storage = await page.evaluate(async () => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), databases: await indexedDB.databases() }));
  expect(storage).toEqual({ local: [], session: [], databases: [] });
  expect(requests.filter(request => request.url.includes('/api/') || request.method !== 'GET' || request.body !== null)).toEqual([]);
  const external = requests.filter(request => request.url.startsWith('https:'));
  expect(external.length).toBeGreaterThan(0);
  expect(external.every(request => /^https:\/\/s3\.tradingview\.com\/external-embedding\/embed-widget-(ticker-tape|advanced-chart)\.js$/.test(request.url))).toBe(true);
});

test('allocation inputs and asset addition remain usable at 320 and 390 pixels without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openEditor(page);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoOverflow(page);
    await expectCashFullyVisible(page);
    await setWeight(page, 'A', 'SPY', '35');
    await page.getByRole('button', { name: 'Balance A with cash', exact: true }).click();
    await addSoxl(page);
    await setWeight(page, 'B', 'SOXL', '10');
    await setWeight(page, 'B', 'SPY', '20');
    await expect(page.getByTestId('transition-fee')).toBeVisible();
    await expectNoOverflow(page);
    await navigate(page, 'Rebalance');
    await expect(page.getByLabel('B weight SOXL', { exact: true })).toHaveValue('10');
    await expectNoOverflow(page);
    await page.getByRole('button', { name: 'Remove SOXL', exact: true }).click();
    await setWeight(page, 'B', 'SPY', '30');
    await navigate(page, 'Market Pulse');
    await expect(page.getByTestId('transition-fee')).toBeVisible();
  }
});

test('a failed risk worker leaves allocations and dollar trades editable, and retry restores risk without losing the draft', async ({ page, context }) => {
  const workerPattern = '**/design.worker-*.js';
  let blockedAttempts = 0;
  await context.route(workerPattern, route => { blockedAttempts++; return route.abort('failed'); });
  await page.goto('./');
  await expect(page.getByLabel('A weight SPY', { exact: true })).toBeVisible();
  await expect(page.getByTestId('transition-fee')).toBeVisible();
  await expect(page.getByText('Risk unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('active-risk')).toHaveText('N/A');
  expect(blockedAttempts).toBeGreaterThan(0);
  await setWeight(page, 'A', 'SPY', '35');
  await page.getByRole('button', { name: 'Balance A with cash', exact: true }).click();
  await expect(page.getByTestId('transition-fee')).toBeVisible();
  const fee = await page.getByTestId('transition-fee').textContent();
  await expect(page.getByRole('button', { name: 'Retry study', exact: true })).toBeVisible();
  await context.unroute(workerPattern);
  await page.getByRole('button', { name: 'Retry study', exact: true }).click();
  await expect(page.getByTestId('active-risk')).toHaveText(/\d.*%/);
  await expect(page.getByLabel('A weight SPY', { exact: true })).toHaveValue('35');
  await expect(page.getByLabel('A weight CASH', { exact: true })).toHaveValue('10');
  await expect(page.getByTestId('transition-fee')).toHaveText(fee!);
});

test('synchronous Worker security failure preserves editing, dollar calculation and a safe retry action', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Worker', {
      configurable: true,
      value: class BlockedWorker {
        constructor() { throw new DOMException('Worker construction blocked by the test environment.', 'SecurityError'); }
      },
    });
  });
  await page.goto('./');
  await expect(page.getByLabel('A weight SPY', { exact: true })).toBeVisible();
  await expect(page.getByTestId('transition-fee')).toBeVisible();
  await expect(page.getByText('Risk unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('active-risk')).toHaveText('N/A');
  await setWeight(page, 'B', 'SPY', '35');
  await page.getByRole('button', { name: 'Balance B with cash', exact: true }).click();
  await expect(page.getByTestId('transition-fee')).toBeVisible();
  const fee = await page.getByTestId('transition-fee').textContent();
  await page.getByRole('button', { name: 'Retry study', exact: true }).click();
  await expect(page.getByText('Risk unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('B weight SPY', { exact: true })).toHaveValue('35');
  await expect(page.getByLabel('B weight CASH', { exact: true })).toHaveValue('0');
  await expect(page.getByTestId('transition-fee')).toHaveText(fee!);
  await expect(page.getByTestId('active-risk')).toHaveText('N/A');
});
