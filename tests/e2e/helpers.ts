import { expect, type Page } from '@playwright/test';

export async function openExample(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try an example', exact: true }).click();
}

export async function compareExample(page: Page) {
  await openExample(page);
  const cash = page.getByRole('checkbox', { name: 'I understand cash earns 0% in this replay', exact: true });
  if (await cash.count()) await cash.check();
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toBeVisible();
  await expect(page.locator('[role="img"] svg')).toBeVisible();
}

/** Independent, deterministic local fixture. Not an embedded provider sample. */
export function syntheticMarketCsv(rows = 530, symbols = ['SPY', 'BND']): string {
  const output = [`date,${symbols.join(',')}`];
  let date = new Date('2023-01-03T00:00:00Z');
  let observation = 0;
  while (observation < rows) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      const prices = symbols.map((_, j) => {
        const trend = 0.00018 * (j + 1) * observation;
        const wave = 0.015 * Math.sin(observation * (0.17 + 0.03 * j));
        return (100 * Math.exp(trend + wave)).toFixed(8);
      });
      output.push(`${date.toISOString().slice(0, 10)},${prices.join(',')}`);
      observation++;
    }
    date = new Date(date.getTime() + 86_400_000);
  }
  return output.join('\n');
}

export async function storageSnapshot(page: Page) {
  return page.evaluate(async () => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    databases: typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map((db) => db.name).filter(Boolean)
      : null,
    cookies: document.cookie,
  }));
}

export async function importOwnPortfolios(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Review my portfolio', exact: true }).click();
  await page.getByRole('combobox', { name: 'Price data connection', exact: true }).selectOption('csv');
  await page.locator('summary').filter({ hasText: 'Import holdings' }).click();
  await page.getByLabel('Holdings CSV file', { exact: true }).setInputFiles({
    name: 'my-holdings.csv', mimeType: 'text/csv',
    buffer: Buffer.from('ticker,allocation\nSPY,60\nBND,30\nCASH,10'),
  });
  await page.getByRole('combobox', { name: 'Symbol column', exact: true }).selectOption('ticker');
  await page.getByRole('combobox', { name: 'Weight or value column', exact: true }).selectOption('allocation');
  await page.getByRole('button', { name: 'Preview holdings', exact: true }).click();
  await page.getByRole('button', { name: 'Import holdings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Import into', exact: true }).selectOption('b');
  await page.getByRole('textbox', { name: 'Holdings table', exact: true }).fill('ticker,allocation\nSPY,40\nBND,50\nCASH,10');
  await page.getByRole('button', { name: 'Preview holdings', exact: true }).click();
  await page.getByRole('button', { name: 'Import holdings', exact: true }).click();
}

export async function importOwnPrices(page: Page, csv = syntheticMarketCsv(), permitPersistence = false) {
  const connection = page.getByRole('combobox', { name: 'Price data connection', exact: true });
  await connection.selectOption('csv');
  const details = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Import price history' }) });
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  await page.getByLabel('Market prices CSV file', { exact: true }).setInputFiles({
    name: 'locally-created-prices.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
  });
  await expect(page.getByRole('textbox',{name:'Market prices CSV',exact:true})).toHaveValue(csv);
  await page.getByRole('combobox', { name: 'CSV shape', exact: true }).selectOption('wide');
  await page.getByRole('combobox', { name: 'Data provenance', exact: true }).selectOption('synthetic');
  await page.getByRole('textbox', { name: 'Data source', exact: true }).fill('QA synthetic file generated locally for browser verification');
  await page.getByRole('checkbox', { name: 'All prices are in USD and use the selected adjusted-price basis', exact: true }).check();
  if (permitPersistence) await page.getByRole('checkbox', { name: 'I have permission to store and export this file and its derived results on my device', exact: true }).check();
  await page.getByRole('button', { name: 'Preview prices', exact: true }).click();
  const apply = page.getByRole('button', { name: 'Import prices', exact: true });
  if (await apply.count()) await apply.click();
}
