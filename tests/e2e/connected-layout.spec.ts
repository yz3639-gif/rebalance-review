import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Actual connected forms + calculated result, rather than the isolated sample-only shell.
test('connected editor and five analytical views remain accessible at desktop and narrow sizes', async ({ page }, info) => {
  test.setTimeout(90_000);
  const output = join('verification','connected-screenshots',info.project.name);
  await mkdir(output,{recursive:true});
  await page.goto('/design/');
  for (const width of [1440,1280,390,320]) {
    await page.setViewportSize({width,height:width>1000?900:844});
    await page.getByRole('combobox',{name:'Current portfolio symbol 1',exact:true}).fill('');
    await page.getByRole('combobox',{name:'Current portfolio symbol 1',exact:true}).fill('SOXL');
    await expect(page.getByRole('option',{name:/^SOXL /})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({path:join(output,`editor-${width}.png`)});
    await page.getByRole('combobox',{name:'Current portfolio symbol 1',exact:true}).press('Escape');
  }
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('combobox',{name:'Example scenario',exact:true}).selectOption('stocks-bonds');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Load example',exact:true}).click();
  await page.getByRole('button',{name:'Compare portfolios',exact:true}).click();
  await expect(page.getByRole('region',{name:'Snapshot metrics',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Report',exact:true}).click();
  await page.getByRole('textbox',{name:'Why this change?',exact:true}).fill('比较组合结构，保留明确的方法和假设。 Synthetic QA example; no actual market performance claim.');
  await page.getByLabel('Next review date',{exact:true}).fill('2099-01-01');
  for (const width of [1440,1280,390,320]) {
    await page.setViewportSize({width,height:width>1000?900:844});
    for (const view of ['Overview','Holdings','Risk','Scenarios','Report']) {
      await page.getByRole('button',{name:view,exact:true}).click();
      if(view==='Overview') await expect(page.getByTestId('history-chart').locator('svg')).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({path:join(output,`${view.toLowerCase()}-${width}.png`)});
      if(width===1440||width===390) {
        const accessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
        expect(accessibility.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
      }
    }
  }
});
