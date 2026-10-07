/** Capture the real, synthetic-only public demo. Never use a personal review URL. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.DEMO_MEDIA_URL || 'http://127.0.0.1:8790/rebalance-review/';
const out = 'docs/media';
const frames = 'tmp/demo-media-frames';
await mkdir(out, { recursive: true });
await mkdir(frames, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1.5, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [], forbidden = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/*', route => {
  const target = new URL(route.request().url());
  if (target.origin !== new URL(url).origin || target.pathname.startsWith('/api/')) {
    forbidden.push(target.origin + target.pathname);
    return route.abort();
  }
  return route.continue();
});
const pause = () => page.waitForTimeout(220); // Allow visible layout/selection transitions to settle for capture.
const button = name => page.getByRole('button', { name, exact: true });
let sequence = 0;
const frame = async () => {
  await pause();
  await page.screenshot({ path: `${frames}/${String(sequence++).padStart(3, '0')}.png` });
};
try {
  await page.goto(url);
  await page.getByRole('region', { name: 'Snapshot metrics', exact: true }).waitFor();
  await page.getByText('DETERMINISTIC SYNTHETIC DATA', { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.getByTestId('history-chart').locator('svg').waitFor();
  await pause();
  await page.screenshot({ path: `${out}/terminal-overview.png`, fullPage: true });

  await button('Holdings').click();
  await page.getByRole('table', { name: 'Holdings comparison', exact: true }).getByRole('button', { name: 'SPY', exact: true }).click();
  await page.setViewportSize({ width: 1600, height: 1360 });
  await pause();
  await page.screenshot({ path: `${out}/terminal-holdings.png`, fullPage: true });

  await page.keyboard.press('Escape');
  await button('Risk').click();
  await button('504 days').click();
  await page.setViewportSize({ width: 1600, height: 1660 });
  await page.getByTestId('correlation-chart').locator('svg').waitFor();
  await page.getByRole('combobox', { name: 'First correlation asset', exact: true }).selectOption('SPY');
  await page.getByRole('combobox', { name: 'Second correlation asset', exact: true }).selectOption('GLD');
  await button('Inspect pair').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await pause();
  await page.screenshot({ path: `${out}/terminal-risk.png`, fullPage: true });

  await page.setViewportSize({ width: 1440, height: 980 });
  await button('Overview').click();
  await button('Reset view').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await frame();
  await button('Index 100').click(); await frame();
  await button('1Y').click(); await frame();
  const chart = await page.getByTestId('history-chart').boundingBox();
  for (const fraction of [.28, .42, .56, .7, .82]) {
    await page.mouse.move(chart.x + chart.width * fraction, chart.y + chart.height * .3);
    await frame();
  }
  await page.mouse.click(chart.x + chart.width * .7, chart.y + chart.height * .3); await frame();
  await button('Holdings').click();
  await page.getByRole('table', { name: 'Holdings comparison', exact: true }).getByRole('button', { name: 'SPY', exact: true }).click(); await frame();
  await button('Risk').click(); await button('126 days').click(); await frame();
  await button('504 days').click(); await frame();
  await button('Scenarios').click(); await button('20 bps').click(); await frame();
  await page.getByRole('checkbox', { name: 'Extra one-session delay', exact: true }).check(); await frame();
  await button('Overview').click(); await button('Reset view').click(); await frame();
  if (errors.length || forbidden.length) throw new Error(JSON.stringify({ errors, forbidden }));
  await writeFile(`${frames}/capture.json`, JSON.stringify({ source: 'Running public demo; deterministic synthetic fixtures only', screenshots: 3, frames: sequence, pageErrors: errors, forbiddenRequests: forbidden }, null, 2) + '\n');
  console.log(`Captured 3 screenshots and ${sequence} interaction frames. No market requests or personal data.`);
} finally {
  await browser.close();
}
