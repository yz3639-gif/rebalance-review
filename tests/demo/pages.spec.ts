import { expect, test } from '@playwright/test';

const repository = 'https://github.com/yz3639-gif/rebalance-review';
test('project Pages root calculates five views without providers, storage or broken base-path assets', async ({ page }) => {
  const badRequests: string[] = [], requests: string[] = [], failures: string[] = [];
  page.on('request', request => requests.push(request.url()));
  page.on('response', response => { if (response.status() >= 400) badRequests.push(`${response.status()} ${response.url()}`); });
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('./');
  await expect(page).toHaveTitle('Rebalance Review — Interactive Portfolio Research');
  await expect(page.getByRole('region', { name: 'Snapshot metrics', exact: true })).toBeVisible();
  await expect(page.getByTestId('history-chart').locator('svg')).toBeVisible();
  await expect(page.locator('.dr-public-note')).toContainText('Generated prices, not live market data');
  await expect(page.locator('.dr-context-source')).toContainText('DETERMINISTIC SYNTHETIC DATA');
  await expect(page.getByRole('link', { name: 'View source', exact: true })).toHaveAttribute('href', repository);
  await expect(page.getByRole('link', { name: 'Run locally', exact: true })).toHaveAttribute('href', `${repository}#quick-start`);
  const metrics = await page.getByRole('region', { name: 'Snapshot metrics', exact: true }).textContent();
  for (const view of ['Holdings', 'Risk', 'Scenarios', 'Report', 'Overview']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await expect(page.getByRole('region', { name: 'Snapshot metrics', exact: true })).toHaveText(metrics!);
  }
  await page.getByRole('button', { name: '1Y', exact: true }).click();
  await page.getByRole('button', { name: 'Index 100', exact: true }).click();
  await expect(page.getByTestId('history-chart')).toHaveAttribute('data-unit', 'index');
  await page.getByRole('button', { name: 'Holdings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search holdings', exact: true }).fill('SPY');
  await page.getByRole('table', { name: 'Holdings comparison', exact: true }).getByRole('button', { name: 'SPY', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Asset inspector', exact: true })).toContainText('SPY');
  await page.getByRole('combobox', { name: 'Example dataset', exact: true }).selectOption('cash');
  await expect(page.locator('.dr-context-source')).toContainText('ZERO-RETURN CASH ASSUMPTION');
  await expect(page.getByRole('region', { name: 'Snapshot metrics', exact: true })).toContainText('0.00%');
  const storage = await page.evaluate(async () => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), databases: await indexedDB.databases() }));
  expect(storage.local).toEqual([]); expect(storage.session).toEqual([]); expect(storage.databases).toEqual([]);
  expect(requests.some(url => url.includes('/api/') || /tiingo|yahoo|query1|query2/i.test(url))).toBe(false);
  expect(requests.filter(url => /^https?:/.test(url)).every(url => url.startsWith('http://127.0.0.1:4175/rebalance-review/'))).toBe(true);
  expect(badRequests).toEqual([]); expect(failures).toEqual([]);
  await page.getByRole('link', { name: 'Licenses & sources', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Licenses and source notices', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Rebalance Review', exact: true })).toHaveAttribute('href', '/rebalance-review/');
  await expect(page.getByRole('link', { name: 'Runtime SBOM', exact: true })).toHaveAttribute('href', '/rebalance-review/sbom/runtime.cdx.json');
  await page.getByRole('link', { name: 'Back to Rebalance Review', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Snapshot metrics', exact: true })).toBeVisible();
});

test('project Pages demo keeps the 50-asset study searchable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await expect(page.getByRole('region', { name: 'Snapshot metrics', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Example dataset', exact: true }).selectOption('fifty');
  await expect(page.getByRole('heading', { name: '50-asset allocation study', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Snapshot metrics', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Holdings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search holdings', exact: true }).fill('BND');
  await page.getByRole('table', { name: 'Holdings comparison', exact: true }).getByRole('button', { name: 'BND', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Asset inspector', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Asset inspector', exact: true })).toContainText('BND');
  await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  await expect(page.getByRole('button', { name: 'Report', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Run locally', exact: true })).toHaveAttribute('href', `${repository}#quick-start`);
});
