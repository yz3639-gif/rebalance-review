import type { BacktestResult, Frequency } from '../types';

export interface LedgerRow {
  date: string;
  navBeforeTrade: number;
  nav: number;
  cash: number;
  holdings: number[];
  fee: number;
  tradedNotional: number;
  tradedFraction: number;
  executedSignal: string | null;
}

/** Solve V_after + rate * sum_i |w_i * V_after - H_i| = V_before.
 * Cash is not a transaction. Risky target weights may sum to any value in [0, 1].
 */
export function rebalance(before: number, holdings: number[], target: number[], rate: number) {
  if (!Number.isFinite(before) || before <= 0 || holdings.length !== target.length ||
      holdings.some(v => !Number.isFinite(v) || v < 0) || target.some(v => !Number.isFinite(v) || v < 0) ||
      holdings.reduce((s, v) => s + v, 0) > before + Math.max(1e-8, before * 1e-10) ||
      target.reduce((s, w) => s + w, 0) > 1 + 1e-10 || !Number.isFinite(rate) || rate < 0 || rate >= 1) {
    throw new Error('Invalid self-financing rebalance inputs.');
  }
  let lo = 0, hi = before;
  const traded = (nav: number) => target.reduce((sum, weight, i) => sum + Math.abs(weight * nav - holdings[i]), 0);
  for (let k = 0; k < 70; k++) {
    const mid = (lo + hi) / 2;
    if (mid + rate * traded(mid) > before) hi = mid; else lo = mid;
  }
  const nav = (lo + hi) / 2, fee = rate * traded(nav);
  const newHoldings = target.map(w => nav * w);
  const cash = nav * Math.max(0, 1 - target.reduce((s, w) => s + w, 0));
  const tolerance = Math.max(1e-8, before * 1e-10);
  if (Math.abs(before - nav - fee) > tolerance || Math.abs(nav - cash - newHoldings.reduce((s, v) => s + v, 0)) > tolerance) {
    throw new Error('Self-financing trade does not reconcile.');
  }
  return { nav, fee, cash, holdings: newHoldings, tradedNotional: traded(nav) };
}

function period(date: string, frequency: Frequency): string {
  return frequency === 'quarterly' ? `${date.slice(0, 4)}-${Math.floor((Number(date.slice(5, 7)) - 1) / 3)}` : date.slice(0, 7);
}

/** Calendar-period signals are recognized at the first following input session.
 * They execute at that close (lag=1), after old holdings earn the day's return.
 * Appending future data never changes the existing ledger prefix.
 */
export function simulateLedger(dates: string[], prices: number[][], target: number[], frequency: Frequency,
  costBps: number, initialNav: number, lag: 1 | 2 = 1): { result: BacktestResult; rows: LedgerRow[] } {
  if (dates.length < 2 || prices.length !== dates.length || !Number.isFinite(initialNav) || initialNav <= 0 ||
      !['monthly', 'quarterly', 'buy-hold'].includes(frequency) || ![1, 2].includes(lag) ||
      !Number.isFinite(costBps) || costBps < 0 || costBps >= 10000 ||
      dates.some((date, i) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date || (i > 0 && date <= dates[i - 1])) ||
      prices.some(r => r.length !== target.length || r.some(v => !Number.isFinite(v) || v <= 0))) {
    throw new Error('Invalid historical ledger inputs.');
  }
  let holdings = target.map(() => 0), cash = initialNav, fees = 0, turnover = 0, trades = 0;
  let peak = initialNav;
  const pending = new Map<number, string>();
  const rows: LedgerRow[] = [], nav: number[] = [], drawdowns: number[] = [];
  for (let i = 0; i < dates.length; i++) {
    if (i) holdings = holdings.map((value, j) => value * prices[i][j] / prices[i - 1][j]);
    if (i && frequency !== 'buy-hold' && period(dates[i], frequency) !== period(dates[i - 1], frequency)) {
      pending.set(i + lag - 1, dates[i - 1]);
    }
    const before = holdings.reduce((s, v) => s + v, cash);
    let after = before, fee = 0, tradedNotional = 0, signal: string | null = null;
    if (i === 0 || pending.has(i)) {
      const trade = rebalance(before, holdings, target, costBps / 10000);
      after = trade.nav; fee = trade.fee; holdings = trade.holdings; cash = trade.cash; tradedNotional = trade.tradedNotional;
      signal = i === 0 ? 'initial' : pending.get(i)!;
      pending.delete(i);
      fees += fee;
      turnover += tradedNotional / before;
      if (tradedNotional > Math.max(1e-8, before * 1e-12)) trades++;
    }
    peak = Math.max(peak, after);
    nav.push(after); drawdowns.push(after / peak - 1);
    rows.push({ date: dates[i], navBeforeTrade: before, nav: after, cash, holdings: [...holdings], fee, tradedNotional,
      tradedFraction: tradedNotional / before, executedSignal: signal });
  }
  const returns = nav.slice(1).map((value, i) => value / nav[i] - 1);
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.length > 1 ? returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length - 1) : 0;
  const years = (Date.parse(dates.at(-1)!) - Date.parse(dates[0])) / (365.25 * 86400000);
  if (!(years > 0) || nav.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('Invalid historical NAV or dates.');
  return { rows, result: { dates: [...dates], nav, drawdowns, totalReturn: nav.at(-1)! / initialNav - 1,
    cagr: Math.pow(nav.at(-1)! / initialNav, 1 / years) - 1, volatility: Math.sqrt(variance * 252),
    maxDrawdown: -Math.min(...drawdowns), fees, turnover, trades } };
}
