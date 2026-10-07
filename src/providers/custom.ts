import type { DataRights, ProviderAdapter } from '../types';
import { containsCredential, currentUsDate, hasCredentialMaterial, inspectCsv, normalizeSymbol } from '../data';
import { PROVIDER_BATCH_TIMEOUT_MS, ProviderError, httpProviderError, mapTwo, observationsDataset, providerDate, readLimitedText, validateProviderRequest, withProviderDeadline } from './shared';

export interface CustomRestConfig {
  endpoint: string;
  source: string;
  format: 'json' | 'csv';
  csvShape: 'long' | 'wide';
  requestMode: 'per-symbol' | 'batch';
  arrayPath: string;
  fields: { date: string; symbol: string; value: string };
  params: { symbol: string; start: string; end: string };
  auth: { kind: 'none' | 'bearer' | 'token' | 'x-api-key' | 'query'; value: string; queryName: string };
  basis: 'adjusted_close' | 'total_return_index';
  usdAndBasisConfirmed: boolean;
  permissions: Pick<DataRights, 'rawPersistence' | 'derivedPersistence' | 'export'>;
}
const safeName = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
function field(object: unknown, path: string): unknown {
  if (!path) return object;
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(path) || path.split('.').some(p => ['__proto__', 'constructor', 'prototype'].includes(p))) throw new ProviderError('mapping', 'Use dot-separated field names without expressions or reserved properties.');
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key) ? (value as Record<string, unknown>)[key] : undefined, object);
}
export function validateCustomConfig(config: CustomRestConfig): CustomRestConfig {
  const c = structuredClone(config);
  let url: URL;
  try { url = new URL(c.endpoint); } catch { throw new ProviderError('endpoint', 'Enter a complete HTTPS API endpoint.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || ['localhost', '[::1]'].includes(url.hostname) || /^127\./.test(url.hostname)) throw new ProviderError('endpoint', 'Use a public HTTPS endpoint without embedded credentials or a fragment.');
  if (hasCredentialMaterial(url.href) || containsCredential(c.endpoint, c.auth.value)) throw new ProviderError('endpoint', 'Remove credentials from the endpoint. Enter them only in the separate API credential field.');
  if (!c.source.trim() || c.source.length > 500 || hasCredentialMaterial(c.source) || containsCredential(c.source, c.auth.value)) throw new ProviderError('source', 'Enter a source name without credentials.');
  if (!c.usdAndBasisConfirmed || !['adjusted_close', 'total_return_index'].includes(c.basis)) throw new ProviderError('basis', 'Confirm USD prices and the selected split-and-distribution-adjusted basis.');
  if (!['json', 'csv'].includes(c.format) || !['per-symbol', 'batch'].includes(c.requestMode)) throw new ProviderError('mapping', 'Choose a supported response format and request mode.');
  if (!['long', 'wide'].includes(c.csvShape) || (c.format === 'csv' && c.csvShape === 'wide' && c.requestMode !== 'batch')) throw new ProviderError('mapping', 'Wide CSV requires one batch request with one column per ETF.');
  for (const value of Object.values(c.params)) if (!safeName.test(value)) throw new ProviderError('mapping', 'Request parameter names must use letters, numbers, underscores or hyphens.');
  if (new Set(Object.values(c.params)).size !== 3) throw new ProviderError('mapping', 'Ticker, start and end parameters must have distinct names.');
  for (const value of [c.arrayPath, ...Object.values(c.fields)]) field({}, value);
  if (!c.fields.date || !c.fields.value || (c.requestMode === 'batch' && !(c.format === 'csv' && c.csvShape === 'wide') && !c.fields.symbol)) throw new ProviderError('mapping', 'Map the date and adjusted-price fields; long batch requests also need a symbol field.');
  if (!['none', 'bearer', 'token', 'x-api-key', 'query'].includes(c.auth.kind) || c.auth.value.length > 2000 || /[\x00-\x1f\x7f]/.test(c.auth.value)) throw new ProviderError('credentials', 'The authentication settings are invalid.');
  if (c.auth.kind !== 'none' && !c.auth.value.trim()) throw new ProviderError('credentials', 'Enter your API credential.');
  if (c.auth.kind === 'query' && (!safeName.test(c.auth.queryName) || Object.values(c.params).includes(c.auth.queryName))) throw new ProviderError('credentials', 'Choose a separate query parameter name for the API credential.');
  if (Object.values(c.permissions).some(v => typeof v !== 'boolean') || (c.permissions.rawPersistence && !c.permissions.derivedPersistence)) throw new ProviderError('rights', 'Raw-data saving requires derived-result saving permission too.');
  return c;
}
/** Export a reusable template, never credentials or durable source permissions. */
export function exportCustomConfig(config: CustomRestConfig): string {
  const c = validateCustomConfig(config);
  const { value: _credential, ...auth } = c.auth;
  const template = JSON.stringify({ schemaVersion: 1, kind: 'rebalance-review-rest-template', configuration: { ...c, auth,
    usdAndBasisConfirmed: false, permissions: { rawPersistence: false, derivedPersistence: false, export: false } },
    instructions: 'Re-enter your credential and confirm the source basis and permissions before using this template.' }, null, 2);
  if (containsCredential(template, c.auth.value)) throw new ProviderError('credentials', 'Remove the credential from nonsecret mapping fields before exporting a template.');
  return template;
}
export function createCustomRestAdapter(config: CustomRestConfig): ProviderAdapter {
  const c = validateCustomConfig(config);
  return {
    id: 'custom-rest', label: `${c.source.trim()} · browser connection`,
    async fetch(input, signal, onProgress) {
      const request = validateProviderRequest(input);
      return withProviderDeadline(signal, async activeSignal => {
        const budget = { bytes: 0 }; let completed = 0;
        onProgress?.({ completed, total: request.symbols.length, status: 'loading' });
        const groups = await mapTwo(c.requestMode === 'batch' ? [request.symbols.join(',')] : request.symbols, async requestedSymbol => withProviderDeadline(activeSignal, async assetSignal => {
          const url = new URL(c.endpoint);
          url.searchParams.set(c.params.symbol, requestedSymbol); url.searchParams.set(c.params.start, request.start); url.searchParams.set(c.params.end, request.end);
          const headers = new Headers({ Accept: c.format === 'json' ? 'application/json' : 'text/csv' });
          if (c.auth.kind === 'bearer') headers.set('Authorization', `Bearer ${c.auth.value}`);
          if (c.auth.kind === 'token') headers.set('Authorization', `Token ${c.auth.value}`);
          if (c.auth.kind === 'x-api-key') headers.set('X-API-Key', c.auth.value);
          if (c.auth.kind === 'query') url.searchParams.set(c.auth.queryName, c.auth.value);
          const response = await fetch(url, { method: 'GET', headers, signal: assetSignal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
          if (!response.ok) { await response.body?.cancel(); throw httpProviderError(response.status, response.headers.get('Retry-After')); }
          if ((response.headers.get('content-type') || '').includes('text/html')) { await response.body?.cancel(); throw new ProviderError('invalid_data', 'The endpoint returned a web page instead of JSON or CSV.'); }
          const text = await readLimitedText(response, budget, assetSignal);
          let rows: unknown;
          try { rows = c.format === 'csv' ? inspectCsv(text).rows : field(JSON.parse(text), c.arrayPath); }
          catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError('invalid_data', 'The response cannot be read using the selected JSON/CSV mapping.'); }
          if (!Array.isArray(rows) || !rows.length || rows.length > 100_000) throw new ProviderError('mapping', 'The selected response path must contain a nonempty array of daily observations.');
          completed += c.requestMode === 'batch' ? request.symbols.length : 1;
          onProgress?.({ completed, total: request.symbols.length, symbol: requestedSymbol, status: 'loading' });
          if (c.format === 'csv' && c.csvShape === 'wide') return rows.flatMap(row => {
            const date = providerDate(field(row, c.fields.date));
            return request.symbols.map(symbol => {
              const raw = row && typeof row === 'object' ? (row as Record<string, unknown>)[symbol] : undefined;
              if ((typeof raw !== 'number' && typeof raw !== 'string') || String(raw).trim() === '') throw new ProviderError('mapping', 'Wide CSV must contain a positive adjusted-price column for every requested ETF.');
              return { date, symbol, value: Number(raw) };
            });
          });
          return rows.map(row => {
            const date = providerDate(field(row, c.fields.date));
            const rawSymbol = c.fields.symbol ? field(row, c.fields.symbol) : requestedSymbol;
            let symbol: string;
            try { if (typeof rawSymbol !== 'string') throw new Error(); symbol = normalizeSymbol(rawSymbol); } catch { throw new ProviderError('mapping', 'The provider symbol field is missing or invalid.'); }
            if (c.requestMode === 'per-symbol' && symbol !== requestedSymbol) throw new ProviderError('mapping', 'A per-symbol response contains a different asset.');
            const rawValue = field(row, c.fields.value);
            if ((typeof rawValue !== 'number' && typeof rawValue !== 'string') || String(rawValue).trim() === '') throw new ProviderError('mapping', 'The adjusted-price field is missing or not numeric.');
            const value = Number(rawValue);
            return { date, symbol, value };
          });
        }), activeSignal);
        const retention = c.permissions.rawPersistence ? 'persistable' : 'operation';
        const dataset = observationsDataset(groups.flat(), request, {
          id: crypto.randomUUID(), source: `${c.source.trim()} · ${new URL(c.endpoint).origin}`,
          currency: 'USD', basis: c.basis, asOf: '', synthetic: false, retention, policy: 'user-declared',
          rights: { display: true, ...c.permissions, publicDisplay: false,
            evidence: 'User declares access to this custom API and the specifically selected local persistence/export permissions. This declaration is not provider-license verification.', verifiedAt: currentUsDate() },
        });
        onProgress?.({ completed, total: request.symbols.length, status: 'complete' });
        return dataset;
      }, PROVIDER_BATCH_TIMEOUT_MS);
    },
  };
}
