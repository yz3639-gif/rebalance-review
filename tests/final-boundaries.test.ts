import { describe, expect, it } from 'vitest';
import { createCashAssumptionDataset, createSyntheticDemo, manifestRightsDecision } from '../src/data';
import { computeReview } from '../src/engine';
import { createPdfSnapshot } from '../src/pdf/model';
import { exportRecord, parseArchive, saveRecord, validateRecord } from '../src/records';
import type { Frequency, ReviewRecord, ReviewSpec } from '../src/types';

function marketRecord(): ReviewRecord {
  const demo = createSyntheticDemo({ observations: 600, endDate: '2025-12-31' });
  const settings = { frequency: 'monthly' as const, costBps: 5, initialNav: 10000, cashReturnConfirmed: true, partialCoverageConfirmed: false };
  const result = computeReview({ ...demo, ...settings });
  return { schemaVersion: 2, id: result.id, createdAt: '2026-10-06T12:00:00.000Z', rationale: 'Compare these allocations again after reviewing the trade-offs.', nextReview: '2027-01-02', a: demo.a, b: demo.b, manifest: demo.dataset.manifest, settings, result, dataset: demo.dataset };
}

describe('independent final archive and retention boundaries', () => {
  it('reads and exports a v1 snapshot without silently upgrading it, but refuses a new v1 save', async () => {
    const r = marketRecord(); r.schemaVersion = 1;
    expect(parseArchive(exportRecord(r)).schemaVersion).toBe(1);
    await expect(saveRecord(r)).rejects.toThrow(/Version 1 archives are read-only/);
  });

  it('allows separately authorized derived records from operation-only custom prices without raw history', () => {
    const r = marketRecord(); r.dataset = undefined;
    r.manifest.retention = 'operation'; r.manifest.policy = 'user-declared';
    r.manifest.rights.rawPersistence = false;
    expect(parseArchive(exportRecord(r)).result.history).toEqual(r.result.history);
    expect(() => exportRecord(r, true)).toThrow(/during a calculation|Raw history/);
  });

  it.each(['operation', 'session'] as const)('prevents %s raw history from entering archives despite permissive booleans', retention => {
    const r = marketRecord(); r.manifest.retention = retention; r.manifest.policy = 'user-declared';
    r.dataset!.manifest = structuredClone(r.manifest);
    expect(manifestRightsDecision(r.manifest, 'persistRaw').allowed).toBe(false);
    expect(manifestRightsDecision(r.manifest, 'exportRaw').allowed).toBe(false);
    expect(() => validateRecord(r)).toThrow();
  });

  it('keeps the Tiingo cap after dropping optional retention and enabling every permission', () => {
    const r = marketRecord(); r.manifest.policy = 'tiingo-byok'; delete r.manifest.retention; r.dataset = undefined;
    for (const action of ['persistRaw', 'persistDerived', 'exportRaw', 'exportDerived', 'publicDisplay'] as const) {
      expect(manifestRightsDecision(r.manifest, action).allowed).toBe(false);
    }
    expect(() => validateRecord(r)).toThrow(/calculation-only/);
    const pdf = createPdfSnapshot({ context: { ...r.settings, a: r.a, b: r.b, manifest: r.manifest }, result: r.result, rationale: r.rationale, nextReview: r.nextReview });
    expect(pdf.mode).toBe('decision-only');
    expect(pdf).not.toHaveProperty('result'); expect(pdf).not.toHaveProperty('manifest');
  });
});

describe('cash assumptions through engine, archive and PDF', () => {
  it.each(['monthly', 'quarterly', 'buy-hold'] satisfies Frequency[])('keeps every cash outcome zero at the maximum supported fee for %s', frequency => {
    const dataset = createCashAssumptionDataset('2023-01-03', '2025-12-31');
    const a = { id: 'a', name: 'Cash A', holdings: [{ symbol: 'CASH', weight: 1 }] };
    const b = { ...structuredClone(a), id: 'b', name: 'Cash B' };
    const spec: ReviewSpec = { a, b, dataset, frequency, costBps: 100, initialNav: 12345, cashReturnConfirmed: true, partialCoverageConfirmed: false };
    const result = computeReview(spec);
    for (const history of [result.history.a, result.history.b, result.delaySensitivity.a, result.delaySensitivity.b]) {
      expect(new Set(history.nav)).toEqual(new Set([12345]));
      for (const value of [history.totalReturn, history.cagr, history.volatility, history.maxDrawdown, history.fees, history.turnover, history.trades]) expect(Math.abs(value)).toBe(0);
    }
    for (const window of result.risk.windows) {
      expect(window.available).toBe(true); expect(window.covariance).toEqual([[0]]);
      expect(window.a).toEqual({ volatility: 0, contributions: { CASH: 0 }, relativeContributions: null });
    }
    const settings = { frequency, costBps: 100, initialNav: 12345, cashReturnConfirmed: true, partialCoverageConfirmed: false };
    const record: ReviewRecord = { schemaVersion: 2, id: result.id, createdAt: '2026-10-06T12:00:00.000Z', rationale: 'Review the explicit zero-return cash assumption.', nextReview: '2027-01-02', a, b, manifest: dataset.manifest, settings, result, dataset };
    const restored = parseArchive(exportRecord(record, true));
    expect(restored.schemaVersion).toBe(2); expect(restored.dataset!.symbols).toEqual([]);
    const pdf = createPdfSnapshot({ context: { ...settings, a, b, manifest: dataset.manifest }, result, rationale: record.rationale, nextReview: record.nextReview });
    expect(pdf.mode).toBe('full');
    if (pdf.mode === 'full') expect(pdf.manifest.basis).toBe('cash_zero');
  });
});
