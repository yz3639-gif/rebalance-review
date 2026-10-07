import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import fixtures from '../oracle/fixtures.json';
import legacyFixture from '../oracle/legacy-fixture.json';
import type { ReviewSpec, Frequency } from '../src/types';
import { computeReview, eulerRisk, ledoitWolf, rebalance, simulateLedger, validateReviewInputs } from '../src/engine';
import { expectedUsEquitySessions } from '../src/data/calendar';

function near(actual: number, expected: number, absolute = 1e-10, relative = 1e-8) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(absolute + relative * Math.abs(expected));
}
function baseSpec(): ReviewSpec {
  return {
    a: { id: 'a', name: 'Current', holdings: [{ symbol: 'SPY', weight: .55 }, { symbol: 'IEF', weight: .30 }, { symbol: 'CASH', weight: .15 }] },
    b: { id: 'b', name: 'Proposed', holdings: [{ symbol: 'SPY', weight: .35 }, { symbol: 'IEF', weight: .3 }, { symbol: 'GLD', weight: .2 }, { symbol: 'CASH', weight: .15 }] },
    dataset: { manifest: { id: 'oracle', source: 'Independent synthetic Python fixture', currency: 'USD', basis: 'total_return_index', asOf: fixtures.dates.at(-1)!, synthetic: true,
      rights: { display: true, rawPersistence: true, derivedPersistence: true, export: true, publicDisplay: true, evidence: 'Synthetic fixture', verifiedAt: '2026-10-05' } },
    dates: [...fixtures.dates], symbols: [...fixtures.symbols], prices: fixtures.prices.map(row => [...row]) },
    frequency: 'monthly', costBps: 5, initialNav: 100000, cashReturnConfirmed: true, partialCoverageConfirmed: false,
  };
}

describe('shared preflight without a market-data request', () => {
  it('validates complete allocations without requiring prices', () => {
    const { dataset: _dataset, ...input } = baseSpec();
    expect(validateReviewInputs(input).union).toEqual(['SPY', 'IEF', 'CASH', 'GLD']);
  });
  it.each(['underweight','duplicate','invalid cost','invalid capital','cash consent','nonboolean consent'] as const)('rejects %s before any dataset is needed', problem => {
    const { dataset: _dataset, ...input } = baseSpec();
    if (problem === 'underweight') { input.a.holdings[0].weight -= .1; input.b.holdings[0].weight -= .1; }
    if (problem === 'duplicate') input.a.holdings.push({ symbol:'SPY', weight:0 });
    if (problem === 'invalid cost') input.costBps=NaN;
    if (problem === 'invalid capital') input.initialNav=Infinity;
    if (problem === 'cash consent') input.cashReturnConfirmed=false;
    if (problem === 'nonboolean consent') input.partialCoverageConfirmed='true' as unknown as boolean;
    expect(()=>validateReviewInputs(input)).toThrow();
  });
});

describe('independent Python/sklearn numerical oracle', () => {
  for (const fixture of fixtures.covarianceCases) it(`matches centered sklearn LedoitWolf: ${fixture.name}`, () => {
    const actual = ledoitWolf(fixture.samples);
    const maximum = Math.max(...fixture.covariance.flat().map(Math.abs));
    actual.forEach((row, i) => row.forEach((v, j) => expect(Math.abs(v - fixture.covariance[i][j])).toBeLessThanOrEqual(1e-12 + 1e-8 * maximum)));
  });
  for (const scenario of fixtures.scenarios) it(`matches independent ledger ${scenario.name}, ${scenario.frequency}, delay=${scenario.lag}`, () => {
    const actual = simulateLedger(fixtures.dates, fixtures.prices, scenario.target, scenario.frequency as Frequency, scenario.costBps, 100000, scenario.lag as 1 | 2);
    actual.rows.forEach((row, i) => {
      const expected = scenario.expected.rows[i];
      near(row.nav, expected.nav, 1e-8, 1e-10); near(row.cash, expected.cash, 1e-8, 1e-10); near(row.fee, expected.fee);
    });
    for (const key of ['totalReturn', 'cagr', 'volatility', 'maxDrawdown', 'fees', 'turnover'] as const) near(actual.result[key], scenario.expected[key]);
  });
  it('matches annualized covariance and Euler risk, with an exact-zero cash row', () => {
    const result = computeReview(baseSpec());
    for (const reference of fixtures.risk) {
      const actual = result.risk.windows.find(w => w.window === reference.window)!;
      near(actual.a!.volatility, reference.volatility);
      fixtures.symbols.forEach((symbol, i) => near(actual.a!.contributions[symbol], reference.contributions[i]));
      const cash = result.symbols.indexOf('CASH');
      expect(actual.covariance![cash]).toEqual(result.symbols.map(() => 0));
      expect(actual.covariance!.every(row => row[cash] === 0)).toBe(true);
      near(Object.values(actual.a!.contributions).reduce((s, v) => s + v, 0), actual.a!.volatility);
    }
  });
  it('agrees with the unchanged legacy ledger when strategic cash is zero', () => {
    const actual = simulateLedger(legacyFixture.dates, legacyFixture.prices, legacyFixture.target, 'monthly', legacyFixture.costBps, legacyFixture.initialNav);
    actual.result.nav.forEach((value, i) => near(value, legacyFixture.nav[i], 1e-8, 1e-10));
    actual.rows.forEach((row, i) => near(row.fee, legacyFixture.fees[i]));
    expect(legacyFixture.sourceSha256).toHaveLength(64);
  });
});

