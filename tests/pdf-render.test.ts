import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdir,writeFile } from 'node:fs/promises';
import { Font, renderToBuffer } from '@react-pdf/renderer';
import PdfDocument from '../src/pdf/Document';
import { createPdfSnapshot, PDF_REPORT_VERSION } from '../src/pdf/model';
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';
import { createSyntheticDemo, SUPPORTED_SYMBOLS, MAX_REVIEW_ASSETS } from '../src/data';
import { computeReview } from '../src/engine';

// PDF.js uses bottom-left coordinates. Keep content between the existing 48 pt
// footer/body boundary and the 48 pt header/body boundary; never strip strings
// from the rationale merely because they resemble a title or version number.
function pageBodyText(content:TextContent,pageHeight:number,id:string,pageNumber:number,totalPages:number) {
  const items=content.items.filter((item):item is TextItem=>'str' in item);
  const header=items.filter(item=>item.transform[5]>=pageHeight-48).map(item=>item.str).join(' ');
  const footer=items.filter(item=>item.transform[5]<=48).map(item=>item.str).join(' ');
  expect(header,`page ${pageNumber} running header`).toContain('REBALANCE REVIEW');
  expect(footer,`page ${pageNumber} running footer`).toContain(`${id} | Report ${PDF_REPORT_VERSION}`);
  expect(footer,`page ${pageNumber} page count`).toContain(`${pageNumber} / ${totalPages}`);
  return items.filter(item=>item.transform[5]>48&&item.transform[5]<pageHeight-48).map(item=>item.str).join(' ');
}

it('renders the dedicated PDF document with an embedded static Chinese font', async () => {
  Font.register({ family: 'RebalanceSansSC', src: fileURLToPath(new URL('../public/fonts/RebalanceSansSC-Regular.ttf', import.meta.url)) });
  const d = createSyntheticDemo({ observations: 530 });
  const spec = { ...d, frequency: 'monthly' as const, costBps: 5, initialNav: 10000, cashReturnConfirmed: true, partialCoverageConfirmed: false };
  const { dataset, ...context } = spec;
  context.a.name = 'Current';
  const snapshot = createPdfSnapshot({ context: { ...context, manifest: dataset.manifest }, result: computeReview(spec), rationale: '降低集中度，同时保留长期投资计划。', nextReview: '2099-01-01' });
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
  const bytes = await renderToBuffer(PdfDocument({ snapshot, chartPng: png }));
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(1000);
}, 20000);

