import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { importOwnPrices } from './helpers';

const fifty = JSON.parse(readFileSync(new URL('../../oracle/expanded-50-fixture.json', import.meta.url), 'utf8')) as { symbols: string[]; dates: string[]; prices: number[][] };
const calendar = JSON.parse(readFileSync(new URL('../../src/data/us-equity-calendar.json', import.meta.url), 'utf8')) as { closedWeekdays: string[] };
const holidays = new Set(calendar.closedWeekdays);
async function own(page: Page) { await page.goto('/'); await page.getByRole('button', { name: 'Review my portfolio', exact: true }).click(); }
async function importHoldings(page: Page, symbols: string[], target: 'a'|'b' = 'a') {
  const details = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Import holdings' }) });
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  await page.getByRole('combobox', { name: 'Import into', exact: true }).selectOption(target);
  await page.getByRole('textbox', { name: 'Holdings table', exact: true }).fill(['symbol,weight', ...symbols.map(symbol => `${symbol},${100/symbols.length}`)].join('\n'));
  await page.getByRole('button', { name: 'Read holdings columns', exact: true }).click();
  await page.getByRole('button', { name: 'Preview holdings', exact: true }).click();
  await page.getByRole('button', { name: 'Import holdings', exact: true }).click();
}

test('catalog searches by name and distinguishes the USD ETF from modeled cash', async ({ page }) => {
  await own(page);
  const input = page.getByRole('combobox', { name: 'Current portfolio symbol 1', exact: true });
  await input.fill('SCHD');
  await expect(page.getByRole('option', { name: /^SCHD / })).toContainText(/Dividend/i);
  await input.press('Enter'); await expect(input).toHaveValue('SCHD');
  await input.fill('semiconductors');
  await expect(page.getByRole('listbox').getByRole('option').first()).toContainText(/semiconductors/i);
  expect(await page.getByRole('listbox').getByRole('option').count()).toBeLessThanOrEqual(12);
  await input.fill('USD');
  await expect(page.getByRole('option', { name: /^USD ProShares Ultra Semiconductors/ })).toBeVisible();
  await input.press('Enter');
  await expect(input).toHaveValue('USD');
  await page.getByRole('spinbutton', { name: 'Current portfolio weight 1', exact: true }).fill('100');
  await page.getByRole('button', { name: 'Copy A to B', exact: true }).click();
  await expect(page.getByText('Cash-only replay period', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'I understand cash earns 0% in this replay', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Price data connection', exact: true }).selectOption('csv');
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Import market prices first');
});

test('holdings preview is staged and reports invalid cells without applying them', async ({ page }) => {
  await own(page);
  await page.locator('summary').filter({ hasText: 'Import holdings' }).click();
  const input = page.getByRole('combobox', { name: 'Current portfolio symbol 1', exact: true });
  await page.getByRole('textbox', { name: 'Holdings table', exact: true }).fill('symbol,weight\nSCHD,60\nSPY,40');
  await page.getByRole('button', { name: 'Read holdings columns', exact: true }).click();
  await page.getByRole('button', { name: 'Preview holdings', exact: true }).click();
  await expect(page.getByLabel('Holdings import preview')).toContainText('SCHD');
  await expect(input).toHaveValue('');
  await page.getByRole('textbox', { name: 'Holdings table', exact: true }).fill('symbol,weight\nSCHD,-5\nSPY,105');
  await expect(page.getByRole('button', { name: 'Import holdings', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview holdings', exact: true }).click();
  const issue = page.getByLabel('Import issues');
  await expect(issue).toContainText('weight'); await expect(issue).toContainText('nonnegative');
  await expect(issue.getByRole('row').nth(1).getByRole('cell').first()).toHaveText('2');
  await expect(input).toHaveValue('');
});

test('fifty catalog ETFs download a complete real-chart PDF and fifty-one are rejected intact', async ({ page },info) => {
  test.setTimeout(90_000);
  await own(page);
  await importHoldings(page, fifty.symbols);
  await expect(page.getByRole('combobox', { name: /Current portfolio symbol/ })).toHaveCount(50);
  await page.getByRole('button', { name: 'Copy A to B', exact: true }).click();
  const csv = ['date,'+fifty.symbols.join(','), ...fifty.dates.map((date, i) => date+','+fifty.prices[i].join(','))].join('\n');
  await importOwnPrices(page, csv, true);
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toBeVisible();
  await expect(page.locator('[role="img"] svg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF report', exact: true })).toBeEnabled();
  const rationale='复查配置，关注税费与资产风险。'.repeat(400).slice(0,4990)+'FINAL-END.';
  expect(rationale).toHaveLength(5000);
  await page.getByRole('textbox',{name:'Why this change?',exact:true}).fill(rationale);
  await page.getByLabel('Next review date',{exact:true}).fill('2099-01-01');
  const pending=page.waitForEvent('download',{timeout:35_000});
  await page.getByRole('button',{name:'Download PDF report',exact:true}).click();
  const download=await pending,path=info.outputPath('fully-covered-fifty-etfs.pdf');await download.saveAs(path);
  const {getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:new Uint8Array(await readFile(path)),useSystemFonts:true,isEvalSupported:false});
  const pdf=await task.promise,pages:string[]=[];let imageCount=0;
  try {
    for(let number=1;number<=pdf.numPages;number++) {
      const pdfPage=await pdf.getPage(number),content=await pdfPage.getTextContent(),operators=await pdfPage.getOperatorList();
      pages.push(content.items.filter(item=>'str' in item&&item.transform[5]>40&&item.transform[5]<740).map(item=>'str'in item?item.str:'').join(' '));
      imageCount+=operators.fnArray.filter(op=>[OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageXObjectRepeat].includes(op)).length;
    }
    const text=pages.join('\n');
    for(const symbol of fifty.symbols)expect(text).toMatch(new RegExp(`(?:^|\\s)${symbol.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:\\s|$)`));
    for(const required of ['SYNTHETIC EXAMPLE','Data cutoff:',fifty.dates.at(-1)!,'Recorded calculation versions:','method lw-ledger-1','Modeled trading fees','Maximum historical drawdown','Questions to revisit','2099-01-01'])expect(text).toContain(required);
    const packageInfo=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')) as {version:string};
    expect(text).toContain(`app ${packageInfo.version}`);expect(text).toContain(`engine ${packageInfo.version}`);
    expect(text).not.toContain('PARTIAL PORTFOLIOS');expect(imageCount).toBeGreaterThanOrEqual(1);
    expect(text.replaceAll(/\s/g,'')).toContain(rationale.replaceAll(/\s/g,''));
    await info.attach('fully-covered-fifty-etfs',{path,contentType:'application/pdf'});
  } finally {await task.destroy();}
  await importHoldings(page, ['SCHD'], 'b');
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('at most 50 different noncash assets');
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /Current portfolio symbol/ })).toHaveCount(50);
  await expect(page.getByRole('combobox', { name: 'Proposed portfolio symbol 1', exact: true })).toHaveValue('SCHD');
});

