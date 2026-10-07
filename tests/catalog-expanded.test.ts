import { describe, expect, it, vi, afterEach } from 'vitest';
import { ETF_REGISTRY, DEMO_SYMBOLS, SUPPORTED_SYMBOLS, MAX_REVIEW_ASSETS, CATALOG_VERSION, getEtf, searchEtfs, snapshotCatalog, createSyntheticDemo, parseHoldings, normalizeSymbol, isCashOnly } from '../src/data';
import { computeReview, simulateLedger } from '../src/engine';
import type { ReviewSpec } from '../src/types';
import fixture from '../oracle/expanded-50-fixture.json';
import { createTiingoAdapter } from '../src/providers/tiingo';
import { PROVIDER_BATCH_TIMEOUT_MS, observationsDataset, validateProviderRequest, withProviderDeadline } from '../src/providers/shared';

function near(actual: number, expected: number, absolute = 1e-10, relative = 1e-8) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(absolute + relative * Math.abs(expected));
}
function spec(): ReviewSpec {
  const { dataset } = createSyntheticDemo({ symbols: fixture.symbols, observations: 505, endDate: fixture.dates.at(-1) });
  dataset.dates = [...fixture.dates]; dataset.prices = fixture.prices.map(row => [...row]);
  return { dataset,
    a: { id: 'a', name: 'Fifty assets plus cash', holdings: [...fixture.symbols.map((symbol, i) => ({ symbol, weight: fixture.scenarios[0].target[i] })), { symbol: 'CASH', weight: .1 }] },
    b: { id: 'b', name: 'Fifty fully invested', holdings: fixture.symbols.map((symbol, i) => ({ symbol, weight: fixture.scenarios[2].target[i] })) },
    frequency: 'monthly', costBps: 5, initialNav: 100000, partialCoverageConfirmed: false, cashReturnConfirmed: true };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('versioned US ETF listing catalog', () => {
  it('keeps demonstrations bounded while expanding the searchable listing universe', () => {
    expect(DEMO_SYMBOLS).toHaveLength(16); expect(createSyntheticDemo().dataset.symbols).toEqual(DEMO_SYMBOLS);
    expect(SUPPORTED_SYMBOLS.length).toBeGreaterThan(1000); expect(new Set(SUPPORTED_SYMBOLS).size).toBe(SUPPORTED_SYMBOLS.length);
    expect(searchEtfs('SCHD')[0].symbol).toBe('SCHD'); expect(searchEtfs('dividend', 8)).toHaveLength(8);
    expect(ETF_REGISTRY.every(entry => entry.catalogVersion === CATALOG_VERSION && entry.identity === 'verified')).toBe(true);
  });
  it('does not invent currency or inception verification from a listing identity', () => {
    expect(getEtf('SCHD')!.currency).toEqual({ value: null, status: 'pending' });
    expect(getEtf('SCHD')!.inception).toEqual({ value: null, status: 'pending' });
    expect(getEtf('SPY')!.currency.status).toBe('verified');
    const frozen = snapshotCatalog(['SCHD','CASH','SCHD','UNKNOWN']);
    expect(frozen.assets).toHaveLength(2); expect(frozen.assets[1].identity).toBe('pending');
    frozen.assets[0].name = 'edited'; expect(getEtf('SCHD')!.name).not.toBe('edited');
  });
  it('distinguishes the listed USD fund from modeled USD cash', () => {
    expect(getEtf('USD')!.name).toMatch(/Semiconductors/);
    expect(normalizeSymbol('USD')).toBe('USD'); expect(normalizeSymbol('USD CASH')).toBe('CASH');
    const portfolio = parseHoldings('symbol,weight\nUSD,100', { mode: 'weight', weightUnit: 'percent' }).portfolio;
    expect(portfolio.holdings).toEqual([{ symbol: 'USD', weight: 1 }]); expect(isCashOnly(portfolio, portfolio)).toBe(false);
  });
  it('uses a common fifty-asset limit and rejects fifty-one before network or calculation', () => {
    expect(MAX_REVIEW_ASSETS).toBe(50);
    const fifty = SUPPORTED_SYMBOLS.slice(0, 50);
    expect(validateProviderRequest({ symbols: [...fifty], start: '2025-01-02', end: '2025-01-03' }).symbols).toHaveLength(50);
    expect(() => validateProviderRequest({ symbols: SUPPORTED_SYMBOLS.slice(0, 51), start: '2025-01-02', end: '2025-01-03' })).toThrow(/50/);
    expect(() => parseHoldings(Array.from({ length: 51 }, (_, i) => `UNKNOWN${i},1`).join('\n'), { mode: 'market_value', hasHeader: false })).toThrow(/50/);
    const input = spec(); input.a.holdings = SUPPORTED_SYMBOLS.slice(0, 51).map(symbol => ({ symbol, weight: 1 / 51 }));
    expect(() => computeReview(input)).toThrow(/50 different noncash/);
  });
  it('retains a dormant zero-weight identity without counting it as a fifty-first exposure', () => {
    const input = spec();
    input.a = { ...structuredClone(input.b), id: 'a', name: 'Current allocation' };
    const baseline = computeReview(input);
    const dormant = SUPPORTED_SYMBOLS.find(symbol => !input.dataset.symbols.includes(symbol))!;
    input.a.holdings.push({ symbol: dormant, weight: 0 });
    const actual = computeReview(input);
    expect(input.a.holdings).toHaveLength(51);
    expect(actual.symbols).toHaveLength(50);
    expect(actual.symbols).not.toContain(dormant);
    expect({ ...actual, id: baseline.id }).toEqual(baseline);
  });
  it('bounds raw editor rows independently of the positive-exposure limit', () => {
    const input = spec();
    input.a.holdings = [{ symbol: 'SPY', weight: 1 }, ...Array.from({ length: 51 }, (_, i) => ({ symbol: `ZERO${i}`, weight: 0 }))];
    expect(() => computeReview(input)).toThrow(/at most 51 holding rows/);
  });
});
describe('independent fifty-asset numerical reference at unchanged tolerances', () => {
  it('compares public-engine covariance, Euler contributions and histories including cash', () => {
    const actual = computeReview(spec());
    expect(actual.symbols).toHaveLength(51);
    for (const reference of fixture.risk) {
      const window = actual.risk.windows.find(w => w.window === reference.window)!;
      near(window.a!.volatility, reference.a.volatility); near(window.b!.volatility, reference.b.volatility);
      const maximum = Math.max(...reference.covariance.flat().map(Math.abs));
      fixture.symbols.forEach((symbol, i) => {
        near(window.a!.contributions[symbol], reference.a.contributions[i]); near(window.b!.contributions[symbol], reference.b.contributions[i]);
        fixture.symbols.forEach((other, j) => expect(Math.abs(window.covariance![actual.symbols.indexOf(symbol)][actual.symbols.indexOf(other)] - reference.covariance[i][j])).toBeLessThanOrEqual(1e-12 + 1e-8 * maximum));
      });
      expect(window.covariance![actual.symbols.indexOf('CASH')]).toEqual(actual.symbols.map(() => 0));
    }
    for (const [side, reference] of [['a', fixture.scenarios[0]], ['b', fixture.scenarios[2]]] as const) {
      actual.history[side].nav.forEach((value, i) => near(value, reference.expected.rows[i].nav, 1e-8, 1e-10));
      for (const key of ['cagr','totalReturn','volatility','maxDrawdown','fees','turnover'] as const) near(actual.history[side][key], reference.expected[key]);
    }
  });
  for (const reference of fixture.scenarios) it(`reconciles fifty-asset ${reference.name}, lag ${reference.lag}`, () => {
    const actual = simulateLedger(fixture.dates, fixture.prices, reference.target, 'monthly', 5, 100000, reference.lag as 1|2);
    actual.rows.forEach((row, i) => { near(row.nav, reference.expected.rows[i].nav, 1e-8, 1e-10); near(row.cash, reference.expected.rows[i].cash, 1e-8, 1e-10); near(row.fee, reference.expected.rows[i].fee); });
  });
});
describe('expanded acquisition boundary', () => {
  it('requires USD confirmation for new listings and accepts per-asset metadata only as provider coverage', async () => {
    const request = { symbols: ['SCHD'], start: '2025-01-02', end: '2025-01-03' };
    const fetch = vi.fn().mockResolvedValue(Response.json({ symbol: 'SCHD', coverage: { startDate: '2012-01-03', endDate: request.end }, prices: [{ date: request.start, adjClose: 100 }, { date: request.end, adjClose: 101 }] }));
    vi.stubGlobal('fetch', fetch);
    await expect(createTiingoAdapter({ token: 'TEST_ONLY' }).fetch(request, new AbortController().signal)).rejects.toMatchObject({ code: 'currency_confirmation' });
    expect(fetch).not.toHaveBeenCalled();
    const progress = vi.fn();
    const dataset = await createTiingoAdapter({ token: 'TEST_ONLY', usdConfirmed: true }).fetch(request, new AbortController().signal, progress);
    expect(dataset.manifest.acquisition!.assets[0]).toEqual({ symbol: 'SCHD', firstDate: request.start, lastDate: request.end, observations: 2, providerStartDate: '2012-01-03', providerEndDate: request.end });
    expect(getEtf('SCHD')!.inception.status).toBe('pending');
    expect(progress).toHaveBeenLastCalledWith({ completed: 1, total: 1, status: 'complete' });
  });
  it('rejects stale returned tails independently for every requested asset', () => {
    const manifest = createSyntheticDemo().dataset.manifest;
    expect(() => observationsDataset([{ date: '2025-01-02', symbol: 'SPY', value: 100 }], { symbols: ['SPY'], start: '2025-01-02', end: '2025-01-03' }, manifest)).toThrow(/final session/);
  });
  it('caps the batch separately at 180 seconds even if individual work completes', async () => {
    vi.useFakeTimers();
    const task = withProviderDeadline(new AbortController().signal, signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))), PROVIDER_BATCH_TIMEOUT_MS);
    const check = expect(task).rejects.toMatchObject({ code: 'timeout' }); await vi.advanceTimersByTimeAsync(180001); await check;
  });
  it('shows Retry-After on limit errors without automatically retrying', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '90' } })); vi.stubGlobal('fetch', fetch);
    await expect(createTiingoAdapter({ token: 'TEST_ONLY' }).fetch({ symbols: ['SPY'], start: '2025-01-02', end: '2025-01-03' }, new AbortController().signal)).rejects.toThrow(/at least 90 seconds/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
