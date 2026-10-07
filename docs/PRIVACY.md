# Privacy and source permissions — v1.2

Portfolio inputs, imported local files, risk calculations, notes and PDF generation run in the browser. No app account, brokerage login, remote AI, advertising, or product analytics is used. API connections are optional network operations; the prior CSV-only statement that the app never makes remote data requests no longer describes this version.

## What leaves the browser

Tiingo requests contain the user's token, requested ETF symbol and date range. They transit the application's same-origin Cloudflare Worker and then the fixed Tiingo EOD endpoint. The application does not record tokens, body content or prices, persist provider responses or share a key between users. Standard host/provider networking may still process IP addresses and request metadata. Holdings weights and decision notes are not sent to the proxy.

Custom API requests go directly to the exact user-configured HTTPS service. That service receives configured ticker/date parameters and any required credential. Header authentication is preferred; query authentication, where required, exposes the key in the provider request URL and browser network tools. The application removes credentials from saved configuration/report/archive data and sanitizes errors. Endpoint CORS, service terms and authentication remain the service owner's responsibility. Custom URLs are never routed through the application's server proxy.

## Memory and storage

Keys stay only in component/adapter memory and are cleared on disconnect, provider switch and Start fresh. For operation-only sources, raw prices remain only during retrieval/validation/calculation. On completion, failure or cancellation, code releases references and terminates the computation Worker. JavaScript garbage collection does not provide a proof of physical memory erasure.

CSV prices may remain in the active tab for session-only review. Explicitly permitted raw storage is separately gated. Local journal saving requires opt-in; no calculation automatically creates a record. Storage is scoped to the browser profile and website origin and is not encrypted account synchronization. Exported archives and PDFs may contain financial information. Browser/site-data deletion or a change of origin can remove access to local records.

Start fresh clears unsaved inputs, mapped files, source declarations, current reports, API credentials and outstanding tasks. It preserves the saved journal and browser-storage opt-in. The separate Clear saved reviews action deletes the journal after confirmation. Invalid archive imports do not overwrite records. Schema v1 records can be read, while new saved reviews use v2.

## Source-specific capabilities

Permissions distinguish display, raw persistence, derived persistence, export and public display. Raw retention is separately operation-only, session or persistable. A source policy can cap permissions; a checkbox does not override the Tiingo BYOK restriction. Replacing a file or changing its interpretation invalidates the previous declarations. A source name or possession of a key is not independent evidence of a license.

Tiingo default policy permits transient on-screen review and disables raw/full-derived saving and exporting. The Starter/trial terms require removing raw data after the calculation. Paid access alone does not establish permission to distribute complete return paths. This product does not attempt to certify subscription entitlements or non-reconstructability of daily NAV charts. [Terms reviewed 2026-10-06](https://app.tiingo.com/tos/).

When full output is restricted, decision-only PDF includes the user's allocations, chosen assumptions and reasoning, without market observations or calculated results. It is labeled differently from a complete analysis report. A full PDF is allowed for synthetic data and source declarations with corresponding derived-export permission. No export flag authorizes publishing a user's private portfolio.

## Verification boundaries

Tests use planted fake keys to check request destinations, state resets, archives and outputs. These checks establish observed behavior, not a comprehensive security certification. Production response headers, authenticated provider access, real-device behavior and user consent must be verified separately. Real provider responses, credentials, personal portfolios and raw Playwright traces do not belong in the public release package.

## Local Yahoo research connection

`npm start` enables a no-key Yahoo Finance connector only on loopback. The local Worker sends selected tickers and date ranges to the fixed public chart host; portfolio weights, starting value and notes stay in the browser. There is no authentication, cookie forwarding, cross-user cache or automatic retry. Responses and local capability checks use no-store. Prices are operation-only and are not added to drafts, archives, release packages or full PDF exports. The `yahoo-local` policy caps permissions independently of editable flags. Public deployment cannot enable this connector on a public hostname.
