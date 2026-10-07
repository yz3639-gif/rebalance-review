import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { compareExample } from './helpers';

test('declared static CSP permits Worker, charts and validated local saving', async ({ page, baseURL }) => {
  const headers = await readFile(new URL('../../public/_headers', import.meta.url), 'utf8');
  const policy = headers.split('\n').find(line => line.trim().startsWith('Content-Security-Policy:'))?.trim().slice('Content-Security-Policy:'.length).trim();
  expect(policy).toBeTruthy();
  await page.addInitScript(() => {
    (window as Window & { __cspViolations: string[] }).__cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      (window as Window & { __cspViolations: string[] }).__cspViolations.push(`${event.violatedDirective}: ${event.blockedURI}`);
    });
  });
  await page.route(new URL('/', baseURL!).href, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy! } });
  });
  await compareExample(page);
  await page.getByRole('textbox', { name: 'Why this change?', exact: true }).fill('Verify the deployed header policy with permitted local saving.');
  await page.getByRole('checkbox', { name: 'Allow local storage on this device', exact: true }).check();
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByText('Review saved on this device. No account or cloud upload.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __cspViolations: string[] }).__cspViolations)).toEqual([]);
});
