import type { PortfolioSpec, ReviewSpec, ReviewResult, RiskWindow } from '../types';
import { ledoitWolf, eulerRisk } from './covariance';
import { simulateLedger } from './ledger';
import { assertRights } from '../data/rights';
import { SUPPORTED_SYMBOLS, MAX_REVIEW_ASSETS } from '../data/registry';
import { assertCompleteDailySessions } from '../data/calendar';
import { normalizeSymbol, validateManifest } from '../data/validation';
import { assertAssetHistoryBounds } from '../data/inception';
export { ledoitWolf, eulerRisk } from './covariance';
export { simulateLedger, rebalance } from './ledger';

const SUPPORTED = new Set(SUPPORTED_SYMBOLS);
const cashSymbol = normalizeSymbol;
function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function portfolioWeights(portfolio: PortfolioSpec): Map<string, number> {
  if (!portfolio || !Array.isArray(portfolio.holdings) || !portfolio.holdings.length) throw new Error('Each portfolio needs holdings.');
  if (portfolio.holdings.length > MAX_REVIEW_ASSETS + 1) throw new Error(`Each portfolio supports at most ${MAX_REVIEW_ASSETS + 1} holding rows, including cash and zero-weight positions.`);
  const weights = new Map<string, number>();
  for (const holding of portfolio.holdings) {
    if (typeof holding.symbol !== 'string' || !holding.symbol.trim() || !Number.isFinite(holding.weight) || holding.weight < 0) throw new Error('Holdings need symbols and finite nonnegative weights.');
    const symbol = cashSymbol(holding.symbol);
    if (weights.has(symbol)) throw new Error(`Duplicate holding ${symbol}: merge only after explicit confirmation.`);
    weights.set(symbol, holding.weight);
  }
  const total = [...weights.values()].reduce((s, w) => s + w, 0);
  if (Math.abs(total - 1) > 1e-8) throw new Error('Portfolio weights must sum to 100%.');
  if (portfolio.marketValues) {
    const values = Object.entries(portfolio.marketValues), valueTotal = values.reduce((s, [, value]) => s + value, 0);
    if (values.length !== weights.size || !Number.isFinite(valueTotal) || valueTotal <= 0 ||
        values.some(([symbol, value]) => symbol !== normalizeSymbol(symbol) || !weights.has(symbol) || !Number.isFinite(value) || value < 0 || Math.abs(value / valueTotal - weights.get(symbol)!) > 1e-8)) {
      throw new Error('USD market values must be finite, nonnegative, canonical, and reconcile with portfolio weights.');
    }
  }
  return weights;
}

/** Shared preflight for the UI and independent worker; it never needs market data. */
export function validateReviewInputs(spec: Omit<ReviewSpec, 'dataset'>) {
  if (!spec || !['monthly', 'quarterly', 'buy-hold'].includes(spec.frequency) || !Number.isFinite(spec.costBps) || spec.costBps < 0 || spec.costBps > 100 || !Number.isFinite(spec.initialNav) || spec.initialNav <= 0 || spec.initialNav > 1e12 || typeof spec.cashReturnConfirmed !== 'boolean' || typeof spec.partialCoverageConfirmed !== 'boolean') throw new Error('Invalid review settings; per-side costs must be 0–100 basis points, starting capital must be positive and no more than $1 trillion, and assumptions must be explicitly confirmed.');
  const a = portfolioWeights(spec.a), b = portfolioWeights(spec.b);
  const union = [...new Set([...a.keys(), ...b.keys()])].filter(symbol => (a.get(symbol) ?? 0) > 0 || (b.get(symbol) ?? 0) > 0);
  if (union.filter(s => s !== 'CASH').length > MAX_REVIEW_ASSETS) throw new Error(`A and B together may contain at most ${MAX_REVIEW_ASSETS} different noncash assets. No holdings were dropped.`);
  if (union.includes('CASH') && !spec.cashReturnConfirmed) throw new Error('Confirm the zero-return USD cash assumption.');
  return { a, b, union };
}

