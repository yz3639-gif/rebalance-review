import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { storageSnapshot } from './helpers';

const disallowedRequests = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, context, baseURL }) => {
  const requests: string[] = [];
  disallowedRequests.set(page, requests);
  const origin = new URL(baseURL!).origin;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) &&
      (url.origin !== origin || url.pathname.startsWith('/api/providers/'))) {
      requests.push(`${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    await route.continue();
  });
});

test.afterEach(async ({ page }) => {
  expect(disallowedRequests.get(page)).toEqual([]);
  // The design study is an isolated, generated example. Browsing it must not
  // create a journal, draft, credential cache, cookie, or hidden local account.
  const stored = await storageSnapshot(page);
  expect(stored.local).toEqual([]);
  expect(stored.session).toEqual([]);
  expect(stored.cookies).toBe('');
  if (stored.databases !== null) expect(stored.databases).toEqual([]);
});

async function openStudy(page: Page) {
  await page.goto('/design/?sample=standard');
  await expect(page.getByRole('heading', { name: 'Core allocation study', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Snapshot metrics', exact: true })).toBeVisible();
}

async function chooseExample(page: Page, label: string) {
  await page.getByRole('combobox', { name: 'Example dataset', exact: true }).selectOption({ label });
  if (label !== 'Loading failure') {
    await expect(navigation(page, 'Overview')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('region', { name: 'Snapshot metrics', exact: true })).toBeVisible();
  }
}

const navigation = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const holdingsTable = (page: Page) => page.getByRole('table', { name: 'Holdings comparison', exact: true });

test('view controls change the display without rewriting the calculated snapshot', async ({ page }, info) => {
  await openStudy(page);
  const metrics = page.getByRole('region', { name: 'Snapshot metrics', exact: true });
  const before = (await metrics.textContent())!;
  const drawdowns = await metrics.locator('.dr-metric').filter({ hasText: 'Maximum drawdown' }).locator('b').allTextContents();
  expect(drawdowns).toHaveLength(2);
  await navigation(page, 'Index 100').click();
  await expect(navigation(page, 'Index 100')).toHaveAttribute('aria-pressed', 'true');
  await navigation(page, '1Y').click();
  await expect(metrics).toHaveText(before);
  await navigation(page, 'Scenarios').click();
  await navigation(page, '20 bps').click();
  await page.getByRole('checkbox', { name: 'Extra one-session delay', exact: true }).check();
  await expect(page.getByRole('region', { name: 'Scenario results', exact: true })).toBeVisible();
  await expect(metrics).toHaveText(before);
  await navigation(page, 'Overview').click();
  await navigation(page, 'Reset view').click();
  await expect(navigation(page, 'USD')).toHaveAttribute('aria-pressed', 'true');
  await expect(navigation(page, 'All')).toHaveAttribute('aria-pressed', 'true');
  await expect(metrics).toHaveText(before);
  const accessibilityIssues: { view: string; rule: string; target: unknown; detail?: string }[] = [];
  for (const name of ['Overview', 'Holdings', 'Risk', 'Scenarios', 'Report']) {
    await navigation(page, name).click();
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    for (const violation of audit.violations) for (const node of violation.nodes) {
      accessibilityIssues.push({ view: name, rule: violation.id, target: node.target, detail: node.failureSummary });
    }
  }
  await expect(page.getByRole('region', { name: 'Report preview', exact: true }).getByRole('row', { name: /Maximum historical drawdown/ }).getByRole('cell')).toHaveText(drawdowns);
  const initialZoom = await page.getByLabel('Report zoom', { exact: true }).textContent();
  await navigation(page, 'Zoom in').click();
  await navigation(page, 'Reset view').click();
  await expect(page.getByLabel('Report zoom', { exact: true })).toHaveText(initialZoom!);
  await navigation(page, 'Overview').click();
  expect(accessibilityIssues, 'Accessibility across all five analysis views').toEqual([]);
  await page.screenshot({ path: info.outputPath('design-overview.png'), fullPage: true });
});

test('holding selection, search and partial-coverage filters retain their meaning', async ({ page }) => {
  await openStudy(page);
  await navigation(page, 'Holdings').click();
  const table = holdingsTable(page);
  const initialRowCount = await table.locator('tbody').getByRole('button').count();
  const symbol = table.locator('tbody').getByRole('button').first();
  const symbolName = (await symbol.getAttribute('aria-label'))!;
  await symbol.click();
  await expect(symbol).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Asset inspector', exact: true })).toContainText(symbolName);
  await page.keyboard.press('Escape');
  await expect(symbol).toHaveAttribute('aria-pressed', 'false');
  await expect(symbol).toBeFocused();
  await page.getByRole('textbox', { name: 'Search holdings', exact: true }).fill(symbolName);
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Search holdings', exact: true }).fill('NO-SUCH-ETF');
  await expect(table.locator('tbody').getByRole('button')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Changes only', exact: true }).check();
  await navigation(page, 'Reset view').click();
  await expect(page.getByRole('textbox', { name: 'Search holdings', exact: true })).toHaveValue('');
  await expect(page.getByRole('checkbox', { name: 'Changes only', exact: true })).not.toBeChecked();
  await expect(table.locator('tbody').getByRole('button')).toHaveCount(initialRowCount);
  await page.getByRole('checkbox', { name: 'Changes only', exact: true }).check();
  await expect(table.locator('tbody').getByRole('button').first()).toBeVisible();
  await chooseExample(page, 'Partial coverage');
  await navigation(page, 'Holdings').click();
  await page.getByRole('checkbox', { name: 'Uncovered only', exact: true }).check();
  await expect(table.locator('tbody').getByRole('button')).toHaveCount(1);
  await expect(table.locator('tbody')).toContainText(/uncovered|excluded/i);
});

test('fifty-asset study remains searchable and risk availability is explicit', async ({ page }) => {
  await openStudy(page);
  await chooseExample(page, '50-asset research basket');
  await navigation(page, 'Holdings').click();
  const rows = holdingsTable(page).locator('tbody').getByRole('button');
  await expect(rows).toHaveCount(51); // Fifty ETF identities, plus modeled cash.
  const etfs = rows.filter({ hasNotText: 'CASH' });
  await expect(etfs).toHaveCount(50);
  const last = etfs.last();
  const lastSymbol = (await last.getAttribute('aria-label'))!;
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('textbox', { name: 'Search holdings', exact: true }).fill(lastSymbol);
  await expect(rows).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await chooseExample(page, 'Short history');
  await navigation(page, 'Risk').click();
  await expect(navigation(page, '504 days')).toBeDisabled();
  await expect(navigation(page, '504 days')).toHaveAttribute('title', 'Insufficient common returns');
  await expect(page.getByText('Unavailable windows are disabled.', { exact: true })).toBeVisible();
  await navigation(page, '252 days').click();
  await expect(page.getByTestId('risk-chart').locator('svg')).toBeVisible();
  await navigation(page, '126 days').click();
  await expect(page.getByTestId('risk-chart')).toHaveAttribute('data-risk-window', '126');
});

test('cash and restricted examples communicate assumptions and export limits', async ({ page }) => {
  await openStudy(page);
  await chooseExample(page, 'All cash');
  await expect(page.getByRole('region', { name: 'Snapshot metrics', exact: true })).toContainText('0.00%');
  await navigation(page, 'Risk').click();
  await expect(page.getByTestId('correlation-chart')).toContainText(/undefined|not applicable|zero|N\/A/i);
  await chooseExample(page, 'Restricted export');
  await navigation(page, 'Report').click();
  await expect(page.getByRole('region', { name: 'Report preview', exact: true })).toContainText(/decision(?:\s+record)?[\s-]+only/i);
  const paperText = (await page.getByRole('region', { name: 'Report preview', exact: true }).getByRole('article').allTextContents()).join('\n');
  for (const metric of ['Maximum historical drawdown', 'Estimated volatility', 'Hypothetical annual growth', 'Data cutoff', 'Signed contributions']) expect(paperText).not.toContain(metric);
});

test('a loading failure has an explicit recovery action', async ({ page }) => {
  await openStudy(page);
  await chooseExample(page, 'Loading failure');
  await expect(page.getByRole('alert')).toContainText(/example|fixture|sample/i);
  await navigation(page, 'Retry example').click();
  await expect(page.getByRole('heading', { name: 'Core allocation study', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Snapshot metrics', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('phone layout keeps the analysis reachable with visible keyboard focus', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudy(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const holdings = navigation(page, 'Holdings');
  await holdings.focus();
  await holdings.press('Enter');
  const symbol = holdingsTable(page).locator('tbody').getByRole('button').first();
  await symbol.focus();
  await symbol.press('Enter');
  await expect(symbol).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Asset inspector', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(symbol).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('design-mobile.png'), fullPage: true });
});
