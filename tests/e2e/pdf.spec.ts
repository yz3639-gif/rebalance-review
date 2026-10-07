import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { compareExample, importOwnPortfolios, importOwnPrices, syntheticMarketCsv } from './helpers';

async function textFromPdf(path: string, checkBounds=false) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = new Uint8Array(await readFile(path));
  expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
  const task = getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i), text = await page.getTextContent();
    if(checkBounds)for(const item of text.items){
      if(!('str'in item)||!item.str.trim())continue;
      expect(item.transform[4],`page ${i}: ${item.str}`).toBeGreaterThanOrEqual(35);
      expect(item.transform[4]+item.width,`page ${i}: ${item.str}`).toBeLessThanOrEqual(582);
      const running=item.str==='REBALANCE REVIEW'||item.str==='PORTFOLIO COMPARISON'||item.str.includes('| Report ')||/^\d+ \/ \d+$/.test(item.str);
      expect(item.transform[5],`page ${i}: ${item.str}`).toBeGreaterThan(running?15:48);
      expect(item.transform[5],`page ${i}: ${item.str}`).toBeLessThan(running?772:744);
    }
    pages.push(text.items.filter(item => !('transform' in item) || (item.transform[5] > 40 && item.transform[5] < 740)).map(item => 'str' in item ? item.str : '').join(' '));
  }
  await task.destroy();
  return { text: pages.join('\n'), pages };
}
test('downloads a complete PDF with Chinese reasoning, context, real text and no third-party requests', async ({ page,baseURL }, info) => {
  const external: string[] = [], initialPdfAssets: string[] = [];
  const origin=new URL(baseURL!).origin;
  let exporting = false;
  page.on('request', request => {
    const url = request.url();
    if (url.startsWith('http') && new URL(url).origin!==origin) external.push(url);
    if (!exporting && /pdf\.worker|RebalanceSansSC|glyph-ranges/.test(url)) initialPdfAssets.push(url);
  });
  await compareExample(page);
  expect(initialPdfAssets).toEqual([]);
  const reason = '降低集中度，同时保留长期投资计划。\nAccept lower concentration; revisit before changing weights.';
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill(reason);
  await page.getByLabel('Next review date', { exact: true }).fill('2099-01-01');
  exporting = true;
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF report', exact: true }).click();
  const file = await pending;
  const path = info.outputPath('complete-review.pdf');
  await file.saveAs(path);
  const result = await textFromPdf(path);
  expect(result.pages.length).toBeGreaterThanOrEqual(4);
  for (const token of ['降低集中度', 'Accept lower concentration', '2099-01-01', 'Deterministic synthetic demonstration', 'total_return_index', 'SYNTHETIC EXAMPLE', 'Modeled trading fees', 'VTI', 'VXUS', 'CASH', 'Ledoit-Wolf', 'Questions to revisit', 'Data cutoff']) expect(result.text).toContain(token);
  expect(external).toEqual([]);
  await expect(page.getByText('PDF generated; download started.', { exact: false })).toBeVisible();
  await info.attach('complete-report', { path, contentType: 'application/pdf' });
  await page.context().setOffline(true);
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill('离线复查。The second download uses a fresh snapshot.');
  const repeat = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF report', exact: true }).click();
  const second = await repeat, secondPath = info.outputPath('offline-review.pdf');
  await second.saveAs(secondPath);
  expect((await textFromPdf(secondPath)).text).toContain('The second download uses a fresh snapshot.');
  await page.context().setOffline(false);
});

