# References, licenses and original contribution

Reviewed 2026-10-06. Versions are resolved by `package-lock.json` and `uv.lock`. References do not imply endorsement. `THIRD_PARTY_NOTICES.md` and `licenses/` preserve installed package notices; the bundled modified font has its own OFL and source/hash manifest in `public/fonts/`.

| Source | Actual use |
| --- | --- |
| [react-pdf](https://github.com/diegomura/react-pdf), MIT, renderer 4.9.0 | Browser Worker PDF layout, pagination, embedded fonts and selectable text. No screenshot-to-PDF conversion. |
| [Apache ECharts](https://github.com/apache/echarts), Apache-2.0 | Existing SVG UI chart and a PNG generated from the same options for PDF. |
| [buffer](https://github.com/feross/buffer), MIT, 6.0.3 | Worker-local compatibility for the PDF image decoder; not added to the page global scope. |
| [fflate](https://github.com/101arrowz/fflate), MIT, 0.8.3 | Lossless PNG decompression. A small callback adapter uses upstream synchronous decompression inside the existing PDF Worker, avoiding a nested-worker offline failure. No decompression algorithm is copied. |
| [React](https://react.dev/learn/preserving-and-resetting-state), MIT | Component-key reset across new reviews; ordinary controlled form state. |
| [Papa Parse](https://www.papaparse.com/docs), MIT | CSV parsing; financial semantics and rights checks remain product code. |
| [Dexie](https://github.com/dexie/Dexie.js), Apache-2.0 | Opt-in local IndexedDB journal. |
| [uv](https://github.com/astral-sh/uv), MIT/Apache-2.0 | Locked independent Python environment and reproducibility commands. |
| [scikit-learn LedoitWolf](https://scikit-learn.org/stable/modules/generated/sklearn.covariance.LedoitWolf.html), BSD-3-Clause | Independent covariance oracle. NumPy/SciPy supply the separate accounting reference. |
| [exchange_calendars](https://github.com/gerrymanoim/exchange_calendars), Apache-2.0 | Frozen US exchange-session calendar generator, checked against historical closures and published dates through 2028. |
| [Cloudflare workers-sdk](https://github.com/cloudflare/workers-sdk), MIT/Apache-2.0, Wrangler 4.147.0 | Worker + Static Assets tooling, restricted BYOK proxy and local API verification. |
| [Tiingo developers](https://www.tiingo.com/documentation/appendix/developers), [EOD API](https://www.tiingo.com/documentation/end-of-day), [terms](https://app.tiingo.com/tos/) | Optional BYOK integration. Default policy uses prices transiently and prohibits saving/exporting market-derived results. Integration code is distinct from verified account entitlement or successful live-key testing. |
| [Ghostfolio](https://github.com/ghostfolio/ghostfolio), AGPL-3.0 | Read-only reference for portfolio import/error flows. No Ghostfolio application code incorporated. Its Angular/NestJS/database architecture is not used. |
| [testfolio methodology](https://testfol.io/guides/portfolio-backtester/) | Read-only comparison of execution and fee assumptions, not a copied engine or performance-equivalence claim. |
| [Playwright accessibility](https://playwright.dev/docs/accessibility-testing), [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Browser checks and accessibility target; passing axe does not prove complete accessibility conformance. |

Original contribution is the self-financing browser ledger, risk/coverage semantics, source capability enforcement, cancellation and reset protocol, shared report context, independent numerical comparisons and executable release evidence. Reused libraries supply rendering, storage, parsing and numerical primitives. No performance claim follows from library reputation.

PyPortfolioOpt, empyrical-reloaded, QuantStats, bt, skfolio, Riskfolio-Lib and Portfolio Performance were considered as references; they are not claimed as incorporated product dependencies. The original multi-asset research baseline remains unchanged.

## Upstream notice limitations

The notice build preserves full published texts where available, including the entire react-pdf package family. Eight upstream packages omit complete license text or have conflicting declarations in their exact published artifacts. `scripts/upstream-licenses.json` records the exact evidence and hashes; `THIRD_PARTY_NOTICES.md` identifies them individually. A generic license template has not been substituted for missing upstream copyright text. The source ZIP does not redistribute node_modules. This manifest is an inventory of evidence, not legal certification of every transitive package.

## v1.2 design references

These are inspected design/test patterns, not dependencies or copied application code:

| Repository and inspected revision | Pattern used |
| --- | --- |
| Ghostfolio `63216e009b413f9865266203f33597e7a8e8bacb` | Import selection/preview, row errors and explicit final apply |
| spiritix/portfolio-backtester `a8fb452b2955e7173ccad3bda637d26aeda75db2` | Versioned input-only draft persistence and a recoverable error boundary |
| portfolio-performance/portfolio `cf247a71f6d132bb73b343cbdae395b87b95ae69` | Independent problem checkers and separately chosen recovery actions |
| ranaroussi/quantstats `9ef4c6d0a4ffe7831f6ebba6a5824fd33a90c05a` | Regression tests for report parameters, dates and numerical semantics |

QuantStats' drawdown sign and annualization conventions are not assumed interchangeable with this project's methods. Ghostfolio application code is not copied into this MIT project. Local regressions must establish our behavior independently.

The MIT/ISC declarations preserved from upstream packages are licensing evidence even when there is no standalone LICENSE file. Canonical SPDX texts are supplied separately in `licenses/standard/`, clearly labeled; they do not manufacture missing package copyright text or resolve the hsl-to-hex MIT/ISC discrepancy. The optional native libvips binaries are installed by npm, not redistributed inside this source ZIP.


## Interactive design study components

- `lucide-react@1.52.0` (ISC): interface icons.
- `@fontsource-variable/geist@5.3.0` and `@fontsource-variable/geist-mono@5.3.0` (OFL-1.1): self-hosted typefaces; font notices are preserved under `licenses/npm-_fontsource-variable_geist-5.3.0/` and `licenses/npm-_fontsource-variable_geist-mono-5.3.0/`.
- Existing Apache ECharts: SVG charts, linked date axes, zoom, bars and heatmaps. Financial calculations remain the project's existing engine.
- [Vite multi-page build](https://vite.dev/guide/build.html#multi-page-app) and [Cloudflare HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/): separate static design entry at `/design/`, with `/design` redirected by the asset service. No API route change.
- [Koyfin Model Portfolios](https://www.koyfin.com/features/model-portfolios/), [TradingView Supercharts](https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/) and [Composer](https://www.composer.trade/): public interaction/layout references for the five-view workspace, linked charts and selection inspector. No proprietary interface code or branding was copied. These references do not establish comparative usability or visual-quality superiority. See the [demo and technical guide](DEMO_AND_TECHNICAL_GUIDE.md) for the implemented workflow and [methods](METHODS.md) for the calculation boundaries.
