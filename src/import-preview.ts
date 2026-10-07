import { inspectCsv, finiteNumber, normalizeSymbol, isIsoDate } from './data';

export interface ImportDiagnostic { severity: 'error' | 'warning'; row?: number; column?: string; code: string; message: string }
export function rowDiagnostics(text: string, options: { kind: 'holdings' | 'long-prices' | 'wide-prices'; symbol?: string; value?: string; date?: string; percent?: boolean }): ImportDiagnostic[] {
  const { headers, rows } = inspectCsv(text);
  const issues: ImportDiagnostic[] = [];
  const check = (row: number, column: string, code: string, run: () => void) => {
    try { run(); } catch (error) { issues.push({ severity: 'error', row, column, code, message: error instanceof Error ? error.message : 'Invalid cell.' }); }
  };
  rows.forEach((cells, i) => {
    const row = i + 2;
    if (options.symbol && headers.includes(options.symbol)) check(row, options.symbol, 'invalid_symbol', () => { normalizeSymbol(cells[options.symbol!]); });
    if (options.date && headers.includes(options.date)) check(row, options.date, 'invalid_date', () => { if (!isIsoDate(cells[options.date!])) throw new Error('Use a real YYYY-MM-DD date.'); });
    const values = options.kind === 'wide-prices' ? headers.filter(h => h !== options.date) : options.value && headers.includes(options.value) ? [options.value] : [];
    for (const column of values) {
      const raw = cells[column];
      if (!raw && options.kind === 'wide-prices') continue;
      check(row, column, 'invalid_value', () => { const n = finiteNumber(options.percent ? raw.replace(/%$/, '') : raw, 'Value'); if (options.kind !== 'holdings' && n <= 0) throw new Error('Prices must be strictly positive.'); });
    }
  });
  return issues;
}
