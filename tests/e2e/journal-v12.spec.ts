import { readFile } from 'node:fs/promises';
import { expect,test,type Page } from '@playwright/test';
import { compareExample } from './helpers';

async function saveExample(page:Page) {
  await compareExample(page);
  await page.getByRole('textbox',{name:'Why this change?',exact:true}).fill('Keep this valid journal review available.');
  await page.getByLabel('Next review date',{exact:true}).fill('2099-01-01');
  await page.getByRole('checkbox',{name:'Allow local storage on this device',exact:true}).check();
  await page.getByRole('button',{name:'Save review',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Review saved on this device.'})).toBeVisible();
}
async function readStores(page:Page) {
  return page.evaluate(async()=>new Promise<{reviews:any[];drafts:any[]}>((resolve,reject)=>{
    const open=indexedDB.open('rebalance-review-v1');open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{const db=open.result,tx=db.transaction(['reviews','drafts'],'readonly');const reviews=tx.objectStore('reviews').getAll(),drafts=tx.objectStore('drafts').getAll();tx.oncomplete=()=>{db.close();resolve({reviews:reviews.result,drafts:drafts.result});};tx.onerror=()=>{db.close();reject(tx.error);};};
  }));
}

test('journal isolates corrupt and unindexed rows and deletes only the chosen damaged record',async({page})=>{
  await saveExample(page);
  await page.evaluate(async()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open('rebalance-review-v1');open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{const db=open.result,tx=db.transaction('reviews','readwrite'),store=tx.objectStore('reviews'),get=store.getAll();get.onsuccess=()=>{const bad=structuredClone(get.result[0]);bad.id='damaged-nav';delete bad.createdAt;bad.result.history.a.maxDrawdown=-.2;store.put(bad);store.put({id:'missing-fields'});};tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};};
  }));
  await page.getByRole('button',{name:/^Saved reviews/}).click();
  await expect(page.locator('.journal-card')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'Some saved reviews need attention',exact:true})).toBeVisible();
  await expect(page.locator('.damaged-record')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Recover inputs only',exact:true})).toHaveCount(1);
  expect((await readStores(page)).reviews).toHaveLength(3);
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('button',{name:'Delete damaged record',exact:true}).first().click();
  expect((await readStores(page)).reviews).toHaveLength(3);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Delete damaged record',exact:true}).first().click();
  await expect(page.locator('.damaged-record')).toHaveCount(1);
  expect((await readStores(page)).reviews).toHaveLength(2);
  await page.getByRole('button',{name:'View old report',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Archived review',exact:true})).toBeVisible();
});

test('opt-in input draft excludes secrets and results, restores explicitly, and clears independently from journal',async({page})=>{
  await saveExample(page);
  await page.getByRole('checkbox',{name:'Save input draft on this device',exact:true}).check();
  await expect(page.getByRole('status').filter({hasText:'Input draft saved locally.'})).toBeVisible();
  await page.getByRole('combobox',{name:'Price data connection',exact:true}).selectOption('tiingo');
  await page.getByLabel('Tiingo API token',{exact:true}).fill('DRAFT_TEST_SECRET_NEVER_STORE');
  const stored=await readStores(page);expect(stored.reviews).toHaveLength(1);expect(stored.drafts).toHaveLength(1);
  const draft=stored.drafts[0];
  expect(Object.keys(draft).sort()).toEqual(['a','b','cashPeriod','id','nextReview','rationale','schemaVersion','settings','updatedAt']);
  const text=JSON.stringify(draft);for(const forbidden of ['DRAFT_TEST_SECRET','dataset','prices','manifest','risk','covariance','rights','apiKey'])expect(text).not.toContain(forbidden);
  expect(draft.settings.partialCoverageConfirmed).toBe(false);expect(draft.settings.cashReturnConfirmed).toBe(false);
  await page.reload();await page.getByRole('button',{name:'Review my portfolio',exact:true}).click();
  await page.getByRole('checkbox',{name:'Save input draft on this device',exact:true}).check();
  await expect(page.getByRole('button',{name:'Restore input draft',exact:true})).toBeVisible();
  await expect(page.getByLabel('Current portfolio symbol 1',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'Restore input draft',exact:true}).click();
  await expect(page.getByLabel('Current portfolio symbol 1',{exact:true})).toHaveValue(draft.a.holdings[0].symbol);
  await expect(page.getByRole('heading',{name:'Your review',exact:true})).toHaveCount(0);
  await expect(page.getByRole('checkbox',{name:'I understand cash earns 0% in this replay',exact:true})).not.toBeChecked();
  await page.getByRole('button',{name:'Clear input draft',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Input draft cleared.'})).toBeVisible();
  const after=await readStores(page);expect(after.drafts).toHaveLength(0);expect(after.reviews).toHaveLength(1);
});

test('v1 archive exports JSON and PDF with historical dates and prints independently of current result',async({page},info)=>{
  await saveExample(page);
  const stored=await readStores(page),old=stored.reviews[0];old.schemaVersion=1;old.createdAt='2026-10-01T12:00:00.000Z';old.nextReview='2026-10-02';old.rationale='Historical reasoning remains attached to the old report.';delete old.versions;delete old.catalog;
  await page.getByRole('button',{name:/^Saved reviews/}).click();
  await page.getByLabel('Import archive',{exact:true}).setInputFiles({name:'old-v1.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(old))});
  const archive=page.locator('.archive');await expect(archive.getByRole('heading',{name:'Archived review',exact:true})).toBeVisible();
  const jsonPending=page.waitForEvent('download');await archive.getByRole('button',{name:'Export review',exact:true}).click();const json=await jsonPending,jsonPath=info.outputPath('historical-v1.json');await json.saveAs(jsonPath);const exported=JSON.parse(await readFile(jsonPath,'utf8'));
  expect(exported.schemaVersion).toBe(1);expect(exported.createdAt).toBe(old.createdAt);expect(exported.nextReview).toBe(old.nextReview);expect(exported.result.history).toEqual(old.result.history);
  const pdfPending=page.waitForEvent('download');await archive.getByRole('button',{name:'Download PDF report',exact:true}).click();const pdf=await pdfPending,pdfPath=info.outputPath('historical-v1.pdf');await pdf.saveAs(pdfPath);
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(await readFile(pdfPath)),useSystemFonts:true,isEvalSupported:false});const doc=await task.promise;let text='';for(let i=1;i<=doc.numPages;i++){const content=await(await doc.getPage(i)).getTextContent();text+=content.items.map(item=>'str'in item?item.str:'').join(' ');}await task.destroy();
  expect(text).toContain(old.createdAt);expect(text).toContain(old.nextReview);expect(text).toContain(old.rationale);
  await expect(archive.locator('.chart svg')).toBeVisible();
  await page.evaluate(()=>{window.print=()=>window.dispatchEvent(new Event('beforeprint'));});
  await archive.getByRole('button',{name:'Print report',exact:true}).click();await page.emulateMedia({media:'print'});
  await expect(archive.locator('.print-context')).toBeVisible();await expect(page.locator('.current-review')).toBeHidden();
  await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('.current-review')).toBeVisible();
  await info.attach('historical-v1-report',{path:pdfPath,contentType:'application/pdf'});
});
