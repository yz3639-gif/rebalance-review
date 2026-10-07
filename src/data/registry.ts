import catalog from './etf-catalog.json';
import type { CatalogSnapshot } from '../types';
/** Recognition is not certification of a user's price source, adjustment basis, or licensing. */
export interface EtfRegistryEntry {
  symbol: string; name: string; issuer: string; sourceUrl: string;
  verifiedAt: string;
  identity: 'verified' | 'pending';
  currency: { value: 'USD' | null; status: 'verified' | 'pending'; sourceUrl?: string };
  inception: { value: string | null; status: 'verified' | 'pending' };
  exchange?: string; catalogVersion?: string;
  priceBasis: 'requires-dataset-verification';
}

export const MAX_REVIEW_ASSETS = 50;
export const DEMO_SYMBOLS: readonly string[] = Object.freeze(['SPY', 'VOO', 'VTI', 'QQQ', 'VEA', 'VWO', 'VXUS', 'SHY', 'IEF', 'TLT', 'BND', 'TIP', 'LQD', 'HYG', 'GLD', 'VNQ']);
const isharesSource = 'https://www.ishares.com/us/products/etf-investments';
const entries: [string, string, string, string, boolean, string | null, boolean][] = [
  ['SPY', 'State Street SPDR S&P 500 ETF Trust', 'State Street', 'https://www.ssga.com/us/en/individual/etfs/state-street-spdr-sp-500-etf-trust-spy', true, '1993-01-22', true],
  ['VOO', 'Vanguard S&P 500 ETF', 'Vanguard', 'https://fund-docs.vanguard.com/F0968.pdf', true, '2010-09-07', false],
  ['VTI', 'Vanguard Morningstar Total Stock Market ETF', 'Vanguard', 'https://fund-docs.vanguard.com/F0970.pdf', true, '2001-05-24', false],
  ['QQQ', 'Invesco QQQ ETF', 'Invesco', 'https://www.invesco.com/qqq-etf/en/home.html', true, '1999-03-10', false],
  ['VEA', 'Vanguard FTSE Developed Markets ETF', 'Vanguard', 'https://fund-docs.vanguard.com/F0936.pdf', true, '2007-07-20', false],
  ['VWO', 'Vanguard FTSE Emerging Markets ETF', 'Vanguard', 'https://fund-docs.vanguard.com/F0964.pdf', true, '2005-03-04', false],
  ['VXUS', 'Vanguard Total International Stock ETF', 'Vanguard', 'https://fund-docs.vanguard.com/F3369.pdf', true, '2011-01-26', false],
  ['SHY', 'iShares 1-3 Year Treasury Bond ETF', 'BlackRock', 'https://www.ishares.com/us/products/239452/', true, '2002-07-22', false],
  ['IEF', 'iShares 7-10 Year Treasury Bond ETF', 'BlackRock', 'https://www.ishares.com/us/products/239456/ishares-710-year-treasury-bond-etf?source_caller=ui', true, '2002-07-22', false],
  ['TLT', 'iShares 20+ Year Treasury Bond ETF', 'BlackRock', isharesSource, true, '2002-07-22', false],
  ['BND', 'Vanguard Total Bond Market ETF', 'Vanguard', 'https://fund-docs.vanguard.com/F0928.pdf', true, '2007-04-03', false],
  ['TIP', 'iShares TIPS Bond ETF', 'BlackRock', 'https://www.ishares.com/us/products/239467/ishares-tips-bond-etf', true, '2003-12-04', false],
  ['LQD', 'iShares iBoxx $ Investment Grade Corporate Bond ETF', 'BlackRock', 'https://www.ishares.com/us/products/239566/lqd-ishares-iboxx-investment-grade-corporate-bond-etf', true, '2002-07-22', false],
  ['HYG', 'iShares iBoxx $ High Yield Corporate Bond ETF', 'BlackRock', 'https://www.ishares.com/us/products/239565/ishares-iboxx-usd-high-yield-corporate-bond-etf', true, '2007-04-04', false],
  ['GLD', 'SPDR Gold Shares', 'World Gold Trust Services', 'https://www.spdrgoldshares.com/usa/gld/', true, '2004-11-18', true],
  ['VNQ', 'Vanguard Real Estate ETF', 'Vanguard', 'https://fund-docs.vanguard.com/F0986.pdf', true, '2004-09-23', false],
];

