import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // CI exercises deliberate external-widget failure without relying on an internet connection.
  await page.route(/^https:\/\//, route => route.abort('blockedbyclient'));
});

async function openPulse(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('market-pulse')).toBeVisible();
  await expect(page.getByTestId('pulse-chart').locator('svg')).toBeVisible();
}
async function navigate(page: Page, name: 'Market Pulse' | 'Rebalance' | 'Research') {
  await page.getByRole('navigation', { name: 'Demo workspace' }).getByRole('button', { name, exact: name !== 'Research' }).click();
}
async function metric(page: Page, id: string) {
  return Number((await page.getByTestId(id).innerText()).replace(/[^\d.-]/g, ''));
}
async function expectNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
}

test('the 50-ETF replay selects SOXL, filters groups, sorts and exposes exact chart data', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', request => { if (request.url().startsWith('https:')) externalRequests.push(request.url()); });
  await openPulse(page);
  const watch = page.getByRole('region', { name: 'ETF watchlist', exact: true });
  await expect(watch.locator('.mp-watch-row')).toHaveCount(50);
  await page.getByRole('searchbox', { name: 'Search 50 ETFs' }).fill('SOXL');
  await expect(watch.locator('.mp-watch-row')).toHaveCount(1);
  await watch.locator('.mp-watch-row').click();
  await expect(page.getByTestId('selected-ticker')).toContainText('SOXL');
  await expect(page.getByTestId('pulse-chart')).toHaveAttribute('aria-label', /SOXL synthetic/);
  await page.getByRole('region', { name: 'Selected asset chart', exact: true }).getByRole('button', { name: 'Data', exact: true }).click();
  const data = page.getByRole('region', { name: 'Session data', exact: true });
  await expect(data.locator('tbody tr')).toHaveCount(128);
  await expect(data.locator('tbody tr').first().locator('td').first()).toHaveText('10:33:30');
  const lastPrice = await data.locator('tbody tr').first().locator('td').nth(1).innerText();
  await expect(page.locator('.mp-chart-price > strong')).toContainText(lastPrice);
  await page.keyboard.press('Escape');
  await expect(data).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search 50 ETFs' }).fill('');
  await page.getByRole('combobox', { name: 'Asset group', exact: true }).selectOption('Fixed income');
  await expect(watch.locator('.mp-watch-row')).toHaveCount(7);
  await page.getByRole('button', { name: 'Sort by session change', exact: true }).click();
  const changes = (await watch.locator('.mp-quote-values small').allTextContents()).map(text => Number(text.replace('−', '-').replace('%', '')));
  expect(changes).toEqual([...changes].sort((a, b) => b - a));
  await page.getByRole('searchbox', { name: 'Search 50 ETFs' }).fill('no-such-ETF');
  await expect(watch.getByText('No matching ETF.', { exact: true })).toBeVisible();
  await watch.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(watch.locator('.mp-watch-row')).toHaveCount(50);
  expect(externalRequests).toEqual([]);
  const storage = await page.evaluate(async () => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), databases: await indexedDB.databases() }));
  expect(storage).toEqual({ local: [], session: [], databases: [] });
});

