import { describe,it,expect } from 'vitest';
import { createSyntheticDemo, createCashAssumptionDataset, defaultCashPeriod, SUPPORTED_SYMBOLS, MAX_REVIEW_ASSETS } from '../src/data';
import { computeReview } from '../src/engine';
import { exportRecord,parseArchive,validateRecord,inspectJournalEntries,recoverInputs,validateDraft } from '../src/records';
import type { ReviewRecord } from '../src/types';
const demo=createSyntheticDemo();
const settings={frequency:'monthly' as const,costBps:5,initialNav:10000,cashReturnConfirmed:true,partialCoverageConfirmed:false};
const result=computeReview({...demo,...settings});
function record():ReviewRecord {return structuredClone({schemaVersion:1 as const,id:result.id,createdAt:'2026-10-05T12:00:00.000Z',rationale:'Reduce stock weight while accepting a different historical outcome.',nextReview:'2026-11-05',a:demo.a,b:demo.b,manifest:demo.dataset.manifest,settings,result,dataset:demo.dataset});}
describe('untrusted review archives and permissions',()=>{
  it('roundtrips a coherent record without exporting raw data by default',()=>{const parsed=parseArchive(exportRecord(record()));expect(parsed.dataset).toBeUndefined();expect(parsed.result.history).toEqual(result.history);});
  it('includes raw data only when explicitly requested and allowed',()=>{expect(parseArchive(exportRecord(record(),true)).dataset?.prices).toEqual(demo.dataset.prices);});
  it.each(['display','derivedPersistence'] as const)('rejects disabled %s permission',flag=>{const r=record();r.manifest.rights[flag]=false;expect(()=>validateRecord(r)).toThrow();});
  it('enforces raw rights independently from derived rights',()=>{const r=record();r.manifest.rights.rawPersistence=false;expect(()=>validateRecord(r)).toThrow();delete r.dataset;expect(()=>validateRecord(r)).not.toThrow();});
  it('blocks exports of a save-only review',()=>{const r=record();r.manifest.rights.export=false;r.dataset=undefined;expect(()=>exportRecord(r)).toThrow();});
  it.each(['','3000-01-01','2026-02-30'])('rejects undated or invalid permission evidence %s',verifiedAt=>{const r=record();r.manifest.rights.verifiedAt=verifiedAt;expect(()=>validateRecord(r)).toThrow();});
  it('rejects an archive that would crash the report through missing default risk',()=>{const r=record();r.result.risk.windows=[];expect(()=>validateRecord(r)).toThrow(/default risk/);});
  it('rejects incomplete available risks',()=>{const r=record();r.result.risk.windows[0].b=undefined;expect(()=>validateRecord(r)).toThrow();});
  it('rejects unreconciled Euler contributions',()=>{const r=record();r.result.risk.windows[0].a!.contributions.VTI+=.05;expect(()=>validateRecord(r)).toThrow(/reconcile/);});
  it('rejects duplicate holdings even if total still100%',()=>{const r=record();r.a.holdings=[{symbol:'SPY',weight:.5},{symbol:'SPY',weight:.5}];expect(()=>validateRecord(r)).toThrow(/unique/);});
  it('rejects inconsistent USD market values',()=>{const r=record();r.a.marketValues={VTI:1,VXUS:2,BND:3,CASH:4};expect(()=>validateRecord(r)).toThrow(/market values/);});
  it('rejects a reordered historical series',()=>{const r=record();r.result.history.a.dates.reverse();expect(()=>validateRecord(r)).toThrow(/dates/);});
  it('rejects mismatched inner source permissions',()=>{const r=record();r.dataset!.manifest=structuredClone(r.manifest);r.dataset!.manifest.rights.export=false;expect(()=>validateRecord(r)).toThrow(/permissions differ/);});
  it('rejects impossible dates cleanly',()=>{const r=record();r.nextReview='2026-99-99';expect(()=>validateRecord(r)).toThrow(/corrupt/);});
  it('handles malformed JSON without any database access',()=>{expect(()=>parseArchive('{')).toThrow(/valid JSON/);});
  it.each([-0.2,1.1])('rejects out-of-domain archived max drawdown %s',value=>{const r=record();r.result.history.a.maxDrawdown=value;expect(()=>validateRecord(r)).toThrow(/corrupt/);});
  it.each(['totalReturn','cagr','volatility','maxDrawdown'] as const)('rejects %s that no longer reconciles to NAV',field=>{const r=record();r.result.history.a[field]+=.01;expect(()=>validateRecord(r)).toThrow(/reconcile/);});
  it('includes the initial purchase fee in the drawdown baseline',()=>{const r=record();expect(r.result.history.a.drawdowns[0]).toBeLessThan(0);r.result.history.a.drawdowns[0]=0;expect(()=>validateRecord(r)).toThrow(/drawdown series/);});
  it('rejects fractional and impossible trade counts',()=>{const r=record();r.result.history.a.trades=1.5;expect(()=>validateRecord(r)).toThrow();r.result.history.a.trades=r.result.history.a.dates.length+1;expect(()=>validateRecord(r)).toThrow(/trade event/);});
  it('does not alter valid v1 statistics or upgrade its schema',()=>{const r=record(),before=structuredClone(r);expect(validateRecord(r)).toEqual(before);expect(r).toEqual(before);});
  it('keeps valid journal rows visible alongside corrupt, unindexed and idless rows',()=>{
    const valid=record(),bad=record();bad.result.history.a.maxDrawdown=-.5;
    const listing=inspectJournalEntries([{key:valid.id,value:valid},{key:'bad',value:bad},{key:'no-date',value:{id:'no-date'}},{key:'idless',value:{a:valid.a,b:valid.b,rationale:'Recover weights only'}}]);
    expect(listing.records).toEqual([valid]);expect(listing.issues.map(i=>i.key)).toEqual(['bad','no-date','idless']);
    expect(listing.issues[0].recovery?.a).toEqual(valid.a);expect(listing.issues[1].recovery).toBeUndefined();
    expect(listing.issues[2].recovery?.rationale).toBe('Recover weights only');
  });
  it('treats mismatched database identity as an isolated issue',()=>{const r=record();const listing=inspectJournalEntries([{key:'not-the-record-id',value:r}]);expect(listing.records).toEqual([]);expect(listing.issues[0].message).toContain('database key');});
  it('recovers only validated user inputs and resets data-dependent consent',()=>{
    const r=record();r.settings.partialCoverageConfirmed=true;
    const recovered=recoverInputs({...r,key:'DO-NOT-RECOVER',credentials:{apiKey:'DO-NOT-RECOVER'}})!;
    expect(Object.keys(recovered).sort()).toEqual(['a','b','nextReview','rationale','settings']);
    expect(recovered.settings?.partialCoverageConfirmed).toBe(false);expect(JSON.stringify(recovered)).not.toContain('DO-NOT-RECOVER');
    r.a.holdings[0].weight=-1;expect(recoverInputs(r)).toBeUndefined();
  });
  it('roundtrips 50 ETFs plus cash, including the directory identity snapshot',()=>{
    const r=record(),symbols=SUPPORTED_SYMBOLS.slice(0,MAX_REVIEW_ASSETS);
    r.schemaVersion=2;r.a.holdings=symbols.map(symbol=>({symbol,weight:.99/MAX_REVIEW_ASSETS}));r.a.holdings.push({symbol:'CASH',weight:.01});r.b=structuredClone(r.a);r.b.id='b';
    r.dataset!.prices=r.dataset!.prices.map((row,i)=>symbols.map((_,j)=>row[j%row.length]*(1+.000001*j*i)));
    r.dataset!.symbols=[...symbols];r.result=computeReview({a:r.a,b:r.b,dataset:r.dataset!,...r.settings});r.id=r.result.id;
    r.catalog={version:'test-v1',asOf:'2026-10-05',assets:symbols.map(symbol=>({symbol,name:`Asset ${symbol}`,identity:'verified',sourceUrl:'https://www.nasdaqtrader.com/'}))};
    r.versions={app:'1.2.0',engine:'1',method:'1'};
    const imported=parseArchive(exportRecord(r,true));expect(imported.result.symbols).toHaveLength(51);expect(imported.catalog).toEqual(r.catalog);expect(imported.versions).toEqual(r.versions);
  });
  it('rejects 51 noncash assets rather than truncating an archive',()=>{const r=record();r.a.holdings=Array.from({length:51},(_,i)=>({symbol:`ETF${i}`,weight:1/51}));expect(()=>validateRecord(r)).toThrow(/exceed 50/);});
  it('retains zero-weight catalog identities without counting them as analyzed holdings',()=>{
    const r=record(),names=Array.from({length:80},(_,i)=>`ZERO${i}`);r.a.holdings.push(...names.slice(0,40).map(symbol=>({symbol,weight:0})));r.b.holdings.push(...names.slice(40).map(symbol=>({symbol,weight:0})));
    r.catalog={version:'test-v1',asOf:'2026-10-05',assets:names.map(symbol=>({symbol,name:symbol,sourceUrl:'https://example.org/',identity:'pending'}))};
    expect(validateRecord(r).catalog?.assets).toHaveLength(80);expect(validateRecord(r).result.symbols).toEqual(result.symbols);
  });
  it('rejects impossible risk-window availability',()=>{const r=record();r.result.risk.windows[0].available=false;expect(()=>validateRecord(r)).toThrow();});
  it('does not reinterpret ambiguous legacy USD holdings as the new ETF ticker',()=>{const r=record();r.a.holdings[0].symbol='USD';expect(()=>validateRecord(r)).toThrow(/legacy archive uses ambiguous USD/);expect(recoverInputs(r)).toBeUndefined();});
  it('roundtrips the USD ETF with an explicit current asset identity snapshot',()=>{
    const r=record();r.schemaVersion=2;r.a.holdings=[{symbol:'USD',weight:1}];r.b.holdings=[{symbol:'USD',weight:1}];r.dataset!.symbols=['USD'];r.dataset!.prices=r.dataset!.prices.map(row=>[row[0]]);
    r.result=computeReview({a:r.a,b:r.b,dataset:r.dataset!,...r.settings});r.id=r.result.id;
    r.catalog={version:'current-catalog',asOf:'2026-10-05',assets:[{symbol:'USD',name:'ProShares Ultra Semiconductors',sourceUrl:'https://www.proshares.com/',identity:'verified'}]};
    const imported=parseArchive(exportRecord(r));expect(imported.result.symbols).toEqual(['USD']);expect(imported.result.history.a.volatility).toBeGreaterThan(0);expect(imported.a.holdings[0].symbol).toBe('USD');
  });
  it('rejects credentials in an archived asset directory source URL',()=>{const r=record();r.catalog={version:'v1',asOf:'2026-10-05',assets:[{symbol:'VTI',name:'VTI',sourceUrl:'https://example.com/data?token=PRIVATE',identity:'verified'}]};expect(()=>validateRecord(r)).toThrow(/no credentials/);});
  it('applies the shared acquisition coverage checks to imported archives',()=>{const r=record();r.manifest.acquisition={requestedStart:'2025-01-01',requestedEnd:'2026-09-30',assets:[{symbol:'VTI',firstDate:'2025-01-02',lastDate:'2026-09-29',observations:300}]};delete r.dataset;expect(()=>validateRecord(r)).toThrow(/coverage is inconsistent/);});
  it('binds the archive identity to the actual report identity',()=>{const r=record();r.id='a-different-review';expect(()=>validateRecord(r)).toThrow(/identity differs/);});
  it.each(['negative variance','asymmetric','indefinite'])('rejects an archived %s covariance',problem=>{
    const r=record(),matrix=r.result.risk.windows[0].covariance!;
    if(problem==='negative variance')matrix[0][0]=-999;
    if(problem==='asymmetric')matrix[0][1]+=.1;
    if(problem==='indefinite'){matrix.forEach(row=>row.fill(0));matrix[0][0]=matrix[1][1]=1;matrix[0][1]=matrix[1][0]=2;}
    expect(()=>validateRecord(r)).toThrow(/covariance/);
  });
  it('rejects reconciled contribution sums that disagree with the archived matrix and weights',()=>{
    const r=record(),risk=r.result.risk.windows[0].a!;risk.volatility*=2;
    Object.keys(risk.contributions).forEach(symbol=>risk.contributions[symbol]*=2);
    expect(()=>validateRecord(r)).toThrow(/covariance and covered allocation weights/);
  });
  it('preserves legacy risk summaries when the optional covariance was not recorded',()=>{
    const r=record();r.result.risk.windows.forEach(window=>delete window.covariance);
    expect(validateRecord(r)).toEqual(r);
  });
  it.each(['duplicate dates','missing session','duplicate symbols','cash column','missing reported asset','future observation','empty observations'])('rejects embedded raw data with %s',problem=>{
    const r=record(),data=r.dataset!;
    if(problem==='duplicate dates')data.dates[1]=data.dates[0];
    if(problem==='missing session'){data.dates.splice(1,1);data.prices.splice(1,1);}
    if(problem==='duplicate symbols')data.symbols[1]=data.symbols[0];
    if(problem==='cash column')data.symbols[0]='CASH';
    if(problem==='missing reported asset')data.symbols[data.symbols.indexOf('VTI')]='DELISTED';
    if(problem==='future observation')data.dates[data.dates.length-1]='2099-01-02';
    if(problem==='empty observations'){data.dates=[];data.prices=[];}
    expect(()=>exportRecord(r,true)).toThrow();
  });
  it('retains historical embedded identities without replacing them from the current directory',()=>{
    const r=record(),prior='VTI',historical='HISTORICAL_ETF';
    for(const p of [r.a,r.b])for(const h of p.holdings)if(h.symbol===prior)h.symbol=historical;
    r.result.symbols=r.result.symbols.map(symbol=>symbol===prior?historical:symbol);
    r.dataset!.symbols=r.dataset!.symbols.map(symbol=>symbol===prior?historical:symbol);
    for(const window of r.result.risk.windows)for(const risk of [window.a,window.b])if(risk){
      risk.contributions[historical]=risk.contributions[prior];delete risk.contributions[prior];
      if(risk.relativeContributions){risk.relativeContributions[historical]=risk.relativeContributions[prior];delete risk.relativeContributions[prior];}
    }
    expect(parseArchive(exportRecord(r,true))).toEqual(r);
  });
  it('rejects missing sensitivity scenarios and a selected-cost row inconsistent with the main result',()=>{
    const r=record();r.result.costSensitivity=[];expect(()=>validateRecord(r)).toThrow(/sensitivity/);
    const altered=record();altered.result.costSensitivity.find(row=>row.costBps===5)!.aCagr+=.01;
    expect(()=>validateRecord(altered)).toThrow(/selected cost scenario/);
  });
});

