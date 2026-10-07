import { describe, expect, it } from 'vitest';
import { createSyntheticDemo } from '../src/data';
import { computeReview } from '../src/engine';
import { breakLongTokens, createPdfSnapshot, historyChartOption, methodNotes, pdfMode, portfolioRows } from '../src/pdf/model';
import type { PdfInput } from '../src/pdf/model';

function input(): PdfInput {
  const d = createSyntheticDemo({ observations: 530 });
  const spec = { ...d, frequency: 'monthly' as const, costBps: 5, initialNav: 10000, cashReturnConfirmed: true, partialCoverageConfirmed: false };
  const { dataset, ...context } = spec;
  return { context: { ...context, manifest: dataset.manifest }, result: computeReview(spec), rationale: '降低集中度，同时保留长期投资计划。\nAccept lower concentration.', nextReview: '2099-01-01' };
}
describe('PDF permission boundary and frozen report', () => {
  it('wraps long Chinese and identifier tokens without losing or reordering characters', () => {
    const input = '保留完整中文理由'.repeat(700) + '\n' + 'W'.repeat(500);
    const rendered = breakLongTokens(input);
    expect(rendered.replaceAll('\n', '')).toBe(input.replaceAll('\n', ''));
    expect(rendered.split('\n').every(line => Array.from(line).length <= 50)).toBe(true);
    expect(breakLongTokens('Ordinary English text.\nPreserve paragraph.')).toBe('Ordinary English text.\nPreserve paragraph.');
  });
  it('freezes an independent snapshot without raw prices or dataset arrays', () => {
    const i = input(), snapshot = createPdfSnapshot(i);
    expect(snapshot.mode).toBe('full');
    i.rationale = 'changed'; i.context.a.holdings[0].weight = .99; i.result.history.a.nav[0] = -100;
    expect(snapshot.rationale).toContain('降低集中度');
    expect(snapshot.a.holdings[0].weight).not.toBe(.99);
    expect(snapshot).not.toHaveProperty('dataset');
    if (snapshot.mode === 'full') expect(snapshot.result.history.a.nav[0]).toBeGreaterThan(0);
  });
  it('decision-only export excludes source, derived results, dates, coverage and chart arrays', () => {
    const i = input(); i.context.manifest.rights.export = false;
    const snapshot = createPdfSnapshot(i);
    expect(snapshot.mode).toBe('decision-only');
    expect(Object.keys(snapshot).sort()).toEqual(['a', 'archived', 'b', 'createdAt', 'id', 'mode', 'nextReview', 'rationale', 'settings']);
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain(i.context.manifest.source);
    expect(text).not.toContain('covariance'); expect(text).not.toContain('cagr');
    expect(text).not.toContain('coverage'); expect(text).not.toContain('prices');
    expect(snapshot.a).toEqual(i.context.a);
  });
  it('Tiingo source remains decision-only despite permissive flags', () => {
    const i = input(); i.context.manifest.retention = 'operation'; i.context.manifest.policy = 'tiingo-byok';
    expect(pdfMode(i.context)).toBe('decision-only');
    expect(createPdfSnapshot(i)).not.toHaveProperty('result');
  });
  it('user-declared operation-only raw data can explicitly permit derived PDF output', () => {
    const i = input(); i.context.manifest.retention = 'operation'; i.context.manifest.policy = 'user-declared';
    i.context.manifest.rights.rawPersistence = false;
    expect(pdfMode(i.context)).toBe('full');
    const snapshot = createPdfSnapshot(i);
    expect(snapshot).toHaveProperty('result'); expect(snapshot).not.toHaveProperty('dataset');
  });
  it('requires both dated source evidence and derived export rights for a full report', () => {
    const i = input(); i.context.manifest.rights.verifiedAt = '';
    expect(pdfMode(i.context)).toBe('decision-only');
  });
  it('requires a complete reason and valid next-review date', () => {
    const i = input();
    expect(() => createPdfSnapshot({ ...i, rationale: ' ' })).toThrow(/reason/);
    expect(() => createPdfSnapshot({ ...i, rationale: 'x'.repeat(5001) })).toThrow(/5,000/);
    expect(() => createPdfSnapshot({ ...i, nextReview: '2025-02-30' })).toThrow(/date/);
    expect(() => createPdfSnapshot({ ...i, nextReview: '2020-01-01' })).toThrow(/date/);
  });
  it('preserves past next-review dates when explicitly exporting an archive', () => {
    const snapshot = createPdfSnapshot({ ...input(), archived: true, nextReview: '2020-01-01' });
    expect(snapshot.nextReview).toBe('2020-01-01'); expect(snapshot.archived).toBe(true);
  });
  it('preserves original archive creation separately from its new export date',()=>{
    const snapshot=createPdfSnapshot({...input(),archived:true,createdAt:'2024-05-01T14:30:00.000Z',nextReview:'2024-06-01'},new Date('2026-10-06T12:00:00Z'));
    expect(snapshot.createdAt).toBe('2026-10-06T12:00:00.000Z');expect(snapshot.reviewCreatedAt).toBe('2024-05-01T14:30:00.000Z');expect(snapshot.nextReview).toBe('2024-06-01');
  });
  it('freezes acquisition, catalog and recorded versions only for a full report',()=>{
    const i=input();i.context.manifest.acquisition={requestedStart:i.result.start,requestedEnd:i.result.end,assets:[{symbol:'VTI',firstDate:i.result.start,lastDate:i.result.end,observations:i.result.observations+1}]};
    i.context.catalog={version:'catalog-test',asOf:'2026-10-05',assets:[{symbol:'VTI',name:'Verified name at review time',sourceUrl:'https://example.org',identity:'verified'}]};i.versions={app:'1.2.0',engine:'1.2.0',method:'lw-ledger-1'};
    const snapshot=createPdfSnapshot(i);i.context.catalog.assets[0].name='Later name';
    if(snapshot.mode!=='full')throw new Error('Expected full report');
    expect(snapshot.catalog?.assets[0].name).toBe('Verified name at review time');expect(snapshot.manifest.acquisition?.assets).toHaveLength(1);expect(snapshot.versions).toEqual(i.versions);
    i.context.manifest.rights.export=false;const decision=createPdfSnapshot(i);expect(decision).not.toHaveProperty('catalog');expect(decision).not.toHaveProperty('versions');expect(decision).not.toHaveProperty('manifest');
  });
  it('decision-only holdings do not use derived exclusions, while full reports retain them', () => {
    const i = input(); i.context.a.holdings.push({ symbol: 'UNSUPPORTED', weight: 0.1 });
    const full = createPdfSnapshot(i);
    expect(portfolioRows(full).find(r => r[0] === 'UNSUPPORTED')?.at(-1)).toBe('Excluded from analysis');
    i.context.manifest.rights.export = false;
    expect(portfolioRows(createPdfSnapshot(i)).find(r => r[0] === 'UNSUPPORTED')?.at(-1)).toBe('');
  });
  it('shares all financial chart points without downsampling or recomputation', () => {
    const r = input().result, option = historyChartOption(r.history);
    expect(option.series[0].data).toEqual(r.history.a.nav);
    expect(option.series[1].data).toEqual(r.history.b.nav);
    expect(option.xAxis.data).toEqual(r.history.a.dates);
  });
  it('cash methodology describes assumptions rather than a covariance estimate', () => {
    const notes = methodNotes('cash_zero').join(' ');
    expect(notes).toContain('No market prices or observed returns');
    expect(notes).not.toContain('Ledoit-Wolf');
  });
});
