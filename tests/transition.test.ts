import { describe, expect, it } from 'vitest';
import { computeActiveRisk, computeTransition } from '../src/engine/transition';
import type { ActiveRiskInput, TransitionInput } from '../src/engine/transition';

function close(actual: number, expected: number, scale = Math.max(1, Math.abs(expected))) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(scale * 1e-12);
}
const transition = (overrides: Partial<TransitionInput> = {}): TransitionInput => ({
  symbols: ['SPY', 'GLD', 'CASH'], currentValues: [6000, 2000, 2000], targetWeights: [.4, .4, .2], costBps: 5, ...overrides,
});
const activeRisk = (overrides: Partial<ActiveRiskInput> = {}): ActiveRiskInput => ({
  symbols: ['SOXL', 'SPY', 'CASH'], weightsA: [0, 1, 0], weightsB: [.2, .8, 0],
  covariance: [[.8 ** 2, .85 * .8 * .18, 0], [.85 * .8 * .18, .18 ** 2, 0], [0, 0, 0]], ...overrides,
});

describe('one current A to B transition', () => {
  it('does not charge an initial purchase when A already equals B', () => {
    const result = computeTransition(transition({ targetWeights: [.6, .2, .2], costBps: 100 }));
    expect(result.afterNav).toBe(10000);
    expect(result.fees).toBe(0); expect(result.grossTraded).toBe(0); expect(result.grossTurnover).toBe(0);
    expect(result.rows.map(row => row.direction)).toEqual(['hold', 'hold', 'cash']);
  });
  it('keeps an all-cash transition constant even at the maximum fee', () => {
    const result = computeTransition({ symbols: ['CASH'], currentValues: [12345], targetWeights: [1], costBps: 100 });
    expect(result.afterNav).toBe(12345); expect(result.cashAfter).toBe(12345);
    expect([result.fees, result.buyNotional, result.sellNotional, result.grossTurnover, result.cashChange]).toEqual([0, 0, 0, 0, 0]);
  });
  it('matches the analytic cash-to-asset purchase, targeting post-fee wealth', () => {
    const result = computeTransition({ symbols: ['CASH', 'SPY'], currentValues: [10000, 0], targetWeights: [0, 1], costBps: 100 });
    const after = 10000 / 1.01;
    close(result.afterNav, after); close(result.fees, after * .01);
    close(result.buyNotional, after); expect(result.sellNotional).toBe(0); expect(result.cashAfter).toBe(0);
    expect(result.rows[0].buyAmount).toBe(0); expect(result.rows[0].sellAmount).toBe(0);
  });
  it('matches asset liquidation with no second fee on the received cash', () => {
    const result = computeTransition({ symbols: ['SPY', 'CASH'], currentValues: [10000, 0], targetWeights: [0, 1], costBps: 100 });
    expect(result.sellNotional).toBe(10000); expect(result.buyNotional).toBe(0);
    close(result.afterNav, 9900); close(result.cashAfter, 9900); close(result.fees, 100);
    close(result.grossTurnover, 1);
  });
  it('matches the closed-form fully invested asset switch and reports gross, not half-turnover', () => {
    const result = computeTransition({ symbols: ['SPY', 'GLD'], currentValues: [10000, 0], targetWeights: [0, 1], costBps: 100 });
    const after = 10000 * .99 / 1.01;
    close(result.afterNav, after); close(result.sellNotional, 10000); close(result.buyNotional, after);
    close(result.fees, .01 * (10000 + after)); close(result.grossTurnover, (10000 + after) / 10000);
    expect(result.cashAfter).toBe(0);
  });
  it('matches the partial-cash sale equation and reconciles the cash ledger', () => {
    const result = computeTransition({ symbols: ['SPY', 'CASH'], currentValues: [6000, 4000], targetWeights: [.4, .6], costBps: 100 });
    const after = (10000 - .01 * 6000) / (1 - .01 * .4);
    close(result.afterNav, after); close(result.sellNotional, 6000 - .4 * after);
    close(result.cashAfter, .6 * after);
    close(result.cashBefore + result.sellNotional - result.buyNotional - result.fees, result.cashAfter);
    close(result.rows.reduce((sum, row) => sum + row.targetAmount, 0) + result.fees, result.beforeNav);
  });
  it('matches the partial-cash buy equation', () => {
    const result = computeTransition({ symbols: ['SPY', 'CASH'], currentValues: [6000, 4000], targetWeights: [.7, .3], costBps: 100 });
    const after = (10000 + .01 * 6000) / (1 + .01 * .7);
    close(result.afterNav, after); close(result.buyNotional, .7 * after - 6000);
    close(result.cashAfter, .3 * after); expect(result.sellNotional).toBe(0);
  });
  it('has exact zero fees in the zero-cost scenario', () => {
    const result = computeTransition(transition({ costBps: 0 }));
    expect(result.fees).toBe(0); expect(result.afterNav).toBe(10000);
    expect(result.buyNotional).toBe(2000); expect(result.sellNotional).toBe(2000);
    expect(result.grossTurnover).toBe(.4);
  });
  it('is invariant to asset order, including CASH in the middle', () => {
    const original = computeTransition(transition());
    const reordered = computeTransition({ symbols: ['GLD', 'CASH', 'SPY'], currentValues: [2000, 2000, 6000], targetWeights: [.4, .2, .4], costBps: 5 });
    close(reordered.afterNav, original.afterNav); close(reordered.fees, original.fees);
    for (const row of original.rows) close(reordered.rows.find(other => other.symbol === row.symbol)!.targetAmount, row.targetAmount);
  });
  it.each([.0001, 100000])('scales dollar amounts but not turnover by %s', scale => {
    const original = computeTransition(transition());
    const scaled = computeTransition(transition({ currentValues: [6000, 2000, 2000].map(value => value * scale) }));
    close(scaled.afterNav, original.afterNav * scale); close(scaled.fees, original.fees * scale);
    close(scaled.grossTurnover, original.grossTurnover);
  });
  it.each([
    { symbols: ['SPY', 'SPY', 'CASH'] }, { symbols: ['spy', 'GLD', 'CASH'] }, { currentValues: [6000, NaN, 2000] },
    { currentValues: [0, 0, 0] }, { currentValues: [Number.MAX_VALUE, Number.MAX_VALUE, 0] }, { currentValues: [-1, 8001, 2000] },
    { currentValues: [10000] }, { targetWeights: [.4, .4, .1] }, { targetWeights: [.4, .7, -.1] },
    { targetWeights: [.4, Infinity, .6] }, { costBps: -1 }, { costBps: 101 }, { costBps: NaN },
  ])('rejects malformed transition inputs %j', invalid => {
    expect(() => computeTransition(transition(invalid))).toThrow();
  });
  it('does not mutate caller input', () => {
    const input = transition(); Object.freeze(input.symbols); Object.freeze(input.currentValues); Object.freeze(input.targetWeights); Object.freeze(input);
    expect(() => computeTransition(input)).not.toThrow();
  });
});

