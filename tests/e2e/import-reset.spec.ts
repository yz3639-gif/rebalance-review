import {test,expect} from '@playwright/test';
import {importOwnPortfolios,importOwnPrices,syntheticMarketCsv} from './helpers';

test('new price file and paste invalidate prior source, permissions and comparison',async({page})=>{
 await importOwnPortfolios(page);await importOwnPrices(page,syntheticMarketCsv(),true);
 await expect(page.getByText('Market data ready',{exact:true})).toBeVisible();
 await page.getByLabel('Market prices CSV file',{exact:true}).setInputFiles({name:'second.csv',mimeType:'text/csv',buffer:Buffer.from(syntheticMarketCsv())});
 await expect(page.getByLabel('Data source',{exact:true})).toHaveValue('');
 await expect(page.getByLabel('All prices are in USD and use the selected adjusted-price basis',{exact:true})).not.toBeChecked();
 await expect(page.getByLabel('I have permission to store and export this file and its derived results on my device',{exact:true})).not.toBeChecked();
 await expect(page.getByText('Missing market data',{exact:true})).toBeVisible();
 await importOwnPrices(page,syntheticMarketCsv(),true);
 await page.getByRole('textbox',{name:'Market prices CSV',exact:true}).fill(syntheticMarketCsv(520));
 await expect(page.getByLabel('Data source',{exact:true})).toHaveValue('');
 await expect(page.getByText('Missing market data',{exact:true})).toBeVisible();
});

test('start fresh resets raw forms, settings and authorizations',async({page})=>{
 await importOwnPortfolios(page);await importOwnPrices(page,syntheticMarketCsv(),true);
 await page.getByRole('combobox',{name:'Replay rebalancing',exact:true}).selectOption('quarterly');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Start fresh',exact:true}).click();
 await page.getByRole('combobox',{name:'Price data connection',exact:true}).selectOption('csv');
 await page.locator('summary').filter({hasText:'Import holdings'}).click();
 await expect(page.getByRole('textbox',{name:'Holdings table',exact:true})).toHaveValue('');
 await page.locator('summary').filter({hasText:'Import price history'}).click();
 await expect(page.getByRole('textbox',{name:'Market prices CSV',exact:true})).toHaveValue('');
 await expect(page.getByLabel('Data source',{exact:true})).toHaveValue('');
 await expect(page.getByRole('combobox',{name:'Replay rebalancing',exact:true})).toHaveValue('monthly');
 await expect(page.getByLabel('I have permission to store and export this file and its derived results on my device',{exact:true})).not.toBeChecked();
});

test('late file read cannot undo paste or start fresh',async({page})=>{
 await page.addInitScript(()=>{const original=File.prototype.text;File.prototype.text=async function(){if(this.name==='slow.csv')await new Promise(r=>setTimeout(r,700));return original.call(this);};});
 await importOwnPortfolios(page);
 await page.locator('summary').filter({hasText:'Import price history'}).click();
 await page.getByLabel('Market prices CSV file',{exact:true}).setInputFiles({name:'slow.csv',mimeType:'text/csv',buffer:Buffer.from('old,data\n1,2')});
 await page.getByRole('textbox',{name:'Market prices CSV',exact:true}).fill('new,data\n3,4');
 await page.waitForTimeout(900);
 await expect(page.getByRole('textbox',{name:'Market prices CSV',exact:true})).toHaveValue('new,data\n3,4');
 await page.getByLabel('Market prices CSV file',{exact:true}).setInputFiles({name:'slow.csv',mimeType:'text/csv',buffer:Buffer.from('old,data\n1,2')});
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Start fresh',exact:true}).click();
 await page.getByRole('combobox',{name:'Price data connection',exact:true}).selectOption('csv');
 await page.waitForTimeout(900);
 await page.locator('summary').filter({hasText:'Import price history'}).click();
 await expect(page.getByRole('textbox',{name:'Market prices CSV',exact:true})).toHaveValue('');
});

test('own-input cash-only review needs no price file and exports v2',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Review my portfolio',exact:true}).click();
 await page.getByLabel('Current portfolio symbol 1',{exact:true}).fill('CASH');await page.getByLabel('Current portfolio weight 1',{exact:true}).fill('100');
 await page.getByRole('button',{name:'Copy A to B'}).click();
 await expect(page.getByText('Cash-only replay period',{exact:true})).toBeVisible();
 await page.getByLabel('I understand cash earns 0% in this replay',{exact:true}).check();
 await page.getByRole('button',{name:'Compare portfolios',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your review',exact:true})).toBeVisible();
 await expect(page.getByText('Zero-volatility portfolios have no defined relative risk contributions.',{exact:false})).toBeVisible();
 await page.getByLabel('Why this change?',{exact:true}).fill('保留现金并在下个月复查。');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export review',exact:true}).click();const file=await download;const stream=await file.createReadStream();const chunks=[];for await (const chunk of stream!)chunks.push(chunk);const json=JSON.parse(Buffer.concat(chunks).toString());expect(json.schemaVersion).toBe(2);expect(json.manifest.basis).toBe('cash_zero');expect(json.result.history.a.totalReturn).toBe(0);
});
