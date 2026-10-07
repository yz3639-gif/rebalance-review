import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { compareExample, openExample, storageSnapshot } from './helpers';

test('explicit save, export, corrupt-archive recovery and clear retain truthful state', async ({ page }, testInfo) => {
  await compareExample(page);
  const rationale = 'Reduce equity concentration; accept the modeled growth tradeoff and review next month.';
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill(rationale);
  await page.getByRole('checkbox', { name: 'Allow local storage on this device', exact: true }).check();
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByText('Review saved on this device. No account or cloud upload.', { exact: true })).toBeVisible();
  const stored = await storageSnapshot(page);
  if (stored.databases !== null) expect(stored.databases).toContain('rebalance-review-v1');

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export review', exact: true }).click();
  const downloaded = await downloading;
  const archivePath = testInfo.outputPath('synthetic-review-archive.json');
  await downloaded.saveAs(archivePath);
  const archive = JSON.parse(await readFile(archivePath, 'utf8'));
  expect(archive.rationale).toBe(rationale);
  expect(archive.dataset).toBeUndefined(); // Raw inclusion requires a separate choice.
  expect(archive.manifest.synthetic).toBe(true);

  await page.getByRole('button', { name: 'Saved reviews', exact: true }).click();
  const journal = page.getByRole('region', { name: 'Saved reviews', exact: true });
  await expect(journal.getByRole('article').filter({ hasText: rationale })).toHaveCount(1);
  await page.getByLabel('Import archive', { exact: true }).setInputFiles({
    name: 'corrupt-review.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":1}'),
  });
  await expect(page.getByRole('alert')).toContainText(/corrupt|incomplete/i);
  await expect(journal.getByRole('article').filter({ hasText: rationale })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toBeVisible();

  await page.getByLabel('Import archive', { exact: true }).setInputFiles(archivePath);
  await expect(page.getByRole('heading', { name: 'Archived review', exact: true })).toBeVisible();
  await expect(page.getByText(/historical calculations have not been independently re-run/i)).toBeVisible();
  await expect(journal.getByRole('article').filter({ hasText: rationale })).toHaveCount(1);

  await page.getByRole('button', { name: 'Use archived weights for a new review', exact: true }).click();
  await page.getByRole('combobox', { name: 'Price data connection', exact: true }).selectOption('csv');
  await expect(page.getByText('Missing market data', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Import market prices first');

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Clear saved reviews', exact: true }).click();
  await expect(page.getByText('No saved reviews yet. Your next decision can be the first entry.', { exact: true })).toBeVisible();
  await expect(journal.getByRole('article').filter({ hasText: rationale })).toHaveCount(0);
});

test('keyboard alone can enter example, confirm cash and compute with result focus', async ({ page, browserName }) => {
  await page.goto('/');
  // macOS Safari defaults to Option-Tab for links/all clickable items.
  // https://support.apple.com/guide/safari/keyboard-and-other-shortcuts-cpsh003/mac
  const next = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
  await page.keyboard.press(next);
  await expect(page.getByRole('link', { name: 'Skip to main content', exact: true })).toBeFocused();
  const example = page.getByRole('button', { name: 'Try an example', exact: true });
  for (let i = 0; i < 12 && !(await example.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press(next);
  await expect(example).toBeFocused();
  await page.keyboard.press('Enter');
  const compare = page.getByRole('button', { name: 'Compare portfolios', exact: true });
  for (let i = 0; i < 100; i++) {
    const active = await page.evaluate(() => ({
      text: (document.activeElement?.textContent ?? '').trim(),
      type: document.activeElement instanceof HTMLInputElement ? document.activeElement.type : '',
      label: document.activeElement instanceof HTMLInputElement ? document.activeElement.labels?.[0]?.textContent?.trim() : '',
    }));
    if (active.type === 'checkbox' && active.label === 'I understand cash earns 0% in this replay') await page.keyboard.press('Space');
    if (await compare.evaluate(el => el === document.activeElement)) break;
    await page.keyboard.press(next);
  }
  await expect(compare).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toBeFocused();
});

test('loaded assets allow offline recomputation without persistent portfolio storage', async ({ page, context }) => {
  await compareExample(page);
  await context.setOffline(true);
  await expect(page.getByText(/you're offline/i)).toBeVisible();
  await page.getByRole('combobox', { name: 'Replay rebalancing', exact: true }).selectOption('quarterly');
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toBeVisible();
  const metadata = page.locator('.report-metadata');
  await expect(metadata.getByText('quarterly', { exact: true })).toBeVisible();
  await expect(metadata.getByText('5 bps / side', { exact: true })).toBeVisible();
  expect((await storageSnapshot(page)).local).toEqual([]);
});

test('storage quota failure preserves the current report', async ({ page }) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = function () { throw new DOMException('Injected full-storage condition for verification', 'QuotaExceededError'); };
  });
  await compareExample(page);
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill('A reason that should survive a storage failure.');
  await page.getByRole('checkbox', { name: 'Allow local storage on this device', exact: true }).check();
  await expect(page.getByRole('alert')).toContainText(/storage is unavailable/i);
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/current review remains available/i);
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Why this change?', exact: true })).toHaveValue('A reason that should survive a storage failure.');
});

test('cancellation keeps inputs and does not display a late report', async ({ page }) => {
  // Delay the actual Worker computation message, retaining a real Worker and its result.
  // This gives every engine the same deterministic chance to press Cancel.
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions) {
        setTimeout(() => super.postMessage(message, transferOrOptions as StructuredSerializeOptions), 1_000);
      }
    };
  });
  await openExample(page);
  await page.getByRole('checkbox', { name: 'I understand cash earns 0% in this replay', exact: true }).check();
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel calculation', exact: true }).click();
  await expect(page.getByText('Calculation cancelled. Your inputs are intact.', { exact: true })).toBeVisible();
  await page.waitForTimeout(1_200); // Purposeful wait beyond the injected late-message time.
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Compare portfolios', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your review', exact: true })).toBeVisible();
});
