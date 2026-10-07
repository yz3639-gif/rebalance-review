import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { compareExample, importOwnPortfolios, importOwnPrices, storageSnapshot, syntheticMarketCsv } from './helpers';

test('homepage offers distinct example and own-portfolio entry', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Try an example', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review my portfolio', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('homepage.png'), fullPage: true });
});

test('example calculates locally without implicit persistent portfolio storage', async ({ page, baseURL }) => {
  const externalRequests: string[] = [];
  const failures: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/.test(url) && new URL(url).origin !== new URL(baseURL!).origin) externalRequests.push(url);
  });
  page.on('pageerror', (error) => failures.push(error.message));
  await compareExample(page);
  await expect(page.getByText(/synthetic/i).first()).toBeVisible();
  const stored = await storageSnapshot(page);
  expect(stored.local).toEqual([]);
  expect(stored.session).toEqual([]);
  expect(stored.cookies).toBe('');
  if (stored.databases !== null) expect(stored.databases).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(failures).toEqual([]);
});

test('report has no automatic accessibility violations', async ({ page }, testInfo) => {
  await compareExample(page);
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('desktop-report.png'), fullPage: true });
});

test('narrow viewport does not overflow and still reaches the report', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await compareExample(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile-report.png'), fullPage: true });
});

test('own portfolio entry does not silently substitute example market data', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Review my portfolio', exact: true }).click();
  await page.getByRole('combobox', { name: 'Price data connection', exact: true }).selectOption('csv');
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toHaveCount(0);
  await expect(page.getByText(/missing market data|add market data|import market data/i).first()).toBeVisible();
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your holdings have been preserved');
});

test('own CSV mapping produces a report with session-only rights', async ({ page }) => {
  await importOwnPortfolios(page);
  await expect(page.getByText('Missing market data', { exact: true })).toBeVisible();
  await importOwnPrices(page);
  await page.getByRole('checkbox', { name: 'I understand cash earns 0% in this replay', exact: true }).check();
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Read the assumptions and unanswered questions' }).click();
  await expect(page.getByText(/Data: QA synthetic file generated locally for browser verification/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export review', exact: true })).toBeDisabled();
  const stored = await storageSnapshot(page);
  expect(stored.local).toEqual([]);
  if (stored.databases !== null) expect(stored.databases).toEqual([]);
});

test('invalid internal price fails without discarding imported holdings', async ({ page }) => {
  await importOwnPortfolios(page);
  const rows = syntheticMarketCsv().split('\n');
  const corrupted = rows[40].split(',');
  corrupted[1] = '';
  rows[40] = corrupted.join(',');
  await importOwnPrices(page, rows.join('\n'));
  await expect(page.getByRole('alert')).toContainText(/internal missing price/i);
  await expect(page.getByText('Missing market data', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toHaveCount(0);
  // Replacing only the prices must suffice; the previous A/B holdings remain valid.
  await importOwnPrices(page);
  await page.getByRole('checkbox', { name: 'I understand cash earns 0% in this replay', exact: true }).check();
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toBeVisible();
});
