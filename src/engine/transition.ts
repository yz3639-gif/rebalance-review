import { rebalance } from './ledger';

export interface TransitionInput {
  /** The same ordered, unique identities must describe both allocations. CASH is optional. */
  symbols: readonly string[];
  /** Current USD market values, including cash when present; never historical replay NAVs. */
  currentValues: readonly number[];
  /** Complete, long-only allocation, expressed as fractions of NAV after the modeled fee. */
  targetWeights: readonly number[];
  /** One constant fee on each dollar bought or sold, in basis points. */
  costBps: number;
}

export interface TransitionRow {
  symbol: string;
  currentAmount: number;
  currentWeight: number;
  targetWeight: number;
  targetAmount: number;
  deltaAmount: number;
  buyAmount: number;
  sellAmount: number;
  direction: 'buy' | 'sell' | 'hold' | 'cash';
}

export interface TransitionResult {
  beforeNav: number;
  afterNav: number;
  fees: number;
  buyNotional: number;
  sellNotional: number;
  grossTraded: number;
  /** Gross risky buys plus sells divided by pre-trade NAV, NOT half-turnover. */
  grossTurnover: number;
  cashBefore: number;
  cashAfter: number;
  cashChange: number;
  rows: TransitionRow[];
  assumptions: string[];
}

function validateSymbols(symbols: readonly string[]) {
  if (!Array.isArray(symbols) || !symbols.length || symbols.some(symbol =>
    typeof symbol !== 'string' || !/^[A-Z0-9][A-Z0-9.\-]{0,31}$/.test(symbol)) ||
    new Set(symbols).size !== symbols.length) {
    throw new Error('Supply unique, canonical asset symbols with CASH as the cash identity.');
  }
}

function validateWeights(weights: readonly number[], length: number, name: string) {
  if (!Array.isArray(weights) || weights.length !== length ||
    weights.some(weight => !Number.isFinite(weight) || weight < 0 || weight > 1) ||
    Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-10) {
    throw new Error(`${name} must be a complete finite, nonnegative allocation totaling 100%.`);
  }
}

/**
 * One current A → B transition, not a backtest or an order ticket.
 * Reuses the ledger equation N + c Σ|w_i N − H_i| = V over NONCASH assets.
 * Weights are normalized only within the accepted floating-point sum tolerance.
 * The caller must supply complete portfolios, not renormalized covered subsets.
 */
export function computeTransition(input: TransitionInput): TransitionResult {
  if (!input) throw new Error('A transition needs current values and a complete target allocation.');
  const { symbols, currentValues, targetWeights, costBps } = input;
  validateSymbols(symbols);
  validateWeights(targetWeights, symbols.length, 'Target weights');
  if (!Array.isArray(currentValues) || currentValues.length !== symbols.length ||
    currentValues.some(value => !Number.isFinite(value) || value < 0) ||
    !Number.isFinite(costBps) || costBps < 0 || costBps > 100) {
    throw new Error('Current values must be finite and nonnegative; per-side fees must be 0–100 bps.');
  }
  const beforeNav = currentValues.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(beforeNav) || beforeNav <= 0) throw new Error('Current portfolio value must be finite and positive.');
  const totalWeight = targetWeights.reduce((sum, weight) => sum + weight, 0);
  const normalized = targetWeights.map(weight => weight / totalWeight);
  const riskyIndices = symbols.flatMap((symbol, index) => symbol === 'CASH' ? [] : [index]);
  const cashIndex = symbols.indexOf('CASH');
  const cashBefore = cashIndex < 0 ? 0 : currentValues[cashIndex];
  const trade = rebalance(beforeNav, riskyIndices.map(index => currentValues[index]),
    riskyIndices.map(index => normalized[index]), costBps / 10000);
  const riskyAmounts = new Map(riskyIndices.map((index, position) => [index, trade.holdings[position]]));
  const rows = symbols.map((symbol, index): TransitionRow => {
    const currentAmount = currentValues[index];
    const targetAmount = symbol === 'CASH' ? trade.cash : riskyAmounts.get(index)!;
    const deltaAmount = targetAmount - currentAmount;
    return { symbol, currentAmount, currentWeight: currentAmount / beforeNav, targetWeight: normalized[index],
      targetAmount, deltaAmount, buyAmount: symbol === 'CASH' ? 0 : Math.max(0, deltaAmount),
      sellAmount: symbol === 'CASH' ? 0 : Math.max(0, -deltaAmount),
      direction: symbol === 'CASH' ? 'cash' : deltaAmount > 0 ? 'buy' : deltaAmount < 0 ? 'sell' : 'hold' };
  });
  const buyNotional = rows.reduce((sum, row) => sum + row.buyAmount, 0);
  const sellNotional = rows.reduce((sum, row) => sum + row.sellAmount, 0);
  const grossTraded = buyNotional + sellNotional;
  const cashAfter = trade.cash;
  const tolerance = Math.max(Number.MIN_VALUE, beforeNav * 1e-12);
  if ([trade.nav, trade.fee, buyNotional, sellNotional, grossTraded, cashAfter].some(value => !Number.isFinite(value)) ||
    Math.abs(beforeNav - trade.nav - trade.fee) > tolerance ||
    Math.abs(cashBefore + sellNotional - buyNotional - trade.fee - cashAfter) > tolerance ||
    Math.abs(grossTraded * costBps / 10000 - trade.fee) > tolerance) {
    throw new Error('The transition failed its cash, fee or NAV reconciliation.');
  }
  return { beforeNav, afterNav: trade.nav, fees: trade.fee, buyNotional, sellNotional, grossTraded,
    grossTurnover: grossTraded / beforeNav, cashBefore, cashAfter, cashChange: cashAfter - cashBefore, rows,
    assumptions: [
      'One illustrative transition at the supplied current USD values; all target weights apply after modeled fees.',
      'Gross turnover is risky buys plus sells divided by current pre-trade NAV. Cash transfers are not charged again.',
      'Fractional amounts and a single constant per-side cost are assumed. Taxes, price moves, spreads, market impact, share rounding and minimum commissions are not separately estimated.',
      'Both portfolios must be complete. This is not an executable order list or an estimate of future returns.',
    ] };
}

