import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { DatasetManifest } from '../src/types';
import { assertRights, createSyntheticDemo, csvRows, currentUsDate, DataValidationError, ETF_REGISTRY, exportSafeCsv, hasCredentialMaterial, inspectCsv, isIsoDate, parseHoldings, parseMarketCsv, rightsDecision, safeCsvCell, SUPPORTED_SYMBOLS, syntheticMarketCsv, TIINGO_STATUS, unknownRights, validateManifest } from '../src/data';

function manifest(): DatasetManifest {
  return { id: 'file-1', source: 'User-supplied licensed test fixture', currency: 'USD', basis: 'adjusted_close', asOf: '2025-01-10', synthetic: false, rights: { display: true, rawPersistence: false, derivedPersistence: false, export: false, publicDisplay: false, evidence: 'Authorized in-session analysis only; test fixture.', verifiedAt: '2025-01-10' } };
}

describe('strict holdings ingestion', () => {
  it('reads mapped USD values, preserves unsupported holdings, and attaches value provenance', () => {
    const result = parseHoldings('Ticker,Amount\nVTI,750\nOTHER,200\nUSD CASH,50', { mode: 'market_value', columns: { symbol: 'Ticker', value: 'Amount' } });
    expect(result.portfolio.holdings).toEqual([{ symbol: 'VTI', weight: .75 }, { symbol: 'OTHER', weight: .2 }, { symbol: 'CASH', weight: .05 }]);
    expect(result.unknownSymbols).toEqual(['OTHER']);
    expect(result.portfolio.marketValues).toEqual({ VTI: 750, OTHER: 200, CASH: 50 });
    expect(result.totalMarketValue).toBe(1000);
  });
  it('accepts decimal and percent weights only in an explicit unit', () => {
    expect(parseHoldings('symbol,weight\nVTI,60%\nBND,40%', { mode: 'weight', weightUnit: 'percent' }).portfolio.holdings[0].weight).toBe(.6);
    expect(parseHoldings('VTI .6\nBND .4', { mode: 'weight', weightUnit: 'decimal', hasHeader: false }).portfolio.holdings[1].weight).toBe(.4);
    expect(() => parseHoldings('symbol,weight\nVTI,1', { mode: 'weight' })).toThrow(/Explicitly choose/);
    expect(() => parseHoldings('symbol,weight\nVTI,100%', { mode: 'weight', weightUnit: 'decimal' })).toThrow(/percent sign/);
  });
  it('requires duplicate confirmation and merges cash aliases only when confirmed', () => {
    const text = 'symbol,weight\nVTI,80\nUSD CASH,10\nCASH,10';
    expect(() => parseHoldings(text, { mode: 'weight', weightUnit: 'percent' })).toThrow(/Duplicate holding CASH/);
    const result = parseHoldings(text, { mode: 'weight', weightUnit: 'percent', confirmMergeDuplicates: true });
    expect(result.portfolio.holdings).toEqual([{ symbol: 'VTI', weight: .8 }, { symbol: 'CASH', weight: .2 }]);
    expect(result.mergedSymbols).toEqual(['CASH']);
  });
  it.each(['-1', 'Infinity', 'NaN', '1e309', '=SUM(1)', '$100', '1,000', ''])('rejects invalid number %j', raw => {
    expect(() => parseHoldings(`symbol,market_value\nVTI,"${raw}"`, { mode: 'market_value' })).toThrow(DataValidationError);
  });
  it('does not normalize an underfunded weight input or invent cash', () => {
    expect(() => parseHoldings('VTI,80', { mode: 'weight', weightUnit: 'percent', hasHeader: false })).toThrow(/Weights must total/);
  });
  it('supports all cash and zero allocations but not an empty portfolio', () => {
    expect(parseHoldings('CASH,100', { mode: 'weight', weightUnit: 'percent', hasHeader: false }).portfolio.holdings).toEqual([{ symbol: 'CASH', weight: 1 }]);
    expect(() => parseHoldings('CASH,0', { mode: 'market_value', hasHeader: false })).toThrow(/greater than zero/);
  });
  it('enforces the independent 50-asset capacity on unknown names', () => {
    const text = Array.from({ length: 51 }, (_, i) => `ETF${i},1`).join('\n');
    expect(() => parseHoldings(text, { mode: 'market_value', hasHeader: false })).toThrow(/50 noncash/);
  });
  it.each(['weight', 'market_value'] as const)('retains a dormant 51st row alongside 50 active assets in %s imports', mode => {
    const text = [...Array.from({ length: 50 }, (_, i) => `ETF${i},2`), 'DORMANT,0'].join('\n');
    const options = { mode, weightUnit: 'percent' as const, hasHeader: false };
    const result = parseHoldings(text, options);
    expect(result.portfolio.holdings).toHaveLength(51);
    expect(result.portfolio.holdings.at(-1)).toEqual({ symbol: 'DORMANT', weight: 0 });
    expect(result.portfolio.holdings.filter(holding => holding.weight > 0)).toHaveLength(50);
    if (mode === 'market_value') expect(result.portfolio.marketValues?.DORMANT).toBe(0);
    expect(() => parseHoldings(`${text}\nANOTHER,0`, options)).toThrow(/51 holding rows/);
    // The explicit merge applies before the independent saved-row limit.
    const merged = parseHoldings(`${text}\nDORMANT,0`, { ...options, confirmMergeDuplicates: true });
    expect(merged.portfolio).toEqual(result.portfolio);
    expect(merged.mergedSymbols).toEqual(['DORMANT']);
  });
  it('normalizes arbitrary nonnegative market values without changing their ratios', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 20 }), values => {
      const text = values.map((value, index) => `ETF${index},${value}`).join('\n');
      const result = parseHoldings(text, { mode: 'market_value', hasHeader: false });
      expect(result.portfolio.holdings.reduce((sum, holding) => sum + holding.weight, 0)).toBeCloseTo(1, 12);
      expect(result.totalMarketValue).toBe(values.reduce((sum, value) => sum + value, 0));
    }), { numRuns: 100 });
  });
});

