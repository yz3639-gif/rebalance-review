import snapshot from './us-equity-calendar.json';
import { currentUsDate, DataValidationError, isIsoDate } from './validation';

export const US_EQUITY_CALENDAR = Object.freeze({
  start: snapshot.start, end: snapshot.end, verifiedAt: snapshot.verifiedAt,
  referenceVersion: snapshot.referenceVersion, sources: snapshot.sources,
});
const closedWeekdays = new Set(snapshot.closedWeekdays);

/** Maintenance status does not reject valid historical inputs inside the snapshot. */
export function calendarMaintenanceStatus(today = currentUsDate()): { status: 'current' | 'expiring' | 'expired'; daysRemaining: number; message: string | null } {
  if (!isIsoDate(today)) throw new DataValidationError('Calendar maintenance status requires a valid ISO date.');
  const daysRemaining = Math.round((Date.parse(`${snapshot.end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (daysRemaining < 0) return { status: 'expired', daysRemaining, message: `The US session calendar ended on ${snapshot.end}. Historical data within its range still work; newer data require a reviewed calendar update.` };
  if (daysRemaining <= 90) return { status: 'expiring', daysRemaining, message: `The US session calendar ends on ${snapshot.end} (${daysRemaining} days remaining). A reviewed update will be needed for later market data.` };
  return { status: 'current', daysRemaining, message: null };
}

export function expectedUsEquitySessions(start: string, end: string): string[] {
  if (!isIsoDate(start) || !isIsoDate(end) || start > end) throw new DataValidationError('Session calendar requires valid ordered ISO dates.');
  if (start < snapshot.start || end > snapshot.end) throw new DataValidationError(`The verified US session calendar covers ${snapshot.start} through ${snapshot.end}. Use data within this range; extending it requires a reviewed calendar update.`);
  const result: string[] = [];
  const date = new Date(`${start}T00:00:00Z`);
  while (date.toISOString().slice(0, 10) <= end) {
    const key = date.toISOString().slice(0, 10);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && !closedWeekdays.has(key)) result.push(key);
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return result;
}

/** Reject sparse/weekly inputs before annualizing; synthetic paths use an explicitly illustrative weekday calendar. */
export function assertCompleteDailySessions(dates: readonly string[], synthetic: boolean): void {
  if (!dates.length || dates.some(date => !isIsoDate(date))) throw new DataValidationError('Daily session validation requires nonempty valid ISO dates.');
  if (dates.some((date, index) => index > 0 && date <= dates[index - 1])) throw new DataValidationError('Daily observations must have unique increasing dates.');
  const supplied = new Set(dates);
  if (synthetic) {
    const cursor = new Date(`${dates[0]}T00:00:00Z`);
    const expected = new Set<string>();
    while (cursor.toISOString().slice(0, 10) <= dates.at(-1)!) {
      const date = cursor.toISOString().slice(0, 10);
      if (![0, 6].includes(cursor.getUTCDay())) expected.add(date);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    if (dates.some(date => !expected.has(date))) throw new DataValidationError('The synthetic demonstration calendar requires weekday observations only.');
    const missing = [...expected].filter(date => !supplied.has(date));
    if (missing.length) throw new DataValidationError(`Synthetic daily data is missing ${missing.length} weekday observations, starting ${missing[0]}.`);
    return;
  }
  const expected = expectedUsEquitySessions(dates[0], dates.at(-1)!);
  const expectedSet = new Set(expected);
  const unexpected = dates.filter(date => !expectedSet.has(date));
  if (unexpected.length) throw new DataValidationError(`Market data contains non-session date ${unexpected[0]}. Use actual US exchange daily adjusted observations; do not insert weekends or holiday forward-fills.`);
  const missing = expected.filter(date => !supplied.has(date));
  if (missing.length) throw new DataValidationError(`Market data is missing ${missing.length} US trading session${missing.length === 1 ? '' : 's'}, starting ${missing[0]}. Supply complete daily observations; weekly/monthly data or silent gaps cannot be annualized as daily returns.`);
}
