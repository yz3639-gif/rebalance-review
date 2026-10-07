/** Capture only our synthetic interface, never vendor quotes or a personal portfolio. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const url = process.env.DEMO_MEDIA_URL || 'http://127.0.0.1:4175/rebalance-review/';
const out = 'docs/media', frames = 'tmp/pulse-media-frames';
await mkdir(out, { recursive: true }); await mkdir(frames, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width:1440,height:1000 }, deviceScaleFactor:1.5, reducedMotion:'reduce' });
const page = await context.newPage();
const errors = [], forbidden = [];
page.on('pageerror', e => errors.push(e.message));
await context.route('**/*', route => {
  const target = new URL(route.request().url());
  if (target.origin !== new URL(url).origin || target.pathname.startsWith('/api/')) { forbidden.push(target.origin + target.pathname); return route.abort(); }
  return route.continue();
});
try {
  await page.goto(url);
  await page.getByTestId('transition-fee').waitFor();
  await page.waitForFunction(() => /\d.*%/.test(document.querySelector('[data-testid="active-risk"]')?.textContent || ''));
  await page.evaluate(() => document.fonts.ready);
  await page.getByTestId('pulse-chart').locator('svg').waitFor();
  await page.screenshot({path:`${out}/market-pulse.png`, fullPage:true});
  await page.getByRole('button',{name:'Inspect the transition',exact:true}).click();
  await page.screenshot({path:`${out}/transition-lab.png`, fullPage:true});
  await page.getByRole('button',{name:'Back to pulse',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(() => { const node = document.querySelector('[data-testid="pulse-chart"]'); const svg = node?.querySelector('svg'); return node && svg && Math.abs(Number(svg.getAttribute('width')) - node.clientWidth) < 2 && node.clientWidth > 0; });
  await page.screenshot({path:`${out}/market-pulse-mobile.png`,fullPage:true});
  await page.setViewportSize({width:1440,height:980});
  await page.waitForFunction(() => { const node = document.querySelector('[data-testid="pulse-chart"]'); const svg = node?.querySelector('svg'); return node && svg && Math.abs(Number(svg.getAttribute('width')) - node.clientWidth) < 2 && node.clientWidth > 0; });
  // Capture the running product itself: both the tape and synchronized quotes move.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('combobox',{name:'Replay speed',exact:true}).selectOption('2');
  await page.getByRole('button',{name:'Play replay',exact:true}).click();
  await page.getByRole('button',{name:'Rebalance Review home',exact:true}).click();
  for (let i=0; i<24; i++) {
    await page.waitForTimeout(140);
    await page.screenshot({path:`${frames}/${String(i).padStart(3,'0')}.png`});
  }
  if(errors.length || forbidden.length) throw new Error(JSON.stringify({errors,forbidden}));
  await writeFile(`${frames}/capture.json`, JSON.stringify({source:'Synthetic Market Pulse UI',frames:24,errors,forbidden,viewport:'1440x980',deviceScaleFactor:1.5},null,2)+'\n');
  console.log('Captured three synthetic screenshots and 24 unedited product frames.');
} finally { await browser.close(); }
