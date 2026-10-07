import { afterEach, describe, expect, it, vi } from 'vitest';
import { createYahooLocalAdapter } from '../src/providers';
import { expectedUsEquitySessions } from '../src/data/calendar';
import { manifestRightsDecision, validateManifest } from '../src/data';
import { ProviderError } from '../src/providers/shared';
import { computeReview } from '../src/engine';
import { exportRecord, parseArchive, validateRecord } from '../src/records';
import { createPdfSnapshot } from '../src/pdf/model';
import type { ReviewRecord, ReviewSpec } from '../src/types';

const dates = expectedUsEquitySessions('2024-01-02', '2025-03-01').slice(0, 253);
const request = { symbols: ['SOXL'], start: dates[0], end: dates.at(-1)! };
const prices = dates.map((date, i) => ({ date, adjClose: 100 + i / 10 }));
const signal = () => new AbortController().signal;
const response = (rows: unknown[] = prices, symbol = 'SOXL') => Response.json({ symbol, prices: rows });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('local personal Yahoo Finance adapter', () => {
  it('normalizes adjusted history without credentials, preserves provenance and reports progress', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ symbol: 'SOXL', prices, upstreamSecret: 'DO_NOT_COPY', token: 'DO_NOT_COPY' }));
    vi.stubGlobal('fetch', fetch); const progress = vi.fn();
    const dataset = await createYahooLocalAdapter().fetch(request, signal(), progress);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/providers/yahoo/eod');
    const options = fetch.mock.calls[0][1];
    expect(JSON.parse(options.body)).toEqual({ symbol: 'SOXL', start: request.start, end: request.end });
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(options).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error' });
    expect(dataset.dates).toEqual(dates); expect(dataset.prices[0]).toEqual([100]);
    expect(dataset.manifest).toMatchObject({ synthetic: false, currency: 'USD', basis: 'adjusted_close', retention: 'operation', policy: 'yahoo-local', asOf: request.end });
    expect(dataset.manifest.source).toMatch(/unofficial public chart interface/);
    expect(dataset.manifest.acquisition).toEqual({ requestedStart: request.start, requestedEnd: request.end, assets: [{ symbol: 'SOXL', firstDate: dates[0], lastDate: dates.at(-1), observations: dates.length }] });
    expect(validateManifest(dataset.manifest).policy).toBe('yahoo-local');
    expect(JSON.stringify(dataset)).not.toContain('DO_NOT_COPY');
    expect(progress.mock.calls.map(call => call[0])).toEqual([
      { completed: 0, total: 1, status: 'loading' },
      { completed: 1, total: 1, symbol: 'SOXL', status: 'loading' },
      { completed: 1, total: 1, status: 'complete' },
    ]);
  });
  it('keeps at most two requests active and returns all selected ETF histories', async () => {
    let active = 0, maximum = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return response(prices, JSON.parse(options.body).symbol);
    }));
    const dataset = await createYahooLocalAdapter().fetch({ ...request, symbols: ['SOXL', 'SPY', 'BND'] }, signal());
    expect(maximum).toBe(2); expect(dataset.symbols).toEqual(['BND', 'SOXL', 'SPY']);
  });
  it.each([
    [404, 'local_connection_disabled', 'local_unavailable'],
    [422, 'stale_history', 'stale_history'],
    [422, 'unverified_asset_identity', 'asset_identity'],
    [401, 'provider_error', 'provider_access'],
    [403, 'provider_error', 'provider_access'],
    [404, 'provider_error', 'unavailable_symbol'],
    [429, 'provider_error', 'rate_limit'],
    [502, 'invalid_adjusted_history', 'invalid_history'],
    [502, 'invalid_upstream_data', 'invalid_history'],
    [504, 'timeout', 'timeout'],
  ])('sanitizes %s / %s errors without echoing provider details', async (status, error, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error, detail: 'SECRET=https://private.example/?token=DO_NOT_LOG' }, { status: Number(status), headers: { 'Retry-After': '75' } })));
    const failure = await createYahooLocalAdapter().fetch(request, signal()).catch(error => error);
    expect(failure).toBeInstanceOf(ProviderError); expect(failure.code).toBe(code);
    expect(failure.message).not.toMatch(/DO_NOT_LOG|private.example|SECRET/);
    if (status === 429) expect(failure.message).toContain('75 seconds');
  });
  it('aborts active requests and does not start already-cancelled work', async () => {
    const controller = new AbortController(); const activeSignals: AbortSignal[] = [];
    const fetch = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      activeSignals.push(options.signal); options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })); vi.stubGlobal('fetch', fetch);
    const check = expect(createYahooLocalAdapter().fetch({ ...request, symbols: ['SOXL', 'SPY'] }, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort(); await check;
    expect(activeSignals.every(signal => signal.aborted)).toBe(true);
    const calls = fetch.mock.calls.length;
    await expect(createYahooLocalAdapter().fetch(request, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetch).toHaveBeenCalledTimes(calls);
  });
  it('enforces the per-ETF deadline and aborts timed-out network work', async () => {
    vi.useFakeTimers(); let activeSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
      activeSignal = options.signal; options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const check = expect(createYahooLocalAdapter().fetch(request, signal())).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(20_001); await check; expect(activeSignal?.aborted).toBe(true);
  });
  it.each([
    ['wrong symbol', () => response(prices, 'SPY'), 'invalid_data'],
    ['malformed JSON', () => new Response('{broken'), 'invalid_data'],
    ['unadjusted close only', () => response(prices.map(({ date, adjClose }) => ({ date, close: adjClose }))), 'invalid_data'],
    ['intraday dates', () => response(prices.map(row => ({ ...row, date: `${row.date}T16:00:00Z` }))), 'invalid_data'],
    ['nonpositive price', () => response(prices.map((row, i) => i === 1 ? { ...row, adjClose: 0 } : row)), 'invalid_data'],
    ['incomplete last session', () => response(prices.slice(0, -1)), 'stale_history'],
    ['missing interior session', () => response(prices.filter((_, i) => i !== 100)), 'invalid_history'],
    ['duplicate session', () => response([...prices, prices[100]]), 'invalid_history'],
  ] as const)('rejects %s rather than repairing or substituting data', async (_case, makeResponse, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse()));
    await expect(createYahooLocalAdapter().fetch(request, signal())).rejects.toMatchObject({ code });
  });
  it('rejects an oversized body and invalid symbols before accepting any prices', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { headers: { 'content-length': '20000001' } })); vi.stubGlobal('fetch', fetch);
    await expect(createYahooLocalAdapter().fetch(request, signal())).rejects.toMatchObject({ code: 'too_large' });
    await expect(createYahooLocalAdapter().fetch({ ...request, symbols: ['UNSUPPORTED_TEST_TICKER'] }, signal())).rejects.toMatchObject({ code: 'invalid_symbols' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('caps rights independently of forged booleans/retention, rejects archives and redacts analytical PDF content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    const dataset = await createYahooLocalAdapter().fetch(request, signal());
    expect(dataset.manifest.rights).toMatchObject({ display: true, rawPersistence: false, derivedPersistence: false, export: false, publicDisplay: false });
    const input: ReviewSpec = { a: { id: 'a', name: 'Current', holdings: [{ symbol: 'SOXL', weight: 1 }] }, b: { id: 'b', name: 'Proposed', holdings: [{ symbol: 'SOXL', weight: 1 }] }, dataset, frequency: 'monthly', costBps: 5, initialNav: 10000, cashReturnConfirmed: false, partialCoverageConfirmed: false };
    const result = computeReview(input), { dataset: _raw, ...settingsAndInputs } = input;
    const manifest = { ...dataset.manifest, retention: 'persistable' as const, rights: { ...dataset.manifest.rights, rawPersistence: true, derivedPersistence: true, export: true, publicDisplay: true } };
    expect(manifestRightsDecision(manifest, 'display').allowed).toBe(true);
    for (const action of ['persistRaw', 'persistDerived', 'exportRaw', 'exportDerived', 'publicDisplay'] as const) expect(manifestRightsDecision(manifest, action).allowed).toBe(false);
    const record: ReviewRecord = { schemaVersion: 2, id: result.id, createdAt: new Date().toISOString(), nextReview: '2027-01-01', rationale: 'Local research test', a: input.a, b: input.b, manifest, result, settings: { frequency: input.frequency, costBps: input.costBps, initialNav: input.initialNav, cashReturnConfirmed: false, partialCoverageConfirmed: false } };
    expect(() => validateRecord(record)).toThrow(/calculation-only/);
    expect(() => parseArchive(JSON.stringify(record))).toThrow(/calculation-only/);
    expect(() => exportRecord(record)).toThrow(/calculation-only/);
    const pdf = createPdfSnapshot({ context: { ...settingsAndInputs, manifest }, result, rationale: record.rationale, nextReview: record.nextReview });
    expect(pdf.mode).toBe('decision-only'); expect(pdf).not.toHaveProperty('manifest'); expect(pdf).not.toHaveProperty('result');
    expect(JSON.stringify(pdf)).not.toContain('Yahoo'); expect(pdf.a.holdings).toEqual(input.a.holdings);
  });
});
