import marketCatalog from './market-catalog.json';

export interface AllocationDraftRow { symbol: string; a: string; b: string }
export type AllocationRow = AllocationDraftRow;
export type AllocationSide = 'a' | 'b';
export type AllocationPresetId = 'core' | 'defensive' | 'unchanged';
export interface AllocationDraftError {
  rowIndex: number | null;
  field: 'symbol' | 'a' | 'b' | 'totalA' | 'totalB' | 'rows';
  message: string;
}
export interface AllocationValidation {
  valid: boolean;
  /** Empty on invalid drafts; both-zero rows are omitted by default, without changing the draft. */
  symbols: string[];
  weightsA: number[];
  weightsB: number[];
  /** Percent totals, not fractions. Null means at least one percentage cannot be interpreted. */
  totals: { a: number | null; b: number | null };
  errors: AllocationDraftError[];
}

const MAX_NONCASH = 50;
const TOTAL_TOLERANCE_PERCENT = 1e-8;
// Match the numerical engines after division as well: percentage and fraction sums can round differently.
const TOTAL_TOLERANCE_FRACTION = 1e-10;
const CATALOG_SYMBOLS: ReadonlySet<string> = new Set(marketCatalog.assets.map(asset => asset.symbol));
const DEFAULT_A = { SPY: '40', VXUS: '20', BND: '20', GLD: '8', IEF: '7', CASH: '5' };
const TARGETS: Record<'core' | 'defensive', Record<string, string>> = {
  core: { SPY: '30', VXUS: '18', BND: '25', GLD: '12', IEF: '10', CASH: '5' },
  defensive: { SPY: '20', VXUS: '10', BND: '30', GLD: '10', IEF: '15', CASH: '15' },
};

/** Decimal and scientific decimal notation are accepted; blank/hex/Infinity are not numbers here. */
function percentage(text: unknown): number | null {
  if (typeof text !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim())) return null;
  const value = Number(text.trim());
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function canonicalSymbol(symbol: unknown): symbol is string {
  return typeof symbol === 'string' && /^[A-Z0-9][A-Z0-9.\-]{0,31}$/.test(symbol);
}

export function createDefaultAllocationDraft(): AllocationDraftRow[] {
  return Object.entries(DEFAULT_A).map(([symbol, a]) => ({ symbol, a, b: TARGETS.core[symbol] }));
}
export const createDefaultAllocation = createDefaultAllocationDraft;

/** Normalize only a valid percentage on blur; preserve incomplete or invalid input for correction. */
export function normalizePercentageDraft(text: string): string {
  const value = percentage(text);
  return value === null ? text : String(value);
}
export const normalizeWeightInput = normalizePercentageDraft;

/** Validate without changing weights, resolving unknown assets, filling blanks, or normalizing totals. */
export function validateAllocationDraft(
  rows: readonly AllocationDraftRow[],
  catalogSymbols: Iterable<string> = CATALOG_SYMBOLS,
  options: { includeZeroRows?: boolean } = {},
): AllocationValidation {
  const errors: AllocationDraftError[] = [];
  const result: AllocationValidation = { valid: false, symbols: [], weightsA: [], weightsB: [], totals: { a: null, b: null }, errors };
  if (!Array.isArray(rows) || !rows.length) {
    errors.push({ rowIndex: null, field: 'rows', message: 'Add at least one asset or CASH.' });
    return result;
  }
  let known: Set<string>;
  try { known = new Set(catalogSymbols); }
  catch { errors.push({ rowIndex: null, field: 'rows', message: 'The asset catalog is unavailable. Try again before applying the draft.' }); return result; }
  if (rows.length > MAX_NONCASH + 1 || rows.filter(row => row?.symbol !== 'CASH').length > MAX_NONCASH) {
    errors.push({ rowIndex: null, field: 'rows', message: 'A comparison supports at most 50 different noncash assets plus CASH, including zero-weight rows.' });
  }
  const seen = new Set<string>();
  const values: { a: number | null; b: number | null }[] = [];
  rows.forEach((row, rowIndex) => {
    const symbol = row?.symbol;
    if (!canonicalSymbol(symbol)) {
      errors.push({ rowIndex, field: 'symbol', message: 'Choose a canonical uppercase ticker, or CASH; leading/trailing spaces are not accepted.' });
    } else {
      if (seen.has(symbol)) errors.push({ rowIndex, field: 'symbol', message: `${symbol} occurs more than once. Merge or remove the duplicate row.` });
      seen.add(symbol);
      if (symbol !== 'CASH' && !known.has(symbol)) errors.push({ rowIndex, field: 'symbol', message: `${symbol} is not in the available ETF catalog.` });
    }
    const parsed = { a: percentage(row?.a), b: percentage(row?.b) };
    values.push(parsed);
    for (const side of ['a', 'b'] as const) if (parsed[side] === null) {
      errors.push({ rowIndex, field: side, message: `${side.toUpperCase()} weight for ${canonicalSymbol(symbol) ? symbol : `row ${rowIndex + 1}`} must be a finite percentage from 0 to 100. Blank values are not zero.` });
    }
  });
  for (const side of ['a', 'b'] as const) {
    if (values.some(value => value[side] === null)) continue;
    const total = values.reduce((sum, value) => sum + value[side]!, 0);
    const fractionalTotal = values.reduce((sum, value) => sum + value[side]! / 100, 0);
    result.totals[side] = total;
    if (Math.abs(total - 100) > TOTAL_TOLERANCE_PERCENT || Math.abs(fractionalTotal - 1) > TOTAL_TOLERANCE_FRACTION) errors.push({ rowIndex: null,
      field: side === 'a' ? 'totalA' : 'totalB', message: `${side.toUpperCase()} weights must total 100%; current total is ${total}%.` });
  }
  if (errors.length) return result;
  const selected = rows.flatMap((row, index) => options.includeZeroRows || values[index].a !== 0 || values[index].b !== 0 ? [{ row, value: values[index] }] : []);
  result.valid = true;
  result.symbols = selected.map(({ row }) => row.symbol);
  // Divide by 100 only: a near-100 total within tolerance is never silently rescaled to exactly 1.
  result.weightsA = selected.map(({ value }) => value.a! / 100);
  result.weightsB = selected.map(({ value }) => value.b! / 100);
  return result;
}