describe('signed active risk from annualized covariance', () => {
  it('matches the analytic 20% SOXL versus SPY example without repeating annualization', () => {
    const result = computeActiveRisk(activeRisk());
    close(result.variance, .2 ** 2 * (.8 ** 2 + .18 ** 2 - 2 * .85 * .8 * .18));
    close(result.trackingError, .13078226179417454);
    close(result.activeWeights.SOXL, .2); close(result.activeWeights.SPY, -.2);
    expect(result.contributions.CASH).toBe(0);
    close(Object.values(result.contributions).reduce((sum, value) => sum + value, 0), result.trackingError);
  });
  it('returns exact zero active risk for identical portfolios', () => {
    const result = computeActiveRisk(activeRisk({ weightsB: [0, 1, 0] }));
    expect(result.trackingError).toBe(0); expect(result.variance).toBe(0); expect(result.relativeContributions).toBeNull();
    expect(result.contributions).toEqual({ SOXL: 0, SPY: 0, CASH: 0 });
  });
  it('accepts zero cash risk and singular perfectly correlated assets', () => {
    const cash = computeActiveRisk({ symbols: ['CASH'], weightsA: [1], weightsB: [1], covariance: [[0]] });
    expect(cash.trackingError).toBe(0); expect(cash.relativeContributions).toBeNull();
    const duplicateExposure = computeActiveRisk({ symbols: ['SPY', 'IVV'], weightsA: [1, 0], weightsB: [0, 1], covariance: [[.04, .04], [.04, .04]] });
    expect(duplicateExposure.trackingError).toBe(0); expect(duplicateExposure.relativeContributions).toBeNull();
  });
  it('retains a negative asset contribution to tracking error', () => {
    const result = computeActiveRisk({ symbols: ['SPY', 'GLD', 'CASH'], weightsA: [0, .5, .5], weightsB: [.2, .4, .4],
      covariance: [[.04, .018, 0], [.018, .01, 0], [0, 0, 0]] });
    close(result.variance, .00098);
    expect(result.contributions.GLD).toBeLessThan(0); expect(result.relativeContributions!.GLD).toBeLessThan(0);
    close(Object.values(result.contributions).reduce((sum, value) => sum + value, 0), result.trackingError);
    close(Object.values(result.relativeContributions!).reduce((sum, value) => sum + value, 0), 1);
  });
  it('reversing A and B reverses active weights but preserves active risk and contributions', () => {
    const input = activeRisk(), result = computeActiveRisk(input);
    const reversed = computeActiveRisk({ ...input, weightsA: input.weightsB, weightsB: input.weightsA });
    close(reversed.trackingError, result.trackingError);
    for (const symbol of input.symbols) {
      close(reversed.activeWeights[symbol], -result.activeWeights[symbol]);
      close(reversed.contributions[symbol], result.contributions[symbol]);
    }
  });
  it.each([1e-12, 1e12])('scales TE by the square root of covariance scale %s', scale => {
    const input = activeRisk(), result = computeActiveRisk(input);
    const scaled = computeActiveRisk({ ...input, covariance: input.covariance.map(row => row.map(value => value * scale)) });
    close(scaled.trackingError, result.trackingError * Math.sqrt(scale));
    for (const symbol of input.symbols) close(scaled.contributions[symbol], result.contributions[symbol] * Math.sqrt(scale));
  });
  it.each([0, .01])('matches an independent 50-asset factor variance with idiosyncratic scale %s', residualScale => {
    const symbols = Array.from({ length: 50 }, (_, index) => `ETF${index}`);
    const factors = symbols.map((_, index) => [.1 + .001 * index, .2 * Math.cos(index)]);
    const residuals = symbols.map((_, index) => residualScale * (index + 1));
    const covariance = factors.map((left, i) => factors.map((right, j) =>
      left[0] * right[0] + left[1] * right[1] + (i === j ? residuals[i] ** 2 : 0)));
    const weightsA = symbols.map(() => .02), weightsB = symbols.map((_, index) => index === 3 ? 1 : 0);
    const active = weightsB.map((weight, index) => weight - weightsA[index]);
    const expected = [0, 1].reduce((sum, factor) =>
      sum + active.reduce((value, weight, index) => value + weight * factors[index][factor], 0) ** 2, 0) +
      active.reduce((sum, weight, index) => sum + (weight * residuals[index]) ** 2, 0);
    const result = computeActiveRisk({ symbols, weightsA, weightsB, covariance });
    close(result.variance, expected); close(result.trackingError, Math.sqrt(expected));
    close(Object.values(result.contributions).reduce((sum, value) => sum + value, 0), result.trackingError);
  });
  it('keeps symbol alignment when cash and risky assets are reordered', () => {
    const input = activeRisk(), original = computeActiveRisk(input), order = [2, 1, 0];
    const reordered = computeActiveRisk({ symbols: order.map(index => input.symbols[index]),
      weightsA: order.map(index => input.weightsA[index]), weightsB: order.map(index => input.weightsB[index]),
      covariance: order.map(i => order.map(j => input.covariance[i][j])) });
    close(reordered.trackingError, original.trackingError);
    for (const symbol of input.symbols) close(reordered.contributions[symbol], original.contributions[symbol]);
  });
  it('rejects an indefinite covariance even when this active allocation has positive variance', () => {
    expect(() => computeActiveRisk({ symbols: ['SPY', 'GLD'], weightsA: [1, 0], weightsB: [0, 1], covariance: [[1, -2], [-2, 1]] })).toThrow(/positive semidefinite/);
  });
  it.each([
    { covariance: [[1]] }, { covariance: [[1, 0, 0], [0, NaN, 0], [0, 0, 0]] },
    { covariance: [[1, .2, 0], [.3, 1, 0], [0, 0, 0]] },
    { covariance: [[-1, 0, 0], [0, 1, 0], [0, 0, 0]] },
    { covariance: [[1, 0, 0], [0, 1, 0], [0, 0, 1e-20]] },
    { covariance: [[0, .1, 0], [.1, 0, 0], [0, 0, 0]] },
    { weightsA: [-.1, 1.1, 0] }, { weightsB: [.2, .7, 0] }, { weightsB: [.2, NaN, .8] },
    { symbols: ['SOXL', 'SOXL', 'CASH'] },
  ])('rejects malformed active risk inputs %j', invalid => {
    expect(() => computeActiveRisk(activeRisk(invalid))).toThrow();
  });
  it('does not mutate the supplied covariance or weights', () => {
    const input = activeRisk(); input.covariance.forEach(Object.freeze); Object.freeze(input.covariance);
    Object.freeze(input.symbols); Object.freeze(input.weightsA); Object.freeze(input.weightsB); Object.freeze(input);
    expect(() => computeActiveRisk(input)).not.toThrow();
  });
});
