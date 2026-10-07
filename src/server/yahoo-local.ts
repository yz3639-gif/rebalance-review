import { assertCompleteDailySessions } from '../data/calendar';
import { ProviderError, readLimitedText, validateProviderRequest, withProviderDeadline } from '../providers/shared';
import type { WorkerEnv } from './index';

const US_EXCHANGES = new Set(['PCX', 'NMS', 'NYQ', 'NGM', 'NCM', 'BTS', 'ASE']);
const newYorkDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

function json(value: unknown, status = 200, retryAfter?: string | null): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY' });
  if (retryAfter && /^\d{1,6}$/.test(retryAfter)) headers.set('Retry-After', retryAfter);
  return new Response(JSON.stringify(value), { status, headers });
}

/** Opt-in local launcher only; an accidentally deployed flag cannot enable a public proxy. */
export function localMarketEnabled(request: Request, env: Pick<WorkerEnv, 'LOCAL_MARKET_DATA'>): boolean {
  return env.LOCAL_MARKET_DATA === 'enabled' && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(request.url).hostname);
}

export function handleLocalMarketStatus(request: Request, env: WorkerEnv): Response {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const url = new URL(request.url), origin = request.headers.get('Origin');
  if (url.search || (origin !== null && origin !== url.origin)) return json({ error: 'origin_not_allowed' }, 403);
  return json({ enabled: localMarketEnabled(request, env) });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid object');
  return value as Record<string, unknown>;
}

function adjustedHistory(value: unknown, body: { symbol: string; start: string; end: string }): { date: string; adjClose: number }[] {
  const chart = object(object(value).chart);
  if (chart.error || !Array.isArray(chart.result) || chart.result.length !== 1) throw new Error('Invalid result');
  const result = object(chart.result[0]), meta = object(result.meta);
  if (meta.symbol !== body.symbol || meta.currency !== 'USD' || meta.instrumentType !== 'ETF' || meta.exchangeTimezoneName !== 'America/New_York' || typeof meta.exchangeName !== 'string' || !US_EXCHANGES.has(meta.exchangeName)) {
    throw new ProviderError('unverified_asset_identity', 'Provider identity is not a verified US USD ETF.');
  }
  const timestamp = result.timestamp, series = object(result.indicators).adjclose;
  if (!Array.isArray(timestamp) || !timestamp.length || timestamp.length > 2000 || !Array.isArray(series) || series.length !== 1) throw new Error('Missing adjusted history');
  const adjusted = object(series[0]).adjclose;
  if (!Array.isArray(adjusted) || adjusted.length !== timestamp.length) throw new Error('Misaligned adjusted history');
  const prices: { date: string; adjClose: number }[] = [];
  timestamp.forEach((seconds, index) => {
    if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 8_640_000_000_000) throw new Error('Invalid timestamp');
    const date = newYorkDate.format(new Date(seconds * 1000));
    if (date < body.start || date > body.end) return;
    const adjClose = adjusted[index];
    if (typeof adjClose !== 'number' || !Number.isFinite(adjClose) || adjClose <= 0) throw new Error('Invalid adjusted observation');
    prices.push({ date, adjClose });
  });
  if (!prices.length) throw new Error('Empty adjusted history');
  assertCompleteDailySessions(prices.map(price => price.date), false);
  if (prices.at(-1)!.date !== body.end) throw new ProviderError('stale_history', 'History does not reach the requested final session.');
  return prices;
}

export async function handleYahooLocal(request: Request, env: WorkerEnv, upstream: typeof fetch = fetch): Promise<Response> {
  if (!localMarketEnabled(request, env)) return json({ error: 'local_connection_disabled' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const url = new URL(request.url);
  if (url.search || request.headers.get('Origin') !== url.origin) return json({ error: 'origin_not_allowed' }, 403);
  if ((request.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') return json({ error: 'json_required' }, 415);
  try {
    if (!env.API_RATE_LIMITER) return json({ error: 'connection_not_configured' }, 503);
    const rate = await env.API_RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'local-development' });
    if (!rate.success) return json({ error: 'rate_limit' }, 429, '60');
    return await withProviderDeadline(request.signal, async signal => {
      let body: { symbol: string; start: string; end: string };
      try {
        const parsed = object(JSON.parse(await readLimitedText(new Response(request.body, { headers: request.headers }), { bytes: 0 }, signal, 2048)));
        if (Object.keys(parsed).sort().join(',') !== 'end,start,symbol') throw new Error();
        body = parsed as typeof body;
        validateProviderRequest({ symbols: [body.symbol], start: body.start, end: body.end });
      } catch { return json({ error: 'invalid_request' }, 400); }
      const endpoint = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(body.symbol)}`);
      endpoint.searchParams.set('period1', String(Date.parse(`${body.start}T00:00:00Z`) / 1000));
      endpoint.searchParams.set('period2', String(Date.parse(`${body.end}T00:00:00Z`) / 1000 + 86400));
      endpoint.searchParams.set('interval', '1d');
      endpoint.searchParams.set('events', 'div,splits');
      endpoint.searchParams.set('includeAdjustedClose', 'true');
      // Workerd supports manual/follow only. Manual returns 3xx for rejection
      // below, keeping the fixed-host boundary without following redirects.
      const response = await upstream(endpoint, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'RebalanceReview/1.2 local-personal-research' }, signal, redirect: 'manual', cache: 'no-store' });
      if (!response.ok) {
        await response.body?.cancel();
        const status = [401, 403, 404, 429].includes(response.status) ? response.status : 502;
        return json({ error: status === 429 ? 'upstream_rate_limit' : 'upstream_error' }, status, response.headers.get('Retry-After'));
      }
      try {
        const data = JSON.parse(await readLimitedText(response, { bytes: 0 }, signal));
        return json({ symbol: body.symbol, prices: adjustedHistory(data, body) });
      } catch (error) {
        if (error instanceof ProviderError && ['unverified_asset_identity', 'stale_history'].includes(error.code)) return json({ error: error.code }, 422);
        return json({ error: 'invalid_upstream_data' }, 502);
      }
    });
  } catch (error) {
    const timedOut = error instanceof ProviderError && error.code === 'timeout';
    return json({ error: timedOut ? 'upstream_timeout' : 'connection_failed' }, timedOut ? 504 : 502);
  }
}
