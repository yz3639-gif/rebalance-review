import { describe, expect, it } from 'vitest';
import { buildDesignSnapshot, freezeSnapshot } from '../src/design/fixtures';
import { correlation, costRows, holdingRows, indexedNav, riskRows } from '../src/design/model';
import { createPdfSnapshot } from '../src/pdf/model';
import { eulerRisk, computeReview } from '../src/engine';
import { createSyntheticDemo } from '../src/data';
import type { RiskWindow } from '../src/types';

const standard=buildDesignSnapshot('standard');
describe('sample design snapshots and derived views',()=>{
  it('uses repeatable computed paths with no raw observations in its public context',()=>{
    const again=buildDesignSnapshot('standard');
    expect(again).toEqual(standard);
    expect(standard.context).not.toHaveProperty('dataset');
    expect(standard.context).not.toHaveProperty('prices');
    expect(standard.context.manifest.synthetic).toBe(true);
    expect(standard.context.initialNav).toBe(100000);
    expect(standard.context.frequency).toBe('quarterly');
    expect(standard.result.asOf).toBe('2026-09-30');
    expect(standard.result.symbols).toHaveLength(6);
    expect(standard.result.history.a.nav).toHaveLength(standard.result.observations+1);
  });
  it('keeps a 50-ETF basket complete and separates excluded original weights from normalized analysis weights',()=>{
    const fifty=buildDesignSnapshot('fifty');
    expect(fifty.result.symbols.filter(symbol=>symbol!=='CASH')).toHaveLength(50);
    expect(fifty.context.a.holdings).toHaveLength(51);
    expect(fifty.context.b.holdings).toHaveLength(51);
    expect(fifty.result.coverage.a).toBeCloseTo(1,12);
    expect(fifty.result.coverage.b).toBeCloseTo(1,12);
    const partial=buildDesignSnapshot('partial'),rows=holdingRows(partial),gold=rows.find(row=>row.symbol==='GLD')!;
    expect(partial.result.partial).toBe(true);
    expect(partial.result.symbols).not.toContain('GLD');
    expect(gold).toMatchObject({a:.08,b:.12,covered:false});
    expect(gold.delta).toBeCloseTo(.04,12);
    expect(partial.result.coverage.a).toBeCloseTo(.92,12);
    expect(partial.result.coverage.b).toBeCloseTo(.88,12);
    expect(rows.reduce((sum,row)=>sum+row.a,0)).toBeCloseTo(1,12);
    expect(rows.reduce((sum,row)=>sum+row.delta,0)).toBeCloseTo(0,12);
  });
  it('exposes actual zero-return cash and unavailable long windows without fabricating observations',()=>{
    const cash=buildDesignSnapshot('cash');
    expect(cash.context.manifest.basis).toBe('cash_zero');
    expect(cash.context.manifest.synthetic).toBe(false);
    expect(cash.result.history.a.nav.every(value=>value===100000)).toBe(true);
    expect(cash.result.history.a.drawdowns.every(value=>value===0)).toBe(true);
    expect(cash.result.history.a.fees).toBe(0);
    const window=cash.result.risk.windows.find(row=>row.window===252)!;
    expect(window.a?.relativeContributions).toBeNull();
    expect(correlation(window,cash.result.symbols)?.values).toEqual([[null]]);
    const short=buildDesignSnapshot('short');
    expect(short.result.observations).toBe(299);
    expect(short.result.risk.windows.find(window=>window.window===504)?.available).toBe(false);
    expect(riskRows(short,504)).toEqual([]);
    expect(correlation(short.result.risk.windows.find(window=>window.window===504),short.result.symbols)).toBeNull();
  });
  it('retains initial fees when indexing wealth and leaves input paths unchanged',()=>{
    const nav=[99950,100500,99000],before=[...nav];
    expect(indexedNav(nav,100000)).toEqual([99.95,100.5,99]);
    expect(nav).toEqual(before);
    expect(indexedNav(standard.result.history.a.nav,standard.context.initialNav)[0]).toBeLessThan(100);
    expect(()=>indexedNav(nav,0)).toThrow(/positive finite/);
  });
  it('derives correlations in the original symbol order and treats zero variance as undefined',()=>{
    const window:RiskWindow={window:252,available:true,observations:252,covariance:[[4,-1,0],[-1,1,0],[0,0,0]]};
    expect(correlation(window,['SPY','IEF','CASH'])).toEqual({symbols:['SPY','IEF','CASH'],values:[[1,-.5,null],[-.5,1,null],[null,null,null]]});
    expect(correlation({...window,covariance:undefined},['SPY','IEF','CASH'])).toBeNull();
    expect(correlation({...window,covariance:[[1,2],[2,1]]},['SPY','IEF'])).toBeNull();
  });
  it('preserves negative Euler contributions and reconciles their changes to estimated volatility changes',()=>{
    const snapshot=structuredClone(standard),symbols=['SPY','IEF'],covariance=[[.04,-.018],[-.018,.01]];
    const a=eulerRisk([.5,.5],covariance,symbols),b=eulerRisk([.3,.7],covariance,symbols);
    snapshot.result.symbols=symbols;
    snapshot.result.risk.windows=[{window:252,observations:252,available:true,covariance,a,b}];
    const rows=riskRows(snapshot);
    expect(rows.find(row=>row.symbol==='IEF')!.a).toBeLessThan(0);
    expect(rows.reduce((sum,row)=>sum+row.delta,0)).toBeCloseTo(b.volatility-a.volatility,12);
    expect(rows.map(row=>row.symbol)).toEqual(symbols);
  });
  it('uses actual cost outcomes only and includes an applied cost outside the four standard checks',()=>{
    const demo=createSyntheticDemo({observations:300});
    const spec={...demo,frequency:'quarterly' as const,costBps:7,initialNav:100000,cashReturnConfirmed:true,partialCoverageConfirmed:false};
    const {dataset,...context}=spec;
    const snapshot={context:{...context,manifest:dataset.manifest},result:computeReview(spec)};
    const rows=costRows(snapshot);
    expect(rows.map(row=>row.costBps)).toEqual([2,5,7,10,20]);
    expect(rows.find(row=>row.current)).toMatchObject({costBps:7,aCagr:snapshot.result.history.a.cagr,bCagr:snapshot.result.history.b.cagr});
    expect(rows.find(row=>row.costBps===10)?.aCagr).toBe(snapshot.result.costSensitivity.find(row=>row.costBps===10)!.aCagr);
  });
  it('projects restricted samples to decision-only reports, without leaking source or derived metrics',()=>{
    const snapshot=buildDesignSnapshot('restricted');
    const report=createPdfSnapshot({context:snapshot.context,result:snapshot.result,rationale:'Sample decision.',nextReview:'2026-12-31',archived:true},new Date('2026-10-01T00:00:00Z'));
    expect(report.mode).toBe('decision-only');
    expect(report).not.toHaveProperty('result');
    expect(report).not.toHaveProperty('manifest');
    expect(report).not.toHaveProperty('catalog');
    expect(report).toHaveProperty('a');
  });
  it('freezes nested snapshot arrays and surfaces an intentional failure without a substitute result',()=>{
    const frozen=freezeSnapshot(structuredClone(standard));
    expect(Object.isFrozen(frozen.result.history.a.nav)).toBe(true);
    expect(()=>{frozen.result.history.a.nav[0]=1;}).toThrow();
    expect(()=>buildDesignSnapshot('failure')).toThrow(/intentionally interrupted/);
  });
});
