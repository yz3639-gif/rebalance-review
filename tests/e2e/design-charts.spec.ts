import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ viewport: { width: 1600, height: 1100 } });

async function study(page: Page) {
  await page.goto('/design/?sample=standard');
  await expect(page.getByRole('region', { name: 'Snapshot metrics', exact: true })).toBeVisible();
  await expect(page.getByTestId('history-chart').locator('svg')).toBeVisible();
}

async function clickSvgShape(shape: Locator, page: Page) {
  await shape.scrollIntoViewIfNeeded();
  const box = await shape.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

test('SVG history supports an actual range drag, date lock and complete linked tooltip', async ({ page }) => {
  await study(page);
  const chart = page.getByTestId('history-chart');
  const metrics = page.getByRole('region', { name: 'Snapshot metrics', exact: true });
  const frozenMetrics = await metrics.textContent();
  const instance = await chart.getAttribute('_echarts_instance_');
  await page.getByRole('button', { name: 'Index 100', exact: true }).click();
  await expect(chart).toHaveAttribute('data-unit', 'index');
  await expect(chart).toHaveAttribute('_echarts_instance_', instance!);
  await chart.scrollIntoViewIfNeeded();
  // Use the rendered SVG handle geometry, not ECharts internal state or actions.
  const handles = chart.locator('svg path[fill="#637893"][stroke="#8da5c5"]');
  await expect(handles).toHaveCount(2);
  const left = await handles.first().boundingBox(), right = await handles.last().boundingBox();
  expect(left).not.toBeNull(); expect(right).not.toBeNull();
  const handleX = left!.x + left!.width / 2, handleY = left!.y + left!.height / 2;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(handleX + (right!.x - left!.x) * .25, handleY, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => Number(await chart.getAttribute('data-range-start'))).toBeGreaterThan(10);
  await expect.poll(async () => Number(await chart.getAttribute('data-range-end'))).toBeGreaterThan(99);
  await expect(chart).toHaveAttribute('_echarts_instance_', instance!);
  const box = await chart.locator('svg').boundingBox();
  await page.mouse.click(box!.x + box!.width * .55, box!.y + box!.height * .25);
  await expect(chart).toHaveAttribute('data-selected-date', /^\d+$/);
  await page.mouse.move(box!.x + box!.width * .61, box!.y + box!.height * .29);
  await expect(chart).toContainText('A · Wealth');
  await expect(chart).toContainText('B · Wealth');
  await expect(chart).toContainText('B − A · Wealth');
  await expect(chart).toContainText('A · Drawdown');
  await expect(chart).toContainText('B · Drawdown');
  await page.keyboard.press('Escape');
  await expect(chart).toHaveAttribute('data-selected-date', '');
  await expect(metrics).toHaveText(frozenMetrics!);
});

test('actual signed allocation bars select the correct asset', async ({ page }) => {
  await study(page);
  await page.getByRole('button', { name: 'Holdings', exact: true }).click();
  const chart = page.getByTestId('weight-chart');
  await expect(chart.locator('svg')).toBeVisible();
  // SPY is the largest negative allocation change in the core fixture.
  const blueBars = chart.locator('svg path[fill="#7AA2FF"]');
  const candidates = await blueBars.evaluateAll(nodes => nodes.map((node, index) => ({ index, box: node.getBoundingClientRect().toJSON() })).filter(row => row.box.width > 30 && row.box.height >= 10).sort((left, right) => right.box.width - left.box.width));
  expect(candidates.length).toBeGreaterThan(0);
  await clickSvgShape(blueBars.nth(candidates[0].index), page);
  await expect(chart).toHaveAttribute('data-selected-asset', 'SPY');
  await expect(page.getByRole('complementary', { name: 'Asset inspector', exact: true })).toContainText('SPY');
  await page.keyboard.press('Escape');
  await expect(chart).toHaveAttribute('data-selected-asset', '');
});

test('actual correlation cells link a pair and risk-window controls update both charts', async ({ page }) => {
  await study(page);
  await page.getByRole('button', { name: 'Risk', exact: true }).click();
  const matrix = page.getByTestId('correlation-chart'), risk = page.getByTestId('risk-chart');
  await expect(matrix.locator('svg')).toBeVisible();
  await page.getByRole('button', { name: '126 days', exact: true }).click();
  await expect(matrix).toHaveAttribute('data-risk-window', '126');
  await expect(risk).toHaveAttribute('data-risk-window', '126');
  const cells = matrix.locator('svg path[stroke="#111a27"]');
  const candidates = await cells.evaluateAll(nodes => nodes.map((node, index) => ({ index, box: node.getBoundingClientRect().toJSON() })).filter(row => row.box.width > 15 && row.box.height > 15));
  expect(candidates.length).toBeGreaterThan(2);
  await clickSvgShape(cells.nth(candidates[1].index), page);
  await expect(matrix).toHaveAttribute('data-selected-pair', /^[A-Z]+\/[A-Z]+$/);
  const pair = (await matrix.getAttribute('data-selected-pair'))!.split('/');
  expect(pair[0]).not.toBe(pair[1]);
  await expect(page.getByRole('combobox', { name: 'First correlation asset', exact: true })).toHaveValue(pair[0]);
  await expect(page.getByRole('combobox', { name: 'Second correlation asset', exact: true })).toHaveValue(pair[1]);
  await page.keyboard.press('Escape');
  await expect(matrix).toHaveAttribute('data-selected-pair', '');
});

test('actual tested cost points select scenarios without changing frozen metrics', async ({ page }) => {
  await study(page);
  const metrics = page.getByRole('region', { name: 'Snapshot metrics', exact: true });
  const before = await metrics.textContent();
  await page.getByRole('button', { name: 'Scenarios', exact: true }).click();
  const chart = page.getByTestId('cost-chart');
  await expect(chart.locator('svg')).toBeVisible();
  const points = chart.locator('svg path[fill="#7AA2FF"][stroke="#0d1521"]');
  const candidates = await points.evaluateAll(nodes => nodes.map((node, index) => ({ index, box: node.getBoundingClientRect().toJSON() })).filter(row => row.box.width >= 5 && row.box.width < 16 && row.box.height >= 5).sort((left, right) => left.box.x - right.box.x));
  expect(candidates).toHaveLength(3); // 2, 10, 20; 5 bps starts selected.
  // ECharts changes a point's fill on pointer entry. Retain this actual SVG
  // element so the color-based locator cannot shift to the next cost point.
  // Hover first, then click the stabilized target with actionability checks;
  // a raw move/down/up can race WebKit's SVG emphasis repaint.
  const point = await points.nth(candidates[0].index).elementHandle();
  expect(point).not.toBeNull();
  await point!.hover();
  await point!.click();
  await expect(chart).toHaveAttribute('data-selected-cost', '2');
  await expect(page.getByRole('button', { name: '2 bps', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(metrics).toHaveText(before!);
});