test('reduced motion starts paused; play, pause, seek, speed and reset control one clock', async ({ page }) => {
  await openPulse(page);
  const pulse = page.getByTestId('market-pulse');
  await expect(pulse).toHaveAttribute('data-step', '0');
  await expect(page.getByRole('button', { name: 'Play replay', exact: true })).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(pulse).toHaveAttribute('data-step', '0');
  await page.getByRole('button', { name: 'Play replay', exact: true }).click();
  await expect.poll(async () => Number(await pulse.getAttribute('data-step'))).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause replay', exact: true }).click();
  const pausedStep = await pulse.getAttribute('data-step');
  await page.waitForTimeout(1200);
  await expect(pulse).toHaveAttribute('data-step', pausedStep!);
  const scrubber = page.getByRole('slider', { name: 'Replay position', exact: true });
  await scrubber.focus(); await scrubber.press('End');
  await expect(pulse).toHaveAttribute('data-step', '653');
  await expect(page.getByRole('region', { name: 'Replay controls', exact: true })).toContainText('SESSION COMPLETE');
  await expect(page.locator('.mp-session-clock b')).toHaveText('16:00:00');
  await scrubber.press('Home'); await scrubber.press('ArrowRight');
  await expect(pulse).toHaveAttribute('data-step', '1');
  await expect(page.locator('.mp-session-clock b')).toHaveText('10:34:00');
  await page.getByRole('combobox', { name: 'Replay speed', exact: true }).selectOption('4');
  await page.getByRole('button', { name: 'Play replay', exact: true }).click();
  await expect.poll(async () => Number(await pulse.getAttribute('data-step'))).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Reset replay and view', exact: true }).click();
  await expect(pulse).toHaveAttribute('data-step', '0');
  await expect(page.getByRole('combobox', { name: 'Replay speed', exact: true })).toHaveValue('1');
  await expect(page.getByTestId('selected-ticker')).toContainText('SPY');
  await expect(page.getByRole('button', { name: 'Play replay', exact: true })).toBeVisible();
});

test('the unchanged target has no trades, fees or active risk; expanded controls remain applied in compact view', async ({ page }) => {
  await openPulse(page);
  await expect(page.getByTestId('transition-fee')).toBeVisible();
  await page.getByRole('combobox', { name: 'Target allocation', exact: true }).selectOption('unchanged');
  await expect(page.getByTestId('transition-gross')).toHaveText('$0');
  await expect(page.getByTestId('transition-fee')).toHaveText('$0.00');
  await expect(page.getByTestId('active-risk')).toHaveText('0.00%');
  await page.getByRole('button', { name: 'Inspect the transition', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Rebalance workbench', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Target allocation', exact: true })).toHaveValue('unchanged');
  await page.getByRole('combobox', { name: 'Transition cost', exact: true }).selectOption('20');
  await page.getByRole('combobox', { name: 'Account value', exact: true }).selectOption('250000');
  await expect(page.getByTestId('transition-fee')).toHaveText('$0.00');
  await page.getByRole('combobox', { name: 'Target allocation', exact: true }).selectOption('defensive');
  expect(await metric(page, 'transition-fee')).toBeGreaterThan(0);
  expect(await metric(page, 'active-risk')).toBeGreaterThan(0);
  await page.getByRole('combobox', { name: 'Active risk window', exact: true }).selectOption('504');
  const fee = await page.getByTestId('transition-fee').innerText();
  const risk = await page.getByTestId('active-risk').innerText();
  await navigate(page, 'Market Pulse');
  await expect(page.getByRole('region', { name: 'Rebalance summary', exact: true })).toContainText('$250,000 example · 504-session synthetic covariance');
  await expect(page.getByTestId('transition-fee')).toHaveText(fee);
  await expect(page.getByTestId('active-risk')).toHaveText(risk);
  await navigate(page, 'Rebalance');
  await expect(page.getByRole('combobox', { name: 'Transition cost', exact: true })).toHaveValue('20');
  await expect(page.getByRole('combobox', { name: 'Account value', exact: true })).toHaveValue('250000');
  await expect(page.getByRole('combobox', { name: 'Active risk window', exact: true })).toHaveValue('504');
  await page.getByRole('combobox', { name: 'Transition cost', exact: true }).selectOption('0');
  await expect(page.getByTestId('transition-fee')).toHaveText('$0.00');
  await expect(page.getByTestId('active-risk')).toHaveText(risk);
});

