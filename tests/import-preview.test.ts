import { describe, expect, it } from 'vitest';
import { rowDiagnostics } from '../src/import-preview';

describe('reviewable CSV diagnostics', () => {
  it('finds multiple invalid holding cells using the user-mapped column and physical row', () => {
    const issues=rowDiagnostics('ticker,allocation\nSPY,nope\nBND,-4\n,30',{kind:'holdings',symbol:'ticker',value:'allocation'});
    expect(issues.map(i=>[i.row,i.column])).toEqual([[2,'allocation'],[3,'allocation'],[4,'ticker']]);
  });
  it('checks every wide price column and distinguishes date failures', () => {
    const issues=rowDiagnostics('when,SPY,BND\n2025-02-30,100,0\n2025-03-03,NA,80',{kind:'wide-prices',date:'when'});
    expect(issues.map(i=>[i.row,i.column,i.code])).toEqual([[2,'when','invalid_date'],[2,'BND','invalid_value'],[3,'SPY','invalid_value']]);
  });
  it('allows leading or trailing blank wide cells for the common-window validator to assess', () => {
    expect(rowDiagnostics('date,SPY,BND\n2025-03-03,100,',{kind:'wide-prices',date:'date'})).toEqual([]);
  });
  it('blocks empty long price observations and permits percentage notation only when selected', () => {
    expect(rowDiagnostics('date,symbol,adjusted_close\n2025-03-03,SPY,',{kind:'long-prices',date:'date',symbol:'symbol',value:'adjusted_close'})).toHaveLength(1);
    expect(rowDiagnostics('symbol,weight\nSPY,100%',{kind:'holdings',symbol:'symbol',value:'weight',percent:true})).toEqual([]);
    expect(rowDiagnostics('symbol,weight\nSPY,100%',{kind:'holdings',symbol:'symbol',value:'weight',percent:false})).toHaveLength(1);
  });
});