describe('market CSV correctness and provenance', () => {
  const long = 'date,symbol,adjusted_close\n2025-01-02,VTI,100\n2025-01-03,VTI,101\n2025-01-02,BND,90\n2025-01-03,BND,91';
  it('long and wide inputs produce the same ordered matrix', () => {
    const a = parseMarketCsv(long, { format: 'long', manifest: manifest() });
    const b = parseMarketCsv('Date,VTI,BND\n2025-01-03,101,91\n2025-01-02,100,90', { format: 'wide', manifest: manifest() });
    expect(a).toEqual(b);
    expect(a.symbols).toEqual(['BND', 'VTI']);
  });
  it('supports mapping, TRI and cutoff derivation', () => {
    const m = manifest(); m.asOf = ''; m.basis = 'total_return_index';
    const result = parseMarketCsv('Day,Asset,TRI\n2025-01-02,VTI,1\n2025-01-03,VTI,1.1', { format: 'long', columns: { date: 'Day', symbol: 'Asset', value: 'TRI' }, manifest: m });
    expect(result.manifest.asOf).toBe('2025-01-03');
    expect(result.manifest.basis).toBe('total_return_index');
  });
  it.each(['2025-02-29', '2024-02-30', '2025-13-01', '2025-01-00', '01/02/2025', '2025-1-2', '2025-01-02T00:00:00Z', '2099-01-01'])('blocks invalid or future date %s', date => {
    expect(() => parseMarketCsv(`date,VTI\n${date},1\n2025-01-03,2`, { format: 'wide', manifest: manifest() })).toThrow(DataValidationError);
  });
  it('accepts a real leap day', () => { expect(isIsoDate('2024-02-29')).toBe(true); });
  it('blocks conflicts regardless of confirmation', () => {
    expect(() => parseMarketCsv(`${long}\n2025-01-02,VTI,999`, { format: 'long', manifest: manifest(), confirmIdenticalDuplicates: true })).toThrow(/Conflicting/);
  });
  it('requires explicit confirmation for identical duplicate observations', () => {
    const text = `${long}\n2025-01-02,VTI,100`;
    expect(() => parseMarketCsv(text, { format: 'long', manifest: manifest() })).toThrow(/Identical duplicate/);
    expect(parseMarketCsv(text, { format: 'long', manifest: manifest(), confirmIdenticalDuplicates: true }).dates).toHaveLength(2);
  });
  it('does not splice incomplete duplicate wide rows', () => {
    const text = 'date,VTI,BND\n2025-01-02,100,\n2025-01-02,,90\n2025-01-03,101,91';
    expect(() => parseMarketCsv(text, { format: 'wide', manifest: manifest(), confirmIdenticalDuplicates: true })).toThrow(/Combining incomplete/);
  });
  it('blocks internal missing values without interpolation', () => {
    const text = 'date,VTI,BND\n2025-01-02,100,90\n2025-01-03,101,\n2025-01-06,102,92';
    expect(() => parseMarketCsv(text, { format: 'wide', manifest: manifest() })).toThrow(/Internal missing price/);
  });
  it('does not silently drop an explicit wide row with every selected price missing', () => {
    const text = 'date,VTI,BND\n2025-01-03,100,90\n2025-01-04,,\n2025-01-06,101,91';
    expect(() => parseMarketCsv(text, { format: 'wide', manifest: manifest(), selectedSymbols: ['VTI', 'BND'] })).toThrow(/Internal missing price/);
  });
  it('permits different inception boundaries and exposes the common window', () => {
    const text = 'date,VTI,BND\n2025-01-02,100,\n2025-01-03,101,91\n2025-01-06,102,92';
    expect(parseMarketCsv(text, { format: 'wide', manifest: manifest() }).dates).toEqual(['2025-01-03', '2025-01-06']);
  });
  it.each(['0', '-10', 'Infinity', 'NaN', '1e309', '=1+1'])('blocks invalid price %s', price => {
    expect(() => parseMarketCsv(`date,VTI\n2025-01-02,${price}\n2025-01-03,1`, { format: 'wide', manifest: manifest() })).toThrow(DataValidationError);
  });
  it('retains supplied metadata and does not invent missing requested series', () => {
    const result = parseMarketCsv(long, { format: 'long', manifest: manifest(), selectedSymbols: ['VTI', 'UNKNOWN', 'CASH'] });
    expect(result.symbols).toEqual(['VTI']);
    expect(result.manifest).toEqual(manifest());
  });
  it('does not let an irrelevant series change the selected calendar', () => {
    const text = 'date,symbol,adjusted_close\n2025-01-03,VTI,100\n2025-01-06,VTI,101\n2025-01-04,OTHER,40';
    const result = parseMarketCsv(text, { format: 'long', manifest: manifest(), selectedSymbols: ['VTI'] });
    expect(result.dates).toEqual(['2025-01-03', '2025-01-06']);
    expect(result.symbols).toEqual(['VTI']);
  });
  it('rejects ambiguous duplicate headers, reserved keys and extra cells', () => {
    expect(() => inspectCsv('date,DATE\n1,2')).toThrow(/Duplicate/);
    expect(() => inspectCsv('__proto__,value\nx,1')).toThrow(/Reserved/);
    expect(() => inspectCsv('a,b\n1,2,3')).toThrow(/3 cells/);
  });
  it('blocks real histories before ETF inception instead of accepting spliced predecessors', () => {
    const text = 'date,VXUS\n2010-01-04,100\n2010-01-05,101';
    expect(() => parseMarketCsv(text, { format: 'wide', manifest: manifest() })).toThrow(/before its issuer-reported inception 2011-01-26/);
  });
  it('unsupported requested prices do not shorten the covered portfolio window', () => {
    const text = 'date,symbol,adjusted_close\n2025-01-02,VTI,100\n2025-01-03,VTI,101\n2025-01-06,VTI,102\n2025-01-06,OTHER,40';
    const result = parseMarketCsv(text, { format: 'long', manifest: manifest(), selectedSymbols: ['VTI', 'OTHER'] });
    expect(result.dates).toEqual(['2025-01-02', '2025-01-03', '2025-01-06']);
    expect(result.symbols).toEqual(['VTI']);
  });
  it('rejects raw close and unconfirmed USD assumptions', () => {
    expect(() => parseMarketCsv(long, { format: 'long', manifest: { ...manifest(), basis: 'close' } as unknown as DatasetManifest })).toThrow(/basis/);
    expect(() => parseMarketCsv(long, { format: 'long', manifest: { ...manifest(), currency: 'EUR' } as unknown as DatasetManifest })).toThrow(/currency/);
  });
});

