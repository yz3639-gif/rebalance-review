import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChartCandlestick, RefreshCw, Radio, Search, ShieldCheck, X } from 'lucide-react';
import marketCatalog from './market-catalog.json';
import './marketEmbed.css';

export interface MarketSymbol { ticker: string; symbol: string; name: string; exchange: string }

// Provider symbology differs from the exchange names in our identity snapshot.
// TradingView's current canonical pages use CBOE (not legacy BATS) for IGV/ARKK.
const providerExchanges: Readonly<Record<string, string>> = {
  Nasdaq: 'NASDAQ', 'NYSE Arca': 'AMEX', 'Cboe BZX': 'CBOE',
};
export const MARKET_CATALOG: readonly MarketSymbol[] = marketCatalog.assets.map(asset => ({
  ticker: asset.symbol, name: asset.name, exchange: asset.exchange,
  symbol: providerExchanges[asset.exchange] ? `${providerExchanges[asset.exchange]}:${asset.symbol}` : '',
}));
const marketLookup = new Map(MARKET_CATALOG.map(asset => [asset.ticker, asset]));
export const MARKET_SYMBOLS = ['SPY', 'QQQ', 'SOXL', 'TQQQ', 'SMH', 'IWM', 'VTI', 'XLK', 'XLF', 'XLE', 'TLT', 'GLD', 'USO', 'EEM', 'ARKK']
  .map(ticker => marketLookup.get(ticker)!)
  .filter((asset): asset is MarketSymbol => Boolean(asset?.symbol));

type WidgetState = 'loading' | 'frame-loaded' | 'unavailable';
type WidgetKind = 'ticker-tape' | 'advanced-chart';

export function resolveMarketSymbol(input: string): MarketSymbol | null {
  const clean = input.trim().toUpperCase();
  if (!/^(?:[A-Z0-9_]{1,20}:)?[A-Z0-9._-]{1,20}$/.test(clean)) return null;
  const asset = marketLookup.get(clean.split(':').pop()!);
  if (!asset?.symbol || (clean.includes(':') && clean !== asset.symbol)) return null;
  return asset;
}

function symbolUrl(symbol: string) {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
}

/** Official embeds own their quote display. We never read their document or prices. */
function OfficialWidget({ kind, settings, symbol, title }: {
  kind: WidgetKind; settings: Record<string, unknown>; symbol: string; title: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<WidgetState>('loading');
  const [attempt, setAttempt] = useState(0);
  const configuration = JSON.stringify(settings);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    let active = true;
    let frame: HTMLIFrameElement | null = null;
    setState('loading');
    const fail = () => { if (active) setState('unavailable'); };
    const loaded = () => {
      if (!active) return;
      window.clearTimeout(timeout);
      // A frame load is not a guarantee of a current quote. The provider displays
      // its own data availability, exchange delay and closed-session information.
      setState('frame-loaded');
    };
    const timeout = window.setTimeout(fail, 15_000);
    const observer = new MutationObserver(() => {
      const candidate = root.querySelector('iframe');
      if (!candidate || candidate === frame) return;
      frame?.removeEventListener('load', loaded);
      frame?.removeEventListener('error', fail);
      frame = candidate;
      frame.title = title;
      frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      frame.addEventListener('load', loaded);
      frame.addEventListener('error', fail);
    });
    observer.observe(root, { childList: true, subtree: true });
    const slot = document.createElement('div');
    slot.className = 'tradingview-widget-container__widget';
    const script = document.createElement('script');
    script.src = `https://s3.tradingview.com/external-embedding/embed-widget-${kind}.js`;
    script.type = 'text/javascript';
    script.async = true;
    script.textContent = configuration;
    script.addEventListener('error', fail);
    root.replaceChildren(slot, script);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      observer.disconnect();
      frame?.removeEventListener('load', loaded);
      frame?.removeEventListener('error', fail);
      script.removeEventListener('error', fail);
      root.replaceChildren();
    };
  }, [configuration, kind, attempt, title]);

  return <div className={`mp-tv-widget mp-tv-widget--${kind}`} data-widget-state={state}>
    <div ref={host} className="tradingview-widget-container mp-tv-host" />
    {state !== 'frame-loaded' && <div className={`mp-tv-status ${state === 'unavailable' ? 'mp-tv-status--failed' : ''}`} role="status">
      {state === 'loading' ? <>
        <span className="mp-tv-loader" aria-hidden="true" />
        <span>Loading the external market view…</span>
      </> : <>
        <ChartCandlestick size={28} aria-hidden="true" />
        <strong>The market view could not load.</strong>
        <span>A network restriction, content blocker or provider outage may be preventing it. Your research view remains available.</span>
        <div className="mp-tv-status-actions">
          <button type="button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={14} aria-hidden="true" />Retry {kind === 'ticker-tape' ? 'ticker tape' : 'chart'}</button>
          <a href={symbolUrl(symbol)} target="_blank" rel="noopener noreferrer">Open on TradingView <ArrowUpRight size={14} aria-hidden="true" /></a>
        </div>
      </>}
    </div>}
    <div className="mp-tv-credit">
      <a href={kind === 'ticker-tape' ? 'https://www.tradingview.com/markets/' : symbolUrl(symbol)} target="_blank" rel="noopener noreferrer">{kind === 'ticker-tape' ? 'Ticker tape' : `${symbol.split(':').pop()} chart`} by TradingView</a>
      {state === 'frame-loaded' && <button type="button" onClick={() => setAttempt(value => value + 1)} aria-label={`Reload ${kind === 'ticker-tape' ? 'ticker tape' : 'market chart'}`}><RefreshCw size={12} aria-hidden="true" />Reload</button>}
    </div>
  </div>;
}

