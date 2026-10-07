import { expect, test, type Page } from '@playwright/test';

async function enterPrintMedia(page: Page) {
  // Replace only the native dialog: the product's Print report handler must
  // select its target, validate permissions and dispatch the real lifecycle.
  await page.evaluate(() => { window.print = () => window.dispatchEvent(new Event('beforeprint')); });
  await page.getByRole('button', { name: 'Print report', exact: true }).click();
  await page.emulateMedia({ media: 'print' });
}

async function leavePrintMedia(page: Page) {
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('body')).not.toHaveAttribute('data-print-target');
  await expect(page.locator('.dr-app')).toBeVisible();
}

test('connected current and archived print select one complete paper report and hide terminal controls', async ({ page }) => {
  await page.goto('/design/');
  await page.getByRole('combobox', { name: 'Example scenario', exact: true }).selectOption('stocks-bonds');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Load example', exact: true }).click();
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Snapshot metrics', exact: true })).toBeVisible();
  await expect(page.locator('.rr-connected-print.current-review .chart svg')).toHaveCount(1);
  await page.getByRole('button', { name: 'Report', exact: true }).click();

  const archivedReason = 'ARCHIVED PRINT REASON: 原始配置复查。 Keep the original costs and assumptions.';
  const currentReason = 'CURRENT PRINT REASON: 修改后的分析说明。 Keep this unsaved revision separate.';
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill(archivedReason);
  await page.getByLabel('Next review date', { exact: true }).fill('2099-01-01');
  await page.getByRole('checkbox', { name: 'Allow local storage on this device', exact: true }).check();
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Review saved on this device.' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill(currentReason);

  await enterPrintMedia(page);
  await expect(page.locator('body')).toHaveAttribute('data-print-target', 'current');
  const current = page.locator('.rr-connected-print.current-review');
  await expect(current).toBeVisible();
  await expect(current.locator('#review-heading')).toBeVisible();
  await expect(page.locator('.report:visible')).toHaveCount(1);
  await expect(page.locator('.report:visible .report-heading h2')).toHaveCount(1);
  await expect(current.locator('.chart svg')).toBeVisible();
  await expect(current.locator('.print-context')).toBeVisible();
  await expect(current.locator('.print-context')).toContainText(currentReason);
  await expect(current.locator('.print-context')).not.toContainText(archivedReason);
  await expect(current.locator('.print-context')).toContainText('2099-01-01');
  for (const title of ['What changes in your allocation?', 'Where does the risk come from?', 'How much do costs and timing matter?']) {
    await expect(current.locator('h3', { hasText: title })).toBeVisible();
  }
  await expect(page.locator('.dr-app')).toBeHidden();
  await expect(page.locator('.rr-connected-base')).toBeHidden();
  await expect(page.locator('.save-panel:visible')).toHaveCount(0);
  await expect(page.locator('.dr-report-page:visible')).toHaveCount(0);
  expect((await current.boundingBox())!.x).toBeGreaterThanOrEqual(0);
  await leavePrintMedia(page);

  await page.getByRole('button', { name: 'Saved reviews', exact: true }).click();
  await page.getByRole('button', { name: 'View old report', exact: true }).click();
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  await expect(page.locator('.rr-connected-print .archive .chart svg')).toHaveCount(1);
  await enterPrintMedia(page);
  await expect(page.locator('body')).toHaveAttribute('data-print-target', 'archive');
  const archive = page.locator('.rr-connected-print .archive');
  await expect(archive).toBeVisible();
  await expect(archive.locator('#archive-heading')).toBeVisible();
  await expect(page.locator('.report:visible')).toHaveCount(1);
  await expect(page.locator('.report:visible .report-heading h2')).toHaveCount(1);
  await expect(archive.locator('.chart svg')).toBeVisible();
  await expect(archive.locator('.print-context')).toBeVisible();
  await expect(archive.locator('.print-context')).toContainText(archivedReason);
  await expect(archive.locator('.print-context')).not.toContainText(currentReason);
  await expect(archive.locator('.print-context')).toContainText('2099-01-01');
  await expect(page.locator('.dr-app')).toBeHidden();
  await expect(page.locator('.rr-connected-base')).toBeHidden();
  await expect(page.locator('.journal-card:visible')).toHaveCount(0);
  await expect(page.locator('.review-actions:visible')).toHaveCount(0);
  expect((await archive.boundingBox())!.x).toBeGreaterThanOrEqual(0);
  await leavePrintMedia(page);
});
