# Calculation methods

Rebalance Review compares two hypothetical, long-only portfolios of USD-listed ETFs and USD cash. It replays the **weights entered today** against historical data. Its results are not brokerage-account returns, forecasts, loss probabilities, security-selection advice, or a reconstruction of the investor's actual transactions.

This document describes the product contract. The current verification report, rather than this description, determines which claims have been tested.

## One dataset for both portfolios

The calculation uses the ordered union of assets held by A and B and one common price-date interval. Market data must be adjusted closing prices or a total-return index, with an explicit USD currency, cutoff, source, and rights manifest. Ordinary closing prices are not interchangeable with these series. Dividend and expense adjustments already reflected in the series are not charged again.

The import path does not interpolate missing internal observations, splice sources, or fill unknown holdings with synthetic prices. Nonpositive or nonfinite prices, invalid/future dates, ambiguous duplicates, and internal gaps prevent calculation. Shorter histories are visibly identified. Unsupported holdings remain in the input; a partial calculation requires explicit consent and discloses the fractions of the original allocations that remain. A weight-derived covered fraction is not verified dollar-value coverage. Portfolio A and B are normalized independently only when a partial calculation has been expressly accepted.

The supported-symbol registry and the engine's capacity are different concepts. The engine capacity is 50 noncash assets across the union of both portfolios. Registry entries are not endorsements or proof that a particular uploaded series has the correct adjustment convention.

## Cash-only source

If both complete portfolios hold only USD cash, the app creates a `cash_zero` source with calendar dates and no price columns. The default period has 253 verified sessions ending before today; the user can change it within the supported calendar and five-year limit. The engine independently rejects risky assets or fabricated price columns in this mode. Constant wealth, zero costs and zero volatility follow from the explicit 0% assumption, not observed market data.

## Risk at the data cutoff

Simple daily returns are `price[t] / price[t-1] - 1`. The default window is the last 252 complete daily returns, which needs 253 common price observations. The 126- and 504-return estimates are separate sensitivities; insufficient histories remain unavailable rather than borrowing dates or imputing values. Annualization uses 252 trading days.

The risky-asset covariance estimate follows the centered, maximum-likelihood Ledoit–Wolf convention in scikit-learn. Its shrinkage target is a scaled identity matrix. This regularization estimates covariance; it does not establish future stability. USD cash is excluded from that fit, then receives an exact-zero covariance row and column. Including a zero-return cash column inside shrinkage could otherwise create an artificial positive cash variance. See the [scikit-learn reference](https://scikit-learn.org/stable/modules/generated/sklearn.covariance.LedoitWolf.html).

For annual covariance `Σ` and weights `w`, volatility is `sqrt(wᵀΣw)`. The signed Euler contribution of asset `i` is `w[i] × (Σw)[i] / volatility`. Contributions sum to portfolio volatility within numerical tolerance and may be negative. Relative contributions divide by volatility when it is positive; they are unavailable when total volatility is zero. An all-cash portfolio has zero modeled volatility and no defined percentage risk contributions. Negative contribution is a covariance result, not a promise of protection. Correlation is not a measure of overlapping underlying holdings.

## Historical replay and costs

History uses the common interval within five calendar years of the dataset cutoff. Both portfolios use identical dates, transaction-cost assumptions, and execution timing. The user may choose monthly, quarterly, or buy-and-hold. A monthly or quarterly signal occurs at the final input session of the period; execution is at the next input session's close. The old holdings earn the execution day's return. The extra-delay diagnostic executes one additional input session later. A terminal signal with no eligible future execution does not cause a forced trade.

The account begins as cash. Its first investment at the initial price observation includes purchase costs. Subsequent rebalances solve for self-financing post-cost target holdings and cash. Costs apply per side to the absolute dollar amount bought or sold in risky assets; cash itself is not charged. The default is 5 basis points per side, with 2/5/10/20 basis-point sensitivities. An all-cash account pays no trading costs. The ledger preserves fees, holdings, and cash rather than subtracting a turnover estimate from returns after the fact.

Prices are interpreted as total-return units. This is a hypothetical friction model: no taxes, bid/ask microstructure, slippage estimate, broker commissions, fractional-share restrictions, margin, borrowing, or investor cash flows are modeled. The zero historical return assumption for cash requires explicit confirmation; it is not a cash-yield forecast.

Report metrics include compounded total return, calendar-time CAGR, annualized volatility, peak-to-trough drawdown, and modeled fees. No Sharpe ratio is presented without a suitable risk-free series. A larger historical return or lower estimated risk does not identify the better future portfolio.

## Numerical acceptance criteria

Independent Python/scikit-learn calculations provide the covariance reference. Ledger checks must separately verify timing and self-financing behavior; matching two copies of the same implementation is insufficient evidence.

| Quantity | Maximum absolute difference |
| --- | --- |
| Covariance element | `1e-12 + 1e-8 × max(abs(reference covariance))` |
| Returns, volatility, risk contribution | `1e-10 + 1e-8 × abs(reference value)` |
| Single-step money residual | `max($1e-8, NAV × 1e-10)` |

Required invariants include identical A/B yielding zero differences, Euler contributions summing to volatility, no-cash parity against the unchanged prior ledger, fee/cash conservation, and future data not changing already executed historical ledger values. Retrospective risk estimates at a later cutoff legitimately change because their estimation window changes. Constant assets, one asset, identical assets, negative contribution, split/dividend-adjusted inputs, short inception, all cash, initial costs, terminal signals, partial coverage, and delayed execution need explicit cases.

No prior research test count establishes these properties for this browser product. Engineering checks do not establish investor usefulness; the real-user gates in [USER_TEST_PROTOCOL.md](USER_TEST_PROTOCOL.md) are separate.

Cash symbols: `CASH`, `USD CASH` and `USD_CASH` explicitly designate modeled zero-return cash. The ticker `USD` is the ProShares Ultra Semiconductors ETF and must never be normalized to cash. ETF prices and product risks apply to `USD`.
