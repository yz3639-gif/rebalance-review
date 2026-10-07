import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import type { PdfSnapshot, FullSnapshot } from './model';
import { DECISION_NOTES, breakLongTokens, methodNotes, OPEN_QUESTIONS, PDF_REPORT_VERSION, formatMoney as money, formatPercent as pct, formatPoints as pp, marketValueCoverage, portfolioRows } from './model';

const styles = StyleSheet.create({
  page: { paddingTop: 56, paddingBottom: 48, paddingHorizontal: 40, fontFamily: 'RebalanceSansSC', fontSize: 8.5, lineHeight: 1.4, color: '#253b32', backgroundColor: '#ffffff' },
  runningHead: { position: 'absolute', top: 24, left: 40, right: 40, color: '#607267', fontFamily: 'RebalanceSansSC', fontSize: 8, paddingBottom: 7 },
  footer: { position: 'absolute', top: 763, left: 40, right: 40, color: '#607267', fontFamily: 'RebalanceSansSC', fontSize: 7, lineHeight: 1.2 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 25, lineHeight: 1.2, color: '#183f34', marginBottom: 8 },
  subtitle: { fontSize: 9, color: '#607267', marginBottom: 13 },
  h2: { fontFamily: 'Helvetica-Bold', fontSize: 14, lineHeight: 1.3, color: '#183f34', marginTop: 11, marginBottom: 6 },
  h3: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginTop: 10, marginBottom: 5 },
  body: { marginBottom: 7 },
  small: { color: '#526358', fontSize: 8, marginBottom: 6 },
  banner: { backgroundColor: '#eef2e7', border: '1pt solid #ccd8bf', padding: 10, marginBottom: 10 },
  warning: { backgroundColor: '#fcf5e7', border: '1pt solid #e9d7b4', padding: 10, marginBottom: 10, color: '#77501d' },
  strong: { fontFamily: 'Helvetica-Bold' },
  table: { marginTop: 5, marginBottom: 10 },
  row: { flexDirection: 'row', borderBottom: '0.5pt solid #dce2d8', paddingVertical: 4 },
  tableHead: { backgroundColor: '#eef2e7', fontSize: 8, color: '#183f34' },
  cell: { paddingHorizontal: 5, fontSize: 8 },
  chart: { width: '100%', height: 185, marginTop: 7, marginBottom: 10, objectFit: 'contain' },
  note: { borderLeft: '2pt solid #7d946a', paddingLeft: 10, marginBottom: 9 },
  metadata: { fontSize: 8, marginBottom: 4, color: '#526358' },
  label: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#526358' },
});

