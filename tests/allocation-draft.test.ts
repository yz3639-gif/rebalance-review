import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyAllocationPreset, balanceAllocationWithCash, createDefaultAllocationDraft, normalizePercentageDraft, validateAllocationDraft } from '../src/demo/allocationDraft';
import type { AllocationDraftRow } from '../src/demo/allocationDraft';
import { computeActiveRisk, computeTransition } from '../src/engine/transition';

const row = (symbol: string, a: string, b = a): AllocationDraftRow => ({ symbol, a, b });

describe('allocation input drafts', () => {
  it('starts with the original complete six-asset A/B case and independent editable objects', () => {
    const rows = createDefaultAllocationDraft(), copy = createDefaultAllocationDraft();
    const result = validateAllocationDraft(rows);
    expect(rows.map(value => value.symbol)).toEqual(['SPY', 'VXUS', 'BND', 'GLD', 'IEF', 'CASH']);
    expect(result.valid).toBe(true); expect(result.totals).toEqual({ a: 100, b: 100 }); expect(result.errors).toEqual([]);
    expect(result.weightsA).toEqual([.4, .2, .2, .08, .07, .05]);
    expect(result.weightsB).toEqual([.3, .18, .25, .12, .1, .05]);
    rows[0].a = '0'; expect(copy[0].a).toBe('40');
  });
  it.each([['050', '50'], ['000.50', '0.5'], [' 25.00 ', '25'], ['.5', '0.5'], ['1.', '1'], ['+05', '5'], ['1e2', '100'], ['-0', '0']])('normalizes valid blur input %s', (input, expected) => {
    expect(normalizePercentageDraft(input)).toBe(expected);
  });
  it.each(['', ' ', '-', '.', '1e', 'Infinity', 'NaN', '0x32', '1,5', '101', '-1', '1e309'])('preserves invalid or empty blur input %j', input => {
    expect(normalizePercentageDraft(input)).toBe(input);
  });
  it.each(['', ' ', 'NaN', 'Infinity', '-1', '100.01', '0x64', '1e309'])('rejects invalid percentages %j without producing numeric allocations', value => {
    const result = validateAllocationDraft([row('SPY', value, '100')]);
    expect(result.valid).toBe(false); expect(result.symbols).toEqual([]); expect(result.weightsA).toEqual([]); expect(result.weightsB).toEqual([]);
    expect(result.totals).toEqual({ a: null, b: 100 }); expect(result.errors.some(error => error.rowIndex === 0 && error.field === 'a')).toBe(true);
  });
  it('does not normalize invalid totals or substitute zero for blank inputs', () => {
    const rows = [row('SPY', '50', '30'), row('CASH', '', '60')], before = structuredClone(rows);
    const result = validateAllocationDraft(rows);
    expect(result.valid).toBe(false); expect(result.totals).toEqual({ a: null, b: 90 });
    expect(result.errors.some(error => error.field === 'totalB')).toBe(true); expect(rows).toEqual(before);
  });
  it('uses the percent tolerance without rescaling an accepted near-100 allocation', () => {
    const result = validateAllocationDraft([row('SPY', '50'), row('CASH', '49.999999995')]);
    expect(result.valid).toBe(true); expect(result.weightsA[0]).toBe(.5); expect(result.weightsA[1]).toBeCloseTo(.49999999995, 15);
    expect(result.weightsA.reduce((sum, value) => sum + value, 0)).not.toBe(1);
    expect(validateAllocationDraft([row('SPY', '50'), row('CASH', '49.99999998')]).valid).toBe(false);
  });
  it.each(['a', 'b'] as const)('rejects the %s percentage boundary that exceeds the engine tolerance after division', side => {
    const rows = [row('SPY', '50'), row('CASH', '50')];
    rows[1][side] = '50.00000000999999';
    const before = structuredClone(rows), result = validateAllocationDraft(rows);
    expect(Math.abs(result.totals[side]! - 100)).toBeLessThanOrEqual(1e-8);
    const unsafeWeights = rows.map(value => Number(value[side]) / 100);
    expect(Math.abs(unsafeWeights.reduce((sum, weight) => sum + weight, 0) - 1)).toBeGreaterThan(1e-10);
    expect(result.valid).toBe(false); expect(result.weightsA).toEqual([]); expect(result.weightsB).toEqual([]);
    expect(result.errors.some(error => error.field === (side === 'a' ? 'totalA' : 'totalB'))).toBe(true);
    expect(rows).toEqual(before);
  });
  it.each(['spy', ' SPY', 'SPY ', '', 'SPY/QQQ', 'UNKNOWN', '__proto__'])('rejects noncanonical or uncatalogued identity %j', symbol => {
    const result = validateAllocationDraft([row(symbol, '100')]);
    expect(result.valid).toBe(false); expect(result.errors.some(error => error.field === 'symbol')).toBe(true);
  });
  it('rejects duplicate identities even when one row is entirely zero', () => {
    const result = validateAllocationDraft([row('SPY', '100'), row('SPY', '0')]);
    expect(result.valid).toBe(false); expect(result.errors.some(error => /more than once/.test(error.message))).toBe(true);
  });
  it('omits both-zero assets only from valid numeric arrays and preserves draft rows', () => {
    const rows = [row('SPY', '100'), row('SOXL', '0'), row('CASH', '0')];
    const result = validateAllocationDraft(rows);
    expect(result.valid).toBe(true); expect(result.symbols).toEqual(['SPY']); expect(result.weightsA).toEqual([1]);
    expect(rows).toHaveLength(3);
    expect(validateAllocationDraft(rows, ['SPY', 'SOXL'], { includeZeroRows: true }).symbols).toEqual(['SPY', 'SOXL', 'CASH']);
  });
  it('keeps a valid asset present on either side in the same aligned union order', () => {
    const result = validateAllocationDraft([row('SOXL', '0', '20'), row('CASH', '10', '0'), row('SPY', '90', '80')]);
    expect(result.valid).toBe(true); expect(result.symbols).toEqual(['SOXL', 'CASH', 'SPY']);
    expect(result.weightsA).toEqual([0, .1, .9]); expect(result.weightsB).toEqual([.2, 0, .8]);
  });
  it('accepts 50 noncash rows plus CASH and rejects 51, including zero rows', () => {
    const names = Array.from({ length: 51 }, (_, index) => `ETF${index}`);
    const rows = names.slice(0, 50).map(symbol => row(symbol, '1'));
    rows.push(row('CASH', '50'));
    expect(validateAllocationDraft(rows, names).valid).toBe(true);
    const tooMany = validateAllocationDraft([...rows, row(names[50], '0')], names);
    expect(tooMany.valid).toBe(false); expect(tooMany.errors.some(error => error.field === 'rows')).toBe(true);
  });
  it('does not throw on malformed runtime rows', () => {
    for (const rows of [null, undefined, [], [null], [{}], [row('SPY', 100 as unknown as string)]]) {
      let result: ReturnType<typeof validateAllocationDraft> | undefined;
      expect(() => { result = validateAllocationDraft(rows as unknown as AllocationDraftRow[]); }).not.toThrow();
      expect(result!.valid).toBe(false);
    }
  });
});

