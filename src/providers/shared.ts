import type { MarketDataset, DatasetManifest, ProviderRequest } from '../types';
import { currentUsDate, isIsoDate, parseMarketCsv, SUPPORTED_SYMBOLS, MAX_REVIEW_ASSETS } from '../data';

export const PROVIDER_TIMEOUT_MS = 20_000;
export const PROVIDER_BATCH_TIMEOUT_MS = 180_000;
export const PROVIDER_MAX_BYTES = 20_000_000;
export class ProviderError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ProviderError'; }
}
export function providerErrorMessage(error: unknown): string {
  return error instanceof ProviderError ? error.message : 'The data connection failed. Check the provider settings or import a permitted CSV instead.';
}
export function validateProviderRequest(request: ProviderRequest): ProviderRequest {
  if (!request || !Array.isArray(request.symbols) || request.symbols.length < 1 || request.symbols.length > MAX_REVIEW_ASSETS ||
      request.symbols.some(s => typeof s !== 'string' || !SUPPORTED_SYMBOLS.includes(s)) || new Set(request.symbols).size !== request.symbols.length) {
    throw new ProviderError('invalid_symbols', `Choose 1–${MAX_REVIEW_ASSETS} listed noncash ETF symbols.`);
  }
  if (!isIsoDate(request.start) || !isIsoDate(request.end) || request.start > request.end || request.end > currentUsDate()) {
    throw new ProviderError('invalid_dates', 'Choose valid ordered dates ending no later than today.');
  }
  const earliest = new Date(`${request.end}T00:00:00Z`);
  const month = earliest.getUTCMonth(); earliest.setUTCFullYear(earliest.getUTCFullYear() - 5);
  if (earliest.getUTCMonth() !== month) earliest.setUTCDate(0);
  if (request.start < earliest.toISOString().slice(0, 10)) throw new ProviderError('invalid_dates', 'API requests are limited to five calendar years.');
  return { symbols: [...request.symbols], start: request.start, end: request.end };
}
export async function withProviderDeadline<T>(signal: AbortSignal, fn: (signal: AbortSignal) => Promise<T>, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  if (signal.aborted) controller.abort(); else signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const result = await fn(controller.signal);
    // A caller may catch a streaming AbortError; a completed callback must not
    // turn an expired or cancelled operation into a successful response.
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return result;
  }
  catch (error) {
    if (timedOut) throw new ProviderError('timeout', `The provider exceeded the ${timeoutMs / 1000}-second limit. Retry or use a permitted CSV.`);
    if (signal.aborted) throw new ProviderError('cancelled', 'Data loading was cancelled.');
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('network', 'The data request failed. Check network access and the provider’s browser CORS policy, or import a permitted CSV.');
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); }
}
export async function readLimitedText(response: Response, budget: { bytes: number }, signal: AbortSignal, maximum = PROVIDER_MAX_BYTES): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum - budget.bytes) { await response.body?.cancel(); throw new ProviderError('too_large', 'The response exceeds the permitted size limit.'); }
  if (!response.body) throw new ProviderError('empty', 'The provider returned an empty response.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let text = '';
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      budget.bytes += value.byteLength;
      if (budget.bytes > maximum) throw new ProviderError('too_large', 'The response exceeds the permitted size limit.');
      text += decoder.decode(value, { stream: true });
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return text + decoder.decode();
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function httpProviderError(status: number, retryAfter?: string | null): ProviderError {
  if (status === 401) return new ProviderError('authentication', 'The provider rejected the API key. Check or replace it.');
  if (status === 403) return new ProviderError('entitlement', 'This key or plan cannot access the requested daily history.');
  if (status === 429) {
    const seconds = retryAfter && /^\d{1,6}$/.test(retryAfter) ? Number(retryAfter) : null;
    return new ProviderError('rate_limit', `The provider or connection limit was reached. ${seconds !== null ? `Wait at least ${seconds} seconds before retrying.` : 'Wait before retrying.'} No automatic retry was attempted.`);
  }
  if (status === 404) return new ProviderError('unavailable_symbol', 'The requested provider history is unavailable.');
  return new ProviderError('upstream', 'The data provider is unavailable. Retry later or import a permitted CSV.');
}
export function providerDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?(?:Z|\+00:00))?$/.test(value) || !isIsoDate(value.slice(0, 10))) {
    throw new ProviderError('invalid_data', 'The provider date field is invalid. Use daily ISO dates or midnight UTC dates.');
  }
  return value.slice(0, 10);
}
export interface PriceObservation { date: string; symbol: string; value: number }
export function observationsDataset(rows: PriceObservation[], request: ProviderRequest, manifest: DatasetManifest): MarketDataset {
  if (!rows.length || rows.length > 100_000) throw new ProviderError('invalid_data', 'The provider returned no usable daily history or too many rows.');
  if (rows.some(r => !request.symbols.includes(r.symbol) || r.date < request.start || r.date > request.end || !Number.isFinite(r.value) || r.value <= 0)) {
    throw new ProviderError('invalid_data', 'The provider returned invalid prices, dates or symbols. Check the response mapping.');
  }
  if (request.symbols.some(s => !rows.some(r => r.symbol === s))) throw new ProviderError('missing_symbols', 'The provider did not return every requested ETF. No partial dataset was accepted.');
  const assets = request.symbols.map(symbol => {
    const observations = rows.filter(row => row.symbol === symbol).map(row => row.date).sort();
    if (observations.at(-1) !== request.end) throw new ProviderError('stale_history', `History for ${symbol} does not reach the requested final session ${request.end}. Retry after the provider updates, or import a permitted historical CSV.`);
    return { symbol, firstDate: observations[0], lastDate: observations.at(-1)!, observations: observations.length };
  });
  manifest = { ...manifest, acquisition: { requestedStart: request.start, requestedEnd: request.end, assets } };
  const csv = ['date,symbol,adjusted_close', ...rows.map(r => `${r.date},${r.symbol},${r.value}`)].join('\n');
  try { return parseMarketCsv(csv, { format: 'long', selectedSymbols: request.symbols, manifest }); }
  catch { throw new ProviderError('invalid_history', 'Daily history failed validation: check session gaps, duplicate dates, adjustments, asset inception and common coverage. No filling or interpolation was applied.'); }
}
export async function mapTwo<T, R>(items: T[], task: (item: T) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const results: R[] = new Array(items.length); let index = 0;
  await Promise.all(Array.from({ length: Math.min(2, items.length) }, async () => {
    while (index < items.length) { if (signal?.aborted) throw new ProviderError('cancelled', 'Data loading was cancelled.'); const i = index++; results[i] = await task(items[i]); }
  }));
  return results;
}
