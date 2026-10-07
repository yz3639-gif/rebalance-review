# Market Pulse local validation — 2026-10-07

**Status: local checks passed; the owner requested publication on October 7, 2026.** Public deployment completion is reported by the [Pages workflow](https://github.com/yz3639-gif/rebalance-review/actions/workflows/pages.yml), separately from these local checks. This record does not inherit the prior release ZIP's Ubuntu or deployment acceptance. No existing accepted ZIP was replaced.

## Homepage allocation editing — follow-up

The homepage and Market view now expose the same A/B weight editor as the expanded Rebalance view. Draft inputs remain in root memory across view changes. Both percentage sums and the divided fractional sums must pass their original tolerances before calculation; empty inputs do not become zero. Direct edits withdraw old results immediately. Risk uses symbol-mapped sample covariance and is unavailable for other funded assets. Dollar trades remain available if the research worker fails.

- Pinned Node 24.21.0: demo build and TypeScript passed. Full unit suite: **577 passed; 2 opt-in benchmark skips**, including 64 draft tests. A seeded 300-case boundary check calls the actual transition/risk engine for every accepted draft; tolerances were not loosened.
- Final demo regression: **51 passed across Chromium, Firefox and WebKit**. Includes direct A/B edits, cash balancing, actual-A copy, `050` normalization, invalid draft recovery, SOXL missing covariance, BND row-reordering invariance, zero-weight asset handling, 320/390 mobile editing, and preservation across views/modes. Both asynchronous worker download failure and synchronous construction failure preserve editing/trades and recover on retry.
- Editing in a fresh Replay session creates no localStorage, sessionStorage or IndexedDB entries and sends no API requests, request payloads or external requests. Market tests intentionally block the official widget scripts; they verify input preservation and no intentional input forwarding, not third-party security isolation.
- Re-captured desktop, full transition and mobile images plus the animated replay. The default cash row is visible without scrolling the six-row example; larger allocations use the bounded table scroller.
- One intermediate test run overlapped a rebuild, causing old lazy chunk URLs to return 404 (47/48 passed). The failure log is retained separately. The final run uses one stable build; no test tolerance, timeout or error suppression was added to conceal this failure.
- A later geometric assertion caught partial clipping of the default cash row at browser-specific native input heights. Baskets of six or fewer rows now expand naturally; larger tables retain their scroller. The final 51-test run passes the unchanged desktop and 320/390 cash-row boundary assertions in all three browsers. The failed run is retained as `verification/allocation-editing-browsers-clipped-cash.log`.

Local machine evidence: `verification/allocation-editing-{build,units,browsers}.log` and `verification/allocation-editing-local.json` (source/build hashes). This follow-up does not rerun the connected app's full release gates, publicly deploy the preview, or certify a release ZIP.

## Original Market Pulse checks (before allocation editing)

The following measurements describe the preceding implementation. They are retained as historical evidence; performance, accessibility and live-vendor observations are not automatically recertified by the follow-up tests above.

| Check | Observed result |
| --- | --- |
| Build | Pinned Node 24.21.0; TypeScript and Vite demo build passed. Catalog subset `--check` passed. The connected application's build also passed. |
| Unit/numerical suite | 513 passed; 2 opt-in benchmark tests skipped. Includes 47 new transition/active-risk tests, 11 replay tests, and 5 catalog parity/provenance tests. |
| Public demo workflows | 27 passed, 9 each in Chromium, Firefox and WebKit. Search/selection, keyboard playback, date-locked values, cash signs, divergent risk bars, persistence across tabs, failed widgets/retry, and 320/390/1280/1440 layouts. External market scripts deliberately blocked for deterministic CI checks. |
| Existing app regression | 54 passed, 18 each in Chromium/Firefox/WebKit, across workbench, connected-workspace and design suites. Includes SOXL/import, full and cash reviews, saving/reopening, JSON/PDF, source restrictions, keyboard and responsive flows. This is a selected core regression, not a rerun of every prior release gate. |
| Official market widgets | Real ticker tape and price charts loaded in three browsers. SOXL, TQQQ and later CBOE-qualified IGV/ARKK were spot-checked; visible provider delay labels retained. All 50 native identity/configuration/callback selections checked in each browser (150 selections). This does not certify availability of all 50 vendor feeds. |
| Privacy in Replay | No external requests; no localStorage, sessionStorage or IndexedDB entries; no page errors in the measured run. Market mode has its separately disclosed third-party connection. |
| Sustained display | Chromium headless, unthrottled 1440×1000, 30.5 seconds at 4×: 1,179–1,181 DOM nodes, 88 SVG elements, p95 frame interval 16.7 ms, no observed tasks longer than 50 ms. This is a local observation, not a performance guarantee for all devices. |
| Accessibility | No automatic axe WCAG A/AA violations in the sampled Pulse and Rebalance views. Named generic containers were corrected to semantic roles. Gradient-related contrast checks require manual judgment; no blanket WCAG certification is claimed. Reduced motion starts paused and disables ticker motion. |
| Media | Three new screenshots plus a GIF captured from the running synthetic product, with external market/API requests blocked. Mobile chart capture waits for its actual SVG resize. No market numbers were painted into images. |

The exhaustive replay test originally exceeded its default five-second timeout while heavy browser checks ran concurrently. Assertions were rewritten to avoid constructing expensive matcher diagnostics on every successful invariant. All 653 advancing frames × 50 assets remain checked; numeric tolerances and timeouts were not widened. The complete suite then passed.

## Remaining boundaries

- Publication is authorized; successful public deployment must be confirmed from the new workflow run and served site.
- This is a static demo preview; personal holdings and new transition/report integration in the connected application are not claimed complete.
- Quotes in Replay and the transition study are synthetic. Provider-hosted Market data does not enter the portfolio engine or saved results.
- No licensed native live feed, taxes, bootstrap inference, alternate covariance default, new public deployment, exact-ZIP Ubuntu verification, real-phone certification, or target-user trials are claimed by this round.
- Existing dependency/source notice limitations remain recorded in the project's notices; no new npm runtime dependencies were introduced.

Commands and calculation assumptions are in [MARKET_PULSE.md](MARKET_PULSE.md); widget provenance and limitations are in [market-data-modes.md](market-data-modes.md).
