# Worker + Static Assets deployment

Rebalance Review v1.2 packages the Vite frontend and a restricted same-origin Tiingo endpoint in one Cloudflare Worker. It needs no database or stored provider key. The browser supplies the user's key for each request; holdings and decision reasons never enter the endpoint. A successful build or dry run is not a public deployment.

## Verify locally

Use Node 24 and the committed npm and uv lockfiles:

```sh
npm ci
uv sync --locked
npm run typecheck
npm test
npm run oracle:check
npm run calendar:check
uv run --locked python -m unittest discover -s oracle -p 'test_*.py'
npx playwright install chromium firefox webkit
npm run test:e2e
npm run deploy:check
npm start
```

`preview:full` serves the already built frontend and API on `http://localhost:8787`. `npm run dev:full` also builds first. A separate Vite dev server proxies `/api` to port 8787. Vite's standalone preview on 4173 serves files but **does not implement the Tiingo endpoint or the production PDF Worker response headers**. Test both environments.

## Publish and verify

The checked-in `wrangler.jsonc` binds `ASSETS`, routes `/api/*` and the PDF Worker asset through the Worker, and configures a per-IP rate-limit binding. Use an authenticated Cloudflare account:

```sh
npx wrangler login
npm run deploy:check
npx wrangler deploy
```

Do not place a Tiingo key in Wrangler secrets, build variables, source files, or static assets. Users enter their own key in the application. Authentication is interactive and cannot be replaced by a fabricated account. A temporary preview, if provided by Wrangler, is a short-lived test deployment rather than a production URL or a completed rollback exercise.

On the actual HTTPS URL verify:

1. The landing page, direct route reload, compute Worker, local CSV and all-cash flows work.
2. The document's CSP retains `script-src 'self'`. HTTPS connections are allowed for configured customer APIs. The hashed `pdf.worker-*.js` response alone permits `wasm-unsafe-eval`; it is served through the Worker, overriding static CSP for that response.
3. `/api/providers/tiingo/eod` rejects wrong method/origin/ticker/date/auth and returns `Cache-Control: no-store, private`. Unsupported API paths return JSON 404, not the SPA. The frontend and endpoint must share an origin.
4. A real user-owned Tiingo key completes history → validation → calculation. Error contract tests do not establish provider entitlement, availability or completeness.
5. Actual downloads in Chromium, Firefox and WebKit contain extractable text and embedded local fonts/charts. Check a real phone separately; browser emulation is not physical-device evidence.
6. No token appears in generated assets, JSON/PDF, application logs or browser storage. Do not turn request/body capture on in an upstream observability service. Query authentication on custom URLs can be logged by the customer's provider or proxy; prefer header authentication.

Cloudflare's rate limiter is an abuse control, not precise billing or guaranteed quota accounting. Upstream Tiingo limits still apply. Generic custom APIs need browser CORS support or a customer-operated compatible proxy; the Worker is deliberately not an arbitrary URL relay.

## Versioning, rollback and release records

Retain the previous known-good version, build hashes and test evidence. `npx wrangler deployments list` and `npx wrangler versions list` identify deployment history; `npx wrangler rollback <VERSION_ID>` restores a verified earlier version. Inspect command help for the installed pinned Wrangler version before operating. Recheck headers, both Workers and a permitted archive after rollback. A first deployment cannot prove recovery to a previously deployed product; record this as pending until rehearsed.

Archives are schema v2. Legacy v1 opens as a read-only snapshot and can seed a new review. Starting fresh preserves the saved journal and does not broaden source permissions. Keep the v1.0 delivery evidence separate from v1.2.

Record actual environment, command results, artifact hashes and outstanding gates in `docs/V1_2_DELIVERY.md`. Public usability, real-user entry/comprehension/preference/reuse, screen-reader review and real-device behavior require separate evidence. Automated checks and an HTTPS URL do not prove them.

Primary sources: [Worker Static Assets](https://developers.cloudflare.com/workers/static-assets/), [rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/).