test('decision-only PDF excludes source prices and derived report metrics', async ({ page }, info) => {
  await importOwnPortfolios(page); await importOwnPrices(page);
  await page.getByRole('checkbox', { name: 'I understand cash earns 0% in this replay', exact: true }).check();
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill('Keep my own allocation plan without restricted market results.');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download decision-only PDF', exact: true }).click();
  const file = await pending, path = info.outputPath('decision-only.pdf'); await file.saveAs(path);
  const { text } = await textFromPdf(path);
  expect(text).toContain('Decision-only record'); expect(text).toContain('Keep my own allocation plan'); expect(text).toContain('SPY');
  for (const forbidden of ['QA synthetic file generated', 'Maximum historical drawdown', 'Annualized risk - 252', 'Modeled trading fees', 'Ending hypothetical wealth', 'Common history:']) expect(text).not.toContain(forbidden);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.print-restriction-notice')).toBeVisible();
  await expect(page.locator('.report .kpi-grid')).toBeHidden();
  await expect(page.locator('.report .history-panel')).toBeHidden();
  await expect(page.locator('.report .print-context')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('.report .kpi-grid')).toBeVisible();
});

test('requires a reason, preserves inputs on font failure and supports retry', async ({ page }) => {
  await compareExample(page);
  await page.getByRole('button', { name: 'Download PDF report', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Write a reason' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill('This input must survive a font loading failure.');
  await page.context().route('**/fonts/RebalanceSansSC-Regular.ttf', route => route.abort());
  await page.getByRole('button', { name: 'Download PDF report', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'PDF unavailable' })).toBeVisible({ timeout: 35000 });
  await expect(page.getByRole('textbox', { name: 'Why this change?', exact: true })).toHaveValue('This input must survive a font loading failure.');
  await expect(page.getByRole('button', { name: 'Download PDF report', exact: true })).toBeEnabled();
  await page.context().unroute('**/fonts/RebalanceSansSC-Regular.ttf');
  const retry = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF report', exact: true }).click();
  expect((await retry).suggestedFilename()).toMatch(/\.pdf$/);
});

test('cancels a stalled PDF without downloading stale content and can retry', async ({ page }) => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.context().route('**/fonts/RebalanceSansSC-Regular.ttf', async route => { await blocked; await route.continue().catch(() => {}); });
  await compareExample(page);
  const rationale = page.getByRole('textbox', { name: 'Why this change?', exact: true });
  await rationale.fill('The cancelled report must not replace this reasoning.');
  let downloads = 0; page.on('download', () => { downloads++; });
  await page.getByRole('button', { name: 'Download PDF report', exact: true }).click();
  await expect(page.getByText('Loading the local PDF font…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel PDF', exact: true }).click();
  await expect(page.getByText('PDF generation cancelled. Your review is unchanged.', { exact: true })).toBeVisible();
  expect(downloads).toBe(0);
  await expect(rationale).toHaveValue('The cancelled report must not replace this reasoning.');
  release(); await page.context().unroute('**/fonts/RebalanceSansSC-Regular.ttf');
  const retry = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF report', exact: true }).click();
  await retry;
  expect(downloads).toBe(1);
});

