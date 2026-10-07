import type { DatasetManifest, MarketDataset } from '../types';
import { inspectCsv, requiredColumn } from './csv';
import { assertRights } from './rights';
import { assertCompleteDailySessions } from './calendar';
import { assertAssetHistoryBounds } from './inception';
import { isKnownSymbol, MAX_REVIEW_ASSETS } from './registry';
import { currentUsDate, DataValidationError, finiteNumber, isIsoDate, normalizeSymbol, validateManifest } from './validation';

export interface MarketCsvOptions {
  format: 'long' | 'wide';
  columns?: { date: string; symbol?: string; value?: string };
  manifest: DatasetManifest;
  confirmIdenticalDuplicates?: boolean;
  /** Restricts the matrix to supplied columns relevant to A/B; absent requested assets remain uncovered. */
  selectedSymbols?: string[];
}

export function parseMarketCsv(text: string, options: MarketCsvOptions): MarketDataset {
  if (options.manifest.basis === 'cash_zero') throw new DataValidationError('Cash assumptions cannot be supplied as market-price CSV data. Use the cash-only review period.');
  if (!['long', 'wide'].includes(options.format)) throw new DataValidationError('Select long or wide market CSV format.');
  const { headers, rows } = inspectCsv(text);
  const dateColumn = requiredColumn(headers, options.columns?.date, 'date');
  const derivedCutoff = rows.map(row => row[dateColumn]).filter(isIsoDate).sort().at(-1) ?? '';
  const manifest = validateManifest({ ...options.manifest, asOf: options.manifest.asOf || derivedCutoff });
  assertRights(manifest, 'display');
  const symbolColumn = options.format === 'long' ? requiredColumn(headers, options.columns?.symbol, 'symbol') : '';
  const valueColumn = options.format === 'long' ? requiredColumn(headers, options.columns?.value, manifest.basis) : '';
  if (options.format === 'long' && new Set([dateColumn, symbolColumn, valueColumn]).size !== 3) throw new DataValidationError('Date, symbol, and price must map to different columns.');
  const wideColumns = options.format === 'wide' ? headers.filter(header => header !== dateColumn).map(column => ({ column, symbol: normalizeSymbol(column) })) : [];
  if (options.format === 'wide' && !wideColumns.length) throw new DataValidationError('A wide CSV needs at least one asset column.');
  if (new Set(wideColumns.map(column => column.symbol)).size !== wideColumns.length) throw new DataValidationError('Wide CSV headers resolve to duplicate symbols.');
  const series = new Map<string, Map<string, number>>();
  const observedDates = new Set<string>();
  const wideRowsByDate = new Map<string, string[]>();
  const today = currentUsDate();
  const add = (symbol: string, date: string, raw: string, row: number) => {
    if (symbol === 'CASH') throw new DataValidationError('Do not supply a market-price column for cash. Cash is modeled separately at a confirmed zero return.');
    if (!raw.trim()) return; // Leading/trailing absent data is resolved only by the visible common window below.
    const value = finiteNumber(raw, `Market row ${row}, ${symbol}`);
    if (!(value > 0)) throw new DataValidationError(`Market row ${row}, ${symbol}: prices must be strictly positive.`);
    const prices = series.get(symbol) ?? new Map<string, number>();
    const previous = prices.get(date);
    if (previous !== undefined) {
      if (previous !== value) throw new DataValidationError(`Conflicting prices for ${symbol} on ${date}. Resolve the source conflict before importing.`);
      if (!options.confirmIdenticalDuplicates) throw new DataValidationError(`Identical duplicate price for ${symbol} on ${date}. Confirm removing identical duplicates before importing.`);
    }
    prices.set(date, value);
    series.set(symbol, prices);
  };
  rows.forEach((row, index) => {
    const date = row[dateColumn];
    if (!isIsoDate(date)) throw new DataValidationError(`Market row ${index + 2}: invalid date. Use a real YYYY-MM-DD calendar date.`);
    if (date > today || date > manifest.asOf) throw new DataValidationError(`Market row ${index + 2}: date is after today's date or the declared dataset cutoff.`);
    if (options.format === 'wide' && observedDates.has(date) && !options.confirmIdenticalDuplicates) throw new DataValidationError(`Duplicate market date ${date}. Confirm removal only if all overlapping prices agree.`);
    if (options.format === 'wide') {
      const values = wideColumns.map(({ column }) => row[column] === '' ? '' : String(finiteNumber(row[column], `Market row ${index + 2}`)));
      const previousRow = wideRowsByDate.get(date);
      if (previousRow && previousRow.some((value, column) => value !== values[column])) throw new DataValidationError(`Conflicting duplicate market rows on ${date}. Combining incomplete duplicate rows is not permitted.`);
      wideRowsByDate.set(date, values);
    }
    observedDates.add(date);
    if (options.format === 'long') {
      if (!row[valueColumn]) throw new DataValidationError(`Market row ${index + 2}: missing price in a long-format observation.`);
      add(normalizeSymbol(row[symbolColumn]), date, row[valueColumn], index + 2);
    } else wideColumns.forEach(({ column, symbol }) => add(symbol, date, row[column], index + 2));
  });
  const requested = options.selectedSymbols?.map(normalizeSymbol).filter(symbol => symbol !== 'CASH');
  const symbols = (requested?.length ? [...new Set(requested)].filter(symbol => series.has(symbol)) : [...series.keys()]).filter(isKnownSymbol).sort();
  if (!symbols.length) throw new DataValidationError('No market observations match the selected portfolios. Your holdings have been retained; supply matching market data.');
  if (symbols.length > MAX_REVIEW_ASSETS) throw new DataValidationError(`A review can include at most ${MAX_REVIEW_ASSETS} noncash market series. Choose the symbols used by A and B.`);
  // Intersect each series' first/last observation, then require a complete grid inside that interval.
  const boundaries = symbols.map(symbol => [...series.get(symbol)!.keys()].sort());
  const start = boundaries.map(dates => dates[0]).sort().at(-1)!;
  const end = boundaries.map(dates => dates.at(-1)!).sort()[0];
  if (start > end) throw new DataValidationError('The assets have no overlapping market-data period.');
  const selectedDates = options.format === 'wide' ? observedDates : new Set(symbols.flatMap(symbol => [...series.get(symbol)!.keys()]));
  const dates = [...selectedDates].filter(date => date >= start && date <= end).sort();
  const prices = dates.map(date => symbols.map(symbol => {
    const value = series.get(symbol)!.get(date);
    if (value === undefined) throw new DataValidationError(`Internal missing price for ${symbol} on ${date}. No interpolation or silent date dropping is allowed.`);
    return value;
  }));
  if (dates.length < 2) throw new DataValidationError('At least two common price observations are required to calculate a return. The default review requires 253.');
  assertCompleteDailySessions(dates, manifest.synthetic);
  assertAssetHistoryBounds({ manifest, dates, symbols });
  return { manifest, dates, symbols, prices };
}
