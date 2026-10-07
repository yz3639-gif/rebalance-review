import Dexie from 'dexie';
import type { Table } from 'dexie';
import { z } from './schema';
import type { BacktestResult, ReviewRecord, RiskWindow } from './types';
import { assertRights, isIsoDate, currentUsDate, isCashOnly, MAX_REVIEW_ASSETS, validateManifest, hasCredentialMaterial, assertCompleteDailySessions, normalizeSymbol } from './data';
import { eulerRisk } from './engine/covariance';

const finite = z.number().finite();
const positive = finite.positive();
const date = z.string().refine(isIsoDate);
const symbol = z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,24}$/);
const values = z.record(symbol, finite);
const portfolio = z.object({ id: z.string().max(100), name: z.string().max(100), holdings: z.array(z.object({symbol,weight:finite.min(0).max(1)})).min(1).max(MAX_REVIEW_ASSETS+1), marketValues: z.record(symbol, finite.nonnegative()).optional() });
const settings = z.object({frequency:z.enum(['monthly','quarterly','buy-hold']),costBps:finite.min(0).max(100),initialNav:positive.max(1e12),cashReturnConfirmed:z.boolean(),partialCoverageConfirmed:z.boolean()});
const rights = z.object({display:z.boolean(),rawPersistence:z.boolean(),derivedPersistence:z.boolean(),export:z.boolean(),publicDisplay:z.boolean(),evidence:z.string().max(4000),verifiedAt:z.string().max(50)});
const acquisition = z.object({requestedStart:date,requestedEnd:date,assets:z.array(z.object({symbol,firstDate:date,lastDate:date,observations:finite.int().positive(),providerStartDate:date.optional(),providerEndDate:date.optional()})).max(MAX_REVIEW_ASSETS)});
const manifest = z.object({id:z.string().min(1).max(200),source:z.string().min(1).max(1000),currency:z.literal('USD'),basis:z.enum(['adjusted_close','total_return_index','cash_zero']),asOf:date,synthetic:z.boolean(),rights,retention:z.enum(['operation','session','persistable']).optional(),policy:z.enum(['tiingo-byok','yahoo-local','user-declared','cash-model']).optional(),acquisition:acquisition.optional()});
const catalog = z.object({version:z.string().min(1).max(100),asOf:date,assets:z.array(z.object({symbol,name:z.string().max(1000),exchange:z.string().max(100).optional(),sourceUrl:z.string().url().max(2000),identity:z.enum(['verified','pending'])})).max(2*(MAX_REVIEW_ASSETS+1))});
const series = z.array(finite).min(2).max(6000);
const history = z.object({dates:z.array(date).min(2).max(6000),nav:series,drawdowns:series,totalReturn:finite.gt(-1),cagr:finite.gt(-1),volatility:finite.nonnegative(),maxDrawdown:finite.min(0).max(1),fees:finite.nonnegative(),turnover:finite.nonnegative(),trades:finite.int().nonnegative()}).refine(v=>v.dates.length===v.nav.length&&v.nav.length===v.drawdowns.length,'Historical series lengths differ');
const risk = z.object({volatility:finite.nonnegative(),contributions:values,relativeContributions:values.nullable()});
// Match the existing allocation-sum tolerance; 50 binary weights can sum a few ulps above 1.
// Coverage is additionally reconciled to the original holdings below. Numerical oracle tolerances are unchanged.
const result = z.object({id:z.string().max(100),asOf:date,start:date,end:date,observations:finite.int().nonnegative(),symbols:z.array(symbol).max(MAX_REVIEW_ASSETS+1),partial:z.boolean(),coverage:z.object({a:finite.min(0).max(1+1e-8),b:finite.min(0).max(1+1e-8)}),risk:z.object({windows:z.array(z.object({window:finite.int(),available:z.boolean(),observations:finite.int().nonnegative(),a:risk.optional(),b:risk.optional(),covariance:z.array(z.array(finite).max(MAX_REVIEW_ASSETS+1)).max(MAX_REVIEW_ASSETS+1).optional()})).max(3)}),history:z.object({a:history,b:history}),costSensitivity:z.array(z.object({costBps:finite.min(0).max(100),aCagr:finite.gt(-1),bCagr:finite.gt(-1)})).max(10),delaySensitivity:z.object({a:history,b:history}),warnings:z.array(z.string().max(3000)).max(100)});
const dataset = z.object({manifest,dates:z.array(date).max(10000),symbols:z.array(symbol).max(MAX_REVIEW_ASSETS),prices:z.array(z.array(positive).max(MAX_REVIEW_ASSETS)).max(10000)}).refine(v=>v.dates.length===v.prices.length&&v.prices.every(row=>row.length===v.symbols.length),'Dataset dimensions differ');
const recordSchema = z.object({schemaVersion:z.union([z.literal(1),z.literal(2)]),id:z.string().min(1).max(100),createdAt:z.string().datetime(),rationale:z.string().min(1).max(5000),nextReview:date,a:portfolio,b:portfolio,manifest,settings,result,dataset:dataset.optional(),catalog:catalog.optional(),versions:z.object({app:z.string().max(100),engine:z.string().max(100),method:z.string().max(100)}).optional()});

