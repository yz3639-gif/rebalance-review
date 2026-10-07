import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type WorkerEnv } from '../src/server';
import { handleLocalMarketStatus, handleYahooLocal } from '../src/server/yahoo-local';

const base = 'http://127.0.0.1:8787';
const body = { symbol: 'SOXL', start: '2025-01-02', end: '2025-01-03' };
const timestamp = (date: string) => Date.parse(`${date}T14:30:00Z`) / 1000;
function chart() {
  return { chart: { error: null, result: [{
    meta: { symbol: 'SOXL', currency: 'USD', instrumentType: 'ETF', exchangeTimezoneName: 'America/New_York', exchangeName: 'PCX', privateField: 'MUST_NOT_FORWARD' },
    timestamp: [timestamp('2025-01-02'), timestamp('2025-01-03')],
    indicators: { adjclose: [{ adjclose: [20, 21] }], quote: [{ close: [999, 999] }] },
  }] } };
}
function env(enabled: string | undefined = 'enabled', allowed = true): WorkerEnv {
  return { LOCAL_MARKET_DATA: enabled, ASSETS: { fetch: vi.fn(async () => new Response('asset')) }, API_RATE_LIMITER: { limit: vi.fn(async () => ({ success: allowed })) } };
}
function request(patch: Record<string, unknown> = {}, origin = base, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request(`${origin}/api/providers/yahoo/eod`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ ...body, ...patch }), signal });
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('local-only observed market history', () => {
  it.each([undefined, '', 'true', 'disabled'])('is unavailable without the exact local flag (%s)', async flag => {
    const e = env(); e.LOCAL_MARKET_DATA = flag;
    const upstream = vi.fn();
    expect(await handleLocalMarketStatus(new Request(`${base}/api/providers/local/status`), e).json()).toEqual({ enabled: false });
    expect((await handleYahooLocal(request(), e, upstream)).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled(); expect(e.API_RATE_LIMITER.limit).not.toHaveBeenCalled();
  });
  it.each(['https://review.example', 'http://192.168.1.2:8787', 'http://localhost.evil.example', 'http://127.0.0.1.evil.example'])('cannot be enabled for a non-loopback URL (%s)', async origin => {
    const upstream = vi.fn();
    const req = request({}, origin, { Host: 'localhost', 'X-Forwarded-Host': 'localhost' });
    expect((await handleYahooLocal(req, env(), upstream)).status).toBe(404);
    expect(await handleLocalMarketStatus(new Request(`${origin}/api/providers/local/status`), env()).json()).toEqual({ enabled: false });
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([base, 'http://localhost:8787', 'http://[::1]:8787'])('reports availability on explicitly enabled loopback (%s)', async origin => {
    const response = await worker.fetch(new Request(`${origin}/api/providers/local/status`), env());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ enabled: true });
    expect(response.headers.get('cache-control')).toBe('no-store, private');
  });
  it('uses a fixed HTTPS domain and only returns validated adjusted observations', async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json(chart()));
    const response = await handleYahooLocal(request({}, base, { Authorization: 'SECRET_NOT_FOR_YAHOO', Cookie: 'private=NO_FORWARD' }), env(), upstream);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ symbol: 'SOXL', prices: [{ date: '2025-01-02', adjClose: 20 }, { date: '2025-01-03', adjClose: 21 }] });
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, options] = upstream.mock.calls[0];
    expect(url.origin).toBe('https://query1.finance.yahoo.com'); expect(url.pathname).toBe('/v8/finance/chart/SOXL');
    expect(url.searchParams.get('period1')).toBe(String(Date.parse('2025-01-02T00:00:00Z') / 1000));
    expect(url.searchParams.get('period2')).toBe(String(Date.parse('2025-01-04T00:00:00Z') / 1000));
    expect(url.searchParams.get('includeAdjustedClose')).toBe('true'); expect(url.searchParams.get('interval')).toBe('1d');
    expect(options.redirect).toBe('manual'); expect(options.cache).toBe('no-store'); expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.headers).not.toHaveProperty('Authorization'); expect(options.headers).not.toHaveProperty('Cookie');
    expect(response.headers.get('cache-control')).toContain('no-store'); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('rejects foreign origins, missing Origin, wrong methods and non-JSON requests', async () => {
    const upstream = vi.fn();
    for (const origin of ['', 'http://evil.example', 'http://localhost:8787']) expect((await handleYahooLocal(request({}, base, { Origin: origin }), env(), upstream)).status).toBe(403);
    expect((await handleYahooLocal(new Request(`${base}/api/providers/yahoo/eod`), env(), upstream)).status).toBe(405);
    expect((await handleYahooLocal(request({}, base, { 'Content-Type': 'text/plain' }), env(), upstream)).status).toBe(415);
    expect(handleLocalMarketStatus(new Request(`${base}/api/providers/local/status`, { headers: { Origin: 'https://foreign.example' } }), env()).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([{ symbol: '../../private' }, { symbol: 'https://evil.example' }, { symbol: 'CASH' }, { symbol: 'UNKNOWN_INVALID_ETF' }, { symbols: ['SOXL', 'SPY'] }, { url: 'https://evil.example' }, { start: '2000-01-01' }, { end: '2099-01-01' }, { symbol: 'x'.repeat(3000) }])('rejects invalid bounded catalog requests before fetching %j', async patch => {
    const upstream = vi.fn(); expect((await handleYahooLocal(request(patch), env(), upstream)).status).toBe(400); expect(upstream).not.toHaveBeenCalled();
  });
  it('requires a configured rate limiter and obeys its result', async () => {
    const upstream = vi.fn(); const missing = env(); delete (missing as Partial<WorkerEnv>).API_RATE_LIMITER;
    expect((await handleYahooLocal(request(), missing, upstream)).status).toBe(503);
    const limited = await handleYahooLocal(request(), env('enabled', false), upstream);
    expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBe('60'); expect(upstream).not.toHaveBeenCalled();
  });
  it.each([{ symbol: 'SPY' }, { currency: 'CAD' }, { instrumentType: 'EQUITY' }, { exchangeTimezoneName: 'Europe/London' }, { exchangeName: 'LSE' }])('refuses mismatched asset identity %j', async patch => {
    const data = chart(); Object.assign(data.chart.result[0].meta, patch);
    const response = await handleYahooLocal(request(), env(), vi.fn().mockResolvedValue(Response.json(data)));
    expect(response.status).toBe(422); expect(await response.json()).toEqual({ error: 'unverified_asset_identity' });
  });
  it.each([
    { adjclose: [] },
    { adjclose: [{ adjclose: [20] }] },
    { adjclose: [{ adjclose: [20, null] }] },
    { adjclose: [{ adjclose: [20, 0] }] },
    { adjclose: [{ adjclose: [20, -1] }] },
    { adjclose: [{ adjclose: [20, '21'] }] },
    { quote: [{ close: [20, 21] }] },
  ])('rejects missing or invalid adjusted history without a close fallback %j', async indicators => {
    const data = chart(); Object.assign(data.chart.result[0], { indicators });
    const response = await handleYahooLocal(request(), env(), vi.fn().mockResolvedValue(Response.json(data)));
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: 'invalid_upstream_data' });
  });
  it('rejects duplicate observations, internal session gaps, and stale final history', async () => {
    for (const times of [[timestamp('2025-01-02'), timestamp('2025-01-02')], [timestamp('2024-12-31'), timestamp('2025-01-03')]]) {
      const data = chart(); data.chart.result[0].timestamp = times;
      expect((await handleYahooLocal(request({ start: '2024-12-31' }), env(), vi.fn().mockResolvedValue(Response.json(data)))).status).toBe(502);
    }
    const data = chart(); data.chart.result[0].timestamp.pop(); data.chart.result[0].indicators.adjclose[0].adjclose.pop();
    const stale = await handleYahooLocal(request(), env(), vi.fn().mockResolvedValue(Response.json(data)));
    expect(stale.status).toBe(422); expect(await stale.json()).toEqual({ error: 'stale_history' });
  });
  it('maps exchange-local dates and filters out observations outside the request', async () => {
    const data = chart(); data.chart.result[0].timestamp = [Date.parse('2025-01-03T00:30:00Z') / 1000, timestamp('2025-01-03'), timestamp('2025-01-06')];
    data.chart.result[0].indicators.adjclose[0].adjclose = [20, 21, 22];
    const response = await handleYahooLocal(request(), env(), vi.fn().mockResolvedValue(Response.json(data)));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ symbol: 'SOXL', prices: [{ date: '2025-01-02', adjClose: 20 }, { date: '2025-01-03', adjClose: 21 }] });
  });
  it.each([301, 302, 307, 308, 401, 403, 404, 429, 500])('does not follow redirects, retry upstream denials/errors or leak their body (%s)', async status => {
    const upstream = vi.fn().mockResolvedValue(new Response('SECRET_PROVIDER_BODY', { status, headers: { 'Retry-After': '60' } }));
    const response = await handleYahooLocal(request(), env(), upstream);
    expect(response.status).toBe([401, 403, 404, 429].includes(status) ? status : 502); expect(await response.text()).not.toContain('SECRET'); expect(upstream).toHaveBeenCalledTimes(1);
    expect(response.headers.get('retry-after')).toBe('60');
  });
  it('bounds the response size and suppresses malformed provider data', async () => {
    for (const response of [new Response('{}', { headers: { 'Content-Length': '20000001' } }), new Response('<html>denied</html>'), Response.json({ chart: { error: { description: 'SECRET' }, result: null } })]) {
      const output = await handleYahooLocal(request(), env(), vi.fn().mockResolvedValue(response)); expect(output.status).toBe(502); expect(await output.text()).not.toContain('SECRET');
    }
  });
  it('times out a stalled response stream after 20 seconds', async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"chart":')); }, cancel });
    const pending = handleYahooLocal(request(), env(), vi.fn().mockResolvedValue(new Response(stream)));
    await vi.advanceTimersByTimeAsync(20_001);
    const response = await pending; expect(response.status).toBe(504); expect(await response.json()).toEqual({ error: 'upstream_timeout' }); expect(cancel).toHaveBeenCalled();
  });
  it('cancels an in-flight body read and hides network/redirect error details', async () => {
    const controller = new AbortController(), cancel = vi.fn();
    const stream = new ReadableStream({ cancel });
    const pending = handleYahooLocal(request({}, base, {}, controller.signal), env(), vi.fn().mockResolvedValue(new Response(stream)));
    await vi.waitFor(() => expect(stream.locked).toBe(true)); controller.abort();
    expect((await pending).status).toBe(502); expect(cancel).toHaveBeenCalled();
    const failed = await handleYahooLocal(request(), env(), vi.fn().mockRejectedValue(new Error('SECRET_COOKIE_OR_REDIRECT')));
    expect(await failed.json()).toEqual({ error: 'connection_failed' });
  });
});