describe('validated draft to numerical engine integration', () => {
  it('never sends an accepted randomized near-boundary allocation outside either engine tolerance', () => {
    let accepted = 0, rejected = 0;
    const offsets = [-1.0000001e-8, -1e-8, -9.99999e-9, -5e-9, 0, 5e-9, 9.99999e-9, 1e-8, 1.0000001e-8];
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 1, max: 10000 }), { minLength: 2, maxLength: 50 }),
      fc.constantFrom(...offsets), fc.constantFrom(...offsets), fc.boolean(),
      (scores, offsetA, offsetB, withCash) => {
        const makePercentages = (values: number[], offset: number) => {
          const sum = values.reduce((total, value) => total + value, 0);
          const percentages = values.slice(0, -1).map(value => 100 * value / sum);
          return [...percentages, 100 - percentages.reduce((total, value) => total + value, 0) + offset];
        };
        const a = makePercentages(scores, offsetA), b = makePercentages([...scores].reverse(), offsetB);
        const names = scores.map((_, index) => withCash && index === scores.length - 1 ? 'CASH' : `ETF${index}`);
        const rows = names.map((symbol, index) => row(symbol, String(a[index]), String(b[index])));
        const draft = validateAllocationDraft(rows, names);
        if (!draft.valid) {
          rejected++; expect(draft.symbols).toEqual([]); expect(draft.weightsA).toEqual([]); expect(draft.weightsB).toEqual([]);
          return;
        }
        accepted++;
        for (const weights of [draft.weightsA, draft.weightsB]) {
          expect(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1)).toBeLessThanOrEqual(1e-10);
        }
        // This calls the actual engines rather than a copied validation formula.
        const ticket = computeTransition({ symbols: draft.symbols, currentValues: draft.weightsA.map(weight => weight * 100000), targetWeights: draft.weightsB, costBps: 5 });
        const covariance = draft.symbols.map((symbol, i) => draft.symbols.map((_, j) => symbol === 'CASH' || i !== j ? 0 : .01 + i * .001));
        const active = computeActiveRisk({ symbols: draft.symbols, weightsA: draft.weightsA, weightsB: draft.weightsB, covariance });
        expect(Number.isFinite(ticket.fees)).toBe(true); expect(Number.isFinite(active.trackingError)).toBe(true);
        expect(ticket.afterNav + ticket.fees).toBeCloseTo(ticket.beforeNav, 7);
      },
    ), { seed: 3639, numRuns: 300 });
    expect(accepted).toBeGreaterThan(50); expect(rejected).toBeGreaterThan(0);
  });
  it('preserves symbol alignment across the default SPY-first and historical covariance orders', () => {
    const rows = createDefaultAllocationDraft();
    const historicalOrder = ['BND', 'GLD', 'IEF', 'SPY', 'VXUS', 'CASH'];
    const varianceBySymbol: Record<string, number> = { SPY: .0324, VXUS: .04, BND: .01, GLD: .04, IEF: .0025, CASH: 0 };
    const historicalCovariance = historicalOrder.map((symbol, i) => historicalOrder.map((_, j) => i === j ? varianceBySymbol[symbol] : 0));
    const expectedVariance = .1 ** 2 * .0324 + .02 ** 2 * .04 + .05 ** 2 * .01 + .04 ** 2 * .04 + .03 ** 2 * .0025;
    const calculate = (draftRows: AllocationDraftRow[]) => {
      const draft = validateAllocationDraft(draftRows);
      expect(draft.valid).toBe(true);
      const mapped = draft.symbols.map(left => draft.symbols.map(right =>
        historicalCovariance[historicalOrder.indexOf(left)][historicalOrder.indexOf(right)]));
      return { active: computeActiveRisk({ symbols: draft.symbols, weightsA: draft.weightsA, weightsB: draft.weightsB, covariance: mapped }),
        ticket: computeTransition({ symbols: draft.symbols, currentValues: draft.weightsA.map(weight => weight * 100000), targetWeights: draft.weightsB, costBps: 5 }) };
    };
    const original = calculate(rows), reordered = calculate(historicalOrder.map(symbol => rows.find(value => value.symbol === symbol)!));
    expect(original.active.variance).toBeCloseTo(expectedVariance, 15);
    expect(reordered.active.variance).toBeCloseTo(expectedVariance, 15);
    expect(reordered.ticket.fees).toBeCloseTo(original.ticket.fees, 9);
    for (const symbol of historicalOrder) expect(reordered.active.contributions[symbol]).toBeCloseTo(original.active.contributions[symbol], 15);
  });
});