const explicitUsdSources: Record<string, string> = {
  VOO: 'https://www.vanguardmexico.com/en/product/etf/equity/0968/sp-500-etf',
  VTI: 'https://www.vanguardmexico.com/en/product/etf/equity/0970/total-stock-market-etf',
  VXUS: 'https://www.vanguardmexico.com/en/product/etf/equity/3369/total-international-stock-etf',
  VEA: 'https://www.vanguardoffshore.com/en/product/etf/equity/0936/ftse-developed-markets-etf',
  VWO: 'https://www.vanguardoffshore.com/en/product/etf/equity/0964/ftse-emerging-markets-etf',
  BND: 'https://www.vanguardoffshore.com/en/product/etf/fixed-income/0928/total-bond-market-etf',
  VNQ: 'https://www.vanguardoffshore.com/en/product/etf/equity/0986/real-estate-etf',
  QQQ: 'https://www.invesco.com/content/dam/invesco/hk/en/pdf/kfs/Invesco_QQQ_KFS_EN.pdf',
  SHY: 'https://www.ishares.com/ch/professionals/en/products/239452/ishares-1-3-year-treasury-bond-etf',
  IEF: 'https://www.ishares.com/ch/professionals/en/products/239456/ishares-710-year-treasury-bond-etf',
  TLT: 'https://www.ishares.com/ch/professionals/en/products/239454/ishares-20-year-treasury-bond-etf',
  TIP: 'https://www.ishares.com/ch/professionals/en/products/239467/ishares-tips-bond-etf',
  LQD: 'https://www.ishares.com/ch/professionals/en/products/239566/ishares-iboxx-investment-grade-corporate-bond-etf',
  HYG: 'https://www.ishares.com/ch/professionals/en/products/etf-investments?switchLocale=Y',
};

const verifiedEntries: readonly EtfRegistryEntry[] = entries.map(([symbol, name, issuer, sourceUrl, identity, inception, usd]) => ({
  symbol, name, issuer, sourceUrl, verifiedAt: '2026-10-05', identity: identity ? 'verified' : 'pending',
  currency: { value: usd || explicitUsdSources[symbol] ? 'USD' : null, status: usd || explicitUsdSources[symbol] ? 'verified' : 'pending', ...(explicitUsdSources[symbol] ? { sourceUrl: explicitUsdSources[symbol] } : {}) },
  inception: { value: inception, status: inception ? 'verified' : 'pending' },
  priceBasis: 'requires-dataset-verification',
}));

export const CATALOG_VERSION = catalog.version;
export const CATALOG_AS_OF = catalog.asOf;
const verified = new Map(verifiedEntries.map(entry => [entry.symbol, entry]));
export const ETF_REGISTRY: readonly EtfRegistryEntry[] = catalog.assets.map(asset => {
  const previous = verified.get(asset.symbol);
  return { symbol: asset.symbol, name: asset.name, issuer: previous?.issuer ?? 'See fund issuer documentation',
    sourceUrl: previous?.sourceUrl ?? catalog.sources[asset.source].url, verifiedAt: catalog.asOf, identity: 'verified' as const,
    currency: previous?.currency ?? { value: null, status: 'pending' as const },
    inception: previous?.inception ?? { value: null, status: 'pending' as const },
    exchange: asset.exchange, catalogVersion: catalog.version, priceBasis: 'requires-dataset-verification' as const };
});
export const SUPPORTED_SYMBOLS: readonly string[] = Object.freeze(ETF_REGISTRY.map(entry => entry.symbol));
const supported = new Set(SUPPORTED_SYMBOLS);
const bySymbol = new Map(ETF_REGISTRY.map(entry => [entry.symbol, entry]));
export function isKnownSymbol(symbol: string): boolean { return symbol === 'CASH' || supported.has(symbol); }
export function getEtf(symbol: string): EtfRegistryEntry | undefined { return bySymbol.get(symbol); }
export function searchEtfs(query: string, limit = 30): readonly EtfRegistryEntry[] {
  const term = query.trim().toUpperCase();
  if (!term) return DEMO_SYMBOLS.map(s => bySymbol.get(s)).filter((e): e is EtfRegistryEntry => Boolean(e)).slice(0, limit);
  return ETF_REGISTRY.filter(e => e.symbol.includes(term) || e.name.toUpperCase().includes(term))
    .sort((a, b) => Number(b.symbol === term) - Number(a.symbol === term) || Number(b.symbol.startsWith(term)) - Number(a.symbol.startsWith(term)) || a.symbol.localeCompare(b.symbol)).slice(0, Math.max(0, Math.min(100, limit)));
}
export function snapshotCatalog(symbols: string[]): CatalogSnapshot {
  return { version: CATALOG_VERSION, asOf: CATALOG_AS_OF, assets: [...new Set(symbols)].filter(s => s !== 'CASH').map(symbol => {
    const entry = bySymbol.get(symbol);
    return entry ? { symbol, name: entry.name, exchange: entry.exchange, sourceUrl: entry.sourceUrl, identity: entry.identity }
      : { symbol, name: symbol, sourceUrl: 'https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs', identity: 'pending' };
  }) };
}
