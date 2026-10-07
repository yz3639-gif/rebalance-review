import type { DatasetManifest, MarketDataset, PortfolioSpec } from '../types';
import { DEMO_SYMBOLS, MAX_REVIEW_ASSETS } from './registry';
import { exportSafeCsv } from './csv';
import { currentUsDate, DataValidationError, isIsoDate } from './validation';

/** Generated mathematical paths only; no observed ETF prices or claims about actual ETF returns. */
export function createSyntheticDemo(options: { observations?: number; endDate?: string; symbols?: string[] } = {}): { dataset: MarketDataset; a: PortfolioSpec; b: PortfolioSpec } {
  const observations = options.observations ?? 1600;
  const endDate = options.endDate ?? '2026-09-30';
  if (!Number.isInteger(observations) || observations < 2 || observations > 20_000) throw new DataValidationError('Synthetic observations must be an integer between 2 and 20,000.');
  if (!isIsoDate(endDate) || endDate > currentUsDate()) throw new DataValidationError('Synthetic cutoff must be a valid date no later than today in America/New_York.');
  const symbols = options.symbols ?? [...DEMO_SYMBOLS];
  if (!symbols.length || symbols.length > MAX_REVIEW_ASSETS || new Set(symbols).size !== symbols.length || symbols.includes('CASH')) throw new DataValidationError(`Synthetic data needs 1–${MAX_REVIEW_ASSETS} distinct noncash symbols.`);
  const dates: string[] = [];
  const cursor = new Date(`${endDate}T00:00:00Z`);
  while (dates.length < observations) {
    if (![0, 6].includes(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  dates.reverse();
  let seed = 19_871_231;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return (seed + 0.5) / 4294967296; };
  const normal = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  const levels = symbols.map((_, index) => 80 + index * 7);
  const prices = dates.map((_, day) => {
    const market = normal();
    const rates = normal();
    const stress = day % 431 > 396 ? 1.8 : 1;
    return symbols.map((symbol, index) => {
      const bond = ['SHY', 'IEF', 'TLT', 'BND', 'TIP', 'LQD'].includes(symbol);
      const idiosyncratic = normal();
      const daily = bond
        ? 0.00008 + stress * (0.0021 * rates - 0.0007 * market + 0.0007 * idiosyncratic)
        : 0.00022 + stress * (0.008 * market + 0.004 * idiosyncratic + 0.001 * rates);
      if (day > 0) levels[index] *= Math.exp(daily);
      return levels[index];
    });
  });
  const manifest: DatasetManifest = {
    id: `synthetic-v1-${observations}-${dates.at(-1)}`, source: 'Deterministic synthetic demonstration; not actual ETF prices. Weekdays are illustrative sessions, not an exchange calendar.',
    currency: 'USD', basis: 'total_return_index', asOf: dates.at(-1)!, synthetic: true,
    rights: { display: true, rawPersistence: true, derivedPersistence: true, export: true, publicDisplay: true, evidence: 'Independently generated mathematical example paths, fully redistributable. No provider data.', verifiedAt: '2026-10-05' },
  };
  const defaultAvailable = ['VTI', 'VXUS', 'BND', 'GLD'].every(symbol => symbols.includes(symbol));
  const a: PortfolioSpec = { id: 'a', name: 'Current allocation', holdings: defaultAvailable ? [{ symbol: 'VTI', weight: .55 }, { symbol: 'VXUS', weight: .2 }, { symbol: 'BND', weight: .2 }, { symbol: 'CASH', weight: .05 }] : [{ symbol: symbols[0], weight: 1 }] };
  const b: PortfolioSpec = { id: 'b', name: 'Proposed allocation', holdings: defaultAvailable ? [{ symbol: 'VTI', weight: .4 }, { symbol: 'VXUS', weight: .2 }, { symbol: 'BND', weight: .25 }, { symbol: 'GLD', weight: .1 }, { symbol: 'CASH', weight: .05 }] : [{ symbol: symbols[0], weight: .8 }, { symbol: 'CASH', weight: .2 }] };
  return { dataset: { manifest, dates, symbols: [...symbols], prices }, a, b };
}

export function syntheticMarketCsv(format: 'long' | 'wide' = 'wide'): string {
  const { dataset } = createSyntheticDemo();
  return format === 'wide'
    ? exportSafeCsv([['date', ...dataset.symbols], ...dataset.dates.map((date, row) => [date, ...dataset.prices[row]])])
    : exportSafeCsv([['date', 'symbol', 'total_return_index'], ...dataset.dates.flatMap((date, row) => dataset.symbols.map((symbol, column) => [date, symbol, dataset.prices[row][column]]))]);
}

export const HOLDINGS_CSV_TEMPLATE = 'symbol,weight\r\nVTI,55\r\nVXUS,20\r\nBND,20\r\nCASH,5\r\n';
