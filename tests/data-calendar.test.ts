import { describe, expect, it } from 'vitest';
import { assertCompleteDailySessions, calendarMaintenanceStatus, createSyntheticDemo, expectedUsEquitySessions, parseMarketCsv } from '../src/data';

describe('bounded daily US equity session validation', () => {
  it('matches the official NYSE 2026 full-day holiday table', () => {
    const sessions = new Set(expectedUsEquitySessions('2026-01-01', '2026-12-31'));
    for (const date of ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25']) expect(sessions.has(date)).toBe(false);
    expect(sessions.has('2026-11-27')).toBe(true); // Early close is still a daily session.
    expect(sessions.has('2026-12-24')).toBe(true);
    expect(sessions.size).toBe(251);
  });
  it('includes documented extraordinary market closures', () => {
    const sessions = new Set(expectedUsEquitySessions('1990-01-01', '2026-12-31'));
    for (const date of ['1994-04-27', '2001-09-11', '2001-09-12', '2001-09-13', '2001-09-14', '2004-06-11', '2007-01-02', '2012-10-29', '2012-10-30', '2018-12-05', '2025-01-09']) expect(sessions.has(date)).toBe(false);
    expect(sessions.has('2021-06-18')).toBe(true); // Juneteenth exchange closure began in 2022.
    expect(sessions.has('2022-06-20')).toBe(false);
    expect(sessions.has('2021-12-31')).toBe(true); // Saturday New Year does not close the prior year-end.
  });
  it('matches the official NYSE 2027 and 2028 holiday tables and includes early closes', () => {
    const byYear: Record<string, string[]> = {
      '2027': ['2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24'],
      '2028': ['2028-01-17', '2028-02-21', '2028-04-14', '2028-05-29', '2028-06-19', '2028-07-04', '2028-09-04', '2028-11-23', '2028-12-25'],
    };
    for (const [year, holidays] of Object.entries(byYear)) {
      const sessions = new Set(expectedUsEquitySessions(`${year}-01-01`, `${year}-12-31`));
      for (const day of holidays) expect(sessions.has(day)).toBe(false);
      expect(sessions.size).toBe(251);
    }
    const sessions = new Set(expectedUsEquitySessions('2027-01-01', '2028-12-31'));
    for (const day of ['2027-11-26', '2027-12-31', '2028-07-03', '2028-11-24']) expect(sessions.has(day)).toBe(true);
    expect(() => expectedUsEquitySessions('2028-12-29', '2029-01-02')).toThrow(/reviewed calendar update/);
  });
  it('warns within 90 days of expiry without invalidating in-range historical data', () => {
    expect(calendarMaintenanceStatus('2028-10-01')).toMatchObject({ status: 'current', daysRemaining: 91, message: null });
    expect(calendarMaintenanceStatus('2028-10-02')).toMatchObject({ status: 'expiring', daysRemaining: 90 });
    expect(calendarMaintenanceStatus('2028-12-31')).toMatchObject({ status: 'expiring', daysRemaining: 0 });
    expect(calendarMaintenanceStatus('2029-01-01')).toMatchObject({ status: 'expired', daysRemaining: -1 });
    expect(() => expectedUsEquitySessions('2028-12-28', '2028-12-29')).not.toThrow();
    expect(() => calendarMaintenanceStatus('2028-02-30')).toThrow(/valid ISO date/);
  });
  it('rejects common-to-all-symbols missing days and weekly input', () => {
    expect(() => assertCompleteDailySessions(['2025-01-02', '2025-01-06'], false)).toThrow(/missing 1 US trading session.*2025-01-03/);
    expect(() => assertCompleteDailySessions(['2025-01-03', '2025-01-10', '2025-01-17'], false)).toThrow(/weekly\/monthly/);
  });
  it('accepts actual consecutive sessions around holidays and weekends', () => {
    expect(() => assertCompleteDailySessions(['2025-01-08', '2025-01-10', '2025-01-13'], false)).not.toThrow();
    expect(() => assertCompleteDailySessions(['2025-07-03', '2025-07-07'], false)).not.toThrow();
  });
  it('rejects holiday, weekend, repeated dates and dates outside reviewed bounds', () => {
    expect(() => assertCompleteDailySessions(['2025-01-08', '2025-01-09', '2025-01-10'], false)).toThrow(/non-session/);
    expect(() => assertCompleteDailySessions(['2025-01-03', '2025-01-04'], false)).toThrow(/non-session/);
    expect(() => assertCompleteDailySessions(['2025-01-03', '2025-01-03'], false)).toThrow(/unique increasing/);
    expect(() => assertCompleteDailySessions(['1989-12-29', '1990-01-02'], false)).toThrow(/verified US session calendar/);
  });
  it('allows illustrative complete weekdays only when explicitly synthetic', () => {
    expect(() => assertCompleteDailySessions(createSyntheticDemo().dataset.dates, true)).not.toThrow();
    expect(() => assertCompleteDailySessions(['2025-01-08', '2025-01-09', '2025-01-10'], true)).not.toThrow();
    expect(() => assertCompleteDailySessions(['2025-01-08', '2025-01-10'], true)).toThrow(/missing 1 weekday/);
  });
  it('market import enforces daily completeness without a bypass flag', () => {
    const manifest = { ...createSyntheticDemo().dataset.manifest, synthetic: false, asOf: '2025-01-10' };
    expect(() => parseMarketCsv('date,VTI\n2025-01-03,100\n2025-01-10,101', { format: 'wide', manifest })).toThrow(/US trading session/);
  });
});
