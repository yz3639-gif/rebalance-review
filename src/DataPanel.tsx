import { useEffect, useRef, useState } from 'react';
import { inspectCsv, parseHoldings, parseMarketCsv, createSyntheticDemo, SUPPORTED_SYMBOLS, currentUsDate, MAX_REVIEW_ASSETS, CATALOG_AS_OF } from './data';
import type { HoldingsImport } from './data/holdings';
import { rowDiagnostics, type ImportDiagnostic } from './import-preview';
import type { MarketDataset, PortfolioSpec } from './types';
import { download } from './records';

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Please check the input and try again.'; }
async function fileText(file?: File) {
  if(!file) return '';
  if(file.size>20_000_000) throw new Error('Please choose a file smaller than 20 MB.');
  return file.text();
}
const freshPriceDraft = () => ({ marketText:'', marketHeaders:[] as string[], dateColumn:'date', priceSymbol:'symbol', priceValue:'adjusted_close', format:'long' as 'long'|'wide', basis:'adjusted_close' as 'adjusted_close'|'total_return_index', synthetic:false, source:'', license:false, usd:false, duplicatePrice:false });
export default function DataPanel({ dataset, onDataset, onPortfolio, onNotice, selectedSymbols, onInvalidated, showPrices=true, automaticPrices=false, onPricesEdited }: {
  dataset:MarketDataset|null; onDataset:(d:MarketDataset)=>void;
  onPortfolio:(p:PortfolioSpec,target:'a'|'b')=>void; onNotice:(s:string)=>void;
  selectedSymbols:string[]; onInvalidated:()=>void; showPrices?:boolean; automaticPrices?:boolean; onPricesEdited?:()=>void;
}) {
  const [holdingText,setHoldingText]=useState('');
  const [holdingPreview,setHoldingPreview]=useState<HoldingsImport|null>(null);
  const [pricePreview,setPricePreview]=useState<MarketDataset|null>(null);
  const [diagnostics,setDiagnostics]=useState<ImportDiagnostic[]>([]);
  const [draft,setDraft]=useState(freshPriceDraft);
  const {marketText,marketHeaders,dateColumn,priceSymbol,priceValue,format,basis,synthetic,source,license,usd,duplicatePrice}=draft;
  const reads=useRef({holdings:0,prices:0});
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;reads.current.holdings++;reads.current.prices++;};},[]);
  function patchDraft(change:Partial<ReturnType<typeof freshPriceDraft>>, resetConsent=true) { onPricesEdited?.();onInvalidated();setPricePreview(null);setDiagnostics([]);setError('');setDraft(old=>({...old,...(resetConsent?{usd:false,license:false}:{}),...change})); }
  function replacePriceText(text:string) {onPricesEdited?.();reads.current.prices++;onInvalidated();setPricePreview(null);setDiagnostics([]);setError('');setDraft({...freshPriceDraft(),marketText:text});}
  async function readFile(input:HTMLInputElement,kind:'holdings'|'prices') {
    const file=input.files?.[0];input.value='';if(!file)return;
    if(kind==='prices')replacePriceText('');else {reads.current.holdings++;setHoldingText('');setDuplicateHolding(false);setHoldingPreview(null);setDiagnostics([]);}
    const run=reads.current[kind];
    try {const text=await fileText(file);if(!mounted.current||run!==reads.current[kind])return;
      if(kind==='prices')setDraft(old=>({...old,marketText:text}));else setHoldingText(text);inspect(text,kind);
    }catch(e){if(mounted.current&&run===reads.current[kind])setError(errorMessage(e));}
  }
  const [target,setTarget]=useState<'a'|'b'>('a');
  const [holdingMode,setHoldingMode]=useState<'weight'|'market_value'>('weight');
  const [weightUnit,setWeightUnit]=useState<'percent'|'decimal'>('percent');
  const [holdingHeaders,setHoldingHeaders]=useState<string[]>([]);

  const [symbolColumn,setSymbolColumn]=useState('symbol');
  const [holdingValue,setHoldingValue]=useState('weight');









  const [duplicateHolding,setDuplicateHolding]=useState(false);

  const [error,setError]=useState('');
  useEffect(()=>{setHoldingPreview(null);setDiagnostics([]);},[holdingText,target,holdingMode,weightUnit,symbolColumn,holdingValue,duplicateHolding]);
  const selectionKey=JSON.stringify(selectedSymbols);
  useEffect(()=>{setPricePreview(null);},[selectionKey]);

  function inspect(text:string,kind:'holdings'|'prices') {
    try {
      const {headers}=inspectCsv(text);
      if(kind==='holdings') {setHoldingHeaders(headers);setSymbolColumn(headers.find(h=>/symbol|ticker/i.test(h))||headers[0]||'');setHoldingValue(headers.find(h=>/weight|value|amount/i.test(h))||headers[1]||'');}
      else {patchDraft({marketHeaders:headers,dateColumn:headers.find(h=>/date/i.test(h))||headers[0]||'',priceSymbol:headers.find(h=>/symbol|ticker/i.test(h))||headers[1]||'',priceValue:headers.find(h=>/adjust|total_return|price|value/i.test(h))||headers[2]||''});}
      setError('');
    } catch(e){setError(errorMessage(e));}
  }
  function loadHoldings() {
    setHoldingPreview(null);setDiagnostics([]);
    try {
      const issues=rowDiagnostics(holdingText,{kind:'holdings',symbol:symbolColumn,value:holdingValue,percent:holdingMode==='weight'&&weightUnit==='percent'});
      if(issues.length){setDiagnostics(issues);setError('Fix the highlighted rows before applying this import.');return;}
      const parsed=parseHoldings(holdingText,{id:target,name:target==='a'?'Current portfolio':'Proposed portfolio',mode:holdingMode,weightUnit,columns:{symbol:symbolColumn,value:holdingValue},confirmMergeDuplicates:duplicateHolding});
      setHoldingPreview(parsed);setError('');
    }catch(e){setError(errorMessage(e));}
  }
  function loadMarket() {
    setPricePreview(null);setDiagnostics([]);
    try {
      const issues=rowDiagnostics(marketText,{kind:format==='long'?'long-prices':'wide-prices',date:dateColumn,symbol:format==='long'?priceSymbol:undefined,value:priceValue});
      if(issues.length){setDiagnostics(issues);setError('Fix the highlighted rows before applying this import.');return;}
      if(!source.trim()) throw new Error('Name your data source before importing prices.');
      if(!usd) throw new Error('Confirm that prices are USD and use the selected return-adjusted basis.');
      const now=currentUsDate();
      const d=parseMarketCsv(marketText,{format,columns:{date:dateColumn,symbol:priceSymbol,value:priceValue},selectedSymbols:selectedSymbols.length?selectedSymbols:undefined,confirmIdenticalDuplicates:duplicatePrice,manifest:{id:crypto.randomUUID(),source:source.trim(),currency:'USD',basis,asOf:'',synthetic,retention:license?'persistable':'session',policy:'user-declared',rights:{display:true,rawPersistence:license,derivedPersistence:license,export:license,publicDisplay:false,evidence:license?'User attests permission to use, store and export this local file.':'Session-only user-supplied file; persistence and export rights unconfirmed.',verifiedAt:now}}});
      setPricePreview(d);setError('');
    }catch(e){setError(errorMessage(e));}
  }
  function sample(shape:'wide'|'long'='wide') {
    const {dataset:d}=createSyntheticDemo();
    const csv=shape==='wide'?[['date',...d.symbols].join(','),...d.dates.map((day,i)=>[day,...d.prices[i]].join(','))].join('\n'):
      ['date,symbol,adjusted_close',...d.dates.flatMap((day,i)=>d.symbols.map((symbol,j)=>[day,symbol,d.prices[i][j]].join(',')))].join('\n');
    download(csv,`synthetic-prices-${shape}-example.csv`,'text/csv');
  }
  const selectOptions=(headers:string[])=>headers.map(h=><option key={h} value={h}>{h}</option>);
  return <section className="data-panel" aria-labelledby="data-heading">
    <div className="section-head"><div><span className="eyebrow">01 / DATA</span><h2 id="data-heading">Your inputs, kept on your device.</h2></div><span className={`status-pill ${dataset||automaticPrices?'ready':''}`}>{dataset?'Market data ready':automaticPrices?'Prices fetched on compare':'Missing market data'}</span></div>
    <p className="muted">{automaticPrices?'Price history will be fetched for the ETFs you enter above. You can also import a holdings table here; no price file or brokerage connection is required.':'Holdings describe what you own. Price history supplies the market context. Import them separately; no brokerage connection required.'}</p>
    {dataset&&<div className="dataset-strip"><strong>{dataset.manifest.synthetic?'SYNTHETIC EXAMPLE':dataset.manifest.source}</strong><span>{dataset.dates[0]} → {dataset.manifest.asOf}</span><span>{dataset.symbols.length} assets · {dataset.dates.length.toLocaleString()} prices each · USD</span><span>{dataset.manifest.rights.rawPersistence?'Saving permitted by source declaration':'Session only · no data persistence'}</span></div>}
    <div className="import-grid">
      <details className="import-card"><summary><span className="round-icon">↙</span><span><strong>Import holdings</strong><small>Paste a table or map a CSV</small></span><span className="chevron">+</span></summary>
        <div className="details-body">
          <div className="button-row" aria-label="Holdings CSV templates">{[
            ['Percent template','holdings-percent.csv','symbol,weight\nSPY,60\nBND,30\nCASH,10'],
            ['Decimal template','holdings-decimal.csv','symbol,weight\nSPY,0.6\nBND,0.3\nCASH,0.1'],
            ['USD value template','holdings-usd-values.csv','symbol,market_value\nSPY,6000\nBND,3000\nCASH,1000'],
          ].map(([label,name,csv])=><button className="quiet" key={name} onClick={()=>download(csv,name,'text/csv')}>{label}</button>)}</div>
          <div className="form-grid"><label>Import into<select value={target} onChange={e=>setTarget(e.target.value as 'a'|'b')}><option value="a">A · Current portfolio</option><option value="b">B · Proposed portfolio</option></select></label><label>Values represent<select value={holdingMode} onChange={e=>setHoldingMode(e.target.value as typeof holdingMode)}><option value="weight">Portfolio weights</option><option value="market_value">Market values in USD</option></select></label></div>
          {holdingMode==='weight'&&<label>Weight units<select value={weightUnit} onChange={e=>setWeightUnit(e.target.value as typeof weightUnit)}><option value="percent">Percent (50 means 50%)</option><option value="decimal">Decimal (0.5 means 50%)</option></select></label>}
          <label>Holdings CSV file<input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={e=>void readFile(e.currentTarget,'holdings')}/></label>
          <label>Holdings table<textarea rows={5} placeholder={'symbol,weight\nSPY,55\nBND,35\nCASH,10'} value={holdingText} onChange={e=>{reads.current.holdings++;setHoldingText(e.target.value);setDuplicateHolding(false);}}/></label>
          <button className="quiet" onClick={()=>inspect(holdingText,'holdings')}>Read holdings columns</button>
          {holdingHeaders.length>0&&<div className="form-grid"><label>Symbol column<select value={symbolColumn} onChange={e=>setSymbolColumn(e.target.value)}>{selectOptions(holdingHeaders)}</select></label><label>Weight or value column<select value={holdingValue} onChange={e=>setHoldingValue(e.target.value)}>{selectOptions(holdingHeaders)}</select></label></div>}
          <label className="check"><input type="checkbox" checked={duplicateHolding} onChange={e=>setDuplicateHolding(e.target.checked)}/>Merge duplicate symbols by adding their values</label>
          <button className="secondary" onClick={loadHoldings}>Preview holdings</button>
          {holdingPreview&&<div className="import-preview" aria-label="Holdings import preview"><h3>Review before applying to {target.toUpperCase()}</h3><p>{holdingPreview.portfolio.holdings.length} holdings · weights total 100%. {holdingPreview.mergedSymbols.length>0?`Merged duplicates: ${holdingPreview.mergedSymbols.join(', ')}.`:''}</p>
            {holdingPreview.portfolio.holdings.some(h=>h.symbol==='USD')&&<p className="warning">USD is the ProShares Ultra Semiconductors ETF. Use CASH for modeled cash. This preview does not treat the ticker USD as cash.</p>}
            {holdingPreview.unknownSymbols.length>0&&<p className="warning">Unmatched holdings retained: {holdingPreview.unknownSymbols.join(', ')}. They require an explicit partial-coverage decision.</p>}
            <div className="table-scroll"><table><thead><tr><th>Symbol</th><th>Weight</th></tr></thead><tbody>{holdingPreview.portfolio.holdings.slice(0,20).map(h=><tr key={h.symbol}><th>{h.symbol}</th><td>{(h.weight*100).toFixed(4)}%</td></tr>)}</tbody></table></div><p className="hint">Showing the first {Math.min(20,holdingPreview.portfolio.holdings.length)} holdings. All {holdingPreview.portfolio.holdings.length} will be applied.</p>
            <button className="secondary" onClick={()=>{onPortfolio(holdingPreview.portfolio,target);onNotice(`Imported ${holdingPreview.portfolio.holdings.length} holdings into ${target.toUpperCase()}. Original weights were replaced only after confirmation.`);setHoldingPreview(null);}}>Import holdings</button></div>}
        </div>
      </details>
      {showPrices&&<details className="import-card"><summary><span className="round-icon">▥</span><span><strong>Import price history</strong><small>Adjusted daily prices · long or wide CSV</small></span><span className="chevron">+</span></summary>
        <div className="details-body">
          <p className="hint">At least 253 common daily prices for the default risk report. Get adjusted historical prices from a source you are entitled to use. Prices and holdings alone do not establish your actual account return. Import selects your current A/B symbols; adding another asset later may require importing its history again.</p>
          <label>Market prices CSV file<input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={e=>void readFile(e.currentTarget,'prices')}/></label>
          <label>Market prices CSV<textarea rows={5} placeholder={'date,symbol,adjusted_close\n2025-01-02,SPY,580.00\n2025-01-02,BND,72.00'} value={marketText} onChange={e=>replacePriceText(e.target.value)}/></label>
          <button className="quiet" onClick={()=>inspect(marketText,'prices')}>Read price columns</button>
          <div className="form-grid"><label>CSV shape<select value={format} onChange={e=>patchDraft({format:e.target.value as typeof format})}><option value="long">Long: date, symbol, value</option><option value="wide">Wide: date, one column per symbol</option></select></label><label>Price basis<select value={basis} onChange={e=>patchDraft({basis:e.target.value as typeof basis})}><option value="adjusted_close">Adjusted close (splits + distributions)</option><option value="total_return_index">Total-return index</option></select></label></div>
          {marketHeaders.length>0&&<div className="form-grid"><label>Date column<select value={dateColumn} onChange={e=>patchDraft({dateColumn:e.target.value})}>{selectOptions(marketHeaders)}</select></label>{format==='long'&&<><label>Price symbol column<select value={priceSymbol} onChange={e=>patchDraft({priceSymbol:e.target.value})}>{selectOptions(marketHeaders)}</select></label><label>Price value column<select value={priceValue} onChange={e=>patchDraft({priceValue:e.target.value})}>{selectOptions(marketHeaders)}</select></label></>}</div>}
          <label>Data provenance<select value={synthetic?'synthetic':'observed'} onChange={e=>patchDraft({synthetic:e.target.value==='synthetic'})}><option value="observed">Observed market data · US trading sessions</option><option value="synthetic">Synthetic test data · generated weekday example</option></select></label>
          <label>Data source<input value={source} maxLength={500} onChange={e=>patchDraft({source:e.target.value})} placeholder="Provider, export date and adjustment convention"/></label>
          <label className="check"><input type="checkbox" checked={usd} onChange={e=>patchDraft({usd:e.target.checked},false)}/>All prices are in USD and use the selected adjusted-price basis</label>
          <label className="check"><input type="checkbox" checked={duplicatePrice} onChange={e=>patchDraft({duplicatePrice:e.target.checked},false)}/>Remove identical duplicate price rows (conflicting values always block)</label>
          <label className="check"><input type="checkbox" checked={license} onChange={e=>patchDraft({license:e.target.checked},false)}/>I have permission to store and export this file and its derived results on my device</label>
          <p className="hint">Leave the last box unchecked for a session-only review. Source rights are your declaration, not a provider license verification. Automatic API connections have their own source permissions.</p>
          <div className="button-row"><button className="secondary" onClick={loadMarket}>Preview prices</button><button className="quiet" onClick={()=>sample('wide')}>Download synthetic CSV example</button><button className="quiet" onClick={()=>sample('long')}>Download long CSV example</button></div>
          {pricePreview&&<div className="import-preview" aria-label="Price import preview"><h3>Review price coverage</h3><p>{pricePreview.dates[0]} → {pricePreview.dates.at(-1)} · {pricePreview.dates.length} common prices per asset · {pricePreview.symbols.length} assets · USD · {pricePreview.manifest.basis.replaceAll('_',' ')}</p><p className="hint">{pricePreview.manifest.source} · {pricePreview.manifest.rights.export?'Storage and exports permitted by your declaration':'Session-only analysis; full report export is unavailable'}</p>
            <div className="table-scroll"><table><thead><tr><th>Date</th>{pricePreview.symbols.slice(0,6).map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{pricePreview.dates.slice(0,20).map((d,i)=><tr key={d}><th>{d}</th>{pricePreview.prices[i].slice(0,6).map((v,j)=><td key={j}>{v.toFixed(4)}</td>)}</tr>)}</tbody></table></div><p className="hint">Showing at most 20 dates and 6 assets. All validated observations will be used. Selected holdings without history remain uncovered.</p>
            <button className="secondary" onClick={()=>{onDataset(pricePreview);onNotice(`Imported ${pricePreview.dates.length.toLocaleString()} common price dates across ${pricePreview.symbols.length} assets. Original files remain on your device.`);setPricePreview(null);}}>Import prices</button></div>}
        </div>
      </details>}
    </div>
    {error&&<div className="error" role="alert">{error}</div>}
    {diagnostics.length>0&&<div className="table-scroll" aria-label="Import issues"><table><thead><tr><th>CSV row</th><th>Column</th><th>Issue</th></tr></thead><tbody>{diagnostics.slice(0,100).map((d,i)=><tr key={i}><td>{d.row}</td><td>{d.column}</td><td>{d.message}</td></tr>)}</tbody></table><p className="hint">{diagnostics.length} issues. Showing the first 100; none of this import was applied.</p></div>}
    <details className="supported"><summary>Supported symbols and data requirements</summary><p>{SUPPORTED_SYMBOLS.length.toLocaleString()} US ETF listings in the {CATALOG_AS_OF} catalog. Search by code or fund name in either allocation. Up to {MAX_REVIEW_ASSETS} different noncash assets across A and B, plus USD cash.</p><p className="hint">A listing is not a guarantee of usable price history. Currency, adjustments and source permissions are checked separately. Unknown metadata remains unknown. Leveraged or inverse funds use their actual fund prices; their daily target is not a long-term return assumption.</p><p className="hint">Use a continuous daily trading-session series. Do not combine providers, fill missing prices, or use unadjusted closing prices. Data checks cannot certify the provider's adjustment calculations.</p></details>
  </section>;
}
