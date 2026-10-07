# Numerical verification

The TypeScript engine is an independent implementation. `generate.py` creates synthetic fixtures with NumPy, scikit-learn's centered Ledoit–Wolf estimator, and an independently expressed cash ledger solved using SciPy's Brent root finder. Both a 15% cash allocation and a fully invested allocation are regenerated for monthly, quarterly, and buy-and-hold scenarios at one- and two-session rebalance delays. No fixture contains observed ETF performance.

Method reference: [scikit-learn LedoitWolf documentation](https://scikit-learn.org/stable/modules/generated/sklearn.covariance.LedoitWolf.html). Scikit-learn is used as an oracle, not bundled into the browser. The shrinkage estimator is independently implemented in TypeScript from the public formula; no Python package source is copied into the product.

The repository includes `pyproject.toml`, `uv.lock`, and `.python-version`. Use [uv](https://github.com/astral-sh/uv) 0.12.21; the reference interpreter is Python 3.11.16. NumPy 2.4.6, pandas 2.3.3, SciPy 1.17.1, scikit-learn 1.9.1, and exchange-calendars 4.13.2 are pinned, including transitive packages and distribution hashes in the lockfile. This development environment is separate from the browser application.

From the repository root:

```sh
uv sync --locked
uv run --locked python oracle/generate.py --check
uv run --locked python oracle/generate_expanded.py --check
uv run --locked python src/data/generate_calendar.py --check
uv run --locked python -m unittest discover -s oracle -p 'test_*.py'
npm ci
npm test -- tests/engine.test.ts tests/data-calendar.test.ts
```

To deliberately regenerate the current numerical reference, run `uv run --locked python oracle/generate.py`. For an independent temporary output, append `--output /your/temporary/fixtures.json`; `--output` also chooses the reference checked by `--check`. Checks regenerate in memory and fail on structural, provenance, or numerical drift without rewriting the reference. Numerical comparison allows documented floating-point tolerances; it does not require different operating systems or BLAS implementations to serialize identical float bytes. The provenance records exact Python/library versions plus generator and dependency-lock hashes. Updating those versions requires an explicit reference regeneration and review.

`legacy-fixture.json` is a separate, frozen compatibility reference captured from the earlier fully invested ledger. It contains its own inputs, outputs, original provenance, original fixture hash, and historical source hash. The default generator never reads, changes, or imports it and requires no old research checkout. Its compatibility test is retained, but the package does not claim to regenerate that historical implementation. The current fully invested SciPy oracle is independently regenerated. The Python regression suite exercises generation in an isolated temporary tree, checks preservation of the frozen fixture, verifies deterministic repeated generation in one environment, and confirms that `--check` rejects deliberate numerical/calendar corruption, boolean values substituted for numbers, missing references and malformed JSON. Failed checks never create or repair those references.

Daily covariance uses centered maximum-likelihood normalization, then a 252 multiplier produces the annualized covariance returned in the review. Cash is appended as an exact-zero row and column **after** fitting risky assets. Euler contributions retain signs, reconcile to annualized volatility, and relative contributions are null for zero variance. The default needs 252 complete returns / 253 prices. The 126 and 504 return windows use the same A/B universe and dates; missing sensitivities are unavailable, never inferred.

Historical simulations use adjusted-close or total-return-index units. Initial cash buys risky units at the first input close, with initial transaction fees. At each later close the existing risky holdings first earn the price change. A monthly/quarterly signal executes at the first supplied close of the following period; the delay diagnostic adds one supplied session. Pending signals beyond the final observation are never forced through. An extra initial-purchase delay is not imposed: timing sensitivity applies to rebalances after initial construction.

For pre-trade NAV `V`, risky holdings `H`, risky target weights `w`, and per-side fee rate `c`, post-fee NAV `N` solves `N + c * sum(abs(w*N - H)) = V`. Residual cash is `N * (1 - sum(w))`. Only risky buys/sells incur fees, and cash earns zero. There are no dividend, fund-expense, borrowing, tax or brokerage charges on top of the supplied total-return basis. Allcash incurs zero fees.

The historical volatility is sample standard deviation of close-to-close net returns, annualized with sqrt(252). It excludes the initial entry event; total return, CAGR and drawdown include initial fees. CAGR uses actual elapsed calendar days / 365.25. Drawdown starts with the initial cash NAV. Turnover is cumulative gross traded notional / pre-trade NAV, **not** half that amount. Trade count counts execution dates with material risky notional, not individual orders.

Current weights are replayed over the latest common history within five calendar years of the declared cutoff. This is not actual-account performance or a recommendation. A/B use the same common observations, initial capital, timing and fee assumptions. Unsupported exposures need explicit partial confirmation; covered weights are normalized per portfolio and original covered weight fractions remain visible. These fractions alone do not assert market-value coverage.

The engine boundary checks complete daily observations against the data module's recorded US equity session calendar. Explicit synthetic fixtures instead use complete weekdays, including holidays, to keep their illustrative convention distinct from observed market data. Sparse weekly/monthly series, internal missing sessions and forward-filled holidays are rejected before the engine annualizes returns. Standalone numerical helpers assume their caller already passed this boundary; their small timing tests are not user datasets.

Tolerances: TypeScript covariance comparison `1e-12 + 1e-8 * maxabs(reference)`; risk/returns `1e-10 + 1e-8 * abs(reference)`; per-step money conservation `max(1e-8 dollars, NAV * 1e-10)`. Python reference checking uses covariance element tolerance `1e-12 + 1e-8 * abs(reference)` and ledger amount tolerance `1e-8 dollars + 1e-10 * abs(reference)`. Tests cover negative Euler contributions, cash, zero/one/identical assets, Python parity, frozen fully invested legacy compatibility, same-A/B equality, initial fees, execution/terminal timing, no future-data revision of ledger prefixes, partial coverage, invalid inputs and 100 generated self-financing cases.

Run `RUN_ENGINE_BENCHMARK=1 npm test -- tests/engine.performance.test.ts` to create your own `oracle/performance-v1.2.json` with 30 warm timings. Machine-specific benchmark outputs are not shipped with the public source package. The 50-asset/5,000-observation numerical workload and 50-asset full product engine workload are measured separately; the latter applies the five-calendar-year product cap. These Node measurements exclude browser UI paint, remote transfers and mobile hardware, and do not establish user comprehension or retention. The browser Worker harness is documented in [browser-performance.md](browser-performance.md).

## Optional private observed-data verification

The public source package contains synthetic numerical references and verification tools; it does not ship private price snapshots or earlier machine-specific verification records. Create current clean-package evidence with `scripts/package_release.py` and `scripts/verify_archive.py --full`. Only an actually completed GitHub workflow establishes a remote CI result.

`verify_local_market.py` can verify privately held Yahoo Finance adjusted-close response files for GLD, IEF and SPY. It checks original response hashes and complete exchange-session coverage, constructs a temporary CSV, invokes the actual TypeScript parser and review engine, and compares the daily ledger and all three risk windows with Python/SciPy/scikit-learn. Both test allocations include 15% zero-return cash. It does not import or execute another research repository. Users with appropriately permitted private snapshots can run:

```sh
uv run --locked python oracle/verify_local_market.py \
  --source-dir /private/directory/containing/original/responses \
  --output /private/directory/verification-evidence.json
```

The input convention is one `<SYMBOL>.json` Yahoo chart response and a matching `<SYMBOL>.json.meta.json` containing `sha256` and `retrieved_at`. The optional evidence output contains source hashes, dates, test coverage, code hashes and numerical errors; it contains no prices, daily returns, NAV paths or source-directory path. Intermediate observed CSV and engine outputs are removed when the check exits. This is parser/engine parity evidence for these private historical inputs; it does not verify a browser workflow, a live Tiingo connection, redistribution rights or investment results. The check is optional and excluded from CI because the private source data are deliberately not distributed. Rerun it after changes to any recorded code hash before treating the evidence as current.

## Expanded universe reference

`generate_expanded.py` creates the independent `expanded-50-fixture.json`: 50 synthetic assets, 505 prices, 126/252/504-session covariance/risk windows, cash and fully invested allocations, monthly accounting, and one-/two-session rebalance delays. It imports the independent SciPy ledger, not the TypeScript engine. Check with `uv run --locked python oracle/generate_expanded.py --check`; regenerate explicitly with `--output /temporary/expanded.json`.

Clean-package verification generates new outputs outside the extracted source and compares them with the packaged references using `scripts/compare_oracles.py` and the existing `assert_equivalent` tolerances. It records both hashes separately. Numerical equivalence across platforms does not require bit-identical serialized floats; all packaged source/reference files and the frozen legacy fixture remain byte-identical throughout verification.

## Optional actual-browser observed workflow

The optional wrapper exercises own-portfolio entry, holdings previews, observed price preview/apply, comparison, and session-only storage/export gates in Chromium, Firefox and WebKit against an already-running local Worker:

```sh
OBSERVED_MARKET_DIR=/private/directory/containing/original/responses uv run --locked python scripts/verify_observed_workflow.py --origin http://127.0.0.1:8787 --output /private/directory/browser-verification.json
```

It first runs the independent source/checksum/currency/calendar/numerical verification above. No price fixture, derived returns/NAV, trace, screenshot, HAR, PDF or archive is saved. Its sanitized output contains observation counts, pass/fail stages and code/build hashes. An absent environment variable produces `not-run`; it never substitutes synthetic data or counts an absent private input as a passing test. This opt-in check is separate from the wholly self-contained public-ZIP workflow.
