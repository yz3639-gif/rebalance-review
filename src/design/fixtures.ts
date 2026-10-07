import { createSyntheticDemo, createCashAssumptionDataset, defaultCashPeriod, DEMO_SYMBOLS, SUPPORTED_SYMBOLS, snapshotCatalog } from '../data';
import { computeReview } from '../engine';
import type { PortfolioSpec, ReviewSpec } from '../types';
import type { DesignSnapshot, FixtureId } from './types';

const AS_OF = '2026-09-30';
const CORE = ['SPY', 'VXUS', 'BND', 'GLD', 'IEF'];
function portfolio(id:'a'|'b',symbols:string[],weights:number[]):PortfolioSpec {
  return { id, name: id==='a'?'Current allocation':'Proposed allocation', holdings: symbols.map((symbol,index)=>({symbol,weight:weights[index]})) };
}

/** Sample-only fixtures. Prices are created and consumed here, never returned to the UI. */
export function buildDesignSnapshot(id:FixtureId):DesignSnapshot {
  if(id==='failure') throw new Error('The sample calculation was intentionally interrupted. Choose Retry to load the core allocation; no personal inputs or saved reviews were changed.');
  if(!['standard','fifty','partial','cash','short','restricted'].includes(id)) throw new Error('Unknown sample scenario.');
  const symbols=id==='fifty'?[...DEMO_SYMBOLS,...SUPPORTED_SYMBOLS.filter(s=>!DEMO_SYMBOLS.includes(s))].slice(0,50):CORE;
  const demo=createSyntheticDemo({observations:id==='short'?300:1261,endDate:AS_OF,symbols});
  let {dataset}=demo;
  let a=portfolio('a',[...CORE,'CASH'],[.4,.2,.2,.08,.07,.05]);
  let b=portfolio('b',[...CORE,'CASH'],[.3,.18,.25,.12,.1,.05]);
  if(id==='fifty') {
    a=portfolio('a',[...symbols,'CASH'],[...symbols.map(()=>.95/50),.05]);
    const scores=symbols.map((_,index)=>1+(index%5)),total=scores.reduce((sum,value)=>sum+value,0);
    b=portfolio('b',[...symbols,'CASH'],[...scores.map(score=>.95*score/total),.05]);
  }
  if(id==='partial') {
    const excluded=dataset.symbols.indexOf('GLD');
    dataset.symbols=dataset.symbols.filter(symbol=>symbol!=='GLD');
    dataset.prices=dataset.prices.map(row=>row.filter((_,index)=>index!==excluded));
  }
  if(id==='cash') {
    const period=defaultCashPeriod('2026-10-01');
    dataset=createCashAssumptionDataset(period.start,period.end);
    a=portfolio('a',['CASH'],[1]);b=portfolio('b',['CASH'],[1]);
  }
  dataset.manifest.id=`design-${id}-${AS_OF}`;
  dataset.manifest.rights.verifiedAt=AS_OF;
  if(id==='restricted') dataset.manifest.rights={...dataset.manifest.rights,rawPersistence:false,derivedPersistence:false,export:false,evidence:'Synthetic permissions demonstration: display only. Full analytical exports and persistence are intentionally disabled.'};
  if(id!=='cash') dataset.manifest.acquisition={requestedStart:dataset.dates[0],requestedEnd:AS_OF,assets:dataset.symbols.map(symbol=>({symbol,firstDate:dataset.dates[0],lastDate:AS_OF,observations:dataset.dates.length}))};
  const spec:ReviewSpec={a,b,dataset,frequency:'quarterly',costBps:5,initialNav:100000,cashReturnConfirmed:true,partialCoverageConfirmed:id==='partial'};
  const result=computeReview(spec);
  result.id=`review-design-${id}-${AS_OF}`;
  const {dataset:consumed,...context}=spec;
  return {context:{...context,manifest:consumed.manifest,catalog:snapshotCatalog([...new Set([...a.holdings,...b.holdings].map(h=>h.symbol))])},result};
}

export { freezeSnapshot } from './model';
