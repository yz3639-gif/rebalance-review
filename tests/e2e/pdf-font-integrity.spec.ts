import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { compareExample } from './helpers';

const font = readFileSync(new URL('../../public/fonts/RebalanceSansSC-Regular.ttf', import.meta.url));

test('truncated successful font response recovers once before decoding and downloads the PDF', async ({ page }, info) => {
  await compareExample(page);
  const reason = 'A complete verified font must preserve this reason. 字体传输完整性验证。';
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill(reason);
  let requests = 0;
  await page.context().route('**/fonts/RebalanceSansSC-Regular.ttf', route => {
    requests++;
    return route.fulfill({ status: 200, contentType: 'font/ttf', body: requests === 1 ? font.subarray(0, 4_683_146) : font });
  });
  const downloadPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF report', exact: true }).click();
  const download = await downloadPending;
  const output = info.outputPath('verified-font-recovery.pdf');
  await download.saveAs(output);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(await readFile(output)), useSystemFonts: true, isEvalSupported: false });
  try {
    const document = await task.promise;
    let text = '';
    for (let number = 1; number <= document.numPages; number++) {
      const content = await (await document.getPage(number)).getTextContent();
      text += content.items.map(item => 'str' in item ? item.str : '').join(' ');
    }
    expect(text).toContain('字体传输完整性验证');
    expect(text).toContain('Maximum historical drawdown');
  } finally { await task.destroy(); }
  expect(requests).toBe(2);
  await expect(page.locator('.pdf-actions [role="alert"]')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Why this change?', exact: true })).toHaveValue(reason);
});

test('repeated truncated font fails explicitly after two requests and a later manual retry succeeds', async ({ page }) => {
  await compareExample(page);
  const rationale = page.getByRole('textbox', { name: 'Why this change?', exact: true });
  await rationale.fill('Do not replace my report or silently select another font. 保留输入。');
  let damaged = true, requests = 0;
  await page.context().route('**/fonts/RebalanceSansSC-Regular.ttf', route => {
    requests++;
    return route.fulfill({ status: 200, contentType: 'font/ttf', body: damaged ? font.subarray(0, 4_683_146) : font });
  });
  await page.getByRole('button', { name: 'Download PDF report', exact: true }).click();
  await expect(page.locator('.pdf-actions [role="alert"]')).toContainText('A fresh download was also invalid');
  expect(requests).toBe(2);
  await expect(rationale).toHaveValue('Do not replace my report or silently select another font. 保留输入。');
  damaged = false;
  const downloadPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF report', exact: true }).click();
  await downloadPending;
  expect(requests).toBe(3);
  await expect(page.locator('.pdf-actions [role="alert"]')).toHaveCount(0);
});