test('unsupported characters fail explicitly without changing the written reason', async ({ page }) => {
  await compareExample(page);
  const reason = 'Keep this unsupported emoji visible in the editor: 🦄';
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill(reason);
  await page.getByRole('button', { name: 'Download PDF report', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'PDF font cannot display' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Why this change?', exact: true })).toHaveValue(reason);
});

test('PDF preserves 5000 characters and maximum holdings in a partial comparison', async ({ page }, info) => {
  await importOwnPortfolios(page);
  const unknown = Array.from({ length: 48 }, (_, i) => `UNK${String(i + 1).padStart(2, '0')}`);
  for (const target of ['a', 'b']) {
    await page.getByRole('combobox', { name: 'Import into', exact: true }).selectOption(target);
    const rows = [['SPY', target === 'a' ? 1.8 : 2.8], ['BND', target === 'a' ? 1.8 : .8], ...unknown.map(symbol => [symbol, 1.8]), ['CASH', 10]];
    await page.getByRole('textbox', { name: 'Holdings table', exact: true }).fill(['ticker,allocation', ...rows.map(row => row.join(','))].join('\n'));
    await page.getByRole('button', { name: 'Preview holdings', exact: true }).click();
    await page.getByRole('button', { name: 'Import holdings', exact: true }).click();
  }
  await importOwnPrices(page, syntheticMarketCsv(), true);
  await page.getByRole('checkbox', { name: 'I understand cash earns 0% in this replay', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Compare only the covered portions; I understand this is not a full-portfolio result', exact: true }).check();
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toBeVisible();
  const rationale = '复查配置，关注税费与未覆盖持仓。'.repeat(400).slice(0, 4990) + 'FINAL-END.';
  expect(rationale.length).toBe(5000);
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill(rationale);
  await page.getByLabel('Next review date', { exact: true }).fill('2099-01-01');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF report', exact: true }).click();
  const file = await pending, path = info.outputPath('partial-maximum-holdings.pdf');
  await file.saveAs(path);
  const extracted = await textFromPdf(path);
  expect(extracted.text).toContain('PARTIAL PORTFOLIOS');
  expect(extracted.text).toContain('Excluded from analysis');
  for (const symbol of unknown) expect(extracted.text).toContain(symbol);
  expect(extracted.text.replaceAll(/\s/g, '')).toContain(rationale.replaceAll(/\s/g, ''));
  await info.attach('partial-maximum-holdings', { path, contentType: 'application/pdf' });
});

test('cash-only PDF describes modeled assumptions without claiming market evidence', async ({ page }, info) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Review my portfolio', exact: true }).click();
  await page.getByLabel('Current portfolio symbol 1', { exact: true }).fill('CASH');
  await page.getByLabel('Current portfolio weight 1', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Copy A to B' }).click();
  await page.getByRole('checkbox', { name: 'I understand cash earns 0% in this replay', exact: true }).check();
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill('保留现金并在下个月复查。');
  await page.getByLabel('Next review date', { exact: true }).fill('2099-01-01');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF report', exact: true }).click();
  const file = await pending, path = info.outputPath('cash-only.pdf'); await file.saveAs(path);
  const extracted = await textFromPdf(path);
  for (const text of ['Assumption-only cash scenario', 'cash_zero', 'No market prices or observed returns are used', '保留现金']) expect(extracted.text).toContain(text);
  expect(extracted.text).not.toContain('Daily risk uses centered Ledoit-Wolf');
  await info.attach('cash-only', { path, contentType: 'application/pdf' });
});

test('PDF preserves all 5000 newline-rich rationale characters without clipping or silently dropping lines',async({page},info)=>{
  await compareExample(page);
  const rationale='Line.\n'.repeat(833).slice(0,4990)+'FINAL-END.';
  expect(rationale).toHaveLength(5000);expect(rationale.match(/Line/g)).toHaveLength(832);
  await page.getByRole('textbox',{name:'Why this change?',exact:true}).fill(rationale);
  await page.getByLabel('Next review date',{exact:true}).fill('2099-01-01');
  const pending=page.waitForEvent('download',{timeout:35000});
  await page.getByRole('button',{name:'Download PDF report',exact:true}).click();
  const file=await pending,path=info.outputPath('newline-rich-reason.pdf');await file.saveAs(path);
  const extracted=await textFromPdf(path,true);
  expect(extracted.text.match(/Line/g)).toHaveLength(832);
  expect(extracted.text.replaceAll(/\s/g,'')).toContain(rationale.replaceAll(/\s/g,''));
  for(const token of ['FINAL-END.','Next review date: 2099-01-01','Questions to revisit','SYNTHETIC EXAMPLE','Modeled trading fees'])expect(extracted.text).toContain(token);
  await info.attach('newline-rich-reason',{path,contentType:'application/pdf'});
});

test('system print includes closed assumptions, reason and next-review date', async ({ page }) => {
  await compareExample(page);
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill('Print this exact rationale even with the assumptions collapsed.');
  await page.getByLabel('Next review date', { exact: true }).fill('2099-01-01');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.print-context').getByText('Print this exact rationale even with the assumptions collapsed.', { exact: true })).toBeVisible();
  await expect(page.locator('.print-context')).toContainText('2099-01-01');
  await expect(page.locator('.print-context')).toContainText('Ledoit-Wolf');
  await expect(page.locator('.print-context')).toContainText('Data source:');
});