describe('review invariants and edge cases', () => {
  it('same A/B yields exactly zero risk, performance, fee and sensitivity deltas', () => {
    const spec = baseSpec(); spec.b = structuredClone(spec.a);
    const result = computeReview(spec);
    expect(result.history.a).toEqual(result.history.b);
    for (const window of result.risk.windows) expect(window.a).toEqual(window.b);
    for (const row of result.costSensitivity) expect(row.aCagr).toBe(row.bCagr);
    expect(result.delaySensitivity.a).toEqual(result.delaySensitivity.b);
  });
  it('all cash has no fees, return or variance and undefined relative contributions', () => {
    const spec = baseSpec(); spec.a.holdings = [{ symbol: 'CASH', weight: 1 }]; spec.b = structuredClone(spec.a);
    const result = computeReview(spec);
    expect(result.history.a.totalReturn).toBe(0); expect(result.history.a.fees).toBe(0); expect(result.history.a.trades).toBe(0);
    for (const window of result.risk.windows.filter(w => w.available)) {
      expect(window.a!.volatility).toBe(0); expect(window.a!.relativeContributions).toBeNull(); expect(window.covariance).toEqual([[0]]);
    }
  });
  it('one asset and constant prices produce zero risk without a variance floor', () => {
    const spec = baseSpec(); spec.a.holdings = [{ symbol: 'SPY', weight: 1 }]; spec.b = structuredClone(spec.a);
    spec.dataset.prices = spec.dataset.prices.map(row => row.map(() => 100));
    const result = computeReview(spec);
    expect(result.risk.windows[0].a!.volatility).toBe(0); expect(result.risk.windows[0].a!.relativeContributions).toBeNull();
    near(result.history.a.totalReturn, 1 / 1.0005 - 1);
  });
  it('retains valid negative Euler contributions', () => {
    const result = eulerRisk([.9, .1], [[.04, -.015], [-.015, .01]], ['A', 'B']);
    expect(result.contributions.B).toBeLessThan(0);
    near(result.contributions.A + result.contributions.B, result.volatility);
  });
  it('252 returns require 253 observations; 504 sensitivity is unavailable without 505', () => {
    const spec = baseSpec(); spec.dataset.dates = spec.dataset.dates.slice(0, 253); spec.dataset.prices = spec.dataset.prices.slice(0, 253);
    const result = computeReview(spec);
    expect(result.observations).toBe(252); expect(result.risk.windows.find(w => w.window === 504)!.available).toBe(false);
    spec.dataset.dates.pop(); spec.dataset.prices.pop(); expect(() => computeReview(spec)).toThrow(/253 common prices/);
  });
  it('uses only the latest five calendar years and enables 504 when sufficient common prices exist', () => {
    const spec = baseSpec(), dates: string[] = [], cursor = new Date('2017-01-02T00:00:00Z');
    while (cursor.toISOString().slice(0, 10) <= '2024-02-29') {
      if (![0, 6].includes(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    spec.dataset.dates = dates; spec.dataset.manifest.asOf = '2024-02-29';
    spec.dataset.prices = dates.map((_, i) => [100 + i * .02, 100 + i * .01, 100 + i * .03]);
    const result = computeReview(spec);
    expect(result.start).toBe('2019-02-28'); expect(result.end).toBe('2024-02-29');
    expect(result.risk.windows.find(w => w.window === 504)!.available).toBe(true);
    expect(result.history.a.dates).toEqual(result.history.b.dates);
  });
  it('initial purchase reconciles cash plus risky transaction fees and includes its drawdown', () => {
    const actual = simulateLedger(['2024-01-30', '2024-01-31'], [[100], [100]], [.6], 'monthly', 20, 100000);
    const expected = 100000 / (1 + .002 * .6);
    near(actual.rows[0].nav, expected); near(actual.rows[0].cash, .4 * expected);
    near(actual.rows[0].fee, .002 * .6 * expected); near(actual.result.maxDrawdown, 1 - expected / 100000);
    expect(actual.rows[1].executedSignal).toBeNull();
  });
  it('next-session close timing lets old holdings earn execution-day return; no forced terminal fill', () => {
    const dates = ['2024-01-30', '2024-01-31', '2024-02-01', '2024-02-02'];
    const prices = [[100, 100], [200, 100], [400, 100], [400, 200]];
    const normal = simulateLedger(dates, prices, [.5, .5], 'monthly', 0, 100);
    expect(normal.rows[1].executedSignal).toBeNull();
    near(normal.rows[2].navBeforeTrade, 250);
    expect(normal.rows[2].executedSignal).toBe('2024-01-31');
    expect(normal.rows[2].holdings).toEqual([125, 125]);
    const delayed = simulateLedger(dates, prices, [.5, .5], 'monthly', 0, 100, 2);
    expect(delayed.rows[2].executedSignal).toBeNull();
    expect(delayed.rows[3].executedSignal).toBe('2024-01-31');
    const terminal = simulateLedger(dates.slice(0, 3), prices.slice(0, 3), [.5, .5], 'monthly', 0, 100, 2);
    expect(terminal.rows.at(-1)!.executedSignal).toBeNull();
  });
  it('future prices and future sessions do not revise prior ledger rows', () => {
    const dates = fixtures.dates, prices = fixtures.prices;
    for (const lag of [1, 2] as const) {
      const original = simulateLedger(dates.slice(0, 101), prices.slice(0, 101), [.55, .3, 0], 'monthly', 5, 100000, lag);
      const changed = prices.map((row, i) => i < 101 ? row : row.map(x => x * 2));
      const extension = simulateLedger(dates, changed, [.55, .3, 0], 'monthly', 5, 100000, lag);
      expect(extension.rows.slice(0, 101)).toEqual(original.rows);
    }
  });
  it('a delayed pending signal survives a subsequent period boundary on sparse inputs', () => {
    const actual = simulateLedger(['2024-01-31', '2024-02-29', '2024-03-28', '2024-04-30'], [[100], [102], [103], [101]], [.6], 'monthly', 5, 100000, 2);
    expect(actual.rows[2].executedSignal).toBe('2024-01-31');
    expect(actual.rows[3].executedSignal).toBe('2024-02-29');
  });
  it('per-symbol adjusted-price rescaling does not change results (no double distribution charge)', () => {
    const spec = baseSpec(), original = computeReview(spec);
    spec.dataset.prices = spec.dataset.prices.map(row => row.map((x, j) => x * [2, .1, 7][j]));
    const scaled = computeReview(spec);
    near(scaled.history.a.totalReturn, original.history.a.totalReturn); near(scaled.risk.windows[0].a!.volatility, original.risk.windows[0].a!.volatility);
  });
  it('partial coverage requires confirmation and reports original covered weight fractions', () => {
    const spec = baseSpec(); spec.a.holdings = [{ symbol: 'SPY', weight: .8 }, { symbol: 'UNKNOWN', weight: .2 }];
    expect(() => computeReview(spec)).toThrow(/Explicit partial/);
    spec.partialCoverageConfirmed = true;
    const result = computeReview(spec); expect(result.partial).toBe(true); near(result.coverage.a, .8); expect(result.symbols).not.toContain('UNKNOWN');
    expect(result.warnings[0]).toMatch(/PARTIAL COVERAGE/);
  });
  it('zero-weight unknown assets do not impose data requirements', () => {
    const spec = baseSpec(); spec.a.holdings.push({ symbol: 'UNKNOWN', weight: 0 }); expect(computeReview(spec).partial).toBe(false);
  });
  it('review identifiers are unique and remain within the archive limit regardless of source ID length', () => {
    const spec = baseSpec(); spec.dataset.manifest.id = 'x'.repeat(100);
    const first = computeReview(spec), second = computeReview(spec);
    expect(first.id.length).toBeLessThanOrEqual(100); expect(first.id).not.toBe(second.id);
  });
  it('self financing holds across generated cash allocations, prices and transaction costs', () => {
    fc.assert(fc.property(
      fc.array(fc.double({ min: .01, max: 1, noNaN: true }), { minLength: 1, maxLength: 20 }),
      fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 10, max: 5000000, noNaN: true }), fc.integer({ min: 0, max: 200 }),
      (raw, invested, nav, bps) => {
        const total = raw.reduce((s, v) => s + v, 0), target = raw.map(v => v / total * invested);
        const holdings = raw.map(v => v / total * nav * .7);
        const actual = rebalance(nav, holdings, target, bps / 10000);
        const tolerance = Math.max(1e-8, nav * 1e-10);
        expect(Math.abs(nav - actual.nav - actual.fee)).toBeLessThanOrEqual(tolerance);
        expect(Math.abs(actual.holdings.reduce((s, v) => s + v, actual.cash) - actual.nav)).toBeLessThanOrEqual(tolerance);
        expect(actual.cash).toBeGreaterThanOrEqual(0);
      }), { numRuns: 100, seed: 318 });
  });
  it('low-level ledger rejects negative implied initial cash and impossible dates', () => {
    expect(() => rebalance(100, [101], [.5], .001)).toThrow();
    expect(() => simulateLedger(['2024-02-31', '2024-03-01'], [[100], [102]], [1], 'monthly', 5, 100)).toThrow();
  });
});

describe('engine boundary rejects unsafe or ambiguous inputs', () => {
  it('rejects real ETF histories before issuer inception, even in a direct engine payload', () => {
    const spec = baseSpec();
    spec.a.holdings = [{ symbol: 'VOO', weight: 1 }]; spec.b = structuredClone(spec.a);
    spec.dataset.symbols = ['VOO']; spec.dataset.dates = expectedUsEquitySessions('2009-01-02', '2010-12-31');
    spec.dataset.prices = spec.dataset.dates.map((_, i) => [100 + .01 * i]);
    spec.dataset.manifest.synthetic = false; spec.dataset.manifest.asOf = '2010-12-31';
    expect(() => computeReview(spec)).toThrow(/inception/);
  });
  const invalid: [string, (spec: ReviewSpec) => void][] = [
    ['duplicate dates', s => { s.dataset.dates[2] = s.dataset.dates[1]; }],
    ['unsorted dates', s => { [s.dataset.dates[1], s.dataset.dates[2]] = [s.dataset.dates[2], s.dataset.dates[1]]; }],
    ['invalid calendar date', s => { s.dataset.dates[0] = '2022-02-31'; }],
    ['future cutoff', s => { s.dataset.manifest.asOf = '2999-01-01'; }],
    ['future price relative to cutoff', s => { s.dataset.manifest.asOf = '2022-01-04'; }],
    ['missing internal price', s => { s.dataset.prices[200][0] = NaN; }],
    ['missing internal session', s => { s.dataset.prices.splice(200, 1); s.dataset.dates.splice(200, 1); }],
    ['infinite price', s => { s.dataset.prices[20][1] = Infinity; }],
    ['nonpositive price', s => { s.dataset.prices[20][1] = 0; }],
    ['duplicate holdings', s => { s.a.holdings.push({ symbol: 'spy', weight: 0 }); }],
    ['negative weight', s => { s.a.holdings[0].weight = -.1; }],
    ['weights do not sum to one', s => { s.a.holdings[0].weight = .8; }],
    ['unconfirmed cash', s => { s.cashReturnConfirmed = false; }],
    ['display rights denied', s => { s.dataset.manifest.rights.display = false; }],
    ['empty rights evidence', s => { s.dataset.manifest.rights.evidence = ''; }],
    ['future rights evidence', s => { s.dataset.manifest.rights.verifiedAt = '2999-01-01'; }],
    ['no covered holdings', s => { s.a.holdings = [{ symbol: 'UNKNOWN', weight: 1 }]; s.partialCoverageConfirmed = true; }],
    ['more than 50 risky positions', s => { s.a.holdings = Array.from({ length: 51 }, (_, i) => ({ symbol: `UNKNOWN${i}`, weight: 1 / 51 })); s.partialCoverageConfirmed = true; }],
    ['misaligned symbols/prices', s => { s.dataset.symbols.push('TLT'); }],
    ['excessive per-side fee', s => { s.costBps = 101; }],
    ['capital above the product bound', s => { s.initialNav = 1e12 + 1; }],
    ['invalid symbol characters', s => { s.a.holdings[0].symbol = '=SUM(A1)'; s.partialCoverageConfirmed = true; }],
    ['market values disagree with weights', s => { s.a.marketValues = { SPY: 30, IEF: 55, CASH: 15 }; }],
    ['negative market values', s => { s.a.marketValues = { SPY: -55, IEF: -30, CASH: -15 }; }],
  ];
  for (const [name, mutate] of invalid) it(`rejects ${name}`, () => { const spec = baseSpec(); mutate(spec); expect(() => computeReview(spec)).toThrow(); });
});
