import { expect, test, type Locator } from '@playwright/test';

async function clearWithKeyboard(input: Locator) {
  await input.focus();
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  await expect(input).toHaveValue('');
}

for (const route of ['/design/', '/']) {
  test.describe(`numeric editing on ${route}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(route);
      if (route === '/') await page.getByRole('button', { name: 'Review my portfolio', exact: true }).click();
    });

    test('weights support real typing, clearing, decimals and pasted leading zeros', async ({ page }, info) => {
      for (const portfolio of ['Current portfolio', 'Proposed portfolio']) {
        const input = page.getByRole('spinbutton', { name: `${portfolio} weight 1`, exact: true });
        await expect(input).toHaveValue('0');
        await input.click();
        await input.press('End');
        await input.pressSequentially('50');
        await expect(input).toHaveValue('50');
        const card = page.locator('.portfolio-editor').filter({ has: input });
        await expect(card.locator('.portfolio-title strong')).toHaveText('50.0%');
        await clearWithKeyboard(input);
        await input.pressSequentially('0.5');
        await expect(input).toHaveValue('0.5');
        await expect(card.locator('.portfolio-title strong')).toHaveText('0.5%');
        await clearWithKeyboard(input);
        await input.pressSequentially('12.50');
        await expect(input).toHaveValue('12.50');
        await input.press('Tab');
        await expect(input).toHaveValue('12.5');
        await input.fill('00050');
        await expect(input).toHaveValue('50');
        await input.press('ArrowUp');
        await expect(input).toHaveValue('50.1');
        await clearWithKeyboard(input);
        await input.pressSequentially('50');
        await expect(input).toHaveValue('50');
      }
      await page.getByRole('combobox', { name: 'Current portfolio symbol 1', exact: true }).fill('SOXL');
      await page.getByRole('spinbutton', { name: 'Current portfolio weight 1', exact: true }).focus();
      await page.locator('.portfolio-editor.a').screenshot({ path: info.outputPath('weight-50.png') });
    });

    test('starting value, row removal, copying and full reset keep displayed numbers in sync', async ({ page }) => {
      const starting = page.getByRole('spinbutton', { name: 'Hypothetical starting USD', exact: true });
      await clearWithKeyboard(starting);
      await starting.pressSequentially('50000');
      await expect(starting).toHaveValue('50000');
      await starting.fill('000123.50');
      await expect(starting).toHaveValue('123.50');
      await starting.press('Tab');
      await expect(starting).toHaveValue('123.5');
      const current = page.locator('.portfolio-editor.a');
      const first = current.getByRole('spinbutton', { name: 'Current portfolio weight 1', exact: true });
      await first.fill('0.00');
      await current.getByRole('button', { name: '+ Add holding', exact: true }).click();
      await current.getByRole('spinbutton', { name: 'Current portfolio weight 2', exact: true }).fill('75');
      await current.getByRole('button', { name: 'Remove holding from Current portfolio', exact: true }).first().click();
      await expect(first).toHaveValue('75');
      await page.getByRole('button', { name: /Copy A to B/ }).click();
      await expect(page.getByRole('spinbutton', { name: 'Proposed portfolio weight 1', exact: true })).toHaveValue('75');
      await clearWithKeyboard(first);
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Start fresh', exact: true }).click();
      await expect(first).toHaveValue('0');
      await expect(starting).toHaveValue('10000');
      await page.getByRole('combobox', { name: 'Example scenario', exact: true }).selectOption('stocks-bonds');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Load example', exact: true }).click();
      await expect(first).toHaveValue('80');
      await expect(current.getByRole('spinbutton', { name: 'Current portfolio weight 2', exact: true })).toHaveValue('20');
    });
  });
}
