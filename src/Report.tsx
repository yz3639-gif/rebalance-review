import { Component, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { ReviewResult, ReviewContext } from './types';
import { historyChartOption, methodNotes, OPEN_QUESTIONS } from './pdf/model';
import { manifestRightsDecision } from './data/rights';
// A ready workbench already has its chart code; network recovery must not require
// reloading the page and discarding unsaved allocations or reasoning.
import Chart from './Chart';
import './pdf/pdf.css';
import './report-terminal.css';
class ChartBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<p className="warning">The chart could not load. Your results are preserved in the tables below.</p>:this.props.children;}
}
export const pct=(n:number,d=2)=>`${(n*100).toFixed(d)}%`;
const pp=(n:number)=>`${n>=0?'+':''}${(n*100).toFixed(2)} pp`;
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);
function difference(n:number) {return Math.abs(n)<1e-10?'No change':n>0?'Higher in B':'Lower in B';}
function ComparisonMetric({label,a,b,note}:{label:string;a:number;b:number;note:string}) {
  return <div className="kpi"><span className="eyebrow">{label}</span><div className="metric-pair"><div><span className="metric-label"><i className="series-dot series-a"/>A · Current</span><strong>{pct(a)}</strong></div><div><span className="metric-label"><i className="series-dot series-b"/>B · Proposed</span><strong>{pct(b)}</strong></div></div><div className="metric-delta"><span>Δ B − A</span><strong>{pp(b-a)}</strong></div><small>{note}</small></div>;
}
function WeightCell({value,series}:{value:number;series:'a'|'b'}) {
  return <td className={`weight-cell weight-${series}`}><span>{pct(value,1)}</span><span className="weight-track" aria-hidden="true"><i style={{width:`${Math.max(0,Math.min(100,value*100))}%`}}/></span></td>;
}
export default function Report({result:r,spec:s,archived=false,rationale='',nextReview='',createdAt}:{result:ReviewResult;spec:ReviewContext;archived?:boolean;rationale?:string;nextReview?:string;createdAt?:string}) {
  const risk=r.risk.windows.find(w=>w.window===252)!;
  const a=risk.a!,b=risk.b!,ha=r.history.a,hb=r.history.b;
  const symbols=[...new Set([...s.a.holdings,...s.b.holdings].map(h=>h.symbol))];
  const weight=(which:'a'|'b',symbol:string)=>s[which].holdings.find(h=>h.symbol===symbol)?.weight||0;
  const deltaVol=b.volatility-a.volatility;
  const direction=(v:number)=>Math.abs(v)<1e-10?0:Math.sign(v);
  const consistent=r.risk.windows.filter(w=>w.available).every(w=>direction((w.b?.volatility||0)-(w.a?.volatility||0))===direction(deltaVol));
  const option=useMemo(()=>historyChartOption(r.history),[r.history]);
  const canPrintFull=manifestRightsDecision(s.manifest,'exportDerived').allowed;
  const acquisition=s.manifest.acquisition;
  function coverage(p:'a'|'b') {
    const v=s[p].marketValues;
    if(!v) return 'Unknown — weight-only input';
    const total=Object.values(v).reduce((sum,n)=>sum+n,0), covered=r.symbols.reduce((sum,key)=>sum+(v[key]||0),0);
    return total>0?`${pct(covered/total,1)} (${money(covered)} of ${money(total)})`:'Unknown';
  }
  return <section className={`report quant-report${canPrintFull?'':' report-print-restricted'}`} aria-labelledby={archived?'archive-heading':'review-heading'}>
    {!canPrintFull&&<p className="print-restriction-notice">This data source does not permit exporting the full analysis. Download the decision-only PDF to keep your own allocation inputs, reasoning and review date.</p>}
    <div className="section-head report-heading"><div><span className="eyebrow">03 / {archived?'ARCHIVED SNAPSHOT':'REVIEW'}</span><h2 id={archived?'archive-heading':'review-heading'} tabIndex={-1}>{archived?'Archived review':'Your review'}</h2></div><span className="status-pill ready">{r.observations.toLocaleString()} common returns</span></div>
    <p className="muted report-subtitle">Same data. Same timing. Same costs. A clearer view of what changes.</p>
    {archived&&createdAt&&<p className="hint">Original review created {createdAt}. Historical data and review dates are preserved.</p>}
    <div className={`report-banner ${r.partial?'warning':''}`}><strong>{s.manifest.synthetic?'SYNTHETIC EXAMPLE · ':''}{r.partial?'PARTIAL PORTFOLIOS · ':''}{s.manifest.basis==='cash_zero'?'Assumption-only cash scenario — no observed market returns':'Hypothetical replay — not actual account performance'}</strong><span>Data cutoff {r.asOf} · Common history {r.start} to {r.end} · {s.frequency==='buy-hold'?'Buy and hold':s.frequency+' rebalancing'} · {s.costBps} bps per side</span></div>
    <dl className="report-metadata"><div><dt>DATA CUTOFF</dt><dd>{r.asOf}</dd></div><div><dt>COMMON HISTORY</dt><dd>{r.start}<span> → </span>{r.end}</dd></div><div><dt>REBALANCING</dt><dd>{s.frequency==='buy-hold'?'Buy and hold':s.frequency}</dd></div><div><dt>MODELED COST</dt><dd>{s.costBps}<span> bps / side</span></dd></div></dl>
    {r.partial&&<div className="warning"><strong>This is a comparison of the covered portions only.</strong><p>A covers {pct(r.coverage.a,1)} of allocation weight; B covers {pct(r.coverage.b,1)}. Covered weights are normalized separately. Excluded holdings can change the full-portfolio conclusion.</p></div>}
    <div className="kpi-grid">
      <ComparisonMetric label="ANNUALIZED RISK · 252 SESSIONS" a={a.volatility} b={b.volatility} note={`${difference(deltaVol)} · annualized volatility`}/>
      <ComparisonMetric label="HYPOTHETICAL ANNUAL GROWTH" a={ha.cagr} b={hb.cagr} note="After modeled trading costs"/>
      <ComparisonMetric label="MAXIMUM HISTORICAL DRAWDOWN" a={ha.maxDrawdown} b={hb.maxDrawdown} note="Peak-to-trough decline over the common period"/>
    </div>
    <article className="panel history-panel"><div className="section-head"><div className="panel-title"><span className="number">01</span><h3>What would today's weights have looked like?</h3></div><span className="muted">Starting capital {money(s.initialNav)}</span></div><p className="hint">A hypothetical replay, including the initial purchase fee. It does not reconstruct deposits, withdrawals or your past trades.</p><ChartBoundary><Chart option={option} label={`Hypothetical wealth: current portfolio ends at ${money(ha.nav.at(-1)!)}, proposed portfolio at ${money(hb.nav.at(-1)!)}. Detailed metrics follow.`}/></ChartBoundary><div className="table-scroll"><table><thead><tr><th>Common-period outcome</th><th>A · Current</th><th>B · Proposed</th></tr></thead><tbody><tr><th>Ending hypothetical wealth</th><td>{money(ha.nav.at(-1)!)}</td><td>{money(hb.nav.at(-1)!)}</td></tr><tr><th>Total return, after costs</th><td>{pct(ha.totalReturn)}</td><td>{pct(hb.totalReturn)}</td></tr><tr><th>Modeled trading fees</th><td>{money(ha.fees)}</td><td>{money(hb.fees)}</td></tr><tr><th>Gross turnover / pre-trade NAV, summed</th><td>{pct(ha.turnover,1)}</td><td>{pct(hb.turnover,1)}</td></tr><tr><th>Rebalance events, including initial purchase</th><td>{ha.trades}</td><td>{hb.trades}</td></tr></tbody></table></div></article>
    <div className="report-grid"><article className="panel"><div className="panel-title"><span className="number">02</span><h3>What changes in your allocation?</h3></div><div className="table-scroll"><table><caption className="sr-only">Original allocation weights before any partial coverage normalization</caption><thead><tr><th>Asset</th><th>A · Current</th><th>B · Proposed</th><th>Change</th></tr></thead><tbody>{symbols.map(symbol=><tr key={symbol}><th>{symbol}<small className="cell-note">{!r.symbols.includes(symbol)&&weight('a',symbol)+weight('b',symbol)>0?'Excluded from analysis':symbol==='CASH'?'USD · 0% return':''}</small></th><WeightCell value={weight('a',symbol)} series="a"/><WeightCell value={weight('b',symbol)} series="b"/><td>{pp(weight('b',symbol)-weight('a',symbol))}</td></tr>)}</tbody></table></div><div className="coverage"><strong>Coverage by USD market value</strong><span>A: {coverage('a')}</span><span>B: {coverage('b')}</span></div></article>
    <article className="panel"><div className="panel-title"><span className="number">03</span><h3>Where does the risk come from?</h3></div><p className="hint">Signed contributions to annualized volatility, in percentage points. Negative values indicate a diversification effect in this estimate.</p><div className="table-scroll"><table><thead><tr><th>Asset</th><th>A · Risk pp</th><th>B · Risk pp</th></tr></thead><tbody>{r.symbols.map(symbol=><tr key={symbol}><th>{symbol}</th><td>{(100*(a.contributions[symbol]||0)).toFixed(3)}</td><td>{(100*(b.contributions[symbol]||0)).toFixed(3)}</td></tr>)}</tbody><tfoot><tr><th>Total volatility</th><td>{pct(a.volatility,3)}</td><td>{pct(b.volatility,3)}</td></tr></tfoot></table></div><p className="hint">{a.relativeContributions===null||b.relativeContributions===null?'Zero-volatility portfolios have no defined relative risk contributions.':'Contributions reconcile to total volatility before display rounding.'} Correlation does not measure overlapping fund holdings.</p></article></div>
    <div className="report-grid"><article className="panel"><div className="panel-title"><span className="number">04</span><h3>Does the risk direction hold up?</h3></div><p className="insight">{consistent?'The direction is consistent across available windows.':'The risk direction changes with the estimation window.'}</p><div className="table-scroll"><table><thead><tr><th>Daily returns</th><th>A · Volatility</th><th>B · Volatility</th><th>Change</th></tr></thead><tbody>{r.risk.windows.map(w=><tr key={w.window}><th>{w.window}{w.window===252?' · default':''}</th><td>{w.available?pct(w.a!.volatility):'Unavailable'}</td><td>{w.available?pct(w.b!.volatility):'Unavailable'}</td><td>{w.available?pp(w.b!.volatility-w.a!.volatility):'Too little history'}</td></tr>)}</tbody></table></div><p className="hint">These are sensitivity checks, not forecasts or probabilities of loss. Lower estimated volatility alone does not determine which allocation suits you.</p></article>
    <article className="panel"><div className="panel-title"><span className="number">05</span><h3>How much do costs and timing matter?</h3></div><p className="hint">Hypothetical annualized growth under alternative per-side costs.</p><div className="table-scroll"><table><thead><tr><th>Cost per side</th><th>A · Growth</th><th>B · Growth</th></tr></thead><tbody>{r.costSensitivity.map(c=><tr key={c.costBps}><th>{c.costBps} bps</th><td>{pct(c.aCagr)}</td><td>{pct(c.bCagr)}</td></tr>)}</tbody></table></div><p className="insight">One extra session of execution delay: A {pct(r.delaySensitivity.a.cagr)}, B {pct(r.delaySensitivity.b.cagr)} annual growth.</p><p className="hint">Existing holdings earn the execution-day return. Fees apply to purchases and sales of risky assets; cash transfers are not charged again.</p></article></div>
    {(acquisition||s.catalog)&&<article className="panel data-provenance" aria-label="Data coverage and identity"><h3>Data coverage and identity</h3>
      {acquisition&&<><p>Requested history: {acquisition.requestedStart} to {acquisition.requestedEnd}.</p><p>Actual common analysis history: {r.start} to {r.end} · {r.observations+1} common prices ({r.observations} returns).</p><p className="hint">The observations below are what the source returned before common-period alignment. Data availability dates do not establish a fund's inception date.</p><div className="table-scroll"><table><thead><tr><th>Asset</th><th>First observation</th><th>Last observation</th><th>Prices</th></tr></thead><tbody>{acquisition.assets.map(asset=><tr key={asset.symbol}><th>{asset.symbol}</th><td>{asset.firstDate}</td><td>{asset.lastDate}</td><td>{asset.observations}</td></tr>)}</tbody></table></div></>}
      {s.catalog&&<p className="hint">Asset directory snapshot: {s.catalog.version} · dated {s.catalog.asOf}. This review retains its recorded asset identity after later directory changes.</p>}
    </article>}
    <details className="assumptions"><summary>Read the assumptions and unanswered questions</summary><ul>{r.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul><p>What changed in your objectives or time horizon? Does this choice still make sense if historical relationships change? Have taxes and real brokerage costs been considered separately?</p><p>Data: {s.manifest.source} · Basis: {s.manifest.basis} · Currency: USD. No risk-free series is supplied, so no Sharpe ratio is displayed.</p></details>
    <p className="hint report-identity">Report ID: {r.id}{createdAt?` · Original review created ${createdAt}`:''}</p>
    <section className="print-context" aria-label="Printable decision and method context"><h3>Your reasoning and next review</h3><p>{rationale.trim()||'No reason recorded.'}</p><p>Next review date: {nextReview||'Not recorded'}. This date does not schedule a reminder.</p><h3>Data and method context</h3><p>Data source: {s.manifest.source}. Basis: {s.manifest.basis}. Currency: USD. Data cutoff: {r.asOf}.</p>{r.warnings.map((warning,i)=><p key={`warning-${i}`}>{warning}</p>)}{methodNotes(s.manifest.basis).map((note,i)=><p key={`method-${i}`}>{note}</p>)}<h3>Questions to revisit</h3>{OPEN_QUESTIONS.map((question,i)=><p key={`question-${i}`}>{question}</p>)}</section>
  </section>;
}
