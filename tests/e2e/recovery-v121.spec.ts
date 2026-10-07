import { expect, test } from '@playwright/test';
import { compareExample } from './helpers';

test('chart stays available offline and a failed PDF module request retries without losing inputs',async({page},info)=>{
  await compareExample(page);
  const rationale=page.getByRole('textbox',{name:'Why this change?',exact:true});
  const reason='Preserve my reasoning after a temporary module loading failure. 保留输入。';
  await rationale.fill(reason);
  const holdings=await page.getByRole('combobox',{name:/portfolio symbol/}).evaluateAll(elements=>elements.map(element=>(element as HTMLInputElement).value));
  await page.context().setOffline(true);
  await page.getByRole('combobox',{name:'Replay rebalancing',exact:true}).selectOption('quarterly');
  await page.getByRole('button',{name:'Compare portfolios',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your review',exact:true})).toBeVisible();
  await expect(page.locator('.chart svg')).toBeVisible();
  await expect(rationale).toHaveValue(reason);
  await page.context().setOffline(false);

  let failedRequests=0,block=true;
  // Abort the first export-only module request. The former lazy chart module
  // cached its rejection forever; the dedicated PDF worker can be recreated.
  await page.context().route('**/assets/*.js',route=>{
    if(block){failedRequests++;return route.abort('failed');}
    return route.continue();
  });
  await page.getByRole('button',{name:'Download PDF report',exact:true}).click();
  await expect(page.locator('.pdf-actions [role="alert"]')).toContainText('PDF unavailable');
  expect(failedRequests).toBeGreaterThan(0);
  await expect(rationale).toHaveValue(reason);
  await expect(page.locator('.chart svg')).toBeVisible();
  expect(await page.getByRole('combobox',{name:/portfolio symbol/}).evaluateAll(elements=>elements.map(element=>(element as HTMLInputElement).value))).toEqual(holdings);
  block=false;
  const pending=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download PDF report',exact:true}).click();
  const download=await pending;
  expect(download.suggestedFilename()).toMatch(/^rebalance-review-.*\.pdf$/);
  await download.saveAs(info.outputPath('module-recovery.pdf'));
  await expect(rationale).toHaveValue(reason);
  await expect(page.locator('.pdf-actions [role="alert"]')).toHaveCount(0);
});

test('invalid local weights, duplicates and starting capital never consume an API request',async({page})=>{
  let requests=0;
  await page.route('**/api/providers/tiingo/eod',async route=>{
    requests++;await route.fulfill({status:429,json:{error:{code:'rate_limited',message:'Rate limit reached.'}}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Review my portfolio',exact:true}).click();
  await page.getByLabel('Current portfolio symbol 1',{exact:true}).fill('SPY');
  await page.getByLabel('Current portfolio weight 1',{exact:true}).fill('90');
  await page.getByRole('button',{name:'Copy A to B',exact:true}).click();
  await page.getByRole('combobox',{name:'Price data connection',exact:true}).selectOption('tiingo');
  await page.getByLabel('Tiingo API token',{exact:true}).fill('LOCAL_VALIDATION_FAKE_TEST_KEY');
  await page.getByRole('checkbox',{name:'I may access this API for my own portfolio review',exact:true}).check();
  await page.getByRole('button',{name:'Use these API settings',exact:true}).click();
  const compare=page.getByRole('button',{name:'Compare portfolios',exact:true});
  await compare.click();await expect(page.getByRole('alert')).toContainText('weights must sum to 100%');
  expect(requests).toBe(0);
  await page.getByLabel('Current portfolio weight 1',{exact:true}).fill('100');
  await page.getByLabel('Proposed portfolio weight 1',{exact:true}).fill('100');
  await page.locator('.portfolio-editor.a').getByRole('button',{name:'+ Add holding',exact:true}).click();
  await page.getByLabel('Current portfolio symbol 2',{exact:true}).fill('SPY');
  await compare.click();await expect(page.getByRole('alert')).toContainText('Duplicate holding');expect(requests).toBe(0);
  await page.locator('.portfolio-editor.a .holding-row').nth(1).getByRole('button').click();
  await page.getByLabel('Hypothetical starting USD',{exact:true}).fill('0');
  await compare.click();await expect(page.getByRole('alert')).toContainText('Invalid review settings');expect(requests).toBe(0);
  await page.getByLabel('Hypothetical starting USD',{exact:true}).fill('10000');
  await compare.click();await expect(page.getByRole('alert')).toContainText('limit was reached');expect(requests).toBe(1);
  await expect(page.getByLabel('Current portfolio weight 1',{exact:true})).toHaveValue('100');
  await expect(page.getByLabel('Tiingo API token',{exact:true})).toHaveValue('LOCAL_VALIDATION_FAKE_TEST_KEY');
});
