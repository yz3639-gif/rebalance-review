import marketCatalog from './market-catalog.json';
import marketUniverse from './market-universe.json';

/** This is a repeatable display simulation, never a quote source for portfolio calculations. */
export const REPLAY_HISTORY_LIMIT = 128;
export const REPLAY_INITIAL_STEP = 0;
const SESSION_INTERVALS = 780;
const INITIAL_INTERVAL = REPLAY_HISTORY_LIMIT - 1;
export const REPLAY_LAST_STEP = SESSION_INTERVALS - INITIAL_INTERVAL;
const INTERVAL_MS = 30_000;
const SESSION_START = Date.parse('2026-09-30T13:30:00.000Z');

export const REPLAY_META = Object.freeze({
  mode: 'synthetic' as const,
  date: '2026-09-30',
  timezone: 'America/New_York',
  timezoneLabel: 'ET',
  startLabel: '09:30:00',
  endLabel: '16:00:00',
  intervalMs: INTERVAL_MS,
  catalogVersion: marketCatalog.version,
  catalogAsOf: marketCatalog.asOf,
  catalogSourceName: marketCatalog.sourceName,
  catalogSourceNotes: marketCatalog.sourceNotes,
  catalogSourceSha256: marketCatalog.sourceCatalogSha256,
  catalogSources: Object.freeze(marketCatalog.sources.map(source => Object.freeze({ ...source }))),
  source: 'Deterministic synthetic ETF display simulation',
  disclosure: 'Real ETF identities; generated prices and volumes. Not live quotes, trades, order flow or fund flows.',
});

export type MarketSleeve = 'US equity' | 'Sectors & themes' | 'Fixed income' | 'Real assets' | 'International' | 'Leveraged & inverse';
export interface MarketAsset {
  readonly symbol: string;
  readonly name: string;
  readonly shortName: string;
  readonly sleeve: MarketSleeve;
  readonly color: string;
}
interface SleeveDefinition { readonly sleeve: MarketSleeve; readonly color: string; readonly assets: readonly (readonly [string, string])[] }
const SLEEVES: readonly SleeveDefinition[] = marketUniverse.map(group => ({
  sleeve: group.sleeve as MarketSleeve, color: group.color,
  assets: group.assets.map(([symbol, shortName]) => [symbol, shortName] as const),
}));

const displayIdentities = new Map(marketCatalog.assets.map(asset => [asset.symbol, asset]));
/** Names come from a checked 50-row slice of the versioned catalog; no full catalog enters this bundle. */
export const MARKET_ASSETS: readonly MarketAsset[] = Object.freeze(SLEEVES.flatMap(group => group.assets.map(([symbol, shortName]) => {
  const entry = displayIdentities.get(symbol);
  if (!entry) throw new Error(`Synthetic display asset ${symbol} is missing from the ETF catalog.`);
  return Object.freeze({ symbol, name: entry.name, shortName, sleeve: group.sleeve, color: group.color });
})));

export interface ReplayPoint {
  readonly timestamp: string;
  readonly price: number;
  /** Synthetic shares generated during this interval, not cumulative or actual exchange volume. */
  readonly volume: number;
}
export interface ReplayQuote extends MarketAsset {
  readonly price: number;
  readonly previousClose: number;
  readonly change: number;
  /** Percentage points: 1.25 means +1.25%, not +125%. */
  readonly changePct: number;
  readonly delta: number;
  readonly updated: boolean;
  readonly updatedAt: string;
  readonly volume: number;
  readonly dayHigh: number;
  readonly dayLow: number;
  readonly history: readonly ReplayPoint[];
}
export interface ReplayGroup {
  readonly sleeve: MarketSleeve;
  readonly color: string;
  readonly count: number;
  /** Equal-weight mean of the selected demo instruments, not a traded index. */
  readonly changePct: number;
  readonly advancing: number;
  readonly declining: number;
}
export interface ReplayFrame {
  readonly step: number;
  readonly timestamp: string;
  readonly timeLabel: string;
  readonly progress: number;
  readonly ended: boolean;
  readonly quotes: readonly ReplayQuote[];
  readonly groups: readonly ReplayGroup[];
  readonly breadth: Readonly<{ advancing: number; declining: number; unchanged: number; total: number; changePct: number }>;
}

const roundPrice = (value: number) => Math.round(value * 100) / 100;
function noise(seed: number, index: number) {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 0x100000000;
}
function symbolSeed(symbol: string) {
  let seed = 2166136261;
  for (const character of symbol) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return seed >>> 0;
}
const TIMES: readonly string[] = Object.freeze(Array.from({ length: SESSION_INTERVALS + 1 }, (_, interval) => new Date(SESSION_START + interval * INTERVAL_MS).toISOString()));
interface SeriesPoint extends ReplayPoint { readonly cumulativeVolume: number; readonly updatedIndex: number; readonly high: number; readonly low: number }
interface AssetSeries { readonly previousClose: number; readonly points: readonly Readonly<SeriesPoint>[] }

