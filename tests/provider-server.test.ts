import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { handleTiingo, type WorkerEnv } from '../src/server';
import identities from '../src/server/tiingo-identities.json';

const base = 'https://review.example';
const metadata = { ticker: 'SPY', exchangeCode: 'ARCA', startDate: '1993-01-29', endDate: '2025-01-03' };
const body = { symbol: 'SPY', start: '2025-01-02', end: '2025-01-03' };
function request(patch: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Request(`${base}/api/providers/tiingo/eod`, { method: 'POST', headers: { Origin: base, Authorization: 'Token SERVER_TEST_CREDENTIAL', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ ...body, ...patch }) });
}
function env(allowed = true): WorkerEnv {
  return { ASSETS: { fetch: vi.fn(async () => new Response('asset')) }, API_RATE_LIMITER: { limit: vi.fn(async () => ({ success: allowed })) } };
}
afterEach(() => vi.useRealTimers());
describe('fixed-origin Tiingo connection', () => {
  it('constructs one fixed upstream URL and returns only bounded adjusted observations', async () => {
    const upstream = vi.fn().mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(Response.json([{ date: '2025-01-02T00:00:00.000Z', adjClose: 100, close: 999, arbitrary: 'private' }]));
    const response = await handleTiingo(request(), env(), upstream);
    const [url, options] = upstream.mock.calls[1];
    expect(url.origin).toBe('https://api.tiingo.com'); expect(url.pathname).toBe('/tiingo/daily/SPY/prices'); expect(url.search).not.toContain('CREDENTIAL');
    expect(options.headers.Authorization).toBe('Token SERVER_TEST_CREDENTIAL'); expect(options.redirect).toBe('manual'); expect(options.cache).toBe('no-store');
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store'); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.json()).toEqual({ symbol: 'SPY', coverage: { startDate: metadata.startDate, endDate: metadata.endDate }, prices: [{ date: '2025-01-02', adjClose: 100 }] });
  });
  it.each(['NYSE','NYSE ARCA','ARCA'])('accepts documented compatible SPY exchange aliases (%s)', async exchangeCode => {
    const upstream=vi.fn().mockResolvedValueOnce(Response.json({...metadata,exchangeCode})).mockResolvedValueOnce(Response.json([{date:'2025-01-02',adjClose:100}]));
    expect((await handleTiingo(request(),env(),upstream)).status).toBe(200);
  });
  it.each(['LSE','SHE','PINK','NASDAQ','UNKNOWN'])('rejects foreign, OTC, mismatched or unresolved live SPY exchanges (%s)', async exchangeCode => {
    const upstream=vi.fn().mockResolvedValueOnce(Response.json({...metadata,exchangeCode}));
    const response=await handleTiingo(request(),env(),upstream);
    expect(response.status).toBe(422);expect(await response.json()).toEqual({error:'unverified_asset_identity'});expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('blocks actual stock, currency and ambiguous directory conflicts before sending the key upstream', async () => {
    const samples=[identities.assets.find(a=>a.assetType==='Stock'),identities.assets.find(a=>a.currency==='AUD'),identities.assets.find(a=>a.ambiguous)];
    for(const asset of samples){expect(asset).toBeDefined();const upstream=vi.fn();const response=await handleTiingo(request({symbol:asset!.symbol}),env(),upstream);expect(response.status).toBe(422);expect(upstream).not.toHaveBeenCalled();}
  });
  it.each([{ symbol: '../../other' }, { symbol: 'https://other.example/' }, { symbol: 'CASH' }, { url: 'https://other.example/' }, { start: '2000-01-01' }])('rejects invalid request without an upstream call %j', async patch => {
    const upstream = vi.fn(); const response = await handleTiingo(request(patch), env(), upstream);
    expect(response.status).toBe(400); expect(upstream).not.toHaveBeenCalled();
  });
  it('blocks cross-origin, missing authentication, and oversized request bodies', async () => {
    const upstream = vi.fn();
    expect((await handleTiingo(request({}, { Origin: 'https://evil.example' }), env(), upstream)).status).toBe(403);
    expect((await handleTiingo(request({}, { Authorization: '' }), env(), upstream)).status).toBe(401);
    expect((await handleTiingo(request({ symbol: 'x'.repeat(3000) }), env(), upstream)).status).toBe(400);
    expect((await handleTiingo(request({}, { 'Content-Type': 'application/jsonp' }), env(), upstream)).status).toBe(415);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('returns a timeout when the provider stalls midway through the response body', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('[{"date":')); }, cancel });
    const pending = handleTiingo(request(), env(), vi.fn().mockResolvedValue(new Response(stream)));
    await vi.advanceTimersByTimeAsync(20_001);
    const response = await pending;
    expect(response.status).toBe(504); expect(await response.json()).toEqual({ error: 'upstream_timeout' });
    expect(cancel).toHaveBeenCalled();
  });
  it('enforces the configured rate limit before upstream calls', async () => {
    const upstream = vi.fn(); const response = await handleTiingo(request(), env(false), upstream);
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('60'); expect(upstream).not.toHaveBeenCalled();
  });
  it('forwards a numeric retry interval while suppressing provider body details', async () => {
    const upstream = vi.fn().mockResolvedValue(new Response('SERVER_TEST_CREDENTIAL', { status: 429, headers: { 'Retry-After': '120' } }));
    const response = await handleTiingo(request(), env(), upstream);
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('120'); expect(await response.text()).not.toContain('CREDENTIAL');
  });
  it.each(['<html>error</html>', '[{"date":"2025-01-02","close":100}]', '[{"date":"2025-01-02","adjClose":-100}]'])('rejects malformed upstream data', async data => {
    const upstream = vi.fn().mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(new Response(data));
    expect((await handleTiingo(request(), env(), upstream)).status).toBe(502);
  });
  it.each([
    { ...metadata, ticker: 'OTHER' }, { ...metadata, startDate: null },
    { ...metadata, endDate: null }, { ...metadata, startDate: '2026-01-01' },
  ])('does not confuse a reserved or mismatched ticker with available history', async coverage => {
    const upstream = vi.fn().mockResolvedValueOnce(Response.json(coverage));
    const response = await handleTiingo(request(), env(), upstream);
    expect(response.status).toBe(502); expect(upstream).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ error: 'invalid_coverage_metadata' });
  });
  it('handles redirects/network failures without leaking provider error text', async () => {
    const upstream = vi.fn().mockRejectedValue(new Error('SERVER_TEST_CREDENTIAL api.tiingo.com secret details'));
    const response = await handleTiingo(request(), env(), upstream);
    expect(response.status).toBe(502); expect(await response.text()).toBe('{"error":"connection_failed"}');
  });
  it.each(['metadata', 'prices'])('does not follow an upstream %s redirect or forward the key to another endpoint', async phase => {
    const upstream = vi.fn();
    if (phase === 'prices') upstream.mockResolvedValueOnce(Response.json(metadata));
    upstream.mockResolvedValueOnce(new Response('private provider body', { status: 302, headers: { Location: 'https://other.example/collect' } }));
    const response = await handleTiingo(request(), env(), upstream);
    expect(response.status).toBe(502); expect(upstream).toHaveBeenCalledTimes(phase === 'prices' ? 2 : 1);
    for (const [url, options] of upstream.mock.calls) { expect(url.origin).toBe('https://api.tiingo.com'); expect(options.redirect).toBe('manual'); }
    expect(await response.text()).not.toContain('private');
  });
  it('serves no general-purpose proxy and preserves static assets', async () => {
    const e = env();
    expect((await worker.fetch(new Request(`${base}/api/proxy?url=https://other.example`), e)).status).toBe(404);
    expect(await (await worker.fetch(new Request(`${base}/`), e)).text()).toBe('asset');
  });
  it('scopes PDF WASM, embedded data and child-Worker permissions to the hashed PDF Worker response', async () => {
    const staticPolicy = "default-src 'self'; script-src 'self'; connect-src 'self' https:; worker-src 'self' blob:; object-src 'none'";
    const e = env(); e.ASSETS.fetch = vi.fn(async () => new Response('worker bytes', { headers: { 'Content-Security-Policy': staticPolicy, 'Content-Type': 'text/javascript' } }));
    const pdf = await worker.fetch(new Request(`${base}/assets/pdf.worker-aB_12-z.js`), e);
    const policy = pdf.headers.get('Content-Security-Policy')!;
    const directives = Object.fromEntries(policy.split(';').map(part => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
    expect(directives['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(directives['connect-src']).toEqual(["'self'", 'blob:', 'data:']);
    expect(directives['worker-src']).toEqual(["'self'", 'blob:']);
    expect(policy).not.toContain(','); expect(await pdf.text()).toBe('worker bytes');
    for (const path of ['/', '/assets/index-aB_12-z.js', '/assets/review.worker-aB_12-z.js', '/assets/pdf.worker-aB_12-z.js.map']) {
      const other = await worker.fetch(new Request(`${base}${path}`), e);
      expect(other.headers.get('Content-Security-Policy')).toBe(staticPolicy);
    }
  });
});
