# Market data modes

Market Pulse separates the external market display from the portfolio research engine. Animation alone does not identify the provenance, freshness or economic meaning of a number.

| Mode | Source | Meaning | Changes portfolio results? |
| --- | --- | --- | --- |
| Real market view | Official TradingView embedded widgets | Provider-displayed quotes and charts; US equities are delayed. Check the widget for venue, timestamps and session status. | No |
| Synthetic replay | Deterministic demo fixtures | A simulated stream designed to demonstrate interaction and event handling. It is not observed market data. | No. Playback changes only the simulated quote display. |
| Research view | Existing frozen review context and result | Historical portfolio comparison using its own source, cutoff and assumptions | Only after a separate, explicit calculation |

The site does not label a delayed feed as realtime, fabricate updates during closed sessions, scrape widget prices or silently replace a failed market feed with simulation. US holidays, extended sessions, halts and provider outages cannot be inferred from the browser clock. Market-session state remains the provider's responsibility; the surrounding interface does not invent an Open/Closed badge.

## Official widget integration

`src/demo/MarketEmbed.tsx` exports:

```tsx
<MarketEmbed
  symbol="SOXL"
  onSymbolSelect={ticker => selectAsset(ticker)}
  includeTape={true}
/>

// Optional standalone use. Its vendor links are not claimed to synchronize
// our native inspector.
<TradingViewTickerTape />
```

Native symbol chips select the chart and call `onSymbolSelect` with a bare ticker. The Advanced Chart's internal symbol selector is disabled to keep the surrounding selection consistent. The legacy ticker tape's links retain TradingView's own behavior. The integration never reads an iframe's document, quote data or internal state.

Market search covers all 50 identities in the small `src/demo/market-catalog.json` snapshot; it does not import the full ETF registry. Search by symbol, fund name or exchange, then select a result. The 15 horizontally scrollable quick buttons and ticker tape are a curated shortcut, not the supported search limit. Keyboard users can Tab to results, press Enter to select a unique result, or Esc to clear the search.

Provider mappings are explicit: Nasdaq → `NASDAQ`, NYSE Arca → `AMEX`, Cboe BZX → `CBOE`. TradingView's current canonical pages identify [IGV as CBOE:IGV](https://www.tradingview.com/symbols/CBOE-IGV/) and [ARKK as CBOE:ARKK](https://www.tradingview.com/symbols/CBOE-ARKK/); the legacy BATS-IGV URL redirected to CBOE-IGV when checked on 2026-10-07. Nasdaq mappings were cross-checked with the [IEF symbol page](https://www.tradingview.com/symbols/NASDAQ-IEF/), and Arca with [SPY](https://www.tradingview.com/symbols/AMEX-SPY/). Unknown symbols and mismatched exchange-qualified inputs show an explicit unmapped state and do not silently fall back to SPY. A valid directory identity still does not guarantee that a vendor permits its display in widgets.

The widgets mount only while the visitor is in the real-market mode. They require no credentials. Integration code serializes public symbols and chart/display settings, not A/B weights, account value, decision notes or imported data. Ordinary browser connection information is also shared with TradingView. Visitors can read the source/privacy disclosure next to the chart. Unmounting removes widget frames and the integration's own timers and event listeners.

Editable A/B rows belong to the page's in-memory allocation draft. The demo does not intentionally send them to TradingView or persist them in browser storage, a URL or a server. Changes to a valid allocation drive the separate transition calculation; a real quote or synthetic replay tick does not change those inputs, mark the account to market or supply missing covariance data. The full local workbench's saved reviews and source-permission controls remain separate.

The integration uses the official, vendor-hosted scripts:

- `https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js`
- `https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js`

These are externally managed widgets, not vendored/open-source libraries. Their public embed URLs are not version-pinned; availability and compatibility require a runtime smoke check. Attribution, links and branding remain visible. Our React lifecycle wrapper, fallback UI and symbol controls are original project code; the configuration follows TradingView's published embedding examples. No vendor bundle or market-price dataset is copied into the repository.

The newer `tv-ticker-tape` web component documents a `tv-link-open` event, but its published module returned HTTP 403 in the implementation environment on 2026-10-07. This release therefore uses the established official iframe embed. The documented new API is not treated as runtime-verified support.

## Loading, errors and truthful status

The host waits up to 15 seconds for an iframe load. Script errors and a missing frame produce an explicit unavailable state with retry and an external TradingView link. A successfully loaded frame does **not** prove that its quote is current or even available: the provider may render a symbol restriction, delayed data or an internal connection error. Reload and the provider link remain accessible after frame load. The application neither bypasses symbol restrictions nor claims to detect errors inside a cross-origin frame.

## Deployment and privacy boundary

The public demo is a separate entry point and may load third-party market widgets. The local portfolio application and its restrictive production Content Security Policy remain separate. GitHub Pages does not implement Cloudflare's `_headers` rules.

The vendor-hosted loader executes in the parent page's JavaScript context; only its resulting provider frames are cross-origin. Consequently, the editable allocation fields are not sandboxed away from all external code. Saying that our integration does not intentionally forward weights is not a claim of third-party security isolation. Switching back to Replay removes the frames but cannot undo scripts already executed in the current tab. A fresh Replay-only session does not load the market provider. See [PRIVACY.md](PRIVACY.md) for the distinction between this demo's memory-only inputs and the local application's optional storage.

For a host with CSP enforcement, enable only the reviewed widget origins on the **public demo route**. The loader is on `https://s3.tradingview.com`; embedded frames are normally served from `https://www.tradingview.com` and `https://www.tradingview-widget.com`. Verify the actual redirect and resource chain at deployment. Requests made inside a cross-origin vendor frame are controlled by that frame's policy. Do not weaken the full local application's script policy or add broad `https:`/wildcard script allowances just to display a widget. A blocked widget must leave the useful, explicitly labeled replay and research modes accessible.

Personal Tiingo, Alpaca or Massive subscriptions are not assumed to grant anonymous public display or redistribution. A future native live-price wall would require a separately reviewed public-display license and a server-side connection, with secrets kept out of the client bundle. BYOK local analysis is a different use case. No such license, live-data server or personal API key is introduced by this widget integration.

## Official references, checked 2026-10-07

- [TradingView Advanced Chart](https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/)
- [Ticker Tape](https://www.tradingview.com/widget-docs/widgets/tickers/ticker-tape/)
- [Official legacy widget integration](https://www.tradingview.com/widget-docs/tutorials/iframe/build-page/widget-integration/)
- [Widget data FAQ](https://www.tradingview.com/widget-docs/faq/data/): widgets are not a raw-data export API; a personal TradingView upgrade does not upgrade embedded data.
- [North America coverage](https://www.tradingview.com/widget-docs/markets/north-america/): NASDAQ, NYSE and Arca currently list delayed Cboe One data.
- [General widget FAQ](https://www.tradingview.com/widget-docs/faq/general/): branding/attribution changes require contacting TradingView.
- [New web-component link events](https://www.tradingview.com/widget-docs/tutorials/web-components/custom-links/)
- [TradingView privacy policy](https://www.tradingview.com/privacy-policy/)
- [Tiingo licensing/developer overview](https://www.tiingo.com/documentation/), [Alpaca market-data plans](https://docs.alpaca.markets/us/v1.1/docs/about-market-data-api), [Massive display/redistribution distinction](https://www.massive.com/stocks)
