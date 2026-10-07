# Three-minute demonstration and technical discussion

## Demonstration

- **0:00–0:30 — The decision.** Start the synthetic example. Explain that A is the current allocation and B a proposal; the displayed prices are generated, not a claimed investment track record.
- **0:30–1:20 — The comparison.** Confirm the zero-return cash assumption, compare, and explain one changed signed risk contribution. Show that both sides use the same dates, cost and execution assumptions.
- **1:20–2:00 — Uncertainty.** Compare the three estimation windows and cost/delay sensitivity. Explain an unavailable window or a partial-coverage example. Lower historical volatility does not establish suitability or predictive power.
- **2:00–2:40 — The decision record.** Write a concrete reason and next-review date, download the permitted PDF and show its assumptions. Saving is opt-in. A displayed date is not a scheduled reminder.
- **2:40–3:00 — Reproducibility.** Show the clean-package verification record, independent Python oracle, and source/license attribution. Explain the separate status of public deployment and live-provider/user tests.

## Technical questions to prepare

1. Why centered maximum-likelihood Ledoit-Wolf? Explain the annualization, independent sklearn comparison, cash exclusion from covariance fitting and Euler reconciliation.
2. Where can a backtest become misleading? Explain adjusted prices, common windows, missing-session rejection, initial costs, next-session execution and no forced terminal trade. Distinguish an as-retrieved dataset from point-in-time historical availability.
3. Why did the first delivery audit find bugs despite passing tests? The original tests did not cover source/file replacement, nested reset state, printable content, the cash-only entry route or regenerating fixtures without an external repository. Show the new targeted regressions.
4. What did you build versus reuse? Describe the financial/state/permissions contracts and original integration. Name ECharts, react-pdf, Papa Parse, Zod, Dexie, sklearn and exchange_calendars with their precise roles.
5. How are secrets and data retained? Describe BYOK transport, fixed server destinations, sanitized failures, operation-only cleanup and separate full-report versus decision-only output.
6. What remains unproven? Real-user preference/retention, actual device coverage, live-provider entitlement and any missing deployment evidence. Never turn tests or generated demos into a claim of economic alpha or user adoption.

## Recruiting positioning

Use verified engineering evidence in a resume: numerical cross-validation, explicit execution/cash accounting, source-bound import validation, browser Workers, API contracts, archive compatibility and tested report output. Add counts or timing only from the current release verification record. Do not claim paying users, fund deployment, superior investment performance or real-time execution.
