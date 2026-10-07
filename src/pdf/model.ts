import { currentUsDate, isIsoDate, manifestRightsDecision } from '../data';
import type { PortfolioSpec, ReviewContext, ReviewResult, ReviewRecord } from '../types';
import packageInfo from '../../package.json';

export const PDF_REPORT_VERSION = packageInfo.version;
export type PdfMode = 'full' | 'decision-only';
export interface DecisionSnapshot {
  mode: 'decision-only';
  id: string;
  createdAt: string;
  /** Original archive creation date. createdAt above is the new export timestamp. */
  reviewCreatedAt?: string;
  rationale: string;
  nextReview: string;
  a: PortfolioSpec;
  b: PortfolioSpec;
  settings: Pick<ReviewContext, 'frequency' | 'costBps' | 'initialNav' | 'cashReturnConfirmed' | 'partialCoverageConfirmed'>;
  archived: boolean;
}
export interface FullSnapshot extends Omit<DecisionSnapshot, 'mode'> {
  mode: 'full';
  manifest: ReviewContext['manifest'];
  result: ReviewResult;
  catalog?: ReviewContext['catalog'];
  versions?: ReviewRecord['versions'];
}
export type PdfSnapshot = DecisionSnapshot | FullSnapshot;
export interface PdfInput {
  context: ReviewContext;
  result: ReviewResult;
  rationale: string;
  nextReview: string;
  archived?: boolean;
  createdAt?: string;
  versions?: ReviewRecord['versions'];
}
export const formatPercent = (n: number, digits = 2) => `${(n * 100).toFixed(digits)}%`;
export const formatPoints = (n: number, digits = 2) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(digits)} pp`;
export const formatMoney = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

/** Display-only boundaries for CJK and long identifiers unsupported by English word breaking. */
export function breakLongTokens(text: string) {
  return text.replace(/\S{51,}/gu, token => {
    const characters = Array.from(token);
    return Array.from({ length: Math.ceil(characters.length / 50) }, (_, i) => characters.slice(i * 50, i * 50 + 50).join('')).join('\n');
  });
}

export const METHOD_NOTES = [
  'This is a hypothetical comparison of allocations, not actual account performance, a forecast, or a recommendation.',
  'Daily risk uses centered Ledoit-Wolf covariance, annualized by 252. The default estimate uses 252 daily returns; 126- and 504-return windows test sensitivity when available.',
  'Cash earns exactly 0% and has zero covariance in this model. Zero-volatility portfolios have no defined relative risk contributions. Signed Euler contributions are not clipped; their sum equals total estimated volatility before display rounding.',
  'Both portfolios use the same covered asset universe and common dates. Partial portfolios exclude uncovered positions and normalize each covered allocation separately. Correlation does not measure overlap in underlying ETF constituents.',
  'Historical replay is limited to the latest five calendar years of common observations. Initial purchases include fees. Monthly or quarterly targets are signaled at period end and executed at the next supplied close; existing holdings earn that session\'s return. No forced final liquidation is modeled.',
  'Fees apply to purchases and sales of risky assets, not cash transfers. Adjusted prices or total-return indices already reflect provider treatment of distributions; fund expenses and distributions are not charged twice.',
  'No deposits, withdrawals, taxes, portfolio margin borrowing, live brokerage execution, personal objectives or risk tolerance are modeled. Leveraged or inverse ETFs use their supplied fund returns; a daily target multiple is never projected over a longer period. No risk-free series is supplied, so no Sharpe ratio is shown.',
];
export const DECISION_NOTES = [
  'This decision record contains your allocation inputs, selected assumptions and written reasoning only. Market prices, risk estimates, historical results, coverage conclusions and charts are intentionally excluded.',
  'The selected rebalancing frequency, starting capital and trading cost are user-entered scenarios, not an investment recommendation or a broker quote.',
  'No deposits, withdrawals, taxes, leverage, actual account trades or personal suitability assessment are modeled. A next-review date is a note; it does not schedule a notification.',
];
export const CASH_METHOD_NOTES = [
  'This is an assumption-only USD cash scenario. No market prices or observed returns are used. The calendar supplies modeled session dates only.',
  'Cash earns exactly 0% throughout the chosen period. Wealth stays at the selected starting amount, with zero volatility, drawdown, turnover and fees. Relative risk contributions are undefined.',
  'The displayed return windows count modeled sessions. No covariance estimate, ETF purchase, price adjustment or transaction cost is applied to all-cash portfolios.',
  'These results are consequences of the selected zero-return assumption, not evidence about actual savings yields, inflation, purchasing power, taxes or investment suitability.',
];
export function methodNotes(basis: ReviewContext['manifest']['basis']) {
  return basis === 'cash_zero' ? CASH_METHOD_NOTES : METHOD_NOTES;
}
export const OPEN_QUESTIONS = [
  'What changed in your objectives or time horizon?',
  'Which trade-off are you accepting, and what would make you reconsider?',
  'Does this choice still make sense if historical relationships change?',
  'Have taxes, real brokerage costs and excluded positions been considered separately?',
];

export function pdfMode(context: ReviewContext): PdfMode {
  return manifestRightsDecision(context.manifest, 'exportDerived').allowed ? 'full' : 'decision-only';
}

/** Copies only the allowlisted fields. A decision-only snapshot never receives derived data. */
export function createPdfSnapshot(input: PdfInput, now = new Date()): PdfSnapshot {
  const rationale = input.rationale.trim();
  if (!rationale || rationale.length > 5000) throw new Error('Write a reason of 1 to 5,000 characters before downloading your report.');
  if (!isIsoDate(input.nextReview) || (!input.archived && input.nextReview < currentUsDate(now))) throw new Error('Choose today or a future next-review date before downloading.');
  const c = input.context;
  const cleanPortfolio = (p: PortfolioSpec): PortfolioSpec => ({ id: p.id, name: p.name, holdings: p.holdings.map(h => ({ symbol: h.symbol, weight: h.weight })), ...(p.marketValues ? { marketValues: { ...p.marketValues } } : {}) });
  const common: Omit<DecisionSnapshot, 'mode'> = {
    id: input.result.id, createdAt: now.toISOString(), rationale, nextReview: input.nextReview,
    a: cleanPortfolio(c.a), b: cleanPortfolio(c.b), archived: Boolean(input.archived),
    settings: { frequency: c.frequency, costBps: c.costBps, initialNav: c.initialNav, cashReturnConfirmed: c.cashReturnConfirmed, partialCoverageConfirmed: c.partialCoverageConfirmed },
  };
  if(input.createdAt) {
    if(!Number.isFinite(Date.parse(input.createdAt))) throw new Error('The review creation date is invalid.');
    common.reviewCreatedAt=input.createdAt;
  }
  const snapshot: PdfSnapshot = pdfMode(c) === 'full'
    ? { ...common, mode: 'full', manifest: structuredClone(c.manifest), result: structuredClone(input.result), ...(c.catalog?{catalog:structuredClone(c.catalog)}:{}), ...(input.versions?{versions:structuredClone(input.versions)}:{}) }
    : { ...common, mode: 'decision-only' };
  return snapshot;
}

export function portfolioRows(s: PdfSnapshot) {
  const symbols = [...new Set([...s.a.holdings, ...s.b.holdings].map(h => h.symbol))];
  return symbols.map(symbol => {
    const a = s.a.holdings.find(h => h.symbol === symbol)?.weight ?? 0;
    const b = s.b.holdings.find(h => h.symbol === symbol)?.weight ?? 0;
    const note = s.mode === 'full' && a + b > 0 && !s.result.symbols.includes(symbol) ? 'Excluded from analysis' : symbol === 'CASH' ? 'USD cash; 0% modeled return' : '';
    return [symbol, formatPercent(a, 1), formatPercent(b, 1), formatPoints(b - a), note];
  });
}
export function marketValueCoverage(portfolio: PortfolioSpec, included: string[]) {
  if (!portfolio.marketValues) return 'Unknown - weight-only input';
  const total = Object.values(portfolio.marketValues).reduce((sum, value) => sum + value, 0);
  const covered = included.reduce((sum, symbol) => sum + (portfolio.marketValues?.[symbol] ?? 0), 0);
  return total > 0 ? `${formatPercent(covered / total, 1)} (${formatMoney(covered)} of ${formatMoney(total)})` : 'Unknown';
}

/** Shared data-to-chart mapping; rendering mode does not change the financial series. */
export function historyChartOption(history: ReviewResult['history']) {
  const { a, b } = history;
  return {
    color: ['#173f37', '#bf6b38'], animation: false,
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => formatMoney(Number(v)) },
    legend: { bottom: 0, icon: 'roundRect', data: ['A · Current', 'B · Proposed'] },
    grid: { left: 62, right: 18, top: 18, bottom: 65 },
    xAxis: { type: 'category', data: a.dates, axisLabel: { formatter: (v: string) => v.slice(0, 7), color: '#66736e' }, axisLine: { lineStyle: { color: '#d5ddd7' } }, axisTick: { show: false } },
    yAxis: { type: 'value', scale: true, axisLabel: { formatter: (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v), color: '#66736e' }, splitLine: { lineStyle: { color: '#edf0ec' } } },
    series: [{ name: 'A · Current', type: 'line', data: a.nav, showSymbol: false, lineStyle: { width: 2.6 } }, { name: 'B · Proposed', type: 'line', data: b.nav, showSymbol: false, lineStyle: { width: 2.6, type: 'dashed' } }],
  };
}