/** Official legacy tape: its own links stay with TradingView, not our inspector. */
export function TradingViewTickerTape() {
  const settings = useMemo(() => ({
    symbols: MARKET_SYMBOLS.map(item => ({ proName: item.symbol, description: item.ticker })),
    colorTheme: 'dark', isTransparent: true, showSymbolLogo: false,
    displayMode: 'regular', locale: 'en',
  }), []);
  return <section className="mp-tv-tape" aria-label="TradingView delayed ETF ticker tape">
    <div className="mp-tv-tape-label"><Radio size={12} aria-hidden="true" /> MARKET TAPE <span>US ETFs · delayed</span></div>
    <OfficialWidget kind="ticker-tape" settings={settings} symbol="AMEX:SPY" title="TradingView ETF ticker tape — delayed market data" />
  </section>;
}

export interface MarketEmbedProps {
  symbol?: string;
  onSymbolSelect?: (symbol: string) => void;
  includeTape?: boolean;
}

/** Mount only in the explicitly selected real-market mode; no credentials needed. */
export function MarketEmbed({ symbol = 'SPY', onSymbolSelect, includeTape = true }: MarketEmbedProps) {
  const [selected, setSelected] = useState(symbol);
  const [query, setQuery] = useState('');
  useEffect(() => { setSelected(symbol); }, [symbol]);
  const asset = resolveMarketSymbol(selected);
  const ticker = asset?.ticker ?? selected.trim().toUpperCase();
  const search = query.trim().toLowerCase();
  const matches = search ? MARKET_CATALOG.filter(item => `${item.ticker} ${item.symbol} ${item.name} ${item.exchange}`.toLowerCase().includes(search)) : [];
  const settings = useMemo(() => ({
    autosize: true, symbol: asset?.symbol, interval: '60', timezone: 'America/New_York',
    theme: 'dark', style: '1', locale: 'en', backgroundColor: '#0c111b', gridColor: 'rgba(142, 160, 191, 0.07)',
    allow_symbol_change: false, hide_side_toolbar: false, hide_top_toolbar: false,
    calendar: false, details: false, save_image: false, support_host: 'https://www.tradingview.com',
  }), [asset?.symbol]);
  const select = (next: MarketSymbol) => {
    setSelected(next.ticker);
    setQuery('');
    onSymbolSelect?.(next.ticker);
  };

  return <section className="mp-market-embed" aria-label="External market explorer">
    {includeTape && <TradingViewTickerTape />}
    <header className="mp-market-header">
      <div><p className="mp-market-kicker">EXTERNAL MARKET EXPLORER</p><h2><span>{ticker}</span><small>Price action</small></h2></div>
      <span className="mp-market-delay">DELAYED · PROVIDER DATA</span>
    </header>
    <div className="mp-market-search-wrap">
      <label className="mp-market-search"><Search size={15} aria-hidden="true" />
        <input type="search" aria-label="Search 50 market ETFs" placeholder="Search all 50 ETFs by ticker or name" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.key === 'Escape') setQuery('');
          if (event.key === 'Enter' && matches.length === 1) { event.preventDefault(); select(matches[0]); }
        }} />
      </label>
      <span className="mp-market-catalog-label">50 ETF identities · {marketCatalog.asOf}</span>
      {search && <div className="mp-market-results">
        <div className="mp-market-results-heading"><span role="status">{matches.length} {matches.length === 1 ? 'match' : 'matches'}</span><button type="button" onClick={() => setQuery('')} aria-label="Clear market search"><X size={13} aria-hidden="true" /></button></div>
        {matches.length ? <ul aria-label="Market ETF search results">{matches.map(item => <li key={item.ticker}><button type="button" onClick={() => select(item)} aria-pressed={asset?.ticker === item.ticker}><b>{item.ticker}</b><span>{item.name}<small>{item.symbol} · {item.exchange}</small></span><ArrowUpRight size={13} aria-hidden="true" /></button></li>)}</ul>
          : <p>No matching ETF in this 50-asset demo. Try a ticker such as IGV, BND or SOXL. No substitute symbol has been selected.</p>}
      </div>}
    </div>
    <div className="mp-market-symbols" role="group" aria-label="Choose market chart symbol">
      {MARKET_SYMBOLS.map(item => <button key={item.ticker} type="button" aria-pressed={asset?.ticker === item.ticker} title={item.name} onClick={() => select(item)}>{item.ticker}</button>)}
    </div>
    {asset ? <OfficialWidget kind="advanced-chart" settings={settings} symbol={asset.symbol} title={`${ticker} TradingView price chart — provider data`} />
      : <div className="mp-market-unknown" role="status"><ChartCandlestick size={28} aria-hidden="true" /><strong>This symbol is not mapped in this demo.</strong><p>{ticker || 'Empty symbol'} has no matching exchange-qualified identity in the 50-ETF catalog. Search or choose a supported ETF above. The chart has not been replaced with another asset.</p></div>}
    <div className="mp-market-disclosure">
      <ShieldCheck size={16} aria-hidden="true" />
      <p>Quotes and charts are served directly by TradingView. US equity data is delayed; timestamps, venue and market-session status are shown inside the chart. A moving ticker does not mean the market is open. This view does not update the historical portfolio analysis.</p>
    </div>
    <details className="mp-market-source-details"><summary>Sources, privacy &amp; data availability</summary>
      <p>Opening this mode connects your browser to TradingView and its data services. Those services receive normal connection information, including your IP address. Rebalance Review sends no holdings, weights, API keys or decision notes, and does not extract or store widget quotes.</p>
      <p>Search covers the same 50 ETF identities as the replay; quick buttons show a curated subset. Listing identity does not guarantee provider coverage. Some symbols or exchanges may be unavailable in an embedded chart. A loaded frame is not proof of a fresh price. If the provider shows an unavailable symbol or connection error, choose another symbol, reload the chart or open it on TradingView. These widgets do not provide a raw-data API for our calculations.</p>
      <p><a href="https://www.tradingview.com/widget-docs/markets/north-america/" target="_blank" rel="noopener noreferrer">Exchange coverage</a><a href="https://www.tradingview.com/widget-docs/faq/data/" target="_blank" rel="noopener noreferrer">Widget data policy</a><a href="https://www.tradingview.com/privacy-policy/" target="_blank" rel="noopener noreferrer">TradingView privacy policy</a></p>
    </details>
  </section>;
}

export default MarketEmbed;