test('account value scales one-time fees while display quotes never change the frozen transition', async ({ page }) => {
  await openPulse(page);
  await navigate(page, 'Rebalance');
  await page.getByRole('combobox', { name: 'Account value', exact: true }).selectOption('25000');
  const smallFee = await metric(page, 'transition-fee');
  await page.getByRole('combobox', { name: 'Account value', exact: true }).selectOption('250000');
  expect(Math.abs(await metric(page, 'transition-fee') - smallFee * 10)).toBeLessThanOrEqual(.06);
  const fee = await page.getByTestId('transition-fee').innerText();
  const risk = await page.getByTestId('active-risk').innerText();
  await navigate(page, 'Market Pulse');
  const scrubber = page.getByRole('slider', { name: 'Replay position', exact: true });
  await scrubber.focus(); await scrubber.press('End');
  await expect(page.getByTestId('transition-fee')).toHaveText(fee);
  await expect(page.getByTestId('active-risk')).toHaveText(risk);
  await navigate(page, 'Research');
  await expect(page.getByRole('region', { name: 'Snapshot metrics', exact: true })).toBeVisible();
  const original = await page.getByRole('region', { name: 'Snapshot metrics', exact: true }).textContent();
  await page.getByRole('button', { name: 'Market Pulse', exact: true }).click();
  await page.getByRole('button', { name: 'Reset replay and view', exact: true }).click();
  await navigate(page, 'Research');
  await expect(page.getByRole('region', { name: 'Snapshot metrics', exact: true })).toHaveText(original!);
});

test('external market widgets fail clearly offline, retry and return to the working replay', async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', request => { if (/s3\.tradingview\.com\/external-embedding/.test(request.url())) scripts.push(request.url()); });
  await openPulse(page);
  expect(scripts).toEqual([]);
  await page.getByRole('group', { name: 'Data mode', exact: true }).getByRole('button', { name: 'Market', exact: true }).click();
  await expect(page.getByLabel('Synthetic ticker strip', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'External market explorer', exact: true })).toBeVisible();
  const chart = page.locator('.mp-tv-widget--advanced-chart');
  await expect(chart).toHaveAttribute('data-widget-state', 'unavailable');
  await expect(chart).toContainText('The market view could not load.');
  await expect(chart.getByRole('link', { name: 'Open on TradingView' })).toHaveAttribute('href', /symbol=AMEX%3ASPY/);
  const attempts = scripts.filter(url => url.includes('advanced-chart')).length;
  await chart.getByRole('button', { name: 'Retry chart', exact: true }).click();
  await expect.poll(() => scripts.filter(url => url.includes('advanced-chart')).length).toBeGreaterThan(attempts);
  await expect(chart).toHaveAttribute('data-widget-state', 'unavailable');
  await page.getByRole('group', { name: 'Choose market chart symbol', exact: true }).getByRole('button', { name: 'SOXL', exact: true }).click();
  await expect(chart.getByRole('link', { name: 'Open on TradingView' })).toHaveAttribute('href', /symbol=AMEX%3ASOXL/);
  const search = page.getByRole('searchbox', { name: 'Search 50 market ETFs', exact: true });
  await search.fill('IGV');
  await expect(page.getByRole('list', { name: 'Market ETF search results' })).toContainText('CBOE:IGV');
  await search.press('Enter');
  await expect(chart.getByRole('link', { name: 'Open on TradingView' })).toHaveAttribute('href', /symbol=CBOE%3AIGV/);
  await search.fill('no-such-ETF');
  await expect(page.getByText(/No matching ETF in this 50-asset demo/)).toBeVisible();
  await expect(chart.getByRole('link', { name: 'Open on TradingView' })).toHaveAttribute('href', /symbol=CBOE%3AIGV/);
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await page.getByRole('group', { name: 'Choose market chart symbol', exact: true }).getByRole('button', { name: 'SOXL', exact: true }).click();
  await page.getByRole('button', { name: 'Return to the interactive replay' }).click();
  await expect(page.getByTestId('selected-ticker')).toContainText('SOXL');
  await expect(page.getByTestId('pulse-chart').locator('svg')).toBeVisible();
  await expect(page.getByRole('region', { name: 'External market explorer', exact: true })).toHaveCount(0);
});

