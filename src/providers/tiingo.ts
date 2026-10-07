import type { ProviderAdapter } from '../types';
import { currentUsDate, getEtf } from '../data';
import { PROVIDER_BATCH_TIMEOUT_MS, ProviderError, httpProviderError, mapTwo, observationsDataset, providerDate, readLimitedText, validateProviderRequest, withProviderDeadline } from './shared';

export function createTiingoAdapter({ token, usdConfirmed = false }: { token: string; usdConfirmed?: boolean }): ProviderAdapter {
  const key = token.trim();
  if (!key || key.length > 500 || /[\s\x00-\x1f\x7f]/.test(key)) throw new ProviderError('invalid_key', 'Enter a valid Tiingo API token without whitespace.');
  return {
    id: 'tiingo-byok', label: 'Tiingo · your API key',
    async fetch(input, signal, onProgress) {
      const request = validateProviderRequest(input);
      if (!usdConfirmed && request.symbols.some(symbol => getEtf(symbol)?.currency.status !== 'verified')) throw new ProviderError('currency_confirmation', 'Confirm that the selected US-listed ETF quotations are in USD. Listing metadata alone does not verify the currency.');
      return withProviderDeadline(signal, async activeSignal => {
        const budget = { bytes: 0 }; let completed = 0;
        const metadata = new Map<string, { providerStartDate: string; providerEndDate: string }>();
        onProgress?.({ completed, total: request.symbols.length, status: 'loading' });
        const groups = await mapTwo(request.symbols, async symbol => withProviderDeadline(activeSignal, async assetSignal => {
          const response = await fetch('/api/providers/tiingo/eod', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Token ${key}` },
            body: JSON.stringify({ symbol, start: request.start, end: request.end }),
            signal: assetSignal, credentials: 'omit', cache: 'no-store', redirect: 'error',
          });
          if (!response.ok) {
            await response.body?.cancel();
            if (response.status === 422) throw new ProviderError('asset_identity', 'Tiingo identity checks could not verify a compatible USD ETF listing. The provider and app directories may disagree or need updating. Use another ETF or import independently verified, permitted CSV history.');
            throw httpProviderError(response.status, response.headers.get('Retry-After'));
          }
          let parsed: unknown;
          try { parsed = JSON.parse(await readLimitedText(response, budget, assetSignal)); }
          catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError('invalid_data', 'The Tiingo connection returned malformed data.'); }
          if (!parsed || typeof parsed !== 'object' || !('prices' in parsed) || !Array.isArray(parsed.prices) || !('symbol' in parsed) || parsed.symbol !== symbol || !('coverage' in parsed) || !parsed.coverage || typeof parsed.coverage !== 'object' || !('startDate' in parsed.coverage) || !('endDate' in parsed.coverage)) throw new ProviderError('invalid_data', 'The Tiingo connection returned an unexpected response or missing coverage metadata.');
          const providerStartDate = providerDate(parsed.coverage.startDate), providerEndDate = providerDate(parsed.coverage.endDate);
          if (providerStartDate > providerEndDate || providerEndDate < request.end) throw new ProviderError('stale_history', `Tiingo coverage for ${symbol} does not reach the requested final session. Retry later or import a permitted historical CSV.`);
          metadata.set(symbol, { providerStartDate, providerEndDate });
          const observations = parsed.prices.map((row: unknown) => {
            if (!row || typeof row !== 'object' || !('date' in row) || !('adjClose' in row) || typeof row.adjClose !== 'number') throw new ProviderError('invalid_data', 'Tiingo adjusted close prices are missing.');
            const date = providerDate(row.date);
            if (date < providerStartDate || date > providerEndDate) throw new ProviderError('invalid_data', 'Returned prices contradict the provider coverage metadata.');
            return { date, symbol, value: row.adjClose };
          });
          completed++; onProgress?.({ completed, total: request.symbols.length, symbol, status: 'loading' });
          return observations;
        }), activeSignal);
        const dataset = observationsDataset(groups.flat(), request, {
          id: crypto.randomUUID(), source: 'Tiingo EOD · user-supplied API token · https://www.tiingo.com',
          currency: 'USD', basis: 'adjusted_close', asOf: '', synthetic: false, retention: 'operation', policy: 'tiingo-byok',
          rights: { display: true, rawPersistence: false, derivedPersistence: false, export: false, publicDisplay: false,
            evidence: 'Personal BYOK processing only. Default Starter/trial restrictions apply: raw data removed after calculation. No output-specific persistence or export entitlement was verified. https://app.tiingo.com/tos/', verifiedAt: currentUsDate() },
        });
        dataset.manifest.acquisition!.assets = dataset.manifest.acquisition!.assets.map(asset => ({ ...asset, ...metadata.get(asset.symbol)! }));
        onProgress?.({ completed, total: request.symbols.length, status: 'complete' });
        return dataset;
      }, PROVIDER_BATCH_TIMEOUT_MS);
    },
  };
}