it('paginates 50 ETFs plus cash and 5000 Chinese characters without losing text or crossing page margins',async()=>{
  Font.register({family:'RebalanceSansSC',src:fileURLToPath(new URL('../public/fonts/RebalanceSansSC-Regular.ttf',import.meta.url))});
  const d=createSyntheticDemo({observations:530}),symbols=SUPPORTED_SYMBOLS.slice(0,MAX_REVIEW_ASSETS);
  d.dataset.prices=d.dataset.prices.map((row,i)=>symbols.map((_,j)=>row[j%row.length]*(1+.000001*j*i)));
  d.dataset.symbols=[...symbols];
  d.dataset.manifest.acquisition={requestedStart:'2024-01-01',requestedEnd:d.dataset.dates.at(-1)!,assets:symbols.map(symbol=>({symbol,firstDate:d.dataset.dates[0],lastDate:d.dataset.dates.at(-1)!,observations:d.dataset.dates.length}))};
  d.a.holdings=symbols.map(symbol=>({symbol,weight:.99/MAX_REVIEW_ASSETS}));d.a.holdings.push({symbol:'CASH',weight:.01});d.b=structuredClone(d.a);d.b.id='b';
  const spec={...d,frequency:'monthly' as const,costBps:5,initialNav:10000,cashReturnConfirmed:true,partialCoverageConfirmed:false};
  const {dataset,...context}=spec;
  const rationale='复查配置，关注税费与资产风险。'.repeat(400).slice(0,4990)+'FINAL-END.';
  expect(rationale).toHaveLength(5000);
  const snapshot=createPdfSnapshot({context:{...context,manifest:dataset.manifest},result:computeReview(spec),rationale,nextReview:'2024-01-01',archived:true,createdAt:'2023-12-01T12:00:00.000Z'});
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
  const bytes=await renderToBuffer(PdfDocument({snapshot,chartPng:png}));
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false});
  const doc=await task.promise,texts:string[]=[],bodyTexts:string[]=[];
  try {
    expect(doc.numPages).toBeGreaterThan(4);
    for(let number=1;number<=doc.numPages;number++) {
      const page=await doc.getPage(number),viewport=page.getViewport({scale:1}),content=await page.getTextContent();
      expect(content.items.map(item=>'str' in item?item.str:'').join(' ')).toContain('REBALANCE REVIEW');
      for(const item of content.items) {
        if(!('str' in item)||!item.str.trim()) continue;
        expect(item.transform[4],`page ${number}: ${item.str}`).toBeGreaterThanOrEqual(35);
        expect(item.transform[4]+item.width,`page ${number}: ${item.str}`).toBeLessThanOrEqual(viewport.width-30);
        const runningText=item.str.startsWith('REBALANCE REVIEW')||item.str.includes('| Report ')||/^\d+ \/ \d+$/.test(item.str);
        expect(item.transform[5],`page ${number}: ${item.str}`).toBeGreaterThan(runningText?15:48);
        expect(item.transform[5],`page ${number}: ${item.str}`).toBeLessThan(viewport.height-20);
      }
      texts.push(content.items.map(item=>'str' in item?item.str:'').join(' '));
      bodyTexts.push(pageBodyText(content,viewport.height,snapshot.id,number,doc.numPages));
    }
    const text=texts.join('\n');
    for(const symbol of [...symbols,'CASH'])expect(text).toContain(symbol);
    expect(text).toContain('Original review created 2023-12-01T12:00:00.000Z');
    expect(text).toContain('Next review date: 2024-01-01');
    expect(text).toContain('Requested history: 2024-01-01');expect(text).toContain('Actual common analysis history:');expect(text).toContain('First observation');
    // Join only body regions across pages, while retaining the full reason.
    const clean=bodyTexts.join('\n').replaceAll(/\s/g,'');
    expect(clean).toContain(rationale.replaceAll(/\s/g,''));
    await mkdir('tmp/pdf-layout',{recursive:true});
    await writeFile('tmp/pdf-layout/fifty-assets-long-reason.pdf',bytes);
  } finally {await task.destroy();}
},30000);

it('preserves every line of a 5000-character newline-rich rationale through pagination',async()=>{
  Font.register({family:'RebalanceSansSC',src:fileURLToPath(new URL('../public/fonts/RebalanceSansSC-Regular.ttf',import.meta.url))});
  const d=createSyntheticDemo({observations:530}),spec={...d,frequency:'monthly' as const,costBps:5,initialNav:10000,cashReturnConfirmed:true,partialCoverageConfirmed:false};
  const {dataset,...context}=spec;
  const rationale='Line.\n'.repeat(833).slice(0,4990)+'FINAL-END.';
  expect(rationale).toHaveLength(5000);
  const snapshot=createPdfSnapshot({context:{...context,manifest:dataset.manifest},result:computeReview(spec),rationale,nextReview:'2099-01-01'});
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
  const bytes=await renderToBuffer(PdfDocument({snapshot,chartPng:png}));
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false}),doc=await task.promise;
  let text='';
  const bodyTexts:string[]=[];
  try{
    for(let number=1;number<=doc.numPages;number++) {
      const page=await doc.getPage(number),viewport=page.getViewport({scale:1}),content=await page.getTextContent();
      bodyTexts.push(pageBodyText(content,viewport.height,snapshot.id,number,doc.numPages));
      for(const item of content.items){if(!('str'in item)||!item.str.trim())continue;
        if(item.str.includes('Line.')||item.str.includes('FINAL-END.')){expect(item.transform[5],`page ${number}`).toBeGreaterThan(48);expect(item.transform[5],`page ${number}`).toBeLessThan(744);}
      }
      text+=content.items.map(item=>'str'in item?item.str:'').join(' ')+'\n';
    }
    expect(text.match(/Line/g)).toHaveLength(rationale.match(/Line/g)!.length);
    expect(text).toContain('FINAL-END.');expect(text).toContain('Next review date: 2099-01-01');expect(text).toContain('Questions to revisit');
    const clean=bodyTexts.join('\n').replaceAll(/\s/g,'');
    expect(clean).toContain(rationale.replaceAll(/\s/g,''));
    await mkdir('tmp/pdf-layout',{recursive:true});await writeFile('tmp/pdf-layout/newline-rich-reason.pdf',bytes);
  }finally{await task.destroy();}
},30000);
