import { ProviderError, providerDate, readLimitedText, validateProviderRequest, withProviderDeadline } from '../providers/shared';
import { verifiedTiingoIdentity } from './tiingo-identity';
import { handleLocalMarketStatus, handleYahooLocal } from './yahoo-local';

export interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  API_RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  LOCAL_MARKET_DATA?: string;
}
function json(value: unknown, status = 200, retryAfter?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY' });
  if (retryAfter && /^\d{1,6}$/.test(retryAfter)) headers.set('Retry-After', retryAfter);
  return new Response(JSON.stringify(value), { status, headers });
}
export async function handleTiingo(request: Request, env: WorkerEnv, upstream: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const url = new URL(request.url);
  if (url.search || request.headers.get('Origin') !== url.origin) return json({ error: 'origin_not_allowed' }, 403);
  if ((request.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') return json({ error: 'json_required' }, 415);
  const auth = request.headers.get('Authorization') || '';
  if (!/^Token [^\s\x00-\x1f\x7f]{1,500}$/.test(auth)) return json({ error: 'invalid_key' }, 401);
  try {
    if (!env.API_RATE_LIMITER) return json({ error: 'connection_not_configured' }, 503);
    const rate = await env.API_RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'local-development' });
    if (!rate.success) return json({ error: 'rate_limit' }, 429, '60');
    return await withProviderDeadline(request.signal, async signal => {
      let parsed: unknown;
      try { parsed = JSON.parse(await readLimitedText(new Response(request.body, { headers: request.headers }), { bytes: 0 }, signal, 2048)); }
      catch { return json({ error: 'invalid_request' }, 400); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).sort().join(',') !== 'end,start,symbol') return json({ error: 'invalid_request' }, 400);
      const body = parsed as { symbol: string; start: string; end: string };
      try { validateProviderRequest({ symbols: [body.symbol], start: body.start, end: body.end }); }
      catch { return json({ error: 'invalid_request' }, 400); }
      if (!verifiedTiingoIdentity(body.symbol)) return json({ error: 'unverified_asset_identity' }, 422);
      const budget = { bytes: 0 };
      // Workerd requires manual redirect handling; every 3xx is rejected below.
      const metadataResponse = await upstream(new URL(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(body.symbol)}`), { method: 'GET', headers: { Accept: 'application/json', Authorization: auth }, signal, redirect: 'manual', cache: 'no-store' });
      if (!metadataResponse.ok) {
        await metadataResponse.body?.cancel();
        const status = [401, 403, 404, 429].includes(metadataResponse.status) ? metadataResponse.status : 502;
        return json({ error: 'metadata_unavailable' }, status, metadataResponse.headers.get('Retry-After') || undefined);
      }
      let coverage: { startDate: string; endDate: string };
      try {
        const metadata = JSON.parse(await readLimitedText(metadataResponse, budget, signal));
        if (!metadata || typeof metadata !== 'object' || typeof metadata.ticker !== 'string' || metadata.ticker.toUpperCase() !== body.symbol || typeof metadata.exchangeCode !== 'string' || !metadata.exchangeCode.trim()) throw new Error();
        if (!verifiedTiingoIdentity(body.symbol, metadata.exchangeCode)) return json({ error: 'unverified_asset_identity' }, 422);
        coverage = { startDate: providerDate(metadata.startDate), endDate: providerDate(metadata.endDate) };
        if (coverage.startDate > coverage.endDate) throw new Error();
      } catch { return json({ error: 'invalid_coverage_metadata' }, 502); }
      const endpoint = new URL(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(body.symbol)}/prices`);
      endpoint.searchParams.set('startDate', body.start); endpoint.searchParams.set('endDate', body.end);
      endpoint.searchParams.set('format', 'json'); endpoint.searchParams.set('resampleFreq', 'daily');
      const response = await upstream(endpoint, { method: 'GET', headers: { Accept: 'application/json', Authorization: auth }, signal, redirect: 'manual', cache: 'no-store' });
      if (!response.ok) {
        await response.body?.cancel();
        const status = [401, 403, 404, 429].includes(response.status) ? response.status : 502;
        return json({ error: status === 429 ? 'upstream_rate_limit' : 'upstream_error' }, status, response.headers.get('Retry-After') || undefined);
      }
      let data: unknown;
      try { data = JSON.parse(await readLimitedText(response, budget, signal)); }
      catch { return json({ error: 'invalid_upstream_data' }, 502); }
      if (!Array.isArray(data) || !data.length || data.length > 2000) return json({ error: 'invalid_upstream_data' }, 502);
      try {
        const prices = data.map(row => {
          if (!row || typeof row !== 'object' || typeof row.adjClose !== 'number' || !Number.isFinite(row.adjClose) || row.adjClose <= 0) throw new Error();
          const date = providerDate(row.date);
          if (date < body.start || date > body.end) throw new Error();
          return { date, adjClose: row.adjClose };
        });
        return json({ symbol: body.symbol, coverage, prices });
      } catch { return json({ error: 'invalid_upstream_data' }, 502); }
    });
  } catch (error) {
    return json({ error: error instanceof ProviderError && error.code === 'timeout' ? 'upstream_timeout' : 'connection_failed' }, error instanceof ProviderError && error.code === 'timeout' ? 504 : 502);
  }
}
export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/providers/local/status') return handleLocalMarketStatus(request, env);
    if (url.pathname === '/api/providers/yahoo/eod') return handleYahooLocal(request, env);
    if (url.pathname === '/api/providers/tiingo/eod') return handleTiingo(request, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    if (/^\/assets\/pdf\.worker-[A-Za-z0-9_-]+\.js$/.test(url.pathname)) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' blob: data:; worker-src 'self' blob:; font-src 'self' blob:; img-src 'self' data: blob:; object-src 'none'");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return env.ASSETS.fetch(request);
  },
};