describe('cash archive identities',()=>{
  function cashRecord():ReviewRecord {
    const period=defaultCashPeriod(),dataset=createCashAssumptionDataset(period.start,period.end);
    const a={id:'a',name:'Cash A',holdings:[{symbol:'CASH',weight:1}]},b={...a,id:'b',name:'Cash B'};
    const result=computeReview({a,b,dataset,...settings});
    return {...record(),schemaVersion:2,id:result.id,a,b,dataset,manifest:dataset.manifest,result};
  }
  it('roundtrips a cash-only archive and its empty-column session matrix',()=>{const r=cashRecord();expect(parseArchive(exportRecord(r,true))).toEqual(JSON.parse(JSON.stringify(r)));});
  it('rejects nonzero cash risk even when its contributions sum and the matrix is absent',()=>{
    const r=cashRecord();for(const w of r.result.risk.windows.filter(window=>window.available)){delete w.covariance;w.a={volatility:1,contributions:{CASH:1},relativeContributions:{CASH:1}};w.b=structuredClone(w.a);}
    expect(()=>validateRecord(r)).toThrow(/cash-assumption risk/);
  });
  it('rejects nonzero cash covariance',()=>{const r=cashRecord();r.result.risk.windows[0].covariance=[[1]];expect(()=>validateRecord(r)).toThrow(/cash covariance/);});
  it('rejects nonzero return sensitivity in a constant cash-only archive',()=>{const r=cashRecord();r.result.costSensitivity[0].aCagr=5;expect(()=>validateRecord(r)).toThrow(/cash-assumption cost/);});
});

