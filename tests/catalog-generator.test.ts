import { describe, expect, it } from 'vitest';
import { parseDirectory, compareCatalog } from '../scripts/update-etf-catalog.mjs';
const header = 'Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares';
const footer = 'File Creation Time: 1006202615:41|||||||';
describe('official directory refresh parser', () => {
  it('accepts only ETF-flagged non-test issues and retains source provenance', () => {
    const result = parseDirectory([header, 'ABC|Example Fund|G|N|N|100|Y|N', 'STK|Common stock|G|N|N|100|N|N', 'TEST|Test fund|G|Y|N|100|Y|N', footer].join('\n'), 0);
    expect(result.assets).toEqual([{ symbol: 'ABC', name: 'Example Fund', exchange: 'Nasdaq', source: 0 }]);
    expect(result.fileCreatedAt).toBe('1006202615:41');
  });
  it('rejects malformed sources before replacement, including unknown flags and missing freshness', () => {
    expect(() => parseDirectory([header, 'ABC|Example Fund|G|N|N|100|?|N', footer].join('\n'), 0)).toThrow(/flag/);
    expect(() => parseDirectory([header, 'ABC|Example Fund|G|N|N|100|Y|N'].join('\n'), 0)).toThrow(/footer/);
    expect(() => parseDirectory([header, '../BAD|Example Fund|G|N|N|100|Y|N', footer].join('\n'), 0)).toThrow(/symbol/);
  });
  it('reports additions, removals and identity changes without mutating saved snapshots', () => {
    const previous = { assets: [{ symbol: 'AAA', name: 'A' }, { symbol: 'OLD', name: 'Old' }] };
    const next = { assets: [{ symbol: 'AAA', name: 'Renamed' }, { symbol: 'NEW', name: 'New' }] };
    expect(compareCatalog(previous, next)).toEqual({ added: ['NEW'], removed: ['OLD'], changed: ['AAA'] });
    expect(previous.assets[0].name).toBe('A');
  });
});
