import { describe, expect, it } from 'vitest';
import { getEtf } from '../src/data/registry';
import { getReplayFrame, MARKET_ASSETS, REPLAY_HISTORY_LIMIT, REPLAY_INITIAL_STEP, REPLAY_LAST_STEP, REPLAY_META } from '../src/demo/replayFeed';

describe('synthetic market pulse replay', () => {
  it('uses 50 distinct catalog identities with explicit synthetic provenance', () => {
    expect(MARKET_ASSETS).toHaveLength(50);
    expect(new Set(MARKET_ASSETS.map(asset => asset.symbol)).size).toBe(50);
    for (const asset of MARKET_ASSETS) {
      expect(asset.name).toBe(getEtf(asset.symbol)?.name);
      expect(asset.shortName).not.toBe('');
      expect(asset.color).toMatch(/^#[\dA-F]{6}$/i);
    }
    expect(MARKET_ASSETS.map(asset => asset.symbol)).toEqual(expect.arrayContaining(['SPY', 'QQQ', 'SOXL', 'TQQQ']));
    expect(REPLAY_META.mode).toBe('synthetic');
    expect(REPLAY_META.disclosure).toMatch(/generated prices and volumes/i);
  });

  it('is deterministic under out-of-order reads and starts with a populated chart', () => {
    const first = getReplayFrame(REPLAY_INITIAL_STEP);
    const recorded = JSON.stringify(first);
    getReplayFrame(REPLAY_LAST_STEP); getReplayFrame(31);
    expect(JSON.stringify(getReplayFrame(REPLAY_INITIAL_STEP))).toBe(recorded);
    expect(first.timeLabel).toBe('10:33:30');
    expect(first.quotes.every(quote => quote.history.length === REPLAY_HISTORY_LIMIT)).toBe(true);
    expect(first.quotes.find(quote => quote.symbol === 'SPY')!.history.some(point => point.price !== first.quotes[0].history[0].price)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.quotes[0].history[0])).toBe(true);
  });

  it.each([-1, .1, NaN, Infinity, -Infinity, REPLAY_LAST_STEP + 1, Number.MAX_SAFE_INTEGER])('rejects invalid or out-of-session step %s', step => {
    expect(() => getReplayFrame(step)).toThrow(RangeError);
  });

  it('advances one common clock, carries unchanged quotes and keeps bounded aligned history', () => {
    // Every frame and quote is still checked. Construct assertion diagnostics only on failure,
    // avoiding hundreds of thousands of matcher/proxy allocations during concurrent CI runs.
    const invariant = (condition: boolean, label: string, step: number, symbol = 'frame') => {
      if (!condition) throw new Error(`Replay step ${step}, ${symbol}: ${label}`);
    };
    // Same absolute threshold as toBeCloseTo(expected, 10); do not relax numerical checks.
    const close = (actual: number, expected: number) => Math.abs(actual - expected) < 0.5 * 10 ** -10;
    let previous = getReplayFrame(0);
    let checkedQuotes = 0;
    for (let step = 1; step <= REPLAY_LAST_STEP; step++) {
      const frame = getReplayFrame(step);
      const frameTimestamp = Date.parse(frame.timestamp);
      invariant(frameTimestamp - Date.parse(previous.timestamp) === REPLAY_META.intervalMs, 'clock advances exactly one interval', step);
      invariant(frame.progress > previous.progress, 'progress increases', step);
      invariant(frame.quotes.length === 50, 'all 50 assets are present', step);
      let updatedCount = 0;
      frame.quotes.forEach((quote, index) => {
        const last = quote.history.at(-1)!;
        const prior = previous.quotes[index];
        invariant(quote.symbol === prior.symbol, 'asset index remains stable', step, quote.symbol);
        invariant(quote.history.length === REPLAY_HISTORY_LIMIT, 'bounded history length', step, quote.symbol);
        invariant(last.timestamp === frame.timestamp, 'last history timestamp matches frame', step, quote.symbol);
        invariant(last.price === quote.price, 'last history price matches quote', step, quote.symbol);
        invariant(quote.history[0].timestamp === prior.history[1].timestamp, 'buffer advances one observation', step, quote.symbol);
        invariant(quote.volume - prior.volume === last.volume, 'interval volume reconciles to cumulative change', step, quote.symbol);
        invariant(quote.volume >= prior.volume, 'cumulative volume never decreases', step, quote.symbol);
        invariant(quote.price > 0 && Number.isFinite(quote.price), 'price is positive and finite', step, quote.symbol);
        invariant(Number.isSafeInteger(quote.volume), 'cumulative volume is a safe integer', step, quote.symbol);
        invariant(quote.dayHigh >= quote.price, 'price does not exceed session high', step, quote.symbol);
        invariant(quote.dayLow <= quote.price, 'price does not fall below session low', step, quote.symbol);
        invariant(close(quote.changePct, 100 * (quote.price / quote.previousClose - 1)), 'percentage agrees with price and previous close', step, quote.symbol);
        invariant(Date.parse(quote.updatedAt) <= frameTimestamp, 'quote update never lies in the future', step, quote.symbol);
        invariant(close(quote.delta, quote.price - prior.price), 'delta reconciles to consecutive prices', step, quote.symbol);
        if (quote.updated) {
          updatedCount++;
          invariant(quote.updatedAt === frame.timestamp, 'updated quote uses this frame timestamp', step, quote.symbol);
          invariant(last.volume > 0, 'updated quote has positive interval volume', step, quote.symbol);
        } else {
          invariant(quote.price === prior.price, 'carried quote retains its price', step, quote.symbol);
          invariant(quote.updatedAt === prior.updatedAt, 'carried quote retains its update timestamp', step, quote.symbol);
          invariant(last.volume === 0, 'carried quote has zero interval volume', step, quote.symbol);
        }
        checkedQuotes++;
      });
      invariant(updatedCount > 0, 'each frame updates at least one quote', step);
      if (step !== REPLAY_LAST_STEP) invariant(updatedCount < 50, 'updates arrive for a subset of quotes', step);
      previous = frame;
    }
    expect(checkedQuotes).toBe(REPLAY_LAST_STEP * 50);
    expect(previous.timeLabel).toBe('16:00:00');
    expect(previous.ended).toBe(true);
    expect(previous.progress).toBe(1);
  });

  it('computes breadth and group means only from the same displayed synthetic frame', () => {
    for (const step of [0, 50, 249, REPLAY_LAST_STEP]) {
      const frame = getReplayFrame(step);
      expect(frame.breadth.total).toBe(50);
      expect(frame.breadth.advancing + frame.breadth.declining + frame.breadth.unchanged).toBe(50);
      expect(frame.breadth.advancing).toBe(frame.quotes.filter(quote => quote.change > 0).length);
      expect(frame.breadth.changePct).toBeCloseTo(frame.quotes.reduce((sum, quote) => sum + quote.changePct, 0) / 50, 12);
      expect(frame.groups.reduce((sum, group) => sum + group.count, 0)).toBe(50);
      for (const group of frame.groups) {
        const members = frame.quotes.filter(quote => quote.sleeve === group.sleeve);
        expect(group.count).toBe(members.length);
        expect(group.changePct).toBeCloseTo(members.reduce((sum, quote) => sum + quote.changePct, 0) / members.length, 12);
      }
    }
  });
});
