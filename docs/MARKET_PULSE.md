# Market Pulse preview

The demo has three workspaces: **Market Pulse**, **Rebalance**, and the original **Research** terminal. The connected local app at `/design/` keeps its existing data, journal and export workflows. This preview does not change its analysis engine, archives or security policy.

## Run the preview

With the repository's pinned Node version and dependencies installed:

```sh
npm run build:demo
npm run preview:demo
```

Open `http://127.0.0.1:4175/rebalance-review/`. If that port is occupied, use `npm run preview:demo -- --port 4176` and adjust the address. `npm start` continues to start the complete connected local app on 8787, rather than this static preview.

## A three-minute walkthrough

1. **Market Pulse / Replay.** Watch the ticker strip and synchronized 50-ETF list. Search SOXL or another symbol; select it to update the chart. All prices and volumes in this mode are generated. The date and clock describe a fixed September 30, 2026 simulated session, not the current market. Pausing freezes numbers and ticker motion. Seek, change speed, reset, inspect a chart point, or open the data table. `/` focuses search and Esc clears inspection.
2. **Edit allocations on the homepage.** The right panel has editable A (current) and B (target) weights. Add any of the 50 demo ETFs or cash by symbol/name; remove rows or explicitly fill the remainder with cash. A blank or invalid field withdraws results until both sides total 100%. `050` becomes `50` on blur. Core rotation and Defensive shift replace B only; Keep allocation copies the actual edited A. Reset restores both example allocations. **Inspect the transition** opens dollar trades, after-fee values and available signed risk contributions; change account size, costs or risk window there. Drafts survive workspace and data-mode switches, but are not saved across page reloads.
3. **Market.** Switch to provider-hosted TradingView widgets for observed market data. The provider controls venue and delay. Native symbol controls update the chart. No embedded quote values are extracted into our calculations. Internet access and a working third-party service are required. A blocked widget offers retry, an external provider link and a return to Replay.
4. **Research.** Open the existing five-view historical A/B study. It uses the original frozen daily synthetic fixture, which is independent of the moving quotes and transition presets. Explore wealth/drawdown, holdings, covariance-derived correlation, costs, and report preview. Run locally to use your own portfolio and permitted source data.

## Data and calculation boundaries

- **Replay feed:** 50 genuine ETF identities; deterministic synthetic prices and interval volumes. One frame advances 30 simulated seconds. First visible frame includes 128 historical points through 10:33:30 ET; replay ends at 16:00 ET. Histories are bounded to 128 displayed points. Tab hiding, changing workspace or mode suspends playback. Reduced-motion users start paused, with tape motion disabled.
- **Breadth and asset groups:** calculated only over this synthetic demo basket. Group returns are equal-weight means of its members. Neither is an exchange index, trade feed, fund-flow measure, or actual market statistic.
- **Transition model:** current dollar values are A weights × the selected account value; price quotes are not required. Target weights apply after fees equal to `costBps / 10,000 × (buys + sells)` for noncash assets. The calculation solves for the self-financing post-fee NAV. Gross turnover is `(buys + sells) / before-trade NAV`, not half-turnover. Both sides must total 100%; neither blanks nor missing assets are silently filled. Dollar calculations and editing remain available if the separate risk worker fails. Fractional dollar trades; no taxes, impact, bid/ask spread model, orders or brokerage execution.
- **Active risk:** `sqrt((wB − wA)' Σ (wB − wA))` on already-annualized Ledoit–Wolf covariance. The fixed study covers SPY, VXUS, BND, GLD and IEF over 126/252/504-session synthetic windows ending September 30, 2026. Covariance is mapped by asset identity, independent of editor order. Another funded asset (for example SOXL) produces **Risk unavailable**, while dollar trades still calculate; a dormant zero/zero row does not remove risk coverage. Signed contributions sum to tracking error. Cash covariance is exactly zero; all-cash pairs need no risk worker. This is not a CAGR confidence interval or a claim of superior expected returns.
- **Research:** previously implemented historical ledger, windows and frozen result model. No provider credentials, raw restricted prices or user journal state enter the public demo.
- **Observed markets:** see [market-data-modes.md](market-data-modes.md) for the official widget integration, attribution and request/privacy boundary. Loading a frame does not establish quote freshness. No blanket LIVE claim.

## Visual system and interaction

Graphite panels with mint positive/primary actions, soft rose negatives, ice-blue risk values; locally hosted Geist and Geist Mono. The desktop canvas aligns watchlist, selected chart and decision summary. Phones use a full-width chart and independently scrollable watchlist. Every chart has a data-table alternative. Direction is also conveyed by signs and labels.

The main ECharts instance is reused and disposed on unmount; ResizeObserver and timers are cleaned up. Sparkline SVGs avoid creating 50 chart runtimes. No runtime financial data is persisted. A checked 50-asset catalog subset avoids shipping the entire ETF directory in the initial page; run `node scripts/update-market-catalog.mjs` after intentional catalog updates (`--check` verifies it without edits and runs during demo builds). The full synthetic session is finite; quote updates do not build an unbounded cache. Research and provider widgets are lazy loaded.

## Verification and media

```sh
npm test
npm run build:demo
npm run test:demo
node scripts/capture_pulse_media.mjs
python3 scripts/assemble_pulse_gif.py  # optional Pillow, media authoring only
```

Deterministic browser checks deliberately block external services and exercise failure/retry. Real vendor availability is a separate manual check. The media capture blocks market services and API routes; README screenshots and GIF contain only our synthetic interface. No financial values are edited into screenshots.

Publication was requested by the owner on October 7, 2026. The Pages workflow builds and tests the demo before publishing from `main`; see its actual run status for deployment completion. Existing ZIP/Ubuntu/production acceptance records are historical and do not certify this new working tree. Tax-aware transitions, bootstrap uncertainty, covariance-model comparison and real-account transition integration remain subsequent work.

[Observed local validation and remaining gates](MARKET_PULSE_VALIDATION.md).
