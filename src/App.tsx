import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createSyntheticDemo, normalizeSymbol, SUPPORTED_SYMBOLS, manifestRightsDecision, currentUsDate, isCashOnly, createCashAssumptionDataset, defaultCashPeriod, US_EQUITY_CALENDAR, calendarMaintenanceStatus } from './data';
import DataPanel, { errorMessage } from './DataPanel';
import { preloadCompute } from './worker-client';
import { validateReviewInputs } from './engine';
import Report, { pct } from './Report';
import ProviderPanel from './ProviderPanel';
import ReviewActions from './ReviewActions';
import AssetSearch from './AssetSearch';
import NumericInput from './NumericInput';
import TerminalPreview from './TerminalPreview';
import { freezeSnapshot } from './design/model';
import './workspace.css';

const DesignWorkspace = lazy(() => import('./design/DesignApp').then(module => ({ default: module.DesignWorkspace })));
import ErrorBoundary from './ErrorBoundary';
import packageInfo from '../package.json';
import { MAX_REVIEW_ASSETS, snapshotCatalog } from './data/registry';
import type { ArchiveIssue, InputDraft, RecoveredInputs } from './records';
import { clearRecords, listRecords, parseArchive, saveRecord, deleteRecord, saveDraft, readDraft, clearDraft } from './records';
import type { Frequency, MarketDataset, PortfolioSpec, ReviewRecord, ReviewResult, ReviewSpec, ReviewContext, ProviderAdapter, ProviderProgress } from './types';

const empty=(id:'a'|'b'):PortfolioSpec=>({id,name:id==='a'?'Current portfolio':'Proposed portfolio',holdings:[{symbol:'',weight:0}]});
const day=()=>currentUsDate();
const nextMonth=()=>currentUsDate(new Date(Date.now()+30*86400000));

function PortfolioEditor({portfolio,onChange,label}:{portfolio:PortfolioSpec;onChange:(p:PortfolioSpec)=>void;label:string}) {
  const total=portfolio.holdings.reduce((s,h)=>s+h.weight,0);
  function change(index:number,field:'symbol'|'weight',value:string) {
    const holdings=portfolio.holdings.map((h,i)=>i!==index?h:field==='symbol'?{...h,symbol:value.toUpperCase()}:{...h,weight:value===''?0:Number(value)/100});
    onChange({...portfolio,holdings,marketValues:undefined});
  }
  return <article className={`portfolio-editor ${portfolio.id}`}><div className="portfolio-title"><span className="portfolio-letter">{portfolio.id.toUpperCase()}</span><div><h3>{label}</h3><span>{portfolio.id==='a'?'Your allocation today':'The change you are considering'}</span></div><strong className={Math.abs(total-1)<1e-8?'total-ok':'total-error'}>{pct(total,1)}</strong></div>
    <div className="editor-labels"><span>Symbol</span><span>Weight (%)</span><span className="sr-only">Remove</span></div>
    {portfolio.holdings.map((h,i)=><div className="holding-row" key={i}><AssetSearch label={`${label} symbol ${i+1}`} value={h.symbol} onChange={value=>change(i,'symbol',value)}/><NumericInput aria-label={`${label} weight ${i+1}`} min="0" max="100" step="0.1" value={Number.isFinite(h.weight)?Number((h.weight*100).toFixed(8)):NaN} onValueChange={value=>change(i,'weight',String(value))}/><button className="remove" aria-label={`Remove ${h.symbol||'holding'} from ${label}`} onClick={()=>onChange({...portfolio,marketValues:undefined,holdings:portfolio.holdings.filter((_,j)=>j!==i)})}>×</button></div>)}
    <button className="quiet add" onClick={()=>onChange({...portfolio,holdings:[...portfolio.holdings,{symbol:'',weight:0}],marketValues:undefined})} disabled={portfolio.holdings.length>=MAX_REVIEW_ASSETS+1}>+ Add holding</button>
    <p className="hint">{Math.abs(total-1)<1e-8?'Weights total 100%.':`Weights must total 100% (${((1-total)*100).toFixed(1)} percentage points remaining).`} {portfolio.marketValues?'USD market values imported. Editing clears their coverage attribution.':'Market-value coverage unknown for weight-only inputs.'}</p>
  </article>;
}