/** B-only action: preserve every A draft and existing row, and add any missing preset assets at A=0. */
export function applyAllocationPreset(rows: readonly AllocationDraftRow[], id: AllocationPresetId): AllocationDraftRow[] {
  if (id === 'unchanged') return rows.map(row => ({ ...row, b: row.a }));
  if (id !== 'core' && id !== 'defensive') throw new Error('Unknown allocation preset.');
  const target = TARGETS[id];
  const updated = rows.map(row => ({ ...row, b: Object.hasOwn(target, row.symbol) ? target[row.symbol] : '0' }));
  const existing = new Set(rows.map(row => row.symbol));
  for (const [symbol, b] of Object.entries(target)) if (!existing.has(symbol)) updated.push({ symbol, a: '0', b });
  return updated;
}

/** Explicitly fill one side's remaining allocation with cash; the other side is untouched. */
export function balanceAllocationWithCash(rows: readonly AllocationDraftRow[], side: AllocationSide): { rows: AllocationDraftRow[]; error?: string } {
  const unchanged = Array.isArray(rows) ? rows.map(row => ({ ...row })) : [];
  const fail = (error: string) => ({ rows: unchanged, error });
  if (side !== 'a' && side !== 'b') return fail('Choose A or B to fill the cash balance.');
  if (!Array.isArray(rows)) return fail('Allocation rows are unavailable.');
  if (rows.some(row => !row || !canonicalSymbol(row.symbol)) || new Set(rows.map(row => row.symbol)).size !== rows.length) {
    return fail('Correct ticker formatting and duplicate rows before filling cash.');
  }
  const noncash = rows.filter(row => row.symbol !== 'CASH');
  if (noncash.length > MAX_NONCASH) return fail('Keep at most 50 noncash asset rows before filling cash.');
  const weights = noncash.map(row => percentage(row[side]));
  if (weights.some(value => value === null)) return fail(`Correct every noncash ${side.toUpperCase()} percentage before filling cash; blank values are not zero.`);
  const total = weights.reduce<number>((sum, value) => sum + value!, 0);
  if (total > 100) return fail(`${side.toUpperCase()} noncash weights exceed 100%. Reduce them before filling cash.`);
  // This user-invoked action changes only cash; rounding removes binary subtraction noise below 1e-10 percentage points.
  const cashWeight = String(Math.round((100 - total) * 1e10) / 1e10);
  const existingCash = unchanged.find(row => row.symbol === 'CASH');
  if (existingCash) existingCash[side] = cashWeight;
  else unchanged.push({ symbol: 'CASH', a: side === 'a' ? cashWeight : '0', b: side === 'b' ? cashWeight : '0' });
  return { rows: unchanged };
}
