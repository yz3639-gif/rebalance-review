# Personal API connections

Version 1.2 includes a personal-key Tiingo connector and a configurable HTTPS REST connector. Calculations still execute in the browser. No shared data key, portfolio account, brokerage order, scheduled refresh, or server-side portfolio database is introduced.

## No-key local personal research

Run `npm start`, open `/design/`, enter two allocations totaling 100%, and select **Compare portfolios**. Fresh local reviews automatically select **Yahoo Finance · local personal research · no key**. Explicit CSV/API choices and loaded examples are respected; a source failure never substitutes synthetic data.

The launcher passes `LOCAL_MARKET_DATA:enabled` only to local Wrangler. The Worker requires both that flag and a loopback request hostname. `GET /api/providers/local/status` advertises availability; `POST /api/providers/yahoo/eod` accepts only `{symbol,start,end}`. Normal public deployment does not set the flag, and a public hostname cannot enable it even if the flag is present. `npm run preview:full` keeps the public-like default with this connection disabled.

This connection uses Yahoo Finance's unofficial public chart interface for personal research. It requires no account/token, uses no cookie or authentication workaround, follows no upstream redirects, and does not retry rate limits automatically. It verifies the returned ticker, USD currency, ETF type, US venue and New York timezone, and accepts only positive `adjclose` observations with complete daily sessions. Request limits are the same two concurrent assets, 20 seconds per asset, 180 seconds per batch and 50 distinct ETFs. The requested end date is the previous trading session; recently launched ETFs shorten the common history and may have unavailable risk windows.