test('/demo computes a labeled synthetic review without an API key or upload',async({page,baseURL})=>{
  const origin=new URL(baseURL!).origin,external:string[]=[];page.on('request',request=>{const url=request.url();if(url.startsWith('http')&&new URL(url).origin!==origin)external.push(url);});
  await page.goto('/demo');
  await expect(page.getByRole('heading',{name:'Your review',exact:true})).toBeVisible();
  await expect(page.locator('[role="img"] svg')).toBeVisible();
  await expect(page.locator('.report-banner')).toContainText('SYNTHETIC EXAMPLE');
  await expect(page.getByRole('button',{name:'Download PDF report',exact:true})).toBeEnabled();
  expect(external).toEqual([]);
});

test('stale API tails fail visibly and a corrected retry reaches the requested final session', async ({ page }) => {
  await own(page);
  await page.getByRole('combobox', { name: 'Current portfolio symbol 1', exact: true }).fill('SPY');
  await page.getByRole('spinbutton', { name: 'Current portfolio weight 1', exact: true }).fill('100');
  await page.getByRole('button', { name: 'Copy A to B', exact: true }).click();
  let stale = true;
  await page.route('**/api/providers/tiingo/eod', async route => {
    const body = route.request().postDataJSON() as { symbol: string; start: string; end: string };
    const prices = [];
    for (const cursor = new Date('2024-01-02T00:00:00Z'); cursor.toISOString().slice(0,10) <= body.end; cursor.setUTCDate(cursor.getUTCDate()+1)) {
      const date = cursor.toISOString().slice(0,10);
      if (![0,6].includes(cursor.getUTCDay()) && !holidays.has(date)) prices.push({ date, adjClose: 100+prices.length*.01 });
    }
    if (stale) prices.pop();
    await route.fulfill({ json: { symbol: body.symbol, coverage: { startDate: '2024-01-02', endDate: body.end }, prices } });
  });
  await page.getByRole('combobox', { name: 'Price data connection', exact: true }).selectOption('tiingo');
  await page.getByLabel('Tiingo API token', { exact: true }).fill('CATALOG_FAKE_TEST_KEY');
  await page.getByRole('checkbox', { name: 'I may access this API for my own portfolio review', exact: true }).check();
  await page.getByRole('button', { name: 'Use these API settings', exact: true }).click();
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('requested final session');
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toHaveCount(0);
  stale = false;
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toBeVisible();
});