describe('permissions, export and synthetic isolation', () => {
  it.each([
    ['2026-10-06T02:00:00Z', '2026-10-05'],
    ['2026-10-06T05:00:00Z', '2026-10-06'],
    ['2026-01-06T04:30:00Z', '2026-01-05'],
    ['2026-07-06T04:30:00Z', '2026-07-06'],
  ])('uses New York civil dates across midnight and daylight saving (%s)', (instant, expected) => {
    expect(currentUsDate(new Date(instant))).toBe(expected);
  });
  it.each([
    'https://example.test/data?token=fixture-secret',
    'https://example.test/data?API_KEY=fixture-secret',
    'https://user:fixture-secret@example.test/data',
    'Authorization: Bearer fixture-secret',
    'https://example.test/data?api_token=fixture-secret',
    'https://example.test/data?access_key=fixture-secret',
    'https://example.test/data?%61%75%74%68=fixture-secret',
    'https://example.test/data?%2561%2575%2574%2568=fixture-secret',
    '{"api_token":"fixture-secret"}',
  ])('blocks credential-bearing metadata without repeating secrets (%s)', source => {
    expect(hasCredentialMaterial(source)).toBe(true);
    const bad = { ...manifest(), source };
    expect(() => validateManifest(bad)).toThrow(/Remove credentials/);
    expect(() => assertRights(bad, 'display')).toThrow(/Remove credentials/);
    expect(rightsDecision({ ...manifest().rights, evidence: source }, 'display').allowed).toBe(false);
    try { validateManifest(bad); } catch (error) { expect(String(error)).not.toContain('fixture-secret'); }
  });
  it('permits public URLs with ordinary noncredential parameters', () => {
    expect(hasCredentialMaterial('Issuer page https://example.test/data?source_caller=ui&siteEntryPassthrough=true')).toBe(false);
  });
  it('denies every action for unknown or undated rights', () => {
    for (const action of ['display', 'persistRaw', 'persistDerived', 'exportRaw', 'exportDerived', 'publicDisplay'] as const) {
      expect(rightsDecision(unknownRights(), action).allowed).toBe(false);
      expect(rightsDecision({ ...createSyntheticDemo().dataset.manifest.rights, evidence: '' }, action).allowed).toBe(false);
    }
  });
  it('keeps session display distinct from storing and exporting results', () => {
    const rights = manifest().rights;
    expect(rightsDecision(rights, 'display').allowed).toBe(true);
    expect(rightsDecision(rights, 'persistDerived').allowed).toBe(false);
    expect(rightsDecision({ ...rights, export: true }, 'exportDerived').allowed).toBe(false);
    expect(rightsDecision({ ...rights, export: true, derivedPersistence: true }, 'exportDerived').allowed).toBe(true);
    expect(rightsDecision({ ...rights, export: true, derivedPersistence: true }, 'exportRaw').allowed).toBe(false);
  });
  it('does not allow displaying an unlicensed market file', () => {
    expect(() => parseMarketCsv('date,VTI\n2025-01-02,1\n2025-01-03,2', { format: 'wide', manifest: { ...manifest(), rights: unknownRights() } })).toThrow(/permissions are unknown/);
  });
  it.each(['=HYPERLINK("evil")', '+cmd', '-cmd', '@SUM(1)', '\t=cmd', '  =cmd', '\r@cmd', '\n=cmd'])('neutralizes spreadsheet formula %j', value => {
    expect(safeCsvCell(value).startsWith("'")).toBe(true);
    expect(csvRows(exportSafeCsv([['value'], [value]]))[1][0].startsWith("'")).toBe(true);
  });
  it('round-trips ordinary quotes and delimiters without dropping content', () => {
    const text = 'Example, "quoted"';
    expect(csvRows(exportSafeCsv([['name'], [text]]))[1][0]).toBe(text);
  });
  it('documents opt-in BYOK and restricted output capability', () => { expect(TIINGO_STATUS.enabled).toBe(true); expect(TIINGO_STATUS.reason).toMatch(/no shared key/); expect(TIINGO_STATUS.termsUrl).toBe('https://app.tiingo.com/tos/'); });
  it('generates a reproducible labeled demo independent of real market data', () => {
    const a = createSyntheticDemo(); const b = createSyntheticDemo();
    expect(a).toEqual(b);
    expect(a.dataset.dates).toHaveLength(1600);
    expect(a.dataset.symbols).toHaveLength(16);
    expect(a.dataset.manifest.synthetic).toBe(true);
    expect(a.dataset.prices.flat().every(value => Number.isFinite(value) && value > 0)).toBe(true);
    expect(ETF_REGISTRY.every(entry => entry.priceBasis === 'requires-dataset-verification')).toBe(true);
    expect(SUPPORTED_SYMBOLS.length).toBeGreaterThan(1000);
  });
  it('generated long and wide examples round-trip to identical prices', () => {
    const m = createSyntheticDemo().dataset.manifest;
    const wide = parseMarketCsv(syntheticMarketCsv('wide'), { format: 'wide', manifest: m });
    const long = parseMarketCsv(syntheticMarketCsv('long'), { format: 'long', manifest: m });
    expect(wide).toEqual(long);
  });
});