describe('explicit allocation preset actions', () => {
  it('fills B targets, preserves A and existing rows, and adds missing preset assets at A=0', () => {
    const rows = [row('SOXL', '50', '75'), row('SPY', '50', '25')], before = structuredClone(rows);
    const updated = applyAllocationPreset(rows, 'core');
    expect(updated[0]).toEqual(row('SOXL', '50', '0')); expect(updated[1]).toEqual(row('SPY', '50', '30'));
    expect(updated.find(value => value.symbol === 'BND')).toEqual(row('BND', '0', '25'));
    expect(validateAllocationDraft(updated).valid).toBe(true); expect(rows).toEqual(before);
  });
  it('makes unchanged copy the actual edited A strings, including blanks, rather than hardcoded defaults', () => {
    const rows = [row('SOXL', '050', '20'), row('SPY', '', '80')];
    const updated = applyAllocationPreset(rows, 'unchanged');
    expect(updated).toEqual([row('SOXL', '050'), row('SPY', '')]);
    expect(validateAllocationDraft(updated).valid).toBe(false);
  });
  it('creates the complete defensive target without altering A', () => {
    const rows = createDefaultAllocationDraft(), updated = applyAllocationPreset(rows, 'defensive');
    expect(updated.map(value => value.a)).toEqual(rows.map(value => value.a));
    expect(updated.map(value => value.b)).toEqual(['20', '10', '30', '10', '15', '15']);
    expect(validateAllocationDraft(updated).valid).toBe(true);
  });
  it('does not silently drop rows when adding a preset exceeds the asset limit', () => {
    const names = Array.from({ length: 50 }, (_, index) => `ETF${index}`), rows = names.map(symbol => row(symbol, '2'));
    const updated = applyAllocationPreset(rows, 'core');
    expect(updated).toHaveLength(56);
    expect(validateAllocationDraft(updated, [...names, 'SPY', 'VXUS', 'BND', 'GLD', 'IEF']).valid).toBe(false);
  });
  it('keeps invalid ticker drafts as strings until validation, including object-property names', () => {
    const updated = applyAllocationPreset([row('__proto__', '100')], 'core');
    expect(updated[0]).toEqual(row('__proto__', '100', '0'));
    expect(validateAllocationDraft(updated).valid).toBe(false);
  });
});

