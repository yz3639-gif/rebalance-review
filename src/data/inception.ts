import type { MarketDataset } from '../types';
import { ETF_REGISTRY } from './registry';
import { DataValidationError } from './validation';

/** Issuer inception is a lower bound, never a substitute for the observed common start. */
export function assertAssetHistoryBounds(dataset: Pick<MarketDataset, 'manifest' | 'symbols' | 'dates'>): void {
  if (dataset.manifest.synthetic || !dataset.dates.length) return;
  for (const symbol of dataset.symbols) {
    const inception = ETF_REGISTRY.find(entry => entry.symbol === symbol)?.inception;
    if (inception?.status === 'verified' && inception.value && dataset.dates[0] < inception.value) {
      throw new DataValidationError(`${symbol} observations begin before its issuer-reported inception ${inception.value}. Do not splice an index, predecessor fund, or different share class into an ETF price history.`);
    }
  }
}