function Sheet({ snapshot, children }: { snapshot: PdfSnapshot; children: ReactNode }) {
  return <Page size="LETTER" style={styles.page} wrap>
    <Text style={styles.runningHead} fixed render={()=>`REBALANCE REVIEW                                                   ${snapshot.mode === 'full' ? 'PORTFOLIO COMPARISON' : 'DECISION RECORD'}`}/>
    {children}
    <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) => `${snapshot.id} | Report ${PDF_REPORT_VERSION}                                    ${pageNumber} / ${totalPages}`} />
  </Page>;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View><Text style={styles.h2} minPresenceAhead={36}>{title}</Text>{children}</View>;
}
function Table({ headers, rows, widths }: { headers: string[]; rows: string[][]; widths?: number[] }) {
  const sizes = widths ?? headers.map(() => 100 / headers.length);
  const firstSize = rows.length > 8 ? 4 : 8;
  const chunks = [rows.slice(0, firstSize), ...Array.from({ length: Math.ceil(Math.max(0, rows.length - firstSize) / 8) }, (_, i) => rows.slice(firstSize + i * 8, firstSize + i * 8 + 8))];
  return <View style={styles.table}>{chunks.map((chunk, group) => <View key={group} wrap={false}>
    <View style={[styles.row, styles.tableHead]} wrap={false}>{headers.map((h, i) => <Text key={i} style={[styles.cell, { width: `${sizes[i]}%` }]}>{h}</Text>)}</View>
    {chunk.map((row, i) => <View key={i} style={styles.row} wrap={false}>{row.map((value, j) => <Text key={j} style={[styles.cell, { width: `${sizes[j]}%` }]}>{value}</Text>)}</View>)}
  </View>)}
  </View>;
}
function Rationale({ snapshot: s }: { snapshot: PdfSnapshot }) {
  // Bound both characters and explicit lines: 600 newline-rich characters can
  // otherwise make a non-splitting Text taller than a page and silently lose text.
  // Each bounded block fits comfortably on a sheet; React PDF places whole blocks.
  const text=breakLongTokens(s.rationale),paragraphs:string[]=[];
  let remainder=text;
  while(remainder) {
    let end=Math.min(600,remainder.length);
    let lines=0;
    for(let index=0;index<end;index++) {
      if(/[\r\n\u2028\u2029]/.test(remainder[index])&&++lines===12){end=index+1;break;}
    }
    if(end<remainder.length) {
      const boundary=Math.max(remainder.lastIndexOf('\n',end),remainder.lastIndexOf(' ',end));
      if(boundary>300) end=boundary+1;
    }
    paragraphs.push(remainder.slice(0,end));remainder=remainder.slice(end);
  }
  // Keep chunks as direct Page children. A very tall enclosing View can itself
  // acquire invalid layout coordinates while being split across many pages.
  return <>
    <Text style={styles.h2} minPresenceAhead={36}>Your decision and next review</Text>
    <Text style={styles.label}>WHY THIS CHANGE?</Text>
    {paragraphs.map((paragraph,i)=><Text key={i} style={[styles.body,{marginTop:i===0?6:0}]} wrap={false}>{paragraph}</Text>)}
    <Text style={styles.body}>Next review date: {s.nextReview}</Text>
    <Text style={styles.small}>This date is a note in your record. It creates no reminder, email, or scheduled task.</Text>
  </>;
}
function Questions() {
  return <View wrap={false}><Section title="Questions to revisit">{OPEN_QUESTIONS.map((q, i) => <Text key={i} style={styles.body}>{i + 1}. {q}</Text>)}</Section></View>;
}
function Allocation({ snapshot: s }: { snapshot: PdfSnapshot }) {
  return <Section title="Current and proposed allocations">
    <Text style={styles.small}>Original input weights, before any partial-coverage normalization.</Text>
    <Table headers={['Asset', 'A - Current', 'B - Proposed', 'Change']} widths={[34, 22, 22, 22]}
      rows={portfolioRows(s).map(([symbol, a, b, change, note]) => [note ? `${symbol}\n${note}` : symbol, a, b, change])} />
    {s.mode === 'full' && <>
      <Text style={styles.small}>Coverage by allocation weight: A {pct(s.result.coverage.a, 1)}; B {pct(s.result.coverage.b, 1)}.</Text>
      <Text style={styles.small}>Coverage by USD market value - A: {marketValueCoverage(s.a, s.result.symbols)}</Text>
      <Text style={styles.small}>Coverage by USD market value - B: {marketValueCoverage(s.b, s.result.symbols)}</Text>
    </>}
  </Section>;
}
function Intro({ snapshot: s }: { snapshot: PdfSnapshot }) {
  return <>
    <Text style={styles.title}>{s.mode === 'full' ? 'Your allocation review.' : 'Your decision record.'}</Text>
    <Text style={styles.subtitle}>A clear record of the change, the trade-offs, and your reasoning.</Text>
    <Text style={styles.metadata}>Generated {s.createdAt} | Report ID {s.id}</Text>
    {s.reviewCreatedAt&&<Text style={styles.metadata}>Original review created {s.reviewCreatedAt}</Text>}
    {s.archived && <View style={styles.warning}><Text>Archived snapshot. Imported content is user-controlled; structural validation is not proof of unchanged calculations. This export does not independently rerun the historical analysis.</Text></View>}
    {s.mode === 'full' ? <>
      <View style={styles.banner}><Text>{s.manifest.synthetic ? 'SYNTHETIC EXAMPLE. ' : ''}{s.result.partial ? 'PARTIAL PORTFOLIOS. ' : ''}{s.manifest.basis === 'cash_zero' ? 'Assumption-only cash scenario - no observed market returns.' : 'Hypothetical replay - not actual account performance.'}</Text></View>
      <Text style={styles.metadata}>Data source: {breakLongTokens(s.manifest.source)}</Text>
      <Text style={styles.metadata}>Basis: {s.manifest.basis} | Currency: {s.manifest.currency} | Data cutoff: {s.result.asOf}</Text>
      {s.versions?<Text style={styles.metadata}>Recorded calculation versions: app {s.versions.app} | engine {s.versions.engine} | method {s.versions.method}</Text>:s.archived?<Text style={styles.metadata}>Original calculation versions were not recorded in this archive.</Text>:null}
      {s.catalog&&<Text style={styles.metadata}>Asset directory: {s.catalog.version} | Directory date: {s.catalog.asOf}. Historical asset identities are retained from this review.</Text>}
      <Text style={styles.metadata}>{s.manifest.basis === 'cash_zero' ? 'Modeled period' : 'Common history'}: {s.result.start} to {s.result.end} | {s.result.observations} {s.manifest.basis === 'cash_zero' ? 'modeled sessions' : 'returns'}</Text>
      {s.result.partial && <View style={styles.warning}><Text>This compares the covered portions only. Covered weights are normalized separately. Excluded holdings can change the full-portfolio conclusion.</Text></View>}
    </> : <View style={styles.warning}><Text>Decision-only record. Source permissions do not permit a full report export. This document contains your own inputs and reasoning only; it contains no market data or derived analytical results.</Text></View>}
    <Text style={styles.metadata}>Selected scenario: {s.settings.frequency} | {s.settings.costBps} bps per side | Starting USD: {money(s.settings.initialNav)}</Text>
    <Text style={styles.metadata}>Cash 0% assumption: {s.settings.cashReturnConfirmed ? 'confirmed' : 'not applicable / not confirmed'} | Partial-comparison confirmation: {s.settings.partialCoverageConfirmed ? 'confirmed' : 'not confirmed'}</Text>
  </>;
}
function DataProvenance({snapshot:s}:{snapshot:FullSnapshot}) {
  const acquisition=s.manifest.acquisition;
  if(!acquisition) return null;
  return <Sheet snapshot={s}>
    <Text style={styles.title}>Data coverage.</Text>
    <Text style={styles.body}>Requested history: {acquisition.requestedStart} to {acquisition.requestedEnd}.</Text>
    <Text style={styles.body}>Actual common analysis history: {s.result.start} to {s.result.end}; {s.result.observations+1} common prices ({s.result.observations} returns).</Text>
    <Text style={styles.small}>Dates below are the actual returned observations for each asset before common-period alignment. Provider coverage dates, when available, describe data availability; they do not establish a fund's inception date.</Text>
    <Table headers={['Asset','First observation','Last observation','Prices']} widths={[20,30,30,20]} rows={acquisition.assets.map(asset=>[asset.symbol,asset.firstDate,asset.lastDate,String(asset.observations)])}/>
    {s.catalog&&<Text style={styles.small}>Asset directory snapshot: {s.catalog.version}, dated {s.catalog.asOf}. This review retains its recorded asset identity after later directory changes.</Text>}
  </Sheet>;
}
function FullResults({ snapshot: s, chartPng }: { snapshot: FullSnapshot; chartPng: string }) {
  const r = s.result, risk = r.risk.windows.find(w => w.window === 252)!;
  const cashOnly = s.manifest.basis === 'cash_zero';
  const a = risk.a!, b = risk.b!, ha = r.history.a, hb = r.history.b;
  const direction = (v: number) => Math.abs(v) < 1e-10 ? 0 : Math.sign(v);
  const delta = b.volatility - a.volatility;
  const consistent = r.risk.windows.filter(w => w.available).every(w => direction((w.b?.volatility ?? 0) - (w.a?.volatility ?? 0)) === direction(delta));
  return <>
    <Sheet snapshot={s}>
      <Intro snapshot={s} />
      <Section title="Comparison at a glance"><Table headers={['Measure', 'A - Current', 'B - Proposed']} widths={[46, 27, 27]} rows={[
        [cashOnly ? 'Modeled volatility - zero-return assumption' : 'Annualized risk - 252 sessions', pct(a.volatility), pct(b.volatility)],
        [cashOnly ? 'Modeled annual growth' : 'Hypothetical annual growth, after costs', pct(ha.cagr), pct(hb.cagr)],
        [cashOnly ? 'Modeled drawdown' : 'Maximum historical drawdown', pct(ha.maxDrawdown), pct(hb.maxDrawdown)],
      ]} /><Text style={styles.small}>{cashOnly ? 'Both paths are consequences of the 0% cash-return assumption. They do not describe actual savings yields.' : `Estimated risk change: ${pp(delta)}. Lower estimated volatility alone does not determine suitability.`}</Text></Section>
      <Allocation snapshot={s} />
    </Sheet>
    <Sheet snapshot={s}>
      <Text style={styles.title}>{cashOnly ? 'Modeled cash path.' : 'Risk and historical replay.'}</Text>
      <Section title="Where does the risk come from?">
        <Text style={styles.small}>{cashOnly ? 'Cash has zero modeled volatility and covariance under the selected assumption.' : 'Signed contributions to annualized volatility in percentage points. Negative values are valid diversification effects in this estimate.'}</Text>
        <Table headers={['Asset', 'A - Risk pp', 'B - Risk pp']} widths={[46, 27, 27]} rows={[
          ...r.symbols.map(symbol => [symbol, ((a.contributions[symbol] ?? 0) * 100).toFixed(3), ((b.contributions[symbol] ?? 0) * 100).toFixed(3)]),
          ['Total volatility', pct(a.volatility, 3), pct(b.volatility, 3)],
        ]} />
        <Text style={styles.small}>{a.relativeContributions === null || b.relativeContributions === null ? 'Zero-volatility portfolios have no defined relative risk contributions.' : 'Contributions reconcile to total volatility before display rounding.'} Correlation does not measure overlap of fund holdings.</Text>
      </Section>
      <Section title="What would these weights have looked like?">
        <Text style={styles.small}>{cashOnly ? `Modeled cash wealth remains ${money(s.settings.initialNav)}. No ETF purchase or fee is applied.` : `Hypothetical wealth from ${money(s.settings.initialNav)}, including the initial purchase fee. These are not actual account balances.`}</Text>
        <Image src={chartPng} style={styles.chart} />
        <Table headers={['Common-period outcome', 'A - Current', 'B - Proposed']} widths={[46, 27, 27]} rows={[
          ['Ending hypothetical wealth', money(ha.nav.at(-1)!), money(hb.nav.at(-1)!)],
          ['Total return, after costs', pct(ha.totalReturn), pct(hb.totalReturn)],
          ['Modeled trading fees', money(ha.fees), money(hb.fees)],
          ['Gross turnover / pre-trade NAV, summed', pct(ha.turnover, 1), pct(hb.turnover, 1)],
          [cashOnly ? 'Modeled trade events' : 'Rebalance events, including initial purchase', String(ha.trades), String(hb.trades)],
        ]} />
      </Section>
    </Sheet>
    <DataProvenance snapshot={s}/>
    <Sheet snapshot={s}>
      <Text style={styles.title}>Sensitivity and assumptions.</Text>
      <Section title="Does the risk direction hold up?">
        <Text style={styles.note}>{consistent ? 'The direction is consistent across available windows.' : 'The risk direction changes with the estimation window.'}</Text>
        <Table headers={['Daily returns', 'A - Volatility', 'B - Volatility', 'Change']} widths={[22, 26, 26, 26]} rows={r.risk.windows.map(w => [String(w.window), w.available ? pct(w.a!.volatility) : 'Unavailable', w.available ? pct(w.b!.volatility) : 'Unavailable', w.available ? pp(w.b!.volatility - w.a!.volatility) : 'Too little history'])} />
      </Section>
      <Section title="How much do costs and timing matter?">
        <Table headers={['Per-side cost', 'A - Annual growth', 'B - Annual growth']} rows={r.costSensitivity.map(c => [`${c.costBps} bps`, pct(c.aCagr), pct(c.bCagr)])} />
        <Text style={styles.note}>One extra session of execution delay: A {pct(r.delaySensitivity.a.cagr)}, B {pct(r.delaySensitivity.b.cagr)} annual growth.</Text>
      </Section>
      <Section title="Warnings and limitations">{r.warnings.length ? r.warnings.map((warning, i) => <Text key={i} style={styles.body}>{i + 1}. {breakLongTokens(warning)}</Text>) : <Text style={styles.body}>No additional engine warnings. The method limitations still apply.</Text>}</Section>
      <Section title="Method assumptions">{methodNotes(s.manifest.basis).map((note, i) => <Text key={i} style={styles.body}>{i + 1}. {note}</Text>)}</Section>
    </Sheet>
    <Sheet snapshot={s}><Text style={styles.title}>Your reasoning.</Text><Rationale snapshot={s} /><Questions /></Sheet>
  </>;
}

export default function PdfDocument({ snapshot, chartPng }: { snapshot: PdfSnapshot; chartPng?: string }) {
  if (snapshot.mode === 'full' && !chartPng?.startsWith('data:image/png;base64,')) throw new Error('A complete report requires its chart.');
  return <Document title={`Rebalance Review - ${snapshot.mode === 'full' ? 'Portfolio comparison' : 'Decision record'}`} author="Rebalance Review" subject={`Local allocation review ${snapshot.id}`} creator={`Rebalance Review ${PDF_REPORT_VERSION}`} producer={`Rebalance Review ${PDF_REPORT_VERSION}`} language="en-US" creationDate={new Date(snapshot.createdAt)} modificationDate={new Date(snapshot.createdAt)}>
    {snapshot.mode === 'full' ? <FullResults snapshot={snapshot} chartPng={chartPng!} /> : <Sheet snapshot={snapshot}><Intro snapshot={snapshot} /><Allocation snapshot={snapshot} /><Rationale snapshot={snapshot} /><Section title="Selected assumptions and limits">{DECISION_NOTES.map((note, i) => <Text key={i} style={styles.body}>{i + 1}. {note}</Text>)}</Section><Questions /></Sheet>}
  </Document>;
}
