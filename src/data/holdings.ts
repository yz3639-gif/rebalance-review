import type { PortfolioSpec } from '../types';
import { csvRows, inspectCsv, requiredColumn } from './csv';
import { isKnownSymbol, MAX_REVIEW_ASSETS } from './registry';
import { DataValidationError, finiteNumber, normalizeSymbol } from './validation';

export interface HoldingsOptions {
  id?: string; name?: string; mode: 'weight' | 'market_value';
  weightUnit?: 'percent' | 'decimal'; columns?: { symbol: string; value: string };
  hasHeader?: boolean; confirmMergeDuplicates?: boolean;
}
export interface HoldingsImport {
  portfolio: PortfolioSpec; unknownSymbols: string[]; mergedSymbols: string[];
  marketValues?: Record<string, number>; totalMarketValue?: number;
}

export function parseHoldings(text: string, options: HoldingsOptions): HoldingsImport {
  if (!['weight', 'market_value'].includes(options.mode)) throw new DataValidationError('Choose weights or USD market values.');
  if (options.mode === 'weight' && !['percent', 'decimal'].includes(options.weightUnit ?? '')) throw new DataValidationError('Explicitly choose percent or decimal weights.');
  let entries: [string, string][];
  if (options.hasHeader === false) {
    entries = csvRows(text).map((row, index) => {
      const cells = row.length === 1 ? row[0].split(/\s+/) : row;
      if (cells.length !== 2) throw new DataValidationError(`Holding row ${index + 1} must contain a symbol and a value.`);
      return [cells[0], cells[1]];
    });
  } else {
    const { headers, rows } = inspectCsv(text);
    const symbolColumn = requiredColumn(headers, options.columns?.symbol, 'symbol');
    const valueColumn = requiredColumn(headers, options.columns?.value, options.mode === 'weight' ? 'weight' : 'market_value');
    if (symbolColumn === valueColumn) throw new DataValidationError('Symbol and value must map to different columns.');
    entries = rows.map(row => [row[symbolColumn], row[valueColumn]]);
  }
  const values = new Map<string, number>();
  const mergedSymbols = new Set<string>();
  for (const [index, [rawSymbol, rawValue]] of entries.entries()) {
    const symbol = normalizeSymbol(rawSymbol);
    const hasPercent = rawValue.trim().endsWith('%');
    if (hasPercent && !(options.mode === 'weight' && options.weightUnit === 'percent')) throw new DataValidationError(`Holding row ${index + 1}: a percent sign requires percent-weight mode.`);
    const value = finiteNumber(hasPercent ? rawValue.trim().slice(0, -1) : rawValue, `Holding row ${index + 1}`);
    if (values.has(symbol)) {
      if (!options.confirmMergeDuplicates) throw new DataValidationError(`Duplicate holding ${symbol}. Confirm merging duplicate positions before importing.`);
      mergedSymbols.add(symbol);
    }
    const combined = (values.get(symbol) ?? 0) + value;
    if (!Number.isFinite(combined)) throw new DataValidationError('Combined holding value is too large.');
    values.set(symbol, combined);
  }
  if (values.size > MAX_REVIEW_ASSETS + 1) throw new DataValidationError(`A portfolio can contain at most ${MAX_REVIEW_ASSETS + 1} holding rows after confirmed duplicate merging, including cash and zero-weight positions.`);
  if ([...values].filter(([symbol, value]) => symbol !== 'CASH' && value > 0).length > MAX_REVIEW_ASSETS) throw new DataValidationError(`A portfolio can contain at most ${MAX_REVIEW_ASSETS} noncash assets with positive allocations. Unknown holdings count toward this limit.`);
  const total = [...values.values()].reduce((sum, value) => sum + value, 0);
  if (!(total > 0) || !Number.isFinite(total)) throw new DataValidationError('Portfolio total must be finite and greater than zero.');
  const scale = options.mode === 'market_value' ? total : options.weightUnit === 'percent' ? 100 : 1;
  if (options.mode === 'weight' && Math.abs(total / scale - 1) > 1e-8) throw new DataValidationError(`Weights must total ${scale}${options.weightUnit === 'percent' ? '%' : ''}; they currently total ${total}. Include cash explicitly.`);
  const portfolio: PortfolioSpec = {
    id: options.id ?? 'portfolio', name: options.name ?? 'My portfolio',
    holdings: [...values].map(([symbol, value]) => ({ symbol, weight: value / scale })),
    ...(options.mode === 'market_value' ? { marketValues: Object.fromEntries(values) } : {}),
  };
  return {
    portfolio, unknownSymbols: [...values.keys()].filter(symbol => !isKnownSymbol(symbol)), mergedSymbols: [...mergedSymbols],
    ...(options.mode === 'market_value' ? { marketValues: Object.fromEntries(values), totalMarketValue: total } : {}),
  };
}
