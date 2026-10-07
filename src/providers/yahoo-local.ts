import type { ProviderAdapter } from '../types';
import { currentUsDate } from '../data';
import { PROVIDER_BATCH_TIMEOUT_MS, ProviderError, httpProviderError, mapTwo, observationsDataset, providerDate, readLimitedText, validateProviderRequest, withProviderDeadline } from './shared';

/** Personal local research only. The same-origin server enforces the local-only gate and ETF identity. */
export function createYahooLocalAdapter(): ProviderAdapter {
  return {
    id: 'yahoo-local', label: 'Yahoo Finance · local personal research',
    async fetch(input, signal, onProgress) {
      const request = validateProviderRequest(input);
      return withProviderDeadline(signal, async activeSignal => {
        const budget = { bytes: 0 }; let completed = 0;
        onProgress?.({ completed, total: request.symbols.length, status: 'loading' });
        const groups = await mapTwo(request.symbols, async symbol => withProviderDeadline(activeSignal, async assetSignal => {
          const response = await fetch('/api/providers/yahoo/eod', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol, start: request.start, end: request.end }),
            signal: assetSignal, credentials: 'omit', cache: 'no-store', redirect: 'error',
          });
          if (!response.ok) {
            // Interpret only the server's fixed error codes; never surface upstream bodies or URLs.
            let errorCode: unknown;
            try { errorCode = (JSON.parse(await readLimitedText(response, { bytes: 0 }, assetSignal, 4096)) as { error?: unknown })?.error; }
            catch { /* Unknown or oversized error bodies receive a safe status-based message. */ }
            if (errorCode === 'local_connection_disabled') throw new ProviderError('local_unavailable', 'Local market history is disabled. Start this application with npm start on this computer, or choose Tiingo or a permitted CSV.');
            if (errorCode === 'invalid_upstream_data' || errorCode === 'invalid_adjusted_history') throw new ProviderError('invalid_history', 'Yahoo Finance returned incomplete or invalid adjusted daily history. Retry later, or choose Tiingo or independently verified, permitted CSV history. No prices were substituted.');
            if (response.status === 422 && errorCode === 'stale_history') throw new ProviderError('stale_history', 'Yahoo Finance history does not reach the requested final session. Retry after the provider updates, or import a permitted historical CSV.');
            if (response.status === 422) throw new ProviderError('asset_identity', 'Yahoo Finance could not verify a compatible USD ETF listing. Choose another ETF or import independently verified, permitted CSV history.');
            if (response.status === 504) throw new ProviderError('timeout', 'The local market history request timed out. Retry or choose Tiingo or a permitted CSV.');
            if (response.status === 401 || response.status === 403) throw new ProviderError('provider_access', 'Yahoo Finance declined the public history request. Retry later, or choose Tiingo or a permitted CSV. No API key is used by this local connection.');
            throw httpProviderError(response.status, response.headers.get('Retry-After'));
          }
          let parsed: unknown;
          try { parsed = JSON.parse(await readLimitedText(response, budget, assetSignal)); }
          catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError('invalid_data', 'The local market connection returned malformed data.'); }
          if (!parsed || typeof parsed !== 'object' || !('prices' in parsed) || !Array.isArray(parsed.prices) || !('symbol' in parsed) || parsed.symbol !== symbol) throw new ProviderError('invalid_data', 'The local market connection returned an unexpected ETF or price response.');
          const observations = parsed.prices.map((row: unknown) => {
            if (!row || typeof row !== 'object' || !('date' in row) || !('adjClose' in row) || typeof row.adjClose !== 'number') throw new ProviderError('invalid_data', 'Split-and-distribution-adjusted close prices are missing. Unadjusted prices were not substituted.');
            return { date: providerDate(row.date), symbol, value: row.adjClose };
          });
          completed++; onProgress?.({ completed, total: request.symbols.length, symbol, status: 'loading' });
          return observations;
        }), activeSignal);
        const dataset = observationsDataset(groups.flat(), request, {
          id: crypto.randomUUID(), source: 'Yahoo Finance · local personal research · unofficial public chart interface · https://finance.yahoo.com',
          currency: 'USD', basis: 'adjusted_close', asOf: '', synthetic: false, retention: 'operation', policy: 'yahoo-local',
          rights: { display: true, rawPersistence: false, derivedPersistence: false, export: false, publicDisplay: false,
            evidence: 'Local personal research only via an unofficial public chart interface. No storage, export or redistribution entitlement was verified. Raw history is removed after calculation. https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html', verifiedAt: currentUsDate() },
        });
        onProgress?.({ completed, total: request.symbols.length, status: 'complete' });
        return dataset;
      }, PROVIDER_BATCH_TIMEOUT_MS);
    },
  };
}
