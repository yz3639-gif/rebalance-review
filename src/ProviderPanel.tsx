import { useEffect, useRef, useState } from 'react';
import type { ProviderAdapter } from './types';
import { createCustomRestAdapter, createTiingoAdapter, createYahooLocalAdapter, exportCustomConfig, providerErrorMessage } from './providers';
import type { CustomRestConfig } from './providers';
import { download } from './records';
import { SUPPORTED_SYMBOLS } from './data/registry';

function defaults(): CustomRestConfig {
  return { endpoint: '', source: '', format: 'json', csvShape: 'long', requestMode: 'per-symbol', arrayPath: '',
    fields: { date: 'date', symbol: '', value: 'adjClose' }, params: { symbol: 'symbol', start: 'startDate', end: 'endDate' },
    auth: { kind: 'none', value: '', queryName: 'apikey' }, basis: 'adjusted_close', usdAndBasisConfirmed: false,
    permissions: { rawPersistence: false, derivedPersistence: false, export: false } };
}
export interface ProviderPanelProps {
  selectedSymbols: string[];
  hasDataset?: boolean;
  hasPriceInput?: boolean;
  mode: 'csv' | 'api';
  onModeChange: (mode: 'csv' | 'api') => void;
  onProvider: (adapter: ProviderAdapter | null) => void;
  onInvalidated: () => void;
  onNotice: (message: string) => void;
}
export default function ProviderPanel({ selectedSymbols, hasDataset = false, hasPriceInput = false, mode, onModeChange, onProvider, onInvalidated, onNotice }: ProviderPanelProps) {
  const [provider, setProvider] = useState<'tiingo' | 'custom' | 'yahoo-local'>('tiingo');
  const [localAvailable, setLocalAvailable] = useState(false);
  const manualChoice = useRef(false);
  const [token, setToken] = useState('');
  const [config, setConfig] = useState<CustomRestConfig>(defaults);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [accessConfirmed, setAccessConfirmed] = useState(false);
  const [usdConfirmed, setUsdConfirmed] = useState(false);
  const selectedKey=JSON.stringify([...new Set(selectedSymbols)].sort());
  const lastSelection=useRef(selectedKey);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/providers/local/status', { signal: controller.signal, cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(status => { if (!controller.signal.aborted) setLocalAvailable(status?.enabled === true); })
      .catch(() => { /* CSV and user-configured APIs remain available without the local service. */ });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!localAvailable || hasDataset || hasPriceInput || manualChoice.current) return;
    manualChoice.current = true;
    setProvider('yahoo-local'); setConnected(true); onModeChange('api'); onProvider(createYahooLocalAdapter());
  }, [localAvailable, hasDataset, hasPriceInput]);
  useEffect(()=>{if(lastSelection.current!==selectedKey){lastSelection.current=selectedKey;setUsdConfirmed(false);if(mode==='api'&&provider!=='yahoo-local'){invalidate();setAccessConfirmed(false);}}},[selectedKey,mode,provider]);
  function invalidate() { onProvider(null); onInvalidated(); setConnected(false); setError(''); }
  function update(next: CustomRestConfig) {
    invalidate();
    const identity = (value: CustomRestConfig) => JSON.stringify([value.endpoint, value.source, value.format, value.csvShape, value.requestMode, value.arrayPath, value.fields, value.params, value.auth, value.basis]);
    if (identity(next) !== identity(config)) {
      next = { ...next, source: next.endpoint !== config.endpoint ? '' : next.source, usdAndBasisConfirmed: false,
        permissions: { rawPersistence: false, derivedPersistence: false, export: false } };
      setAccessConfirmed(false);
    }
    setConfig(next);
  }
  function choose(value: string) {
    manualChoice.current = true;
    invalidate(); setToken(''); setConfig(defaults()); setAccessConfirmed(false); setUsdConfirmed(false);
    if (value === 'csv') onModeChange('csv');
    else if (value === 'yahoo-local' && localAvailable) {
      setProvider('yahoo-local'); onModeChange('api'); onProvider(createYahooLocalAdapter()); setConnected(true);
      onNotice('Local market connection ready. Compare portfolios fetches actual daily adjusted history for your selected ETFs. No API key is required.');
    } else { setProvider(value as 'tiingo' | 'custom'); onModeChange('api'); }
  }
  function connect() {
    try {
      if (!accessConfirmed) { setError('Confirm that you may access this API for your own review.'); return; }
      const adapter = provider === 'tiingo' ? createTiingoAdapter({ token, usdConfirmed }) : createCustomRestAdapter(config);
      onInvalidated(); onProvider(adapter); setError(''); setConnected(true);
      onNotice('API settings are ready. Compare portfolios will request the selected history; credentials are kept only in memory.');
    } catch (e) { onProvider(null); setConnected(false); setError(providerErrorMessage(e)); }
  }
  return <section className="data-panel" aria-labelledby="provider-heading">
    <div className="section-head"><div><span className="eyebrow">DATA CONNECTION</span><h2 id="provider-heading">Choose how to load your prices.</h2></div><span className={`status-pill ${connected ? 'ready' : ''}`}>{mode === 'csv' ? 'Local files' : connected && provider === 'yahoo-local' ? 'Local market connection ready' : connected ? 'API settings ready' : 'API setup required'}</span></div>
    <label>Price data connection<select value={mode === 'csv' ? 'csv' : provider} onChange={e => choose(e.target.value)}>{localAvailable && <option value="yahoo-local">Yahoo Finance · local personal research · no key</option>}<option value="csv">Import my CSV</option><option value="tiingo">Tiingo · use my API key</option><option value="custom">Custom REST API · browser connection</option></select></label>
    {mode === 'api' && <div className="details-body">
      <p className="hint">Compare fetches up to five years of daily adjusted history for your supported ETFs: {selectedSymbols.some(s => SUPPORTED_SYMBOLS.includes(s)) ? selectedSymbols.filter(s => SUPPORTED_SYMBOLS.includes(s)).join(', ') : 'add your ETF holdings first'}. Cash is modeled separately. No brokerage connection or orders.</p>
      {provider === 'yahoo-local' ? <>
        <div className="dataset-strip"><strong>Actual daily market history · fetched when you compare</strong><span>No file upload or API key required.</span></div>
        <p className="hint">Enter A and B weights totaling 100%, then click Compare portfolios. The local service verifies each ETF, USD currency, adjusted closes and completed trading sessions. It requests history through the previous trading day; the report shows the dates actually used.</p>
        <p className="hint">This is an unofficial connection to Yahoo Finance's public chart data for personal research on this computer. Availability and limits depend on Yahoo. A failed request keeps your inputs and never substitutes synthetic prices.</p>
        <p className="hint">Prices are released after calculation. This source does not enable local result saving, JSON archives or full analytical PDF export; a decision-only PDF remains available. Use a permitted CSV or your own API for sources with the required export rights.</p>
        <button className="quiet" onClick={() => choose('csv')}>Disconnect and use CSV</button>
      </> : provider === 'tiingo' ? <>
        <label>Tiingo API token<input type="password" autoComplete="off" spellCheck={false} value={token} maxLength={500} onChange={e => { invalidate(); setToken(e.target.value); setAccessConfirmed(false); }} placeholder="Your personal Tiingo token"/></label>
        <p className="hint">Your token and requested ETF symbols pass through our Cloudflare connection to Tiingo. They are not saved or logged by application code. Portfolio weights and review notes stay in your browser. <a href="https://www.tiingo.com/documentation/general/overview" target="_blank" rel="noreferrer">Get your own token ↗</a></p>
        <label className="check"><input type="checkbox" checked={usdConfirmed} onChange={e=>{invalidate();setUsdConfirmed(e.target.checked);}}/>I confirm my selected ETF listings are quoted in USD</label><p className="hint">Required for catalog entries whose quotation currency has not been independently verified. A US listing alone is not a currency verification.</p>
        <p className="warning">Tiingo uses operation-only processing: prices are removed after calculation and requested again for the next comparison. Local saving, archive export and full analytical PDF export are disabled because an output-specific entitlement has not been verified. A decision-only PDF can include your allocations, assumptions and reasoning; it excludes source data and analytical results.</p>
      </> : <>
        <p className="hint">Standard HTTPS GET APIs with JSON or CSV responses and browser CORS support. OAuth flows, arbitrary scripts and server forwarding of custom URLs are not supported. You can always import an authorized CSV instead.</p>
        <div className="form-grid"><label>Custom API endpoint<input type="url" value={config.endpoint} onChange={e => update({ ...config, endpoint: e.target.value })} placeholder="https://api.example.com/history"/></label><label>Custom API source name<input value={config.source} maxLength={500} onChange={e => update({ ...config, source: e.target.value })} placeholder="Provider and account permission description"/></label></div>
        <div className="form-grid"><label>Response format<select value={config.format} onChange={e => update({ ...config, format: e.target.value as 'json' | 'csv' })}><option value="json">JSON array</option><option value="csv">CSV observations</option></select></label><label>Request shape<select value={config.requestMode} onChange={e => update({ ...config, requestMode: e.target.value as 'per-symbol' | 'batch', csvShape: e.target.value === 'per-symbol' ? 'long' : config.csvShape })}><option value="per-symbol">One request per ETF</option><option value="batch">One request with comma-separated symbols</option></select></label>{config.format === 'csv' && <label>API CSV shape<select value={config.csvShape} onChange={e => update({ ...config, csvShape: e.target.value as 'long' | 'wide', requestMode: e.target.value === 'wide' ? 'batch' : config.requestMode })}><option value="long">Long: date, symbol, price</option><option value="wide">Wide: date, one column per ETF</option></select></label>}</div>
        <details><summary>Request parameters and response mapping</summary><div className="details-body">
          <div className="form-grid">{(['symbol', 'start', 'end'] as const).map(key => <label key={key}>{key === 'symbol' ? 'Ticker parameter' : key === 'start' ? 'Start-date parameter' : 'End-date parameter'}<input value={config.params[key]} onChange={e => update({ ...config, params: { ...config.params, [key]: e.target.value } })}/></label>)}</div>
          {config.format === 'json' && <label>JSON array path<input value={config.arrayPath} onChange={e => update({ ...config, arrayPath: e.target.value })} placeholder="Leave empty for a top-level array; e.g. data.prices"/></label>}
          <div className="form-grid">{(['date', 'symbol', 'value'] as const).filter(key => !(config.format === 'csv' && config.csvShape === 'wide') || key === 'date').map(key => <label key={key}>{key === 'date' ? 'Date field' : key === 'symbol' ? 'Symbol field (optional for per-ETF requests)' : 'Adjusted-price field'}<input value={config.fields[key]} onChange={e => update({ ...config, fields: { ...config.fields, [key]: e.target.value } })}/></label>)}</div>{config.format === 'csv' && config.csvShape === 'wide' && <p className="hint">Wide CSV headers must use the exact selected ETF symbols, such as SPY and BND.</p>}
        </div></details>
        <div className="form-grid"><label>API authentication<select value={config.auth.kind} onChange={e => update({ ...config, auth: { ...config.auth, kind: e.target.value as CustomRestConfig['auth']['kind'], value: '' } })}><option value="none">No authentication</option><option value="bearer">Authorization: Bearer</option><option value="token">Authorization: Token</option><option value="x-api-key">X-API-Key header</option><option value="query">API key query parameter</option></select></label>{config.auth.kind !== 'none' && <label>Custom API credential<input type="password" autoComplete="off" spellCheck={false} maxLength={2000} value={config.auth.value} onChange={e => update({ ...config, auth: { ...config.auth, value: e.target.value } })}/></label>}</div>
        {config.auth.kind === 'query' && <><label>API key parameter name<input value={config.auth.queryName} onChange={e => update({ ...config, auth: { ...config.auth, queryName: e.target.value } })}/></label><p className="warning">This provider requires the credential in its request URL. The provider and browser network tools can see it. Our app excludes the endpoint query and credential from saved reports, errors and archives; prefer header authentication when available.</p></>}
        <label>Custom API price basis<select value={config.basis} onChange={e => update({ ...config, basis: e.target.value as CustomRestConfig['basis'], usdAndBasisConfirmed: false })}><option value="adjusted_close">Adjusted close (splits + distributions)</option><option value="total_return_index">Total-return index</option></select></label>
        <label className="check"><input type="checkbox" checked={config.usdAndBasisConfirmed} onChange={e => update({ ...config, usdAndBasisConfirmed: e.target.checked })}/>Custom API prices are USD and use the selected adjusted basis</label>
        <label className="check"><input type="checkbox" checked={config.permissions.derivedPersistence} onChange={e => update({ ...config, permissions: { derivedPersistence: e.target.checked, rawPersistence: e.target.checked && config.permissions.rawPersistence, export: e.target.checked && config.permissions.export } })}/>My provider permits saving these derived results locally</label>
        <label className="check"><input type="checkbox" checked={config.permissions.rawPersistence} disabled={!config.permissions.derivedPersistence} onChange={e => update({ ...config, permissions: { ...config.permissions, rawPersistence: e.target.checked } })}/>My provider also permits saving raw history locally</label>
        <label className="check"><input type="checkbox" checked={config.permissions.export} disabled={!config.permissions.derivedPersistence} onChange={e => update({ ...config, permissions: { ...config.permissions, export: e.target.checked } })}/>My provider permits exporting the permitted review content, including PDF</label>
        <p className="hint">Permissions are your source-specific declaration. They are not inferred from possession of an API key. Without raw-storage permission, prices are removed after each calculation.</p>
        <button className="quiet" onClick={() => { try { download(exportCustomConfig(config), 'rest-api-template.json'); setError(''); onNotice('API template exported without credentials or source permissions. Re-enter and confirm them when reusing it.'); } catch (e) { setError(providerErrorMessage(e)); } }}>Export API template without credentials</button>
      </>}
      {provider !== 'yahoo-local' && <><label className="check"><input type="checkbox" checked={accessConfirmed} onChange={e => { invalidate(); setAccessConfirmed(e.target.checked); }}/>I may access this API for my own portfolio review</label>
      <div className="button-row"><button className="secondary" onClick={connect}>Use these API settings</button><button className="quiet" onClick={() => choose('csv')}>Disconnect and use CSV</button></div></>}
    </div>}
    {error && <div className="error" role="alert">{error}</div>}
  </section>;
}
