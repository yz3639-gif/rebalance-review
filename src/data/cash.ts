import type { MarketDataset, PortfolioSpec } from '../types';
import { currentUsDate, isIsoDate, normalizeSymbol, DataValidationError } from './validation';
import { expectedUsEquitySessions, US_EQUITY_CALENDAR } from './calendar';

export function isCashOnly(a: PortfolioSpec, b: PortfolioSpec): boolean {
  return [a,b].every(p => p.holdings.length > 0 && Math.abs(p.holdings.reduce((sum,h)=>sum+h.weight,0)-1)<1e-8 && p.holdings.every(h=>{
    try {return Number.isFinite(h.weight) && h.weight>=0 && (h.weight===0 || normalizeSymbol(h.symbol)==='CASH');} catch {return false;}
  }));
}
export function defaultCashPeriod(today=currentUsDate()): {start:string;end:string} {
  const end=today<US_EQUITY_CALENDAR.end?today:US_EQUITY_CALENDAR.end;
  const earliest=new Date(`${end}T00:00:00Z`);earliest.setUTCFullYear(earliest.getUTCFullYear()-2);
  const dates=expectedUsEquitySessions(earliest.toISOString().slice(0,10),end).filter(d=>d<today).slice(-253);
  if(dates.length<253)throw new DataValidationError('The verified calendar has insufficient history for this cash period.');
  return {start:dates[0],end:dates.at(-1)!};
}
export function createCashAssumptionDataset(start:string,end:string):MarketDataset {
  if(!isIsoDate(start)||!isIsoDate(end)||start>end||end>currentUsDate())throw new DataValidationError('Choose a valid cash period ending no later than today.');
  const lower=new Date(`${end}T00:00:00Z`);const month=lower.getUTCMonth();lower.setUTCFullYear(lower.getUTCFullYear()-5);if(lower.getUTCMonth()!==month)lower.setUTCDate(0);
  if(start<lower.toISOString().slice(0,10))throw new DataValidationError('Cash replay is limited to five calendar years.');
  const dates=expectedUsEquitySessions(start,end);
  if(dates.length<253)throw new DataValidationError('Choose at least 253 modeled sessions for the cash review.');
  return {manifest:{id:`cash-${crypto.randomUUID()}`,source:'USD cash assumption: 0% return; no observed market prices',currency:'USD',basis:'cash_zero',asOf:dates.at(-1)!,synthetic:false,retention:'persistable',policy:'cash-model',rights:{display:true,rawPersistence:true,derivedPersistence:true,export:true,publicDisplay:false,evidence:'App-generated zero-return cash assumption and calendar, not a third-party price dataset.',verifiedAt:currentUsDate()}},dates,symbols:[],prices:dates.map(()=>[])};
}
