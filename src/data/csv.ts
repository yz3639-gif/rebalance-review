import Papa from 'papaparse';
import { DataValidationError } from './validation';

export const MAX_CSV_BYTES = 20 * 1024 * 1024;
export const MAX_CSV_ROWS = 250_000;
export interface CsvInspection { headers: string[]; rows: Record<string, string>[] }

/** Parse as arrays first so duplicate headers and unsafe object keys cannot silently overwrite data. */
export function csvRows(text: string): string[][] {
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES) throw new DataValidationError('CSV exceeds the 20 MB local import limit.');
  if (!text.trim()) throw new DataValidationError('The input is empty.');
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    skipEmptyLines: 'greedy', dynamicTyping: false,
    delimitersToGuess: [',', '\t', ';', '|'],
  });
  const hardErrors = parsed.errors.filter(error => error.code !== 'UndetectableDelimiter');
  if (hardErrors.length) throw new DataValidationError(hardErrors.map(error => `CSV row ${(error.row ?? 0) + 1}: ${error.message}`));
  if (parsed.data.length > MAX_CSV_ROWS + 1) throw new DataValidationError(`CSV exceeds ${MAX_CSV_ROWS.toLocaleString()} data rows.`);
  return parsed.data.map(row => row.map(value => value.trim()));
}

export function inspectCsv(text: string): CsvInspection {
  const rows = csvRows(text);
  const headers = rows[0];
  if (!headers?.length || headers.some(header => !header)) throw new DataValidationError('Every CSV column needs a nonempty header.');
  if (new Set(headers.map(header => header.toLowerCase())).size !== headers.length) throw new DataValidationError('Duplicate CSV column names are not allowed. Rename them before importing.');
  if (headers.some(header => ['__proto__', 'prototype', 'constructor'].includes(header.toLowerCase()))) throw new DataValidationError('Reserved CSV column names are not allowed.');
  const records = rows.slice(1).map((row, index) => {
    if (row.length !== headers.length) throw new DataValidationError(`CSV row ${index + 2} has ${row.length} cells; expected ${headers.length}.`);
    const record: Record<string, string> = Object.create(null);
    headers.forEach((header, column) => { record[header] = row[column]; });
    return record;
  });
  if (!records.length) throw new DataValidationError('CSV contains headers but no data rows.');
  return { headers, rows: records };
}

export function requiredColumn(headers: string[], name: string | undefined, fallback: string): string {
  const requested = name ?? fallback;
  const column = headers.find(header => header === requested) ?? headers.find(header => header.toLowerCase() === requested.toLowerCase());
  if (!column) throw new DataValidationError(`Missing column “${requested}”. Choose a matching column in the mapping controls.`);
  return column;
}

/** Spreadsheet formula neutralization; quote escaping remains the CSV writer's responsibility. */
export function safeCsvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /^[\s\u0000-\u001f\u007f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
}

export function exportSafeCsv(rows: unknown[][]): string {
  return Papa.unparse(rows.map(row => row.map(safeCsvCell)), { newline: '\r\n' });
}