export function computeReview(spec: ReviewSpec): ReviewResult {
  if (!spec?.dataset?.manifest) throw new Error('Market data is required; holdings are retained separately.');
  const { dataset, frequency, costBps, initialNav } = spec, { manifest } = dataset;
  validateManifest(manifest);
  if (manifest.currency !== 'USD' || !['adjusted_close', 'total_return_index', 'cash_zero'].includes(manifest.basis)) throw new Error('Only USD adjusted-close or total-return-index data is supported.');
  assertRights(manifest, 'display');
  if (!validDate(manifest.asOf) || manifest.asOf > new Date().toISOString().slice(0, 10)) throw new Error('Dataset cutoff is invalid or in the future.');
  const { a, b, union } = validateReviewInputs(spec);
  if (manifest.basis === 'cash_zero' && (union.length !== 1 || union[0] !== 'CASH' || dataset.symbols.length !== 0 || manifest.synthetic)) throw new Error('Cash-assumption data requires two entirely cash portfolios and no observed asset columns.');
  if (!Array.isArray(dataset.symbols) || dataset.symbols.some(s => typeof s !== 'string' || !s.trim())) throw new Error('Invalid market-data symbols.');
  const dataSymbols = dataset.symbols.map(cashSymbol);
  if (dataSymbols.length > MAX_REVIEW_ASSETS) throw new Error(`A review supports at most ${MAX_REVIEW_ASSETS} noncash market columns.`);
  if (new Set(dataSymbols).size !== dataSymbols.length) throw new Error('Duplicate market-data symbols are not allowed.');
  const uncovered = union.filter(s => s !== 'CASH' && (!SUPPORTED.has(s) || !dataSymbols.includes(s)));
  if (uncovered.length && !spec.partialCoverageConfirmed) throw new Error(`Missing or unsupported market data: ${uncovered.join(', ')}. Explicit partial-coverage confirmation is required.`);
  const symbols = union.filter(s => !uncovered.includes(s)).sort((a, b) => a === 'CASH' ? 1 : b === 'CASH' ? -1 : a.localeCompare(b));
  const risky = symbols.filter(s => s !== 'CASH');
  const coverage = { a: symbols.reduce((s, symbol) => s + (a.get(symbol) ?? 0), 0), b: symbols.reduce((s, symbol) => s + (b.get(symbol) ?? 0), 0) };
  if (coverage.a <= 0 || coverage.b <= 0) throw new Error('Each portfolio needs at least one covered positive holding.');
  const weightsA = symbols.map(s => (a.get(s) ?? 0) / coverage.a), weightsB = symbols.map(s => (b.get(s) ?? 0) / coverage.b);
  if (!Array.isArray(dataset.dates) || !Array.isArray(dataset.prices) || dataset.dates.length !== dataset.prices.length || !dataset.dates.length) throw new Error('Price rows and dates must be nonempty and aligned.');
  for (let i = 0; i < dataset.dates.length; i++) {
    if (!validDate(dataset.dates[i]) || dataset.dates[i] > manifest.asOf || (i && dataset.dates[i] <= dataset.dates[i - 1])) throw new Error('Dates must be valid, unique, strictly increasing and no later than the cutoff.');
    if (!Array.isArray(dataset.prices[i]) || dataset.prices[i].length !== dataSymbols.length || dataset.prices[i].some(v => !Number.isFinite(v) || v <= 0)) throw new Error('Missing, nonpositive or invalid prices: interpolation is not permitted.');
  }
  assertCompleteDailySessions(dataset.dates, manifest.synthetic);
  assertAssetHistoryBounds({ manifest, symbols: risky, dates: dataset.dates });
  const lowerDate = new Date(`${manifest.asOf}T00:00:00Z`);
  const month = lowerDate.getUTCMonth();
  lowerDate.setUTCFullYear(lowerDate.getUTCFullYear() - 5);
  if (lowerDate.getUTCMonth() !== month) lowerDate.setUTCDate(0);
  const lower = lowerDate.toISOString().slice(0, 10), first = dataset.dates.findIndex(d => d >= lower);
  if (first < 0 || dataset.dates.length - first < 253) throw new Error('At least 253 common prices (252 daily returns) are required within the latest five years.');
  const dates = dataset.dates.slice(first), columns = risky.map(s => dataSymbols.indexOf(s));
  const prices = dataset.prices.slice(first).map(row => columns.map(i => row[i]));
  const returns = prices.slice(1).map((row, i) => row.map((value, j) => value / prices[i][j] - 1));
  if (returns.some(row => row.some(value => !Number.isFinite(value)))) throw new Error('Prices produced invalid returns.');
  const windows: RiskWindow[] = [252, 126, 504].map(window => {
    if (returns.length < window) return { window, available: false, observations: returns.length };
    const riskyCov = risky.length ? ledoitWolf(returns.slice(-window)) : [];
    const covariance = symbols.map((s, i) => symbols.map((t, j) => s === 'CASH' || t === 'CASH' ? 0 : riskyCov[i][j] * 252));
    return { window, available: true, observations: window, covariance, a: eulerRisk(weightsA, covariance, symbols), b: eulerRisk(weightsB, covariance, symbols) };
  });
  const targetA = risky.map(s => (a.get(s) ?? 0) / coverage.a), targetB = risky.map(s => (b.get(s) ?? 0) / coverage.b);
  const simulate = (target: number[], cost: number, lag: 1 | 2 = 1) => simulateLedger(dates, prices, target, frequency, cost, initialNav, lag).result;
  const history = { a: simulate(targetA, costBps), b: simulate(targetB, costBps) };
  const warnings = ['Hypothetical replay of today’s weights; this is not actual account performance or a recommendation.',
    'Annualized risk uses 252 sessions; covariance uses centered Ledoit–Wolf with maximum-likelihood normalization.',
    'Adjusted-price / total-return units include distributions and fund expenses; these are not charged twice.',
    'Signals execute at the next supplied session close; existing holdings earn the execution-day return. Initial purchase fees are included.',
    'Turnover is cumulative gross buys plus sells divided by pre-trade NAV. Historical volatility excludes the initial purchase event; total return and drawdown include its cost.',
    'Daily dates are checked against the recorded session calendar (complete weekdays for synthetic data). This does not certify source prices, adjustments, taxes or brokerage effects.'];
  if (manifest.basis === 'cash_zero') warnings.splice(0,warnings.length,'Assumption-only cash replay: no observed market prices and no covariance estimate.','USD cash is modeled at exactly 0% return over the selected exchange-session calendar. No interest, inflation, taxes or brokerage fees are modeled.','Risk contributions, fees and returns are zero; relative risk contributions are undefined. This is not actual account performance.');
  if (manifest.synthetic) warnings.unshift('SYNTHETIC DEMONSTRATION DATA — not observed ETF prices.');
  if (uncovered.length) warnings.unshift(`PARTIAL COVERAGE: ${uncovered.join(', ')} excluded; covered weights are normalized separately for A and B.`);
  if (union.includes('CASH')) warnings.push('USD cash earns exactly 0% in this hypothetical replay and has zero price variance.');
  if (dates.at(-1)! < manifest.asOf) warnings.push(`Latest available price is ${dates.at(-1)}; manifest cutoff is ${manifest.asOf}.`);
  if (returns.length < 504) warnings.push('504-session risk sensitivity is unavailable because the common history is too short.');
  return { id: `review-${crypto.randomUUID()}`, asOf: manifest.asOf, start: dates[0], end: dates.at(-1)!, observations: returns.length,
    symbols, partial: uncovered.length > 0, coverage, risk: { windows }, history,
    costSensitivity: [2, 5, 10, 20].map(cost => ({ costBps: cost, aCagr: cost === costBps ? history.a.cagr : simulate(targetA, cost).cagr, bCagr: cost === costBps ? history.b.cagr : simulate(targetB, cost).cagr })),
    delaySensitivity: { a: simulate(targetA, costBps, 2), b: simulate(targetB, costBps, 2) }, warnings };
}