export interface RecoveredInputs {
  a: ReviewRecord['a']; b: ReviewRecord['b'];
  rationale?: string; nextReview?: string; settings?: ReviewRecord['settings'];
  cashPeriod?: {start:string;end:string};
}
export interface ArchiveIssue { key: IDBValidKey; message: string; recovery?: RecoveredInputs }
export interface JournalListing { records: ReviewRecord[]; issues: ArchiveIssue[] }
export interface InputDraft {
  schemaVersion: 1; id: 'current'; updatedAt: string;
  a: ReviewRecord['a']; b: ReviewRecord['b']; settings: ReviewRecord['settings'];
  rationale: string; nextReview: string;
  cashPeriod?: {start:string;end:string};
}
const draftPortfolio=z.object({id:z.string().max(100),name:z.string().max(100),holdings:z.array(z.object({symbol:z.string().max(25),weight:finite.min(0).max(1)})).max(MAX_REVIEW_ASSETS+1),marketValues:z.record(symbol,finite.nonnegative()).optional()});
const draftSchema = z.object({schemaVersion:z.literal(1),id:z.literal('current'),updatedAt:z.string().datetime(),a:draftPortfolio,b:draftPortfolio,settings,rationale:z.string().max(5000),nextReview:z.string().max(10),cashPeriod:z.object({start:z.string().max(10),end:z.string().max(10)}).optional()});
type JournalDatabase = Dexie & {reviews:Table<unknown,IDBValidKey>;drafts:Table<InputDraft,string>};
let database:JournalDatabase|null=null;
function db():JournalDatabase {
  if(!database) {
    database=new Dexie('rebalance-review-v1') as JournalDatabase;
    database.version(1).stores({reviews:'id,createdAt'});
    database.version(2).stores({reviews:'id,createdAt',drafts:'id'});
  }
  return database;
}
function validatePortfolios(a:ReviewRecord['a'],b:ReviewRecord['b']) {
  if(new Set([...a.holdings,...b.holdings].filter(h=>h.symbol!=='CASH'&&h.weight>0).map(h=>h.symbol)).size>MAX_REVIEW_ASSETS) throw new Error(`Archived portfolios exceed ${MAX_REVIEW_ASSETS} different ETFs.`);
  for(const p of [a,b]) {
    if(new Set(p.holdings.map(h=>h.symbol)).size!==p.holdings.length||Math.abs(p.holdings.reduce((s,h)=>s+h.weight,0)-1)>1e-8) throw new Error('Archived holdings must be unique and total 100%.');
    if(p.marketValues) {
      const total=Object.values(p.marketValues).reduce((s,v)=>s+v,0);
      if(total<=0||Object.keys(p.marketValues).length!==p.holdings.length||p.holdings.some(h=>p.marketValues?.[h.symbol]===undefined||Math.abs(p.marketValues[h.symbol]/total-h.weight)>1e-8)) throw new Error('Archived market values do not reconcile with allocation weights.');
    }
  }
}
const agrees=(actual:number,expected:number)=>Math.abs(actual-expected)<=1e-10+1e-8*Math.abs(expected);
/** Validate a recorded matrix, without fitting new prices or changing historical estimates. */
function validateCovariance(matrix:number[][],symbols:string[]) {
  if(matrix.length!==symbols.length||matrix.some(row=>row.length!==symbols.length)) throw new Error('Archived covariance dimensions differ.');
  const maximum=Math.max(0,...matrix.flat().map(Math.abs)),tolerance=1e-12+1e-8*maximum;
  for(let i=0;i<matrix.length;i++) for(let j=0;j<matrix.length;j++) {
    if((i===j&&matrix[i][j]<-tolerance)||Math.abs(matrix[i][j]-matrix[j][i])>tolerance) throw new Error('Archived covariance must be symmetric with nonnegative variances.');
    if((symbols[i]==='CASH'||symbols[j]==='CASH')&&Math.abs(matrix[i][j])>tolerance) throw new Error('Archived cash covariance must be zero.');
  }
  // Cholesky of the normalized symmetric matrix plus the existing element tolerance.
  // This accepts rounding at that tolerance, but rejects materially indefinite matrices.
  const scale=Math.max(1,maximum),lower=matrix.map(row=>row.map(()=>0));
  for(let i=0;i<matrix.length;i++) for(let j=0;j<=i;j++) {
    let value=(matrix[i][j]/scale+matrix[j][i]/scale)/2+(i===j?tolerance/scale:0);
    for(let k=0;k<j;k++) value-=lower[i][k]*lower[j][k];
    if(i===j) {if(!(value>0)) throw new Error('Archived covariance is not positive semidefinite within the recorded numerical tolerance.');lower[i][j]=Math.sqrt(value);}
    else lower[i][j]=value/lower[j][j];
  }
}
function reconcileRisk(window:RiskWindow,r:ReviewRecord) {
  if(!window.covariance) return; // Earlier archives may omit the matrix; never invent one.
  for(const side of ['a','b'] as const) {
    const weights=r.result.symbols.map(symbol=>(r[side].holdings.find(h=>h.symbol===symbol)?.weight??0)/r.result.coverage[side]);
    const expected=eulerRisk(weights,window.covariance,r.result.symbols),actual=window[side]!;
    if(!agrees(actual.volatility,expected.volatility)||r.result.symbols.some(symbol=>!agrees(actual.contributions[symbol],expected.contributions[symbol]))) throw new Error('Archived risk does not reconcile with its covariance and covered allocation weights.');
  }
}
function validateEmbeddedDataset(r:ReviewRecord) {
  const data=r.dataset;
  if(!data) return;
  if(new Set(data.symbols).size!==data.symbols.length||data.symbols.some(symbol=>symbol==='CASH'||normalizeSymbol(symbol)!==symbol)||(!data.symbols.length&&r.manifest.basis!=='cash_zero')) throw new Error('Archived market-data symbols must be unique, canonical noncash identities.');
  if(data.dates.some(date=>date>r.manifest.asOf)) throw new Error('Archived market observations exceed the recorded cutoff.');
  assertCompleteDailySessions(data.dates,r.manifest.synthetic);
  const first=data.dates.indexOf(r.result.start);
  if(first<0||JSON.stringify(data.dates.slice(first))!==JSON.stringify(r.result.history.a.dates)) throw new Error('Archived market observations do not align with the recorded analysis history.');
  if(r.result.symbols.some(symbol=>symbol!=='CASH'&&!data.symbols.includes(symbol))) throw new Error('Archived market observations omit a reported asset.');
  const acquisition=r.manifest.acquisition;
  if(acquisition&&(acquisition.assets.length!==data.symbols.length||data.symbols.some(symbol=>{
    const asset=acquisition.assets.find(item=>item.symbol===symbol);
    return !asset||asset.firstDate>data.dates[0]||asset.lastDate<data.dates.at(-1)!||asset.observations<data.dates.length;
  }))) throw new Error('Archived market observations differ from their recorded acquisition coverage.');
  // Do not compare against today's directory: a historical ETF may have delisted or changed metadata.
}
/** Check identities from archived NAV, not a new market-data backtest. Never replace stored statistics. */
function validateHistory(h:BacktestResult,initialNav:number) {
  let peak=initialNav,worst=0;
  for(let i=0;i<h.nav.length;i++) {
    const nav=h.nav[i],dd=h.drawdowns[i];
    if(nav<=0||dd>0||dd<=-1) throw new Error('Archive historical balances or drawdowns are outside valid domains.');
    peak=Math.max(peak,nav);
    if(!agrees(dd,nav/peak-1)) throw new Error('Archived drawdown series does not reconcile with NAV and starting capital.');
    worst=Math.max(worst,-dd);
  }
  const terminal=h.nav.at(-1)!/initialNav;
  const years=(Date.parse(h.dates.at(-1)!)-Date.parse(h.dates[0]))/(365.25*86400000);
  const returns=h.nav.slice(1).map((nav,i)=>nav/h.nav[i]-1);
  const mean=returns.reduce((sum,value)=>sum+value,0)/returns.length;
  const variance=returns.length>1?returns.reduce((sum,value)=>sum+(value-mean)**2,0)/(returns.length-1):0;
  if(!(years>0)||!agrees(h.maxDrawdown,worst)||!agrees(h.totalReturn,terminal-1)||!agrees(h.cagr,Math.pow(terminal,1/years)-1)||!agrees(h.volatility,Math.sqrt(variance*252))) throw new Error('Archived historical statistics do not reconcile with NAV and starting capital.');
  if(h.trades>h.dates.length) throw new Error('Archived trade event count exceeds the available sessions.');
}
export function validateRecord(input:unknown):ReviewRecord {
  const parsed=recordSchema.safeParse(input);
  if(!parsed.success) throw new Error('This archive is incomplete or corrupt. No saved records were changed.');
  const r=parsed.data;
  if(r.id!==r.result.id) throw new Error('Archive identity differs from its report identity.');
  validateManifest(r.manifest);
  if(r.dataset) validateManifest(r.dataset.manifest);
  if(r.catalog&&(hasCredentialMaterial(r.catalog.version)||r.catalog.assets.some(asset=>new URL(asset.sourceUrl).protocol!=='https:'||[asset.name,asset.exchange??'',asset.sourceUrl].some(hasCredentialMaterial)))) throw new Error('Asset directory provenance must use public HTTPS source URLs and contain no credentials.');
  if(r.catalog&&new Set(r.catalog.assets.map(asset=>asset.symbol)).size!==r.catalog.assets.length) throw new Error('Archived asset directory identities must be unique.');
  if(!r.catalog&&[...r.a.holdings.map(h=>h.symbol),...r.b.holdings.map(h=>h.symbol),...r.result.symbols,...(r.dataset?.symbols??[])].includes('USD')) throw new Error('This legacy archive uses ambiguous USD: older versions treated USD as cash, while USD is also an ETF ticker. Review the original inputs and use CASH explicitly if cash was intended; otherwise supply fresh ETF data. No values were reinterpreted.');
  if(r.manifest.basis==='cash_zero'&&(!isCashOnly(r.a,r.b)||r.manifest.synthetic||r.dataset?.symbols.length)) throw new Error('Cash-assumption archives must contain only cash allocations.');
  if(r.manifest.asOf>currentUsDate()) throw new Error('Archive cutoff is in the future.');
  assertRights(r.manifest,'persistDerived');
  if(r.dataset) {assertRights(r.manifest,'persistRaw');assertRights(r.dataset.manifest,'persistRaw');if(JSON.stringify(r.dataset.manifest)!==JSON.stringify(r.manifest)) throw new Error('Archive dataset identity or permissions differ.');}
  validatePortfolios(r.a,r.b);
  if(r.result.asOf!==r.manifest.asOf) throw new Error('Archive cutoff differs from its dataset manifest.');
  const rr=r.result,windows=rr.risk.windows;
  if(rr.observations<252) throw new Error('Archive has too few observations for its default risk report.');
  if(windows.length!==3||new Set(windows.map(w=>w.window)).size!==3||![126,252,504].every(n=>windows.some(w=>w.window===n))||!windows.some(w=>w.window===252&&w.available&&w.a&&w.b)) throw new Error('Archive has no valid default risk report.');
  if(!rr.symbols.length||new Set(rr.symbols).size!==rr.symbols.length) throw new Error('Archive asset symbols must be unique.');
  const held=new Set([...r.a.holdings,...r.b.holdings].filter(h=>h.weight>0).map(h=>h.symbol));
  if(rr.symbols.some(s=>!held.has(s))) throw new Error('Archive result contains an asset outside the original allocations.');
  for(const side of ['a','b'] as const) {
    const covered=r[side].holdings.filter(h=>rr.symbols.includes(h.symbol)).reduce((sum,h)=>sum+h.weight,0);
    if(covered<=0||!agrees(rr.coverage[side],covered)) throw new Error('Archive coverage does not reconcile with original allocations.');
  }
  if(rr.partial!==[...held].some(s=>!rr.symbols.includes(s))) throw new Error('Archive partial-coverage status differs from excluded allocations.');
  if(rr.partial&&!r.settings.partialCoverageConfirmed) throw new Error('Archive partial coverage was not confirmed.');
  if(rr.costSensitivity.length!==4||![2,5,10,20].every(cost=>rr.costSensitivity.some(item=>item.costBps===cost))) throw new Error('Archived cost sensitivity must include each recorded 2, 5, 10 and 20 bps scenario exactly once.');
  for(const item of rr.costSensitivity) {
    if(r.manifest.basis==='cash_zero'&&(!agrees(item.aCagr,0)||!agrees(item.bCagr,0))) throw new Error('Archived cash-assumption cost sensitivities must have zero returns.');
    if(item.costBps===r.settings.costBps&&(!agrees(item.aCagr,rr.history.a.cagr)||!agrees(item.bCagr,rr.history.b.cagr))) throw new Error('Archived cost sensitivity does not reconcile with the selected cost scenario.');
  }
  for(const w of windows) {
    if(w.available!==(rr.observations>=w.window)||(!w.available&&w.observations!==rr.observations)) throw new Error('Archive risk window availability differs from its history.');
    if(w.covariance) validateCovariance(w.covariance,rr.symbols);
    if(!w.available) continue;
    if(!w.a||!w.b||w.observations!==w.window) throw new Error('Archive risk window is incomplete.');
    for(const risk of [w.a,w.b]) {
      if(Object.keys(risk.contributions).length!==rr.symbols.length||rr.symbols.some(s=>risk.contributions[s]===undefined)) throw new Error('Archive risk assets differ from the report.');
      const sum=Object.values(risk.contributions).reduce((s,v)=>s+v,0);
      if(!agrees(sum,risk.volatility)) throw new Error('Archived risk contributions do not reconcile.');
      if(risk.volatility===0?risk.relativeContributions!==null:!risk.relativeContributions||Object.keys(risk.relativeContributions).length!==rr.symbols.length||rr.symbols.some(s=>risk.relativeContributions?.[s]===undefined||Math.abs(risk.relativeContributions[s]-risk.contributions[s]/risk.volatility)>1e-8)) throw new Error('Archived relative risk contributions are invalid.');
      if(r.manifest.basis==='cash_zero'&&(!agrees(risk.volatility,0)||risk.relativeContributions!==null||Object.values(risk.contributions).some(value=>!agrees(value,0)))) throw new Error('Archived cash-assumption risk and contributions must be zero, with undefined relative risk.');
    }
    reconcileRisk(w,r);
  }
  for(const h of [rr.history.a,rr.history.b,rr.delaySensitivity.a,rr.delaySensitivity.b]) {
    if(h.dates.some((d,i)=>i>0&&d<=h.dates[i-1])||h.dates[0]!==rr.start||h.dates.at(-1)!==rr.end||JSON.stringify(h.dates)!==JSON.stringify(rr.history.a.dates)) throw new Error('Archive historical dates or balances are inconsistent.');
    validateHistory(h,r.settings.initialNav);
    if(r.manifest.basis==='cash_zero'&&(!r.settings.cashReturnConfirmed||h.nav.some(nav=>!agrees(nav,r.settings.initialNav))||[h.totalReturn,h.cagr,h.volatility,h.maxDrawdown,h.fees,h.turnover,h.trades].some(value=>!agrees(value,0)))) throw new Error('Archived cash-assumption history must remain constant with zero returns, risk, trades and fees.');
  }
  if(rr.end>rr.asOf||rr.observations!==rr.history.a.dates.length-1) throw new Error('Archive observation count or cutoff is inconsistent.');
  validateEmbeddedDataset(r);
  return r;
}
/** Recover only independent, valid user inputs. Never salvage statistics, permissions, data or secrets. */
export function recoverInputs(input:unknown):RecoveredInputs|undefined {
  if(!input||typeof input!=='object') return;
  const raw=input as Record<string,unknown>,a=portfolio.safeParse(raw.a),b=portfolio.safeParse(raw.b);
  if(!a.success||!b.success) return;
  if(!raw.catalog&&[...a.data.holdings,...b.data.holdings].some(h=>h.symbol==='USD')) return;
  try {validatePortfolios(a.data,b.data);} catch {return;}
  const clean:RecoveredInputs={a:a.data,b:b.data};
  const rationale=z.string().max(5000).safeParse(raw.rationale),nextReview=date.safeParse(raw.nextReview),scenario=settings.safeParse(raw.settings);
  if(rationale.success) clean.rationale=rationale.data;
  if(nextReview.success) clean.nextReview=nextReview.data;
  if(scenario.success) clean.settings={...scenario.data,cashReturnConfirmed:false,partialCoverageConfirmed:false};
  return clean;
}
/** Include unindexed rows as well as normal ones. One corrupt row must not hide the whole journal. */
export function inspectJournalEntries(entries:Iterable<{key:IDBValidKey;value:unknown}>):JournalListing {
  const listing:JournalListing={records:[],issues:[]};
  for(const {key,value} of entries) {
    try {
      const record=validateRecord(value);
      if(record.id!==key) throw new Error('Stored record identity differs from its database key.');
      listing.records.push(record);
    } catch(error) {
      listing.issues.push({key,message:error instanceof Error?error.message:'This saved record could not be validated.',recovery:recoverInputs(value)});
    }
  }
  listing.records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
  return listing;
}
export async function saveRecord(record:ReviewRecord) {if(record.schemaVersion!==2) throw new Error('Version 1 archives are read-only historical snapshots. Use their weights for a new review to save a version 2 record.');await db().reviews.put(validateRecord(record));}
export async function listRecords():Promise<JournalListing> {
  const entries:Array<{key:IDBValidKey;value:unknown}>=[];
  await db().reviews.toCollection().each((value,cursor)=>{entries.push({key:cursor.primaryKey as IDBValidKey,value});});
  return inspectJournalEntries(entries);
}
export async function deleteRecord(key:IDBValidKey) {await db().reviews.delete(key);}
export async function clearRecords() {await db().reviews.clear();}
export function validateDraft(input:unknown):InputDraft {
  const parsed=draftSchema.safeParse(input);
  if(!parsed.success) throw new Error('The saved input draft is incomplete or corrupt. Your review journal is unchanged.');
  const draft=parsed.data;
  draft.settings.partialCoverageConfirmed=false;
  draft.settings.cashReturnConfirmed=false;
  return draft;
}
export async function saveDraft(input:Omit<InputDraft,'schemaVersion'|'id'|'updatedAt'>) {
  const draft=validateDraft({...input,schemaVersion:1,id:'current',updatedAt:new Date().toISOString()});
  await db().drafts.put(draft);
}
export async function readDraft():Promise<InputDraft|null> {const input=await db().drafts.get('current');return input?validateDraft(input):null;}
export async function clearDraft() {await db().drafts.delete('current');}
export function exportRecord(record:ReviewRecord,includeData=false) {
  const r=validateRecord(record);
  assertRights(r.manifest,'exportDerived');
  if(includeData) {assertRights(r.manifest,'exportRaw');if(!r.dataset) throw new Error('This record has no stored dataset.');assertRights(r.dataset.manifest,'exportRaw');}
  return JSON.stringify({...r,dataset:includeData?r.dataset:undefined},null,2);
}
export function parseArchive(text:string) {
  if(text.length>20_000_000) throw new Error('Archive exceeds the 20 MB limit.');
  try {return validateRecord(JSON.parse(text));}
  catch(error) {if(error instanceof SyntaxError) throw new Error('This is not a valid JSON review archive. No saved records were changed.');throw error;}
}
export function download(content:string,filename:string,type='application/json') {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