export default function App({terminal=false}:{terminal?:boolean}={}) {
  const [started,setStarted]=useState(terminal);
  const [terminalEditing,setTerminalEditing]=useState(true);
  const [exampleScenario,setExampleScenario]=useState<'stocks-bonds'|'gold'|'cash'>('gold');
  const [autoDemo,setAutoDemo]=useState(false);
  const demoOpened=useRef(false);
  const [a,setA]=useState<PortfolioSpec>(empty('a'));
  const [b,setB]=useState<PortfolioSpec>(empty('b'));
  const [dataset,setDataset]=useState<MarketDataset|null>(null);
  const [frequency,setFrequency]=useState<Frequency>('monthly');
  const [costBps,setCostBps]=useState(5);
  const [initialNav,setInitialNav]=useState(10000);
  const [cashConfirmed,setCashConfirmed]=useState(false);
  const [partialConfirmed,setPartialConfirmed]=useState(false);
  const [result,setResult]=useState<ReviewResult|null>(null);
  const [lastSpec,setLastSpec]=useState<ReviewContext|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [offline,setOffline]=useState(!navigator.onLine);
  const [rationale,setRationale]=useState('');
  const [nextReview,setNextReview]=useState(nextMonth());
  const [localOptIn,setLocalOptIn]=useState(false);
  const [rememberData,setRememberData]=useState(false);
  const [records,setRecords]=useState<ReviewRecord[]>([]);
  const [archiveIssues,setArchiveIssues]=useState<ArchiveIssue[]>([]);
  const [progress,setProgress]=useState<ProviderProgress|null>(null);
  const [createdAt,setCreatedAt]=useState('');
  const [draftEnabled,setDraftEnabled]=useState(false);
  const [draftReady,setDraftReady]=useState(false);
  const [pendingDraft,setPendingDraft]=useState<InputDraft|null>(null);
  const [draftNotice,setDraftNotice]=useState('');
  const explicitPrint=useRef<'current'|'archive'|null>(null);
  const draftOperation=useRef(0);
  const [showRecords,setShowRecords]=useState(false);
  const [archive,setArchive]=useState<ReviewRecord|null>(null);
  const [reviewEpoch,setReviewEpoch]=useState(0);
  const [dataMode,setDataMode]=useState<'csv'|'api'>('csv');
  const [csvEdited,setCsvEdited]=useState(false);
  const [provider,setProvider]=useState<ProviderAdapter|null>(null);
  const [cashPeriod,setCashPeriod]=useState(defaultCashPeriod);
  const fetchController=useRef<AbortController|null>(null);
  const archiveRead=useRef(0);
  const worker=useRef<Worker|null>(null);
  const operation=useRef(0);
  useEffect(()=>{if(started)void preloadCompute().catch(()=>{});},[started]);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{
    const before=()=>{document.body.dataset.printTarget=explicitPrint.current||(archive?'archive':'current');};
    const after=()=>{delete document.body.dataset.printTarget;explicitPrint.current=null;};
    window.addEventListener('beforeprint',before);window.addEventListener('afterprint',after);
    return()=>{window.removeEventListener('beforeprint',before);window.removeEventListener('afterprint',after);};
  },[archive]);
  useEffect(()=>{
    if(!draftEnabled||!draftReady)return;
    const run=draftOperation.current;
    const timeout=setTimeout(()=>{
      void saveDraft({a,b,settings:{frequency,costBps,initialNav,cashReturnConfirmed:false,partialCoverageConfirmed:false},rationale,nextReview,cashPeriod})
        .then(()=>{if(run===draftOperation.current)setDraftNotice('Input draft saved locally. Prices, API credentials, results and data permissions are excluded.');})
        .catch(()=>{if(run===draftOperation.current)setDraftNotice('Draft was not saved. Check that weights and starting value contain valid numbers, or retry local storage. Your inputs remain here.');});
    },450);
    return()=>clearTimeout(timeout);
  },[draftEnabled,draftReady,a,b,frequency,costBps,initialNav,rationale,nextReview,cashPeriod]);
  useEffect(()=>{const online=()=>setOffline(!navigator.onLine);window.addEventListener('online',online);window.addEventListener('offline',online);return()=>{window.removeEventListener('online',online);window.removeEventListener('offline',online);worker.current?.terminate();fetchController.current?.abort();archiveRead.current++;if(timer.current)clearTimeout(timer.current);};},[]);
  function invalidate() {stop();setResult(null);setLastSpec(null);setError('');setNotice('');}
  function editPortfolio(p:PortfolioSpec,target:'a'|'b') {invalidate();setPartialConfirmed(false);(target==='a'?setA:setB)(p);}
  function loadDataset(d:MarketDataset) {invalidate();setPartialConfirmed(false);setDataset(d);setRememberData(false);}
  function invalidateDataset() {invalidate();setDataset(null);setRememberData(false);setPartialConfirmed(false);}
  function resetReview() {
    if(terminal){setTerminalEditing(true);setShowRecords(false);}
    stop();draftOperation.current++;if(draftEnabled){void clearDraft().catch(()=>setDraftNotice('The old draft could not be cleared. Use Clear input draft to retry.'));}setDraftEnabled(false);setDraftReady(false);setPendingDraft(null);setDraftNotice('');archiveRead.current++;setReviewEpoch(v=>v+1);setStarted(true);setDataset(null);setResult(null);setLastSpec(null);setArchive(null);setRationale('');setRememberData(false);setCashConfirmed(false);setPartialConfirmed(false);setFrequency('monthly');setCostBps(5);setInitialNav(10000);setNextReview(nextMonth());setCashPeriod(defaultCashPeriod());setDataMode('csv');setCsvEdited(false);setProvider(null);setError('');setNotice('');
  }
  function demo(scenario=exampleScenario) {
    resetReview();setExampleScenario(scenario);const d=createSyntheticDemo();
    if(scenario==='cash'){setA({id:'a',name:'Current portfolio',holdings:[{symbol:'CASH',weight:1}]});setB({id:'b',name:'Proposed portfolio',holdings:[{symbol:'CASH',weight:1}]});setNotice('Cash-only scenario loaded. Confirm the zero-return assumption before comparing.');}
    else {setA(scenario==='stocks-bonds'?{id:'a',name:'Current portfolio',holdings:[{symbol:'SPY',weight:.8},{symbol:'BND',weight:.2}]}:d.a);setB(scenario==='stocks-bonds'?{id:'b',name:'Proposed portfolio',holdings:[{symbol:'SPY',weight:.6},{symbol:'BND',weight:.4}]}:d.b);setDataset(d.dataset);setNotice('Synthetic example loaded. Review the assumptions, then compare portfolios.');}
  }
  useEffect(()=>{if(location.pathname==='/demo'&&!demoOpened.current){demoOpened.current=true;demo('stocks-bonds');setAutoDemo(true);}},[]);
  useEffect(()=>{if(autoDemo&&dataset&&a.holdings[0]?.symbol==='SPY'&&b.holdings[0]?.symbol==='SPY'){setAutoDemo(false);void calculate();}},[autoDemo,dataset,a,b]);
  function own() {resetReview();setA(empty('a'));setB(empty('b'));setNotice('Start with your holdings. They stay here while you add price history.');}
  function stop() {operation.current++;worker.current?.terminate();worker.current=null;fetchController.current?.abort();fetchController.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;setBusy(false);setProgress(null);}
  async function calculate() {
    stop();const run=operation.current;setError('');setNotice('');setResult(null);setLastSpec(null);
    let input:ReviewSpec|null=null;
    try {
      const normalize=(p:PortfolioSpec)=>({...p,holdings:p.holdings.map(h=>({...h,symbol:normalizeSymbol(h.symbol)}))});
      // Preserve the helpful missing-data message for a not-yet-populated own-portfolio form.
      if(!dataset&&dataMode==='csv'&&!isCashOnly(a,b))throw new Error('Import market prices first. Your holdings have been preserved.');
      const pa=normalize(a),pb=normalize(b);
      // Reject local input errors before using provider quota or waiting for network history.
      // The worker applies this same validation independently before computation.
      validateReviewInputs({a:pa,b:pb,frequency,costBps,initialNav,cashReturnConfirmed:cashConfirmed,partialCoverageConfirmed:partialConfirmed});
      setBusy(true);
      // Load executable assets before obtaining transient provider observations.
      const workerUrl=await preloadCompute();
      if(run!==operation.current)return;
      let data:MarketDataset|null=dataset;
      if(isCashOnly(pa,pb)){data=createCashAssumptionDataset(cashPeriod.start,cashPeriod.end);setDataset(data);}
      else if(dataMode==='api') {
        if(!provider)throw new Error('Configure your API connection first. Your holdings have been preserved.');
        const symbols=[...new Set([...pa.holdings,...pb.holdings].filter(h=>h.weight>0&&h.symbol!=='CASH').map(h=>h.symbol))].filter(s=>SUPPORTED_SYMBOLS.includes(s));
        if(!symbols.length)throw new Error('Choose at least one supported ETF for API history.');
        const end=defaultCashPeriod().end,startDate=new Date(`${end}T00:00:00Z`);const month=startDate.getUTCMonth();startDate.setUTCFullYear(startDate.getUTCFullYear()-5);if(startDate.getUTCMonth()!==month)startDate.setUTCDate(0);
        const controller=new AbortController();fetchController.current=controller;setNotice('Fetching your requested history. Holdings and reasons stay in this browser.');
        data=await provider.fetch({symbols,start:startDate.toISOString().slice(0,10),end},controller.signal,p=>{if(run===operation.current)setProgress(p);});
        if(run!==operation.current)return;
        if(data.manifest.retention!=='operation')setDataset(data);
      }
      if(!data)throw new Error('Import market prices first. Your holdings have been preserved.');
      const context:ReviewContext=structuredClone({a:pa,b:pb,manifest:data.manifest,frequency,costBps,initialNav,cashReturnConfirmed:cashConfirmed,partialCoverageConfirmed:partialConfirmed,catalog:snapshotCatalog([...new Set([...pa.holdings,...pb.holdings].map(h=>h.symbol))])});
      input={...context,dataset:data};
      data=null;
      timer.current=setTimeout(()=>{stop();setError('Calculation exceeded 30 seconds. Your holdings are intact. Try again.');},30000);
      if(run!==operation.current)return;
      const active=new Worker(workerUrl,{type:'module'});worker.current=active;
      active.onmessage=e=>{if(worker.current!==active||run!==operation.current)return;stop();if(e.data.ok){if(terminal){setTerminalEditing(false);setShowRecords(false);setArchive(null);window.scrollTo({top:0});}setResult(e.data.result);setCreatedAt(new Date().toISOString());setLastSpec(context);if(context.manifest.retention==='operation'){setDataset(null);setRememberData(false);}setNotice(context.manifest.retention==='operation'?'Review complete. Calculation-only raw history was released; changing inputs will fetch again.':'Review complete. Every comparison uses the same dataset.');setTimeout(()=>document.getElementById(terminal?'connected-review-heading':'review-heading')?.focus(),30);}else{setError(e.data.error);}};
      active.onerror=()=>{if(worker.current!==active)return;stop();setError('The calculation could not finish. Your holdings are intact; try again.');};
      active.postMessage(input);input=null;
    }catch(e){if(run!==operation.current)return;stop();setNotice('');setError(errorMessage(e));}
    finally {input=null;}
  }
  function currentRecord():ReviewRecord {
    if(!result||!lastSpec)throw new Error('Compare your current inputs before saving.');
    if(!rationale.trim())throw new Error('Write a short reason for the proposed change before saving or exporting.');
    if(!nextReview||nextReview<day())throw new Error('Choose today or a future date for your next review.');
    return {schemaVersion:2,id:result.id,createdAt:createdAt||new Date().toISOString(),catalog:lastSpec.catalog,versions:{app:packageInfo.version,engine:packageInfo.version,method:'lw-ledger-1'},rationale:rationale.trim(),nextReview,a:lastSpec.a,b:lastSpec.b,manifest:lastSpec.manifest,settings:{frequency:lastSpec.frequency,costBps:lastSpec.costBps,initialNav:lastSpec.initialNav,cashReturnConfirmed:lastSpec.cashReturnConfirmed,partialCoverageConfirmed:lastSpec.partialCoverageConfirmed},result,dataset:rememberData&&dataset?.manifest.id===lastSpec.manifest.id?dataset:undefined};
  }
  async function refreshRecords() {const listing=await listRecords();setRecords(listing.records);setArchiveIssues(listing.issues);}
  async function save() {try{if(!localOptIn)throw new Error('Enable local storage to save on this device.');await saveRecord(currentRecord());await refreshRecords();setNotice('Review saved on this device. No account or cloud upload.');setError('');}catch(e){setError(`Could not save: ${errorMessage(e)} Your current review remains available.`);}}
  async function showSaved() {setShowRecords(true);if(localOptIn){try{await refreshRecords();}catch(e){setError(`Could not read saved reviews: ${errorMessage(e)}`);}}setTimeout(()=>document.getElementById('saved-heading')?.scrollIntoView({behavior:'smooth'}),30);}
  async function enableLocal(enabled:boolean) {setLocalOptIn(enabled);if(enabled){try{await refreshRecords();}catch(e){setError(`Local storage is unavailable: ${errorMessage(e)}`);}}}
  function loadForReview(r:ReviewRecord) {resetReview();setA({...r.b,id:'a',name:'Current portfolio',marketValues:undefined});setB({...r.b,id:'b',name:'Proposed portfolio',marketValues:undefined});setNotice('Previous proposed weights loaded as A and copied to B. Supply fresh prices, then edit B; both will be recalculated on the same new dataset. The old report remains separate.');document.getElementById('workbench')?.scrollIntoView({behavior:'smooth'});}
  function printReview(target:'current'|'archive') {
    const container=target==='archive'?'.archive':'.current-review';
    if(!document.querySelector(`${container} .chart svg`))throw new Error('Wait for this report chart to load before printing, or download a PDF.');
    explicitPrint.current=target;document.body.dataset.printTarget=target;window.print();
  }
  async function enableDraft(enabled:boolean) {
    const run=++draftOperation.current;
    setDraftReady(false);setDraftEnabled(enabled);setPendingDraft(null);
    try {
      if(!enabled){await clearDraft();if(run===draftOperation.current)setDraftNotice('Input draft removed. Saved reviews were kept.');return;}
      const saved=await readDraft();
      if(run!==draftOperation.current)return;
      if(saved){setPendingDraft(saved);setDraftNotice('An earlier input draft is available. Choose whether to restore it or replace it with your current inputs.');}
      else {setDraftReady(true);setDraftNotice('Input draft saving enabled.');}
    } catch {if(run===draftOperation.current)setDraftNotice('The saved draft could not be read. Clear input draft to remove a damaged draft, or keep working without draft storage.');}
  }
  function restoreInputs(inputs:RecoveredInputs) {
    resetReview();setA({...inputs.a,id:'a',name:'Current portfolio'});setB({...inputs.b,id:'b',name:'Proposed portfolio'});
    if(inputs.settings){setFrequency(inputs.settings.frequency);setCostBps(inputs.settings.costBps);setInitialNav(inputs.settings.initialNav);}
    if(inputs.cashPeriod)setCashPeriod(inputs.cashPeriod);
    setRationale(inputs.rationale||'');setNextReview(inputs.nextReview||nextMonth());
    setNotice('Only portfolio inputs were recovered. Supply fresh prices and confirm assumptions before calculating; no archived result was reused.');
  }
  async function importArchive(input:HTMLInputElement) {
    const f=input.files?.[0];input.value='';if(!f)return;const run=++archiveRead.current;
    try{if(f.size>20_000_000)throw new Error('Archive exceeds the 20 MB limit.');const text=await f.text();if(run!==archiveRead.current)return;const r=parseArchive(text);setArchive(r);setNotice('Archive structure and permissions validated. It has not been saved; its historical calculations have not been independently re-run.');setError('');}catch(e){if(run===archiveRead.current)setError(errorMessage(e));}
  }
  const positiveSymbols=[...new Set([...a.holdings,...b.holdings].filter(h=>h.weight>0).map(h=>h.symbol.trim().toUpperCase()))];
  const hasCash=positiveSymbols.some(s=>['CASH','USD CASH','USD_CASH'].includes(s));
  const unsupported=positiveSymbols.filter(s=>!['CASH','USD CASH','USD_CASH'].includes(s)&&(!SUPPORTED_SYMBOLS.includes(s)||(dataMode==='csv'&&!dataset?.symbols.includes(s))));
  const maintenance=calendarMaintenanceStatus();
  const allCash=isCashOnly(a,b);
  const canSave=!!lastSpec&&manifestRightsDecision(lastSpec.manifest,'persistDerived').allowed;
  const currentSnapshot=useMemo(()=>terminal&&result&&lastSpec?freezeSnapshot(structuredClone({context:lastSpec,result})):null,[terminal,result,lastSpec]);
  const archiveSnapshot=useMemo(()=>terminal&&archive?freezeSnapshot(structuredClone({context:{...archive.settings,a:archive.a,b:archive.b,manifest:archive.manifest,catalog:archive.catalog},result:archive.result})):null,[terminal,archive]);
  const savePanel=result&&lastSpec&&<section className="save-panel" aria-labelledby="save-heading"><div><span className="eyebrow">04 / YOUR NEXT REVIEW</span><h2 id="save-heading">Remember the reason.<br/>Not just the result.</h2><p className="muted">At your next review, compare these weights and your new proposal on one fresh dataset. Keep this report as a separate historical snapshot.</p></div><div><label>Why this change?<textarea maxLength={5000} rows={4} value={rationale} onChange={e=>setRationale(e.target.value)} placeholder="What changed? Which trade-off are you accepting? What would make you reconsider?"/></label><label>Next review date<input type="date" min={day()} value={nextReview} onChange={e=>setNextReview(e.target.value)}/></label><p className="hint">This date is a note in your record. No email, notification or scheduled task is created.</p><label className="check"><input type="checkbox" checked={localOptIn} onChange={e=>void enableLocal(e.target.checked)}/>Allow local storage on this device</label><label className="check"><input type="checkbox" checked={rememberData} disabled={!lastSpec.manifest.rights.rawPersistence||lastSpec.manifest.retention==='operation'} onChange={e=>setRememberData(e.target.checked)}/>Include permitted market data for later reproduction</label>{!canSave&&<p className="warning">This source does not permit saving derived results. Report exports follow the separate source permissions shown below.</p>}<div className="button-row"><button className="primary" disabled={!canSave} onClick={()=>void save()}>Save review</button><ReviewActions versions={{app:packageInfo.version,engine:packageInfo.version,method:'lw-ledger-1'}} context={lastSpec} result={result} rationale={rationale} nextReview={nextReview} createdAt={createdAt} getRecord={currentRecord} includeData={rememberData} resetEpoch={reviewEpoch} onPrint={()=>printReview('current')} onError={setError} onNotice={setNotice}/></div></div></section>;
  const editCurrent=()=>{setTerminalEditing(true);setShowRecords(false);setArchive(null);window.scrollTo({top:0});};
  const connectedMessages=<div className="rr-connected-messages">{error&&<div className="error" role="alert">{error}</div>}{notice&&<div className="status" role="status">{notice}</div>}{offline&&<div className="status" role="status">You're offline. Existing results and local files remain available.</div>}</div>;
  const archiveWorkspace=terminal&&archive&&archiveSnapshot?<div className="rr-connected rr-connected-analysis">
    {connectedMessages}
    <div className="rr-connected-recovery-nav"><button className="secondary" onClick={()=>{setArchive(null);setShowRecords(true);}}>Return to journal</button><button className="quiet" onClick={()=>loadForReview(archive)}>Use archived weights for a new review</button></div>
    <ErrorBoundary scope="archived research terminal" resetKey={archive.id}><Suspense fallback={<div className="status" role="status">Opening archived research workspace…</div>}>
      <DesignWorkspace key={`archive-${archive.id}`} snapshot={archiveSnapshot} reportDetails={{rationale:archive.rationale,nextReview:archive.nextReview,createdAt:archive.createdAt,archived:true,versions:archive.versions}} onEdit={()=>loadForReview(archive)} onJournal={()=>{setArchive(null);setShowRecords(true);}} actions={<section className="rr-connected-report-actions"><div className="warning"><strong>Archived snapshot · data cutoff {archive.manifest.asOf}</strong><p>Original identities, calculations and permissions are preserved. Supply fresh data when starting a new comparison.</p><div className="button-row"><button className="secondary" onClick={()=>loadForReview(archive)}>Use archived weights for a new review</button><button className="quiet" onClick={async()=>{try{if(!localOptIn)throw new Error('Enable local storage first.');await saveRecord(archive);await refreshRecords();setNotice('Imported archive saved on this device.');}catch(e){setError(errorMessage(e));}}}>Save imported archive</button><button className="quiet" onClick={()=>{setArchive(null);setShowRecords(true);}}>Close old report</button></div></div><ReviewActions archived record={archive} createdAt={archive.createdAt} context={archiveSnapshot.context} result={archive.result} rationale={archive.rationale} nextReview={archive.nextReview} resetEpoch={reviewEpoch} onPrint={()=>printReview('archive')} onError={setError} onNotice={setNotice}/></section>}/>
    </Suspense></ErrorBoundary>
    <div className="rr-connected-print saved-panel" aria-hidden="true" inert><div className="archive"><Report archived createdAt={archive.createdAt} rationale={archive.rationale} nextReview={archive.nextReview} result={archive.result} spec={archiveSnapshot.context}/></div></div>
  </div>:null;
  const currentWorkspace=terminal&&currentSnapshot&&!terminalEditing&&!showRecords?<div className="rr-connected rr-connected-analysis">
    {connectedMessages}
    <div className="rr-connected-recovery-nav"><button className="secondary" onClick={editCurrent}>Return to inputs</button><button className="quiet" onClick={()=>void showSaved()}>Saved reviews</button></div>
    <ErrorBoundary scope="research terminal" resetKey={result!.id}><Suspense fallback={<div className="status" role="status">Opening your research workspace…</div>}>
      <DesignWorkspace key={result!.id} snapshot={currentSnapshot} reportDetails={{rationale,nextReview,createdAt}} onEdit={editCurrent} onJournal={()=>void showSaved()} actions={savePanel}/>
    </Suspense></ErrorBoundary>
    <div className="rr-connected-print current-review" aria-hidden="true" inert><Report result={result!} spec={lastSpec!} rationale={rationale} nextReview={nextReview}/></div>
  </div>:null;
  const connectedWorkspace=archiveWorkspace??currentWorkspace;
  return <div className={terminal?"rr-connected rr-connected-inputs":undefined}>
    {connectedWorkspace}
    <div className="rr-connected-base" hidden={Boolean(connectedWorkspace)} inert={Boolean(connectedWorkspace)}>
    <a className="skip-link" href="#main">Skip to main content</a>
    <header className="site-header"><div className="header-inner"><a className="brand" href="#main" aria-label="Rebalance Review home"><span className="brand-symbol" aria-hidden="true">rr<span>↗</span></span><span>rebalance<span className="brand-light"> review</span><small className="brand-descriptor">PORTFOLIO RESEARCH</small></span></a><div className="header-right"><span className="header-mode">ETF / USD</span><span className="private"><span className="dot"/>Private by default</span><button className="quiet" onClick={showSaved}>Saved reviews <span aria-hidden="true">↗</span></button></div></div></header>
    <main id="main">
      {terminal&&showRecords&&<div className="rr-connected-journal-heading"><span className="eyebrow">RESEARCH TERMINAL / JOURNAL</span><h1>Your review journal.</h1><button className="secondary" onClick={()=>setShowRecords(false)}>{currentSnapshot&&!terminalEditing?"Return to analysis":"Return to inputs"}</button></div>}
      <div className="rr-connected-editor" hidden={terminal&&showRecords} inert={terminal&&showRecords}>
      {!started?<section className="hero"><div className="hero-copy"><span className="eyebrow"><span className="dot"/> INDEPENDENT PORTFOLIO ANALYSIS</span><h1>Every allocation.<br/><span className="hero-emphasis">Under the lens.</span></h1><p>Put two portfolios on the same analytical footing. Inspect allocation changes, risk contributions and historical trade-offs before you rebalance.</p><div className="hero-actions"><button className="primary" onClick={()=>demo()}>Try an example <span aria-hidden="true">↗</span></button><button className="secondary" onClick={own}>Review my portfolio</button></div><p className="micro">No app account · Local calculations · Connect your own data</p><div className="hero-features"><span>01 &nbsp; Compare allocations</span><span>02 &nbsp; Understand risk</span><span>03 &nbsp; Save your reasoning</span></div></div><TerminalPreview/></section>:<>
        <section className="workspace-heading"><div><span className="eyebrow">WORKSPACE / ALLOCATION RESEARCH</span><h1>{terminal?"Build your comparison.":"Before you rebalance."}</h1><p className="muted">{terminal?"Search the full ETF directory. Add your history. Inspect every trade-off.":"Change the weights. Inspect the trade-offs. Keep a record of why."}</p></div><div className="button-row">{terminal&&currentSnapshot&&<button className="secondary" onClick={()=>{setTerminalEditing(false);window.scrollTo({top:0});}}>Return to analysis</button>}<label className="scenario-choice">Example scenario<select value={exampleScenario} onChange={e=>setExampleScenario(e.target.value as typeof exampleScenario)}><option value="stocks-bonds">Stocks and bonds</option><option value="gold">Add gold</option><option value="cash">All cash</option></select></label><button className="quiet" onClick={()=>{if(confirm('Replace the current unsaved inputs with the synthetic example?'))demo();}}>Load example</button><button className="quiet" onClick={()=>{if(confirm('Clear unsaved inputs and begin a new review?'))own();}}>Start fresh</button></div></section>
        <div className="workspace-summary" aria-label="Review configuration overview">
          <div><span>01 / UNIVERSE</span><strong>{positiveSymbols.filter(s=>!['CASH','USD CASH','USD_CASH'].includes(s)).length}<small> / {MAX_REVIEW_ASSETS} ETFs</small></strong></div>
          <div><span>02 / DATA CUTOFF</span><strong>{dataset?.dates.at(-1)||(allCash?cashPeriod.end:'—')}<small>{allCash?'Modeled cash':dataset?.manifest.synthetic?'Synthetic data':dataset?'Imported history':dataMode==='api'?provider?'Fetched on compare':'API setup required':'No source loaded'}</small></strong></div>
          <div><span>03 / RISK MODEL</span><strong>{allCash?'Zero-return cash':'Ledoit–Wolf'}<small>{allCash?'Assumption only':'252 daily returns'}</small></strong></div>
          <div><span>04 / EXECUTION</span><strong>{costBps}<small> bps / side</small></strong><span className="summary-cadence">{frequency==='buy-hold'?'Buy and hold':`${frequency} rebalancing`}</span></div>
        </div>
        <nav className="workspace-nav" aria-label="Workspace sections"><a href="#allocations-heading"><span>01</span> Allocations</a><a href="#provider-heading"><span>02</span> Data connection</a>{result&&<a href={terminal?"#connected-review-heading":"#review-heading"} onClick={terminal?e=>{e.preventDefault();setTerminalEditing(false);window.scrollTo({top:0});}:undefined}><span>03</span> Analysis ↗</a>}<span className="workspace-nav-note">BROWSER COMPUTE <i aria-hidden="true"/></span></nav>
        {dataset?.manifest.synthetic&&<div className="demo-notice"><span className="dot"/><strong>Synthetic example</strong><span>These are generated prices, not observed ETF returns. Use your own files for a personal review.</span></div>}
        <fieldset className="workbench-fieldset" disabled={busy} id="workbench"><legend className="sr-only">Portfolio review inputs</legend>

          <section className="allocations" aria-labelledby="allocations-heading"><div className="section-head"><div><span className="eyebrow">01 / PORTFOLIO INPUTS</span><h2 id="allocations-heading">Put your two allocations side by side.</h2></div><button className="secondary compact" onClick={()=>editPortfolio({...a,id:'b',name:'Proposed portfolio',marketValues:undefined},'b')}>Copy A to B <span aria-hidden="true">→</span></button></div><div className="portfolio-grid"><PortfolioEditor key={`a-${reviewEpoch}`} portfolio={a} label="Current portfolio" onChange={p=>editPortfolio(p,'a')}/><PortfolioEditor key={`b-${reviewEpoch}`} portfolio={b} label="Proposed portfolio" onChange={p=>editPortfolio(p,'b')}/></div>
            <div className="settings"><label>Replay rebalancing<select value={frequency} onChange={e=>{invalidate();setFrequency(e.target.value as Frequency);}}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="buy-hold">Buy and hold</option></select></label><label>Trading cost per side<select value={costBps} onChange={e=>{invalidate();setCostBps(Number(e.target.value));}}>{[2,5,10,20].map(v=><option key={v} value={v}>{v} bps ({(v/100).toFixed(2)}%)</option>)}</select></label><label>Hypothetical starting USD<NumericInput key={`starting-${reviewEpoch}`} min="1" max="1000000000000" step="1000" value={initialNav} onValueChange={value=>{invalidate();setInitialNav(value);}}/></label></div>
            <div className="assumption-checks">{positiveSymbols.includes('USD')&&<p className="warning">USD is the ProShares Ultra Semiconductors ETF. Use CASH for modeled cash.</p>}{allCash&&<div className="panel"><strong>Cash-only replay period</strong><p className="hint">No market file is needed. These are modeled sessions with 0% cash return.</p><div className="form-grid"><label>Cash replay start<input type="date" min={US_EQUITY_CALENDAR.start} max={day()} value={cashPeriod.start} onChange={e=>{invalidate();setCashPeriod({...cashPeriod,start:e.target.value});}}/></label><label>Cash replay end<input type="date" min={US_EQUITY_CALENDAR.start} max={day()} value={cashPeriod.end} onChange={e=>{invalidate();setCashPeriod({...cashPeriod,end:e.target.value});}}/></label></div></div>}{hasCash&&<label className="check"><input type="checkbox" checked={cashConfirmed} onChange={e=>{invalidate();setCashConfirmed(e.target.checked);}}/>I understand cash earns 0% in this replay</label>}{unsupported.length>0&&<div className="warning"><strong>{dataset?'Uncovered positions':'Awaiting market data'}: {unsupported.join(', ')}</strong><p>Positions remain in your inputs. An incomplete review excludes them and separately normalizes each covered allocation.</p>{(dataset||dataMode==='api')&&<label className="check"><input type="checkbox" checked={partialConfirmed} onChange={e=>{invalidate();setPartialConfirmed(e.target.checked);}}/>Compare only the covered portions; I understand this is not a full-portfolio result</label>}</div>}</div>
          </section>
          <ProviderPanel key={`provider-${reviewEpoch}`} selectedSymbols={positiveSymbols} hasDataset={Boolean(dataset)} hasPriceInput={csvEdited} mode={dataMode} onModeChange={setDataMode} onProvider={p=>setProvider(p)} onInvalidated={invalidateDataset} onNotice={setNotice}/><DataPanel key={`${reviewEpoch}-${dataMode}`} showPrices={dataMode==='csv'} automaticPrices={dataMode==='api'&&Boolean(provider)} onPricesEdited={()=>setCsvEdited(true)} dataset={dataset} selectedSymbols={positiveSymbols.filter(s=>!['CASH','USD CASH','USD_CASH'].includes(s))} onDataset={loadDataset} onPortfolio={editPortfolio} onNotice={setNotice} onInvalidated={invalidateDataset}/>
        </fieldset>
        <div className="compare-bar"><p><strong>Run the comparison.</strong><span>{allCash?'Cash assumptions · No observed prices required':dataMode==='api'?(provider?`${provider.label} · Fetch daily prices and calculate locally`:'Finish your API setup below'):dataset?'252-return risk estimate · Up to five years of common history':'Missing market data. Your holdings will stay here.'}</span></p>{busy?<button className="secondary" onClick={()=>{stop();setNotice('Calculation cancelled. Your inputs are intact.');}}>Cancel calculation</button>:<button className="primary" onClick={calculate}>Compare portfolios <span aria-hidden="true">→</span></button>}</div>
        {busy&&<div className="status" role="status"><span className="spinner"/>{progress?`Loading history: ${progress.completed}/${progress.total} assets${progress.symbol?` · ${progress.symbol}`:''}`:'Calculating risk, fees and sensitivity checks…'}</div>}
      </>}
      <section className="draft-panel" aria-label="Optional input draft"><label className="check"><input type="checkbox" checked={draftEnabled} onChange={e=>void enableDraft(e.target.checked)}/>Save input draft on this device</label><p className="hint">Optional recovery of allocations, settings and your reason. Prices, API credentials and analysis results are never included. Turning this off removes the draft.</p>
        {pendingDraft&&<div className="button-row"><button className="secondary" onClick={()=>{const saved=pendingDraft;restoreInputs(saved);setDraftEnabled(true);setDraftReady(true);setPendingDraft(null);setDraftNotice('Input draft restored. Add fresh prices before comparing.');}}>Restore input draft</button><button className="quiet" onClick={()=>{setPendingDraft(null);setDraftReady(true);}}>Replace saved draft</button></div>}
        {(draftEnabled||draftNotice)&&<button className="quiet" onClick={()=>{draftOperation.current++;setDraftReady(false);setDraftEnabled(false);setPendingDraft(null);void clearDraft().then(()=>setDraftNotice('Input draft cleared. Saved reviews were kept.')).catch(()=>setDraftNotice('Could not clear the draft. Please retry.'));}}>Clear input draft</button>}
        {draftNotice&&<p className="hint" role="status">{draftNotice}</p>}
      </section>
      </div>
      {maintenance.status!=='current'&&<p className="warning">{maintenance.message}</p>}
      {offline&&<div className="status" role="status">You're offline. The loaded workbench still calculates with local files. Keep this tab open; a fresh page load needs the app assets.</div>}
      {error&&<div className="error" role="alert">{error}</div>}
      {notice&&<div className="status" role="status">{notice}</div>}
      {!terminal&&result&&lastSpec&&<div className="current-review" id="current-review"><ErrorBoundary scope="report" resetKey={result.id}><Report result={result} spec={lastSpec} rationale={rationale} nextReview={nextReview}/></ErrorBoundary>{savePanel}</div>}
      {(showRecords||archive)&&<section className="saved-panel" aria-labelledby="saved-heading"><div className="section-head"><div><span className="eyebrow">YOUR REVIEW JOURNAL</span><h2 id="saved-heading">Saved reviews</h2></div><button className="quiet" onClick={()=>{archiveRead.current++;setShowRecords(false);setArchive(null);}}>Close journal</button></div><p className="muted">Stored in this browser only. Clearing site data removes saved records. Export permitted archives for your own backup.</p><label className="check"><input type="checkbox" checked={localOptIn} onChange={e=>void enableLocal(e.target.checked)}/>Allow local storage on this device</label><div className="button-row"><label className="file-label">Import archive<input type="file" accept=".json,application/json" onChange={e=>void importArchive(e.currentTarget)}/></label><button className="quiet danger" onClick={async()=>{if(!localOptIn){setError('Enable local storage to access the saved journal.');return;}if(!confirm('Delete all saved reviews from this browser? Export any permitted backups first.'))return;try{await clearRecords();setRecords([]);setArchiveIssues([]);setArchive(null);setNotice('All saved reviews were removed from this browser.');}catch(e){setError(errorMessage(e));}}}>Clear saved reviews</button></div>{localOptIn&&records.length===0&&<p className="empty-state">No saved reviews yet. Your next decision can be the first entry.</p>}{!localOptIn&&<p className="empty-state">Enable local storage to open your journal. Nothing is saved automatically.</p>}<div className="journal-grid">{localOptIn&&records.map(r=><article className="journal-card" key={r.id}><span className="eyebrow">{r.createdAt.slice(0,10)} · {r.manifest.synthetic?'SYNTHETIC':'LOCAL DATA'}</span><h3>Review again {r.nextReview}</h3><p>{r.rationale}</p><small>Old data cutoff: {r.manifest.asOf}</small><div className="button-row"><button className="secondary" onClick={()=>setArchive(r)}>View old report</button><button className="quiet" onClick={()=>loadForReview(r)}>Use weights for a new review</button></div></article>)}</div>
        {localOptIn&&archiveIssues.length>0&&<div className="warning"><h3>Some saved reviews need attention</h3><p>Valid reviews remain available. Damaged records are kept until you choose to remove them.</p>{archiveIssues.map((issue,i)=><div className="damaged-record" key={i}><p>{issue.message}</p><div className="button-row">{issue.recovery&&<button className="secondary" onClick={()=>restoreInputs(issue.recovery!)}>Recover inputs only</button>}<button className="quiet danger" onClick={async()=>{if(!confirm('Delete this damaged record? Other saved reviews and drafts will be kept.'))return;try{await deleteRecord(issue.key);await refreshRecords();setNotice('The damaged record was removed. Other reviews were kept.');}catch(e){setError(errorMessage(e));}}}>Delete damaged record</button></div></div>)}</div>}
        {!terminal&&archive&&<div className="archive"><div className="warning"><strong>Archived snapshot · data cutoff {archive.manifest.asOf}</strong><p>{archive.rationale}</p><p>Archive content is user-controlled; schema validation is not proof of unchanged calculations. Recompute on freshly supplied data for a new comparison.</p><div className="button-row"><button className="secondary" onClick={()=>loadForReview(archive)}>Use archived weights for a new review</button><button className="quiet" onClick={async()=>{try{if(!localOptIn)throw new Error('Enable local storage first.');await saveRecord(archive);await refreshRecords();setNotice('Imported archive saved on this device.');}catch(e){setError(errorMessage(e));}}}>Save imported archive</button><button className="quiet" onClick={()=>setArchive(null)}>Close old report</button></div></div><ErrorBoundary scope="archived report" resetKey={archive.id}><Report archived createdAt={archive.createdAt} rationale={archive.rationale} nextReview={archive.nextReview} result={archive.result} spec={{...archive.settings,a:archive.a,b:archive.b,manifest:archive.manifest,catalog:archive.catalog}}/><ReviewActions archived record={archive} createdAt={archive.createdAt} context={{...archive.settings,a:archive.a,b:archive.b,manifest:archive.manifest,catalog:archive.catalog}} result={archive.result} rationale={archive.rationale} nextReview={archive.nextReview} resetEpoch={reviewEpoch} onPrint={()=>printReview('archive')} onError={setError} onNotice={setNotice}/></ErrorBoundary></div>}
      </section>}
      <section className="principles"><div><span className="eyebrow">BUILT FOR THOUGHTFUL DECISIONS</span><h2>A review tool.<br/>You make the decision.</h2></div><div><h3>Clear assumptions</h3><p>Daily risk estimates, explicit trading costs and a common historical window. No hidden score or promise of future returns.</p></div><div><h3>Local by design</h3><p>Calculations and files stay in your browser. API requests send selected tickers and dates to your chosen provider. Local Yahoo needs no key; Tiingo keys transit our restricted proxy. Saving is optional and source permissions apply.</p></div><div><h3>An honest scope</h3><p>US-listed ETFs and USD cash. No taxes, brokerage trades or actual account return reconstruction. Real-user validation is still pending.</p></div></section>
    </main><footer><span>rebalance review <small>v{packageInfo.version} · UI preview</small></span><span>Built to explain the trade-offs.</span><a href="/licenses/index.html" target="_blank" rel="noreferrer">Open-source notices</a><a href="/guide.html" target="_blank" rel="noreferrer">Methodology & privacy ↗</a></footer>
    </div>
  </div>;
}
