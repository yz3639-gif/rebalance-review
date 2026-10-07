import type { RiskWindow } from '../types';
import type { DesignSnapshot } from './types';

export interface HoldingRow { symbol:string; name:string; a:number; b:number; delta:number; covered:boolean }
export function holdingRows(snapshot:DesignSnapshot):HoldingRow[] {
  const {context,result}=snapshot;
  const symbols=[...new Set([...context.a.holdings,...context.b.holdings].map(h=>h.symbol))];
  return symbols.map(symbol=>{
    const a=context.a.holdings.find(h=>h.symbol===symbol)?.weight??0,b=context.b.holdings.find(h=>h.symbol===symbol)?.weight??0;
    return {symbol,name:symbol==='CASH'?'USD cash · 0% modeled return':context.catalog?.assets.find(asset=>asset.symbol===symbol)?.name??symbol,a,b,delta:b-a,covered:result.symbols.includes(symbol)};
  });
}
export function riskRows(snapshot:DesignSnapshot,window:126|252|504=252) {
  const selected=snapshot.result.risk.windows.find(item=>item.window===window);
  if(!selected?.available||!selected.a||!selected.b)return [];
  const names=new Map(holdingRows(snapshot).map(row=>[row.symbol,row.name]));
  return snapshot.result.symbols.map(symbol=>{
    const a=selected.a!.contributions[symbol],b=selected.b!.contributions[symbol];
    return {symbol,name:names.get(symbol)??symbol,a,b,delta:b-a};
  });
}
export interface CorrelationMatrix { symbols:string[]; values:(number|null)[][] }
/** Correlations implied by a recorded shrinkage covariance, not unshrunk sample Pearson correlations. */
export function correlation(window:RiskWindow|undefined,symbols:string[]):CorrelationMatrix|null {
  const covariance=window?.covariance;
  if(!window?.available||!covariance||covariance.length!==symbols.length||covariance.some(row=>row.length!==symbols.length||row.some(value=>!Number.isFinite(value))))return null;
  if(covariance.some((row,index)=>row[index]<0))return null;
  let invalid=false;
  const values=covariance.map((row,i)=>row.map((value,j)=>{
    if(symbols[i]==='CASH'||symbols[j]==='CASH'||covariance[i][i]===0||covariance[j][j]===0)return null;
    const ratio=value/Math.sqrt(covariance[i][i]*covariance[j][j]);
    if(!Number.isFinite(ratio)||Math.abs(ratio)>1+1e-8){invalid=true;return null;}
    // Clamp only floating-point boundary noise; never turn invalid matrix cells into a plausible correlation.
    return Math.max(-1,Math.min(1,ratio));
  }));
  return invalid?null:{symbols:[...symbols],values};
}
/** Index against starting capital, not the first after-fee NAV: retain the initial purchase cost. */
export function indexedNav(nav:number[],initialNav:number):number[] {
  if(!Number.isFinite(initialNav)||initialNav<=0||nav.some(value=>!Number.isFinite(value)||value<=0))throw new Error('An indexed path needs positive finite NAV and starting capital.');
  return nav.map(value=>100*value/initialNav);
}
export function costRows(snapshot:DesignSnapshot) {
  const {context,result}=snapshot;
  const rows=new Map(result.costSensitivity.map(row=>[row.costBps,{...row,current:false}]));
  rows.set(context.costBps,{costBps:context.costBps,aCagr:result.history.a.cagr,bCagr:result.history.b.cagr,current:true});
  return [...rows.values()].sort((a,b)=>a.costBps-b.costBps);
}

/** Structured clone removes freezing across Worker messages; call this after receiving a sample. */
export function freezeSnapshot<T>(value:T,seen=new WeakSet<object>()):T {
  if(value&&typeof value==='object'&&!seen.has(value)) {
    seen.add(value);for(const child of Object.values(value))freezeSnapshot(child,seen);Object.freeze(value);
  }
  return value;
}
