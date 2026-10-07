import snapshot from './tiingo-identities.json';
import { CATALOG_VERSION, ETF_REGISTRY, getEtf } from '../data/registry';

// Official Tiingo supported_tickers.zip uses NYSE for many NYSE Arca listings
// (including SPY), plus NYSE ARCA, NASDAQ and BATS. Do not infer a US venue
// from arbitrary nonempty strings or trust OTC/foreign symbol collisions.
const exchanges: Record<string, readonly string[]> = {
  'NYSE Arca': ['NYSE', 'NYSE ARCA', 'ARCA'],
  NYSE: ['NYSE'],
  Nasdaq: ['NASDAQ'],
  'Cboe BZX': ['BATS', 'CBOE BZX'],
  'NYSE American': ['AMEX', 'NYSE MKT', 'NYSE AMERICAN'],
};
export function compatibleTiingoExchange(catalogExchange: string | undefined, providerExchange: unknown): boolean {
  return typeof providerExchange === 'string' && Boolean(catalogExchange && exchanges[catalogExchange]?.includes(providerExchange.trim().toUpperCase()));
}
const identities = new Map(snapshot.assets.map(asset => [asset.symbol, asset]));
const snapshotValid = snapshot.schemaVersion === 1 && snapshot.catalogVersion === CATALOG_VERSION &&
  identities.size === snapshot.assets.length && identities.size <= ETF_REGISTRY.length &&
  snapshot.assets.every(asset => getEtf(asset.symbol));

/** Snapshot is a disambiguation gate, never an entitlement or guarantee of live availability. */
export function verifiedTiingoIdentity(symbol: string, liveExchange?: unknown): boolean {
  if (!snapshotValid) return false;
  const asset = identities.get(symbol), catalog = getEtf(symbol);
  return Boolean(asset && catalog && !asset.ambiguous && asset.assetType === 'ETF' && asset.currency === 'USD' && asset.hasHistory &&
    compatibleTiingoExchange(catalog.exchange, asset.exchange) &&
    (liveExchange === undefined || compatibleTiingoExchange(catalog.exchange, liveExchange)));
}