The policy is `yahoo-local`, with operation-only raw retention and no raw/derived persistence, full-report export or public display. Editing archive flags cannot expand it. Decisions-only PDF remains available. No downloaded prices ship in the repository or ZIP. This is not an official Yahoo integration or a licensed public data service. See [Yahoo's adjustment explanation](https://in.help.yahoo.com/kb/adjusted-close-sln28256.html) and [yfinance's description of the public interface and personal-use scope](https://ranaroussi.github.io/yfinance/); no yfinance dependency or implementation code is copied.

## Tiingo

Choose **Tiingo · use my API key**, enter your own token, confirm access and apply the settings. Compare requests the supported noncash symbols selected in A/B. Each request covers no more than five calendar years; at most two requests run concurrently, each asset request has a 20-second deadline, and a complete load has a 180-second deadline. A response is bounded to 20 MB. A/B may contain at most 50 distinct noncash ETFs. Progress and cancellation remain available during the batch.

The browser sends a POST to `/api/providers/tiingo/eod`. The body contains a supported ticker and start/end dates. The token is in the Authorization header. The Worker only constructs fixed `api.tiingo.com/tiingo/daily/{ticker}` metadata and `/prices` endpoints. It cannot proxy arbitrary URLs, redirects, hosts, methods or headers. It returns only the requested symbol, validated coverage dates, dates and adjusted closes, suppressing other provider response/error details.

Before sending a key upstream, the Worker checks a versioned, server-only identity snapshot from Tiingo's official [supported ticker directory](https://apimedia.tiingo.com/docs/tiingo/daily/supported_tickers.zip). The snapshot must match the application's exact ETF catalog version. A usable entry must be unambiguous, classified as ETF, quoted in USD, have nonempty historical coverage, and name a compatible US listing venue. Stocks, foreign-currency entries, OTC listings, reservations, conflicting duplicate tickers and missing identities fail closed with an explicit identity error. The live metadata endpoint must then agree with the ticker and compatible exchange; valid coverage and a complete requested final session remain separate checks. A user's USD checkbox cannot override contradictory provider identity.

Tiingo uses `NYSE` for many NYSE Arca funds (including SPY), as well as `NYSE ARCA`; Nasdaq listings use `NASDAQ` and Cboe BZX listings use `BATS`. The adapter allows these explicit venue aliases instead of requiring display-name equality. Unrecognized venues and venue conflicts remain blocked pending investigation. This is a conservative identity check, not proof of entitlement, corporate-action correctness, or complete freedom from historical ticker reuse. A listing in the application does not guarantee Tiingo compatibility; independently verified and permitted CSV remains available.

Maintainers refresh the factual snapshot with `node scripts/update-tiingo-identities.mjs` (inspect the summary) and then `node scripts/update-tiingo-identities.mjs --write` after updating the ETF catalog. The script requires no key, fetches no prices, writes atomically, and records source SHA-256, date and the catalog version. The current snapshot is `2026-10-06-cfa7721f69c7`, source ZIP SHA-256 `cfa7721f69c7a0d9510321ef16de34e4a51dd594624a4e10d33a7f751b0fc9b9`; it retains 5,749 metadata identities for 5,758 catalog symbols. **This count includes blocked identities.** Builds and normal startup use the committed snapshot and perform no metadata download. Tiingo metadata is not relicensed under the application's MIT license. The [official EOD documentation](https://www.tiingo.com/documentation/end-of-day) explains that its directory includes reservations and that live metadata is required to establish present coverage.

This connection passes the token and requested ticker through Cloudflare and Tiingo; the application does not persist or log them. Browser/network tools and infrastructure processing are outside a claim that data “never leaves the device.” Weights, balances and rationale are not sent. Application Worker observability is disabled. Requests/responses use no-store, no storage bindings or Cache API exist, and no provider token belongs in a static environment variable or deployment secret.

Tiingo's default manifest is `policy: tiingo-byok`, `retention: operation`: raw observations must be discarded after calculation. Edits requiring recalculation request them again. Raw and derived persistence/export are disabled, including the full analytical PDF, because possession of a token does not establish output-specific entitlement. A decision-only PDF remains available for the user's allocation inputs, selected assumptions and reasoning; it excludes source data and analytical results. The trusted policy cannot be relaxed by editing permission booleans. A user's personal API key is never a shared public-data license.

The official [BYOK documentation](https://www.tiingo.com/documentation/general/overview) describes software using each user's token without redistribution. [Header authentication](https://www.tiingo.com/documentation/general/connecting) is supported. [EOD documentation](https://www.tiingo.com/documentation/end-of-day) identifies `adjClose` as adjusted for splits and distributions. The [terms, reviewed October 6, 2026](https://app.tiingo.com/tos/), additionally restrict Starter/trial retention and require non-reconstructability for qualifying derived products.

## Custom REST

The custom connector makes HTTPS GET requests **directly from the browser**, with no application proxy. The API must allow the page's origin and requested authentication headers through CORS. A network/CORS error offers local CSV as the fallback. OAuth exchanges, executable transformations and APIs requiring an arbitrary server-side proxy are outside this connector.

- Choose one request per ETF or one batch request with comma-separated symbols.
- Map ticker/start/end query parameter names. Existing noncredential endpoint parameters are retained.
- Read a top-level or dot-path JSON array, long CSV observations, or wide CSV with exact ETF ticker headers. Map the date, symbol and adjusted-price fields as applicable. Wide CSV uses a single batch request.
- Use no authentication, Bearer, Token, X-API-Key, or a separately entered API-key query parameter. Query authentication necessarily exposes the credential in the provider request URL; header authentication is preferable when supported. Cookies are omitted and redirects fail.
- Confirm USD and the adjusted-close/total-return basis. Declare derived saving, raw saving and export permissions separately. Public-display permission is never inferred.
- Export a configuration template without the credential, source permissions or basis confirmation. This JSON documents the mapping for reuse; re-enter the credential and permissions when configuring a new connection. It is not a provider entitlement.

Credentials belong only in the separate credential input. Endpoint/source validation rejects common embedded authentication query names (including `api_token`, `access_key`, `auth`, subscription keys and signed-URL signatures), and detects the entered credential in raw or percent-encoded form, including nested encodings. Nonsecret static parameters such as response format remain allowed. Export repeats the credential check across the template. This reduces accidental disclosure; it is not a general detector for arbitrary secrets encoded or encrypted under an unrelated field name.

Automatic requests must reach their requested final trading session. A shorter start is acceptable only with enough common observations and a visible coverage summary; missing final sessions never become a silently stale review. API errors do not substitute generated data.

The manifest stores only the human source name and endpoint **origin**, not the full URL or authentication configuration. Missing sessions, invalid dates/prices, conflicting duplicates, inception violations and missing requested symbols reject the dataset. No data provider is silently replaced by generated data.

Custom data uses `policy: user-declared`. If raw saving is not permitted, `retention: operation` removes raw observations after calculation; independently declared derived saving/export can still permit a report. Full raw persistence requires its own permission. An API key does not verify the user's declarations.

## Worker deployment

`wrangler.jsonc` configures one Cloudflare Worker with Static Assets, not a Pages proxy or cron ingest service. Build `dist` first, then run the pinned Wrangler 4.147.0 dry run before deploying. The fixed API route runs through the Worker and has explicit no-store/nosniff/frame/CSP headers. Hashed PDF Worker assets additionally pass through a narrow response-header route permitting WASM only for that Worker; other scripts retain the document policy.

The API requires matching Origin, JSON content, bounded request size, a syntactically valid token, supported symbols and valid date limits. It uses a 60-request/60-second rate binding keyed by Cloudflare's connecting-IP header. This is burst protection, not exact global accounting or authentication. A missing rate binding fails closed. There is no public refresh/job endpoint.

Use the official [Cloudflare Wrangler Action](https://github.com/cloudflare/wrangler-action) for controlled deployments with a least-privilege deployment token. Preview and production should have separate rate-limit namespace IDs if isolated counters are required. Keep known-good deployment IDs and verify actual static/API headers and archive compatibility when rehearsing rollback.

## Verification and remaining proof

`tests/providers.test.ts` covers mappings, limits, concurrency, cancellation, rights, secret exclusion and custom JSON/long/wide CSV. `tests/provider-server.test.ts` covers fixed-host routing, malformed input, response projection, rate limits, stalled-body timeouts, sanitized errors and PDF-Worker-specific CSP. `tests/e2e/providers.spec.ts` exercises authentication/rate-limit recovery, repeat fetching, cancellation and late responses, disconnect credential clearing, permission invalidation, and derived-only archive/local saving with raw data and credentials excluded. These use explicitly synthetic network fixtures, not real provider observations.

A Wrangler dry run verifies bundling/configuration, not a live deployment. The authorized user's real-key Tiingo flow, selected custom provider's actual CORS policy, public HTTPS/security headers, quota behavior and rollback still need live verification. No real key was retrieved or embedded during implementation. Do not represent mocked tests as provider entitlement or production availability.

Cash symbols: `CASH`, `USD CASH` and `USD_CASH` explicitly designate modeled zero-return cash. The ticker `USD` is the ProShares Ultra Semiconductors ETF and must never be normalized to cash. ETF prices and product risks apply to `USD`.