function createSeries(asset: MarketAsset, assetIndex: number): AssetSeries {
  const seed = symbolSeed(asset.symbol);
  const previousClose = roundPrice(22 + noise(seed, 7) * 425);
  const sleeveIndex = SLEEVES.findIndex(group => group.sleeve === asset.sleeve);
  const direction = asset.symbol === 'SQQQ' || asset.symbol === 'SOXS' ? -1 : 1;
  const exposure = asset.sleeve === 'Leveraged & inverse' ? 2.5 * direction : asset.sleeve === 'Fixed income' ? -.16 : asset.sleeve === 'Real assets' ? .26 : .85;
  const idiosyncraticScale = asset.sleeve === 'Fixed income' ? .000035 : .00024;
  // Sparse independent display arrivals. The price process still evolves on one common simulation clock.
  const cadence = 4 + assetIndex % 5;
  const offset = assetIndex % cadence;
  const volumeScale = 400 + Math.floor(noise(seed, 17) * 24_000);
  let modelPrice = previousClose * (1 + (noise(seed, 10) - .48) * .008);
  let shownPrice = roundPrice(modelPrice), cumulativeVolume = 0, high = shownPrice, low = shownPrice, updatedIndex = 0;
  const points: Readonly<SeriesPoint>[] = [];
  for (let interval = 0; interval <= SESSION_INTERVALS; interval++) {
    const commonMove = .000011 + Math.sin(interval / 37) * .000041 + (noise(811, interval) - .5) * .00031;
    const sleeveMove = (noise(13_021 + sleeveIndex * 151, interval) - .5) * .00013;
    modelPrice *= Math.exp(exposure * commonMove + sleeveMove + (noise(seed, interval) - .5) * idiosyncraticScale);
    const updates = interval === 0 || interval === SESSION_INTERVALS || (interval + offset) % cadence === 0;
    const volume = updates ? Math.max(1, Math.floor(volumeScale * (.45 + noise(seed, interval + 10_000)) * (interval === 0 ? 1 : cadence))) : 0;
    if (updates) {
      shownPrice = roundPrice(modelPrice);
      cumulativeVolume += volume;
      updatedIndex = interval;
      high = Math.max(high, shownPrice); low = Math.min(low, shownPrice);
    }
    points.push(Object.freeze({ timestamp: TIMES[interval], price: shownPrice, volume, cumulativeVolume, updatedIndex, high, low }));
  }
  return Object.freeze({ previousClose, points: Object.freeze(points) });
}

// A finite 390-minute session is generated lazily once: at most 50 × 781 immutable points.
// Calling getReplayFrame in any order has identical output; advancing playback adds no retained state.
let series: readonly AssetSeries[] | undefined;
function getSeries() { return series ??= Object.freeze(MARKET_ASSETS.map(createSeries)); }

export function getReplayFrame(step: number): ReplayFrame {
  if (!Number.isSafeInteger(step) || step < REPLAY_INITIAL_STEP || step > REPLAY_LAST_STEP) {
    throw new RangeError(`Replay step must be an integer from ${REPLAY_INITIAL_STEP} to ${REPLAY_LAST_STEP}.`);
  }
  const interval = INITIAL_INTERVAL + step;
  const quotes: readonly ReplayQuote[] = Object.freeze(getSeries().map((assetSeries, index) => {
    const point = assetSeries.points[interval];
    const change = roundPrice(point.price - assetSeries.previousClose);
    return Object.freeze({ ...MARKET_ASSETS[index], price: point.price, previousClose: assetSeries.previousClose,
      change, changePct: 100 * change / assetSeries.previousClose,
      delta: roundPrice(point.price - assetSeries.points[interval - 1].price),
      updated: point.updatedIndex === interval, updatedAt: TIMES[point.updatedIndex],
      volume: point.cumulativeVolume, dayHigh: point.high, dayLow: point.low,
      history: Object.freeze(assetSeries.points.slice(interval - REPLAY_HISTORY_LIMIT + 1, interval + 1)),
    });
  }));
  const mean = (members: readonly ReplayQuote[]) => members.reduce((sum, quote) => sum + quote.changePct, 0) / members.length;
  const advancing = quotes.filter(quote => quote.change > 0).length;
  const declining = quotes.filter(quote => quote.change < 0).length;
  const elapsedSeconds = interval * INTERVAL_MS / 1000 + 9 * 3600 + 30 * 60;
  const timeLabel = [Math.floor(elapsedSeconds / 3600), Math.floor(elapsedSeconds / 60) % 60, elapsedSeconds % 60].map(value => String(value).padStart(2, '0')).join(':');
  return Object.freeze({ step, timestamp: TIMES[interval], timeLabel, progress: step / REPLAY_LAST_STEP, ended: step === REPLAY_LAST_STEP,
    quotes,
    breadth: Object.freeze({ advancing, declining, unchanged: quotes.length - advancing - declining, total: quotes.length, changePct: mean(quotes) }),
    groups: Object.freeze(SLEEVES.map(group => {
      const members = quotes.filter(quote => quote.sleeve === group.sleeve);
      return Object.freeze({ sleeve: group.sleeve, color: group.color, count: members.length, changePct: mean(members),
        advancing: members.filter(quote => quote.change > 0).length, declining: members.filter(quote => quote.change < 0).length });
    })),
  });
}