export interface ActiveRiskInput {
  symbols: readonly string[];
  weightsA: readonly number[];
  weightsB: readonly number[];
  /** An already annualized covariance, in exactly the same symbol order. No annualization is repeated. */
  covariance: readonly (readonly number[])[];
}

export interface ActiveRiskResult {
  activeWeights: Record<string, number>;
  variance: number;
  trackingError: number;
  /** Signed Euler contributions to tracking error; their sum is trackingError. */
  contributions: Record<string, number>;
  relativeContributions: Record<string, number> | null;
}

function validatedCovariance(input: ActiveRiskInput): number[][] {
  const { covariance, symbols } = input, size = symbols.length;
  if (!Array.isArray(covariance) || covariance.length !== size || covariance.some(row =>
    !Array.isArray(row) || row.length !== size || row.some(value => !Number.isFinite(value)))) {
    throw new Error('Active-risk covariance must be a finite square matrix aligned with the assets.');
  }
  if (covariance.some((row, index) => row[index] < 0)) throw new Error('Covariance variances cannot be negative.');
  const scale = Math.max(...covariance.map(row => Math.max(...row.map(Math.abs))));
  const tolerance = Number.EPSILON * 64 * size;
  const matrix: number[][] = covariance.map((row: readonly number[], i: number) => row.map((value, j) => {
    if ((symbols[i] === 'CASH' || symbols[j] === 'CASH') && value !== 0) {
      throw new Error('CASH must have exactly zero covariance under the zero-return cash assumption.');
    }
    if (scale > 0 && Math.abs(value / scale - covariance[j][i] / scale) > tolerance) {
      throw new Error('Active-risk covariance must be symmetric.');
    }
    return value / 2 + covariance[j][i] / 2;
  }));
  if (scale === 0) return matrix;
  // Diagonally pivoted Schur complements admit singular PSD matrices without a variance floor.
  const residual = matrix.map(row => row.map(value => value / scale));
  for (let k = 0; k < size; k++) {
    let pivot = k;
    for (let i = k; i < size; i++) {
      if (residual[i][i] < -tolerance) throw new Error('Active-risk covariance must be positive semidefinite.');
      if (residual[i][i] > residual[pivot][pivot]) pivot = i;
    }
    if (residual[pivot][pivot] <= tolerance) {
      if (residual.slice(k).some(row => row.slice(k).some(value => Math.abs(value) > tolerance))) {
        throw new Error('Active-risk covariance must be positive semidefinite.');
      }
      break;
    }
    [residual[k], residual[pivot]] = [residual[pivot], residual[k]];
    for (const row of residual) [row[k], row[pivot]] = [row[pivot], row[k]];
    for (let i = k + 1; i < size; i++) for (let j = i; j < size; j++) {
      const value = residual[i][j] - residual[i][k] * residual[j][k] / residual[k][k];
      residual[i][j] = value; residual[j][i] = value;
    }
  }
  return matrix;
}

/** Estimated active risk of B versus A, with the supplied covariance; not a CAGR confidence interval. */
export function computeActiveRisk(input: ActiveRiskInput): ActiveRiskResult {
  if (!input) throw new Error('Active risk needs two complete allocations and covariance.');
  const { symbols, weightsA, weightsB } = input;
  validateSymbols(symbols);
  validateWeights(weightsA, symbols.length, 'A weights');
  validateWeights(weightsB, symbols.length, 'B weights');
  const matrix = validatedCovariance(input);
  const active = weightsB.map((weight, index) => weight - weightsA[index]);
  const marginal = matrix.map(row => row.reduce((sum, value, index) => sum + value * active[index], 0));
  const signedVariance = active.reduce((sum, weight, index) => sum + weight * marginal[index], 0);
  const varianceTolerance = Math.max(...matrix.map((row, index) => row[index])) * Number.EPSILON * 64 * symbols.length;
  if (!Number.isFinite(signedVariance) || marginal.some(value => !Number.isFinite(value)) || signedVariance < -varianceTolerance) {
    throw new Error('Active-risk variance is invalid for the supplied covariance.');
  }
  const variance = Math.max(0, signedVariance), trackingError = Math.sqrt(variance);
  const contributions = Object.fromEntries(symbols.map((symbol, index) =>
    [symbol, trackingError === 0 ? 0 : active[index] * marginal[index] / trackingError]));
  const relativeContributions = trackingError === 0 ? null : Object.fromEntries(symbols.map(symbol => [symbol, contributions[symbol] / trackingError]));
  if (Object.values(contributions).some(value => !Number.isFinite(value)) ||
    (relativeContributions && Object.values(relativeContributions).some(value => !Number.isFinite(value)))) {
    throw new Error('Active-risk contributions exceed finite numerical precision.');
  }
  return { activeWeights: Object.fromEntries(symbols.map((symbol, index) => [symbol, active[index]])),
    variance, trackingError, contributions, relativeContributions };
}