describe('explicit cash balancing', () => {
  it('fills existing CASH on the chosen side and preserves other-side drafts', () => {
    const rows = [row('SPY', '70', ''), row('CASH', '', '25')], before = structuredClone(rows);
    const result = balanceAllocationWithCash(rows, 'a');
    expect(result.error).toBeUndefined(); expect(result.rows).toEqual([row('SPY', '70', ''), row('CASH', '30', '25')]);
    expect(rows).toEqual(before);
  });
  it('adds CASH with zero on the unselected side', () => {
    const result = balanceAllocationWithCash([row('SPY', '100', '40')], 'b');
    expect(result.rows).toEqual([row('SPY', '100', '40'), row('CASH', '0', '60')]);
    expect(validateAllocationDraft(result.rows).valid).toBe(true);
  });
  it('supports a new all-cash draft without a catalog lookup', () => {
    const result = balanceAllocationWithCash([], 'a');
    expect(result.rows).toEqual([row('CASH', '100', '0')]);
    expect(result.error).toBeUndefined();
    expect(balanceAllocationWithCash([row('NOTCATALOGUED', '50')], 'a').error).toBeUndefined();
  });
  it.each(['', 'NaN', '-1', 'Infinity', '101'])('rejects invalid noncash percentages %j and preserves the draft', a => {
    const rows = [row('SPY', a), row('CASH', '20')], result = balanceAllocationWithCash(rows, 'a');
    expect(result.error).toBeTruthy(); expect(result.rows).toEqual(rows);
  });
  it('rejects noncash totals above 100 rather than reducing other holdings', () => {
    const rows = [row('SPY', '80'), row('GLD', '30')], result = balanceAllocationWithCash(rows, 'a');
    expect(result.error).toMatch(/exceed 100/); expect(result.rows).toEqual(rows);
  });
  it('rejects duplicates and noncanonical tickers without overwriting cash', () => {
    for (const rows of [[row('CASH', '10'), row('CASH', '90')], [row('spy', '50')]]) {
      expect(balanceAllocationWithCash(rows, 'a').error).toMatch(/ticker formatting and duplicate/);
    }
  });
  it('removes subtraction noise while retaining decimal cash precision', () => {
    const result = balanceAllocationWithCash([row('SPY', '33.33333333'), row('GLD', '33.33333333')], 'a');
    expect(result.rows.at(-1)!.a).toBe('33.33333334');
    expect(validateAllocationDraft(result.rows.map(value => ({ ...value, b: value.a }))).valid).toBe(true);
  });
  it('accepts frozen input for every action and leaves it unchanged', () => {
    const rows = createDefaultAllocationDraft(); rows.forEach(Object.freeze); Object.freeze(rows);
    expect(() => validateAllocationDraft(rows)).not.toThrow();
    expect(() => applyAllocationPreset(rows, 'defensive')).not.toThrow();
    expect(() => balanceAllocationWithCash(rows, 'a')).not.toThrow();
  });
});