test('historical inspection matches the locked price and return; cash and active-risk directions remain signed', async ({ page }) => {
  await openPulse(page);
  const headline = page.locator('.mp-chart-price > strong');
  const latestPrice = await headline.innerText();
  const priorClose = Number((await page.locator('.mp-chart-data > span').filter({ hasText: 'Prior close' }).locator('b').innerText()).replace(/,/g, ''));
  await page.getByRole('region', { name: 'Selected asset chart', exact: true }).getByRole('button', { name: 'Data', exact: true }).click();
  const data = page.getByRole('region', { name: 'Session data', exact: true });
  const earliestRow = data.locator('tbody tr').last();
  const earlierTime = await earliestRow.getByRole('button').innerText();
  const earlierPriceText = await earliestRow.locator('td').nth(1).innerText();
  const earlierChange = (Number(earlierPriceText.replace(/,/g, '')) / priorClose - 1) * 100;
  const expectedChange = `${earlierChange < 0 ? '−' : '+'}${Math.abs(earlierChange).toFixed(2)}%`;
  await earliestRow.getByRole('button').click();
  await expect(headline).toContainText(earlierPriceText);
  await expect(page.locator('.mp-chart-price > span')).toContainText(expectedChange);
  await expect(page.locator('.mp-chart-toolbar')).toContainText(`Locked ${earlierTime} ET`);
  await expect(page.getByRole('button', { name: 'Play replay', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(headline).toHaveText(latestPrice);
  await navigate(page, 'Rebalance');
  await expect(page.getByTestId('active-risk')).toBeVisible();
  const cash = page.locator('.mp-trade-table tbody tr').filter({ hasText: 'CASH' });
  await expect(cash.locator('td').nth(2)).toContainText('Cash −');
  // GLD offsets active risk in the fixed core sample, and its bar must extend left of zero.
  for (const [symbol, negative] of [['GLD', true], ['SPY', false]] as const) {
    const row = page.locator('.mp-risk-row').filter({ hasText: symbol });
    await expect(row.locator('span')).toHaveText(negative ? /^−[\d.]+ pp$/ : /^\+[\d.]+ pp$/);
    const track = await row.locator(':scope > div').boundingBox();
    const bar = await row.locator('i').boundingBox();
    expect(track).not.toBeNull(); expect(bar).not.toBeNull();
    const zero = track!.x + track!.width / 2;
    expect(bar!.width).toBeGreaterThan(0);
    if (negative) {
      expect(bar!.x).toBeLessThan(zero);
      expect(Math.abs(bar!.x + bar!.width - zero)).toBeLessThan(.6);
    } else {
      expect(Math.abs(bar!.x - zero)).toBeLessThan(.6);
      expect(bar!.x + bar!.width).toBeGreaterThan(zero);
    }
  }
  await page.getByRole('combobox', { name: 'Target allocation', exact: true }).selectOption('defensive');
  await expect(cash.locator('td').nth(2)).toContainText('Cash +');
});

test('the pulse and transition remain usable without page overflow at 320, 390, 1280 and 1440 pixels', async ({ page }) => {
  await openPulse(page);
  await expect(page.getByTestId('transition-fee')).toBeVisible();
  for (const width of [320, 390, 1280, 1440]) {
    await page.setViewportSize({ width, height: width < 400 ? 844 : 900 });
    await expectNoOverflow(page);
    await expect(page.getByRole('searchbox', { name: 'Search 50 ETFs' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play replay', exact: true })).toBeVisible();
    await navigate(page, 'Rebalance');
    await expectNoOverflow(page);
    await expect(page.getByRole('combobox', { name: 'Target allocation', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Transition cost', exact: true })).toBeVisible();
    await navigate(page, 'Market Pulse');
  }
});
