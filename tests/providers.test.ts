import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTiingoAdapter } from '../src/providers/tiingo';
import { createCustomRestAdapter, exportCustomConfig, type CustomRestConfig } from '../src/providers/custom';
import { expectedUsEquitySessions } from '../src/data/calendar';
import { PROVIDER_MAX_BYTES, ProviderError, providerErrorMessage, validateProviderRequest, withProviderDeadline } from '../src/providers/shared';

const dates = expectedUsEquitySessions('2024-01-02', '2025-03-01').slice(0, 253);
const request = { symbols: ['SPY'], start: dates[0], end: dates.at(-1)! };
const prices = dates.map((date, i) => ({ date, adjClose: 100 + i / 10 }));
const coverage = { startDate: dates[0], endDate: dates.at(-1)! };
const signal = () => new AbortController().signal;
/** Valid JSON delivered in real byte chunks, with no declared Content-Length. */
function chunkedJson(value: unknown, paddingBytes: number): Response {
  const body = new TextEncoder().encode(JSON.stringify(value));
  let remaining = paddingBytes, bodySent = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (remaining > 0) {
        const size = Math.min(1_000_000, remaining); remaining -= size;
        controller.enqueue(new Uint8Array(size).fill(32));
      } else if (!bodySent) { bodySent = true; controller.enqueue(body); }
      else controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
}
function custom(): CustomRestConfig {
  return { endpoint: 'https://market.example/history', source: 'User-authorized custom test source', format: 'json', csvShape: 'long', requestMode: 'per-symbol', arrayPath: 'data.prices', fields: { date: 'date', symbol: '', value: 'adjClose' }, params: { symbol: 'symbol', start: 'start', end: 'end' }, auth: { kind: 'none', value: '', queryName: 'apikey' }, basis: 'adjusted_close', usdAndBasisConfirmed: true, permissions: { rawPersistence: false, derivedPersistence: false, export: false } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('credential-isolated market adapters', () => {
  it('normalizes Tiingo history and carries restrictive operation-only rights', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ symbol: 'SPY', coverage, prices })); vi.stubGlobal('fetch', fetch);
    const dataset = await createTiingoAdapter({ token: 'FAKE_SECRET_FOR_TEST_ONLY' }).fetch(request, signal());
    expect(fetch.mock.calls[0][0]).toBe('/api/providers/tiingo/eod');
    const options = fetch.mock.calls[0][1];
    expect(options.headers.Authorization).toBe('Token FAKE_SECRET_FOR_TEST_ONLY');
    expect(options.body).not.toContain('FAKE_SECRET'); expect(options.cache).toBe('no-store'); expect(options.credentials).toBe('omit');
    expect(dataset.dates).toEqual(dates); expect(dataset.manifest.retention).toBe('operation');
    expect(dataset.manifest.rights).toMatchObject({ rawPersistence: false, derivedPersistence: false, export: false, publicDisplay: false });
    expect(JSON.stringify(dataset)).not.toContain('FAKE_SECRET');
  });
  it.each([401, 403, 404, 422, 429, 502])('replaces upstream %s details with actionable safe messages', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('SECRET_URL=https://private.example/?token=DO_NOT_LOG', { status })));
    const error = await createTiingoAdapter({ token: 'DO_NOT_LOG' }).fetch(request, signal()).catch(e => e);
    expect(error).toBeInstanceOf(ProviderError); expect(error.message).not.toContain('DO_NOT_LOG'); expect(error.message).not.toContain('private.example');
    if (status === 403) expect(error.code).toBe('entitlement');
    if (status === 422) expect(error.code).toBe('asset_identity');
  });
  it('caps both adapters at two concurrent requests', async () => {
    let active = 0, max = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      active++; max = Math.max(max, active); await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return Response.json({ symbol: JSON.parse(options.body).symbol, coverage, prices });
    }));
    const result = await createTiingoAdapter({ token: 'TEST' }).fetch({ ...request, symbols: ['SPY', 'BND', 'GLD'] }, signal());
    expect(result.symbols).toHaveLength(3); expect(max).toBe(2);
  });
  it('cancels the outstanding fetches and reports a timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); })));
    const pending = createTiingoAdapter({ token: 'TEST' }).fetch(request, signal());
    const check = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(20_001); await check;
  });
  it('does not start cancelled work or accept a callback that swallows cancellation', async () => {
    const controller = new AbortController(), callback = vi.fn(async () => 'not called');
    controller.abort();
    await expect(withProviderDeadline(controller.signal, callback)).rejects.toMatchObject({ code: 'cancelled' });
    expect(callback).not.toHaveBeenCalled();
    const active = new AbortController();
    await expect(withProviderDeadline(active.signal, async () => { active.abort(); return 'must not escape'; })).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('rejects declared oversized responses before parsing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { headers: { 'content-length': '20000001' } })));
    await expect(createTiingoAdapter({ token: 'TEST' }).fetch(request, signal())).rejects.toMatchObject({ code: 'too_large' });
  });
  it('rejects actual streamed bytes beyond 20 MB without Content-Length', async () => {
    const response = chunkedJson({ symbol: 'SPY', coverage, prices }, PROVIDER_MAX_BYTES + 1);
    expect(response.headers.has('Content-Length')).toBe(false);
    let activeSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => { activeSignal = options.signal; return response; }));
    await expect(createTiingoAdapter({ token: 'TEST' }).fetch(request, signal())).rejects.toMatchObject({ code: 'too_large' });
    expect(activeSignal?.aborted).toBe(true);
    expect(response.body?.locked).toBe(false);
  });
  it('shares the 20 MB streamed-byte budget across concurrent ETF responses', async () => {
    const padding = 10_100_000, activeSignals: AbortSignal[] = [], responses: Response[] = [];
    for (const symbol of ['SPY', 'BND']) {
      const size = padding + new TextEncoder().encode(JSON.stringify({ symbol, coverage, prices })).byteLength;
      expect(size).toBeLessThan(PROVIDER_MAX_BYTES);
      expect(size * 2).toBeGreaterThan(PROVIDER_MAX_BYTES);
    }
    const fetch = vi.fn(async (_url, options) => {
      activeSignals.push(options.signal);
      const response = chunkedJson({ symbol: JSON.parse(options.body).symbol, coverage, prices }, padding);
      expect(response.headers.has('Content-Length')).toBe(false);
      responses.push(response); return response;
    });
    vi.stubGlobal('fetch', fetch);
    await expect(createTiingoAdapter({ token: 'TEST' }).fetch({ ...request, symbols: ['SPY', 'BND'] }, signal())).rejects.toMatchObject({ code: 'too_large' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(activeSignals.every(s => s.aborted)).toBe(true);
    await vi.waitFor(() => expect(responses.every(response => !response.body?.locked)).toBe(true));
  });
  it('rejects wrong Tiingo symbols and internal session gaps', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ symbol: 'BND', coverage, prices })).mockResolvedValueOnce(Response.json({ symbol: 'SPY', coverage, prices: prices.filter((_, i) => i !== 100) })); vi.stubGlobal('fetch', fetch);
    await expect(createTiingoAdapter({ token: 'TEST' }).fetch(request, signal())).rejects.toMatchObject({ code: 'invalid_data' });
    await expect(createTiingoAdapter({ token: 'TEST' }).fetch(request, signal())).rejects.toMatchObject({ code: 'invalid_history' });
  });
  it('custom HTTPS JSON mapping stays browser-direct with isolated header authentication', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: { prices } })); vi.stubGlobal('fetch', fetch);
    const config = custom(); config.auth = { kind: 'bearer', value: 'UNSAVED_CUSTOM_SECRET', queryName: 'apikey' };
    const dataset = await createCustomRestAdapter(config).fetch(request, signal());
    expect(fetch.mock.calls[0][0].origin).toBe('https://market.example');
    expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer UNSAVED_CUSTOM_SECRET');
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
    expect(JSON.stringify(dataset)).not.toContain('UNSAVED_CUSTOM_SECRET'); expect(dataset.manifest.source).toBe('User-authorized custom test source · https://market.example');
    expect(dataset.manifest.retention).toBe('operation');
  });
  it('query authentication is added only to the outbound URL, never to metadata', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: { prices } })); vi.stubGlobal('fetch', fetch);
    const config = custom(); config.auth = { kind: 'query', value: 'QUERY_CREDENTIAL', queryName: 'apikey' };
    const dataset = await createCustomRestAdapter(config).fetch(request, signal());
    expect(fetch.mock.calls[0][0].searchParams.get('apikey')).toBe('QUERY_CREDENTIAL'); expect(JSON.stringify(dataset)).not.toContain('QUERY_CREDENTIAL'); expect(dataset.manifest.source).not.toContain('?');
  });
  it('maps batch CSV and honors source-specific declared permissions', async () => {
    const config = custom(); config.format = 'csv'; config.requestMode = 'batch'; config.fields.symbol = 'ticker'; config.fields.value = 'adjusted'; config.permissions = { rawPersistence: true, derivedPersistence: true, export: true };
    const csv = ['date,ticker,adjusted', ...dates.flatMap((date, i) => [`${date},SPY,${100 + i}`, `${date},BND,${200 + i}`])].join('\n');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(csv, { headers: { 'content-type': 'text/csv' } })));
    const dataset = await createCustomRestAdapter(config).fetch({ ...request, symbols: ['SPY', 'BND'] }, signal());
    expect(dataset.symbols).toEqual(['BND', 'SPY']); expect(dataset.manifest.retention).toBe('persistable'); expect(dataset.manifest.rights.export).toBe(true); expect(dataset.manifest.rights.publicDisplay).toBe(false);
  });
  it('maps wide CSV without a fake symbol field and permits declared derived export without raw retention', async () => {
    const config = custom(); config.format = 'csv'; config.csvShape = 'wide'; config.requestMode = 'batch'; config.permissions = { rawPersistence: false, derivedPersistence: true, export: true };
    const csv = ['date,SPY,BND', ...dates.map((date, i) => `${date},${100 + i},${200 + i}`)].join('\n');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(csv)));
    const dataset = await createCustomRestAdapter(config).fetch({ ...request, symbols: ['SPY', 'BND'] }, signal());
    expect(dataset.symbols).toEqual(['BND', 'SPY']); expect(dataset.manifest.retention).toBe('operation'); expect(dataset.manifest.policy).toBe('user-declared'); expect(dataset.manifest.rights.export).toBe(true);
  });
  it('exports a reusable API template without the credential or automatically inherited permissions', () => {
    const config = custom(); config.auth = { kind: 'query', value: 'MUST_NEVER_EXPORT', queryName: 'apikey' }; config.permissions = { rawPersistence: true, derivedPersistence: true, export: true };
    const text = exportCustomConfig(config), template = JSON.parse(text);
    expect(text).not.toContain('MUST_NEVER_EXPORT'); expect(template.configuration.auth.value).toBeUndefined();
    expect(template.configuration.permissions).toEqual({ rawPersistence: false, derivedPersistence: false, export: false }); expect(template.configuration.usdAndBasisConfirmed).toBe(false);
    config.fields.value = config.auth.value;
    expect(() => exportCustomConfig(config)).toThrow(/nonsecret mapping fields/);
  });
  it.each(['http://market.example/history', 'https://user:secret@market.example/history', 'https://market.example/history?apikey=hidden'])('blocks unsafe endpoint %s', endpoint => {
    expect(() => createCustomRestAdapter({ ...custom(), endpoint })).toThrow(ProviderError);
  });
  it.each(['api_token','access_key','auth','subscription-key','X-Amz-Signature','credential'])('rejects embedded %s query credentials before template export', name => {
    const config={...custom(),endpoint:`https://market.example/history?${name}=ENDPOINT_SECRET`};
    expect(()=>createCustomRestAdapter(config)).toThrow(/Remove credentials/);
    expect(()=>exportCustomConfig(config)).toThrow(/Remove credentials/);
    try{exportCustomConfig(config);}catch(error){expect(providerErrorMessage(error)).not.toContain('ENDPOINT_SECRET');}
  });
  it.each(['ABC%2B123%2F456','ABC%252B123%252F456','%41%42%43%2b%31%32%33%2f%34%35%36'])('rejects a known secret hidden by URL encoding (%s)', encoded => {
    const config=custom();config.auth={kind:'bearer',value:'ABC+123/456',queryName:'apikey'};
    config.endpoint=`https://market.example/history/${encoded}`;
    expect(()=>createCustomRestAdapter(config)).toThrow(/Remove credentials/);
    expect(()=>exportCustomConfig(config)).toThrow(/Remove credentials/);
    config.endpoint='https://market.example/history';config.source=`Provider account ${encoded}`;
    expect(()=>exportCustomConfig(config)).toThrow(/without credentials/);
  });
  it('fails closed on excessive nested URL encoding instead of letting a credential escape its decoding bound',()=>{
    let encoded=encodeURIComponent('ABC+123/456');for(let i=0;i<12;i++)encoded=encodeURIComponent(encoded);
    const config=custom();config.endpoint=`https://market.example/history/${encoded}`;config.auth={kind:'bearer',value:'ABC+123/456',queryName:'apikey'};
    expect(()=>exportCustomConfig(config)).toThrow(/Remove credentials/);
    config.auth={kind:'none',value:'',queryName:'apikey'};expect(()=>exportCustomConfig(config)).toThrow(/Remove credentials/);
  });
  it('rejects encoded credentials beside malformed UTF-8 without allowing an undecodable run to hide them',()=>{
    const config=custom();config.auth={kind:'bearer',value:'AUDIT+ONLY/123',queryName:'apikey'};
    config.endpoint='https://market.example/history/%41%55%44%49%54%2b%4f%4e%4c%59%2f%31%32%33%ff';
    expect(()=>exportCustomConfig(config)).toThrow(/Remove credentials/);
    config.auth={kind:'none',value:'',queryName:'apikey'};expect(()=>exportCustomConfig(config)).toThrow(/Remove credentials/);
  });
  it('does not accept arbitrary data expressions or missing access-basis confirmation', () => {
    expect(() => createCustomRestAdapter({ ...custom(), arrayPath: '__proto__.prices' })).toThrow(ProviderError);
    expect(() => createCustomRestAdapter({ ...custom(), usdAndBasisConfirmed: false })).toThrow(ProviderError);
  });
  it('network/CORS failures never reflect a URL or credential in errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('https://api.example/?apikey=EXPOSED')));
    const error = await createCustomRestAdapter(custom()).fetch(request, signal()).catch(e => e);
    expect(providerErrorMessage(error)).toContain('CORS'); expect(providerErrorMessage(error)).not.toContain('EXPOSED');
  });
  it('limits request symbols and dates before any network call', () => {
    expect(() => validateProviderRequest({ ...request, symbols: ['SPY/../../anything'] })).toThrow(ProviderError);
    expect(() => validateProviderRequest({ ...request, symbols: ['CASH'] })).toThrow(ProviderError);
    expect(() => validateProviderRequest({ ...request, start: '2010-01-01' })).toThrow(ProviderError);
  });
});