describe('input-only draft boundary',()=>{
  function draft(){const r=record();return{schemaVersion:1,id:'current',updatedAt:r.createdAt,a:r.a,b:r.b,settings:r.settings,rationale:'',nextReview:'2099-'};}
  it('retains incomplete editor inputs without assuming the comparison is valid',()=>{const d=draft();d.a.holdings=[{symbol:'',weight:.2},{symbol:'SPY',weight:.1}];const restored=validateDraft(d);expect(restored.a.holdings).toEqual(d.a.holdings);expect(restored.rationale).toBe('');expect(restored.nextReview).toBe('2099-');});
  it('drops credentials, prices, permissions and nested extra fields',()=>{const d=draft(),r=record();const restored=validateDraft({...d,apiKey:'SECRET',dataset:r.dataset,result:r.result,manifest:r.manifest,a:{...d.a,apiKey:'SECRET'},settings:{...d.settings,key:'SECRET'}});expect(Object.keys(restored).sort()).toEqual(['a','b','id','nextReview','rationale','schemaVersion','settings','updatedAt']);expect(JSON.stringify(restored)).not.toContain('SECRET');expect(restored.settings.cashReturnConfirmed).toBe(false);expect(restored.settings.partialCoverageConfirmed).toBe(false);});
  it('rejects nonfinite scenarios instead of claiming they were safely saved',()=>{const d=draft();d.settings.initialNav=NaN;expect(()=>validateDraft(d)).toThrow(/draft/);});
});
