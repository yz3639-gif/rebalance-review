# Changelog

## 1.2.1 — quality-fix candidate

- Reject embedded raw or encoded API credentials in exported configuration and source metadata.
- Cross-check Tiingo symbols against a versioned provider identity directory and live exchange metadata before accepting prices.
- Reject internally inconsistent archived risk, cost sensitivity, cash and raw market-data values while preserving supported historical formats.
- Count positive ETF exposures consistently and validate portfolios and settings before spending provider requests.
- Recover chart and PDF generation after failed network requests, preserving user inputs.
- Preserve every line of long, newline-heavy PDF rationales across page boundaries.

The original 1.2.0 package remains immutable. Its earlier passing tests did not cover these defects; 1.2.1 requires its own exact-package evidence. Public deployment, authenticated Tiingo, real-device and user gates remain separate.

## 1.2.0 — release candidate

- Expand the asset directory beyond the original demo list and use a 50-asset comparison limit.
- Strengthen import replacement, data freshness, archived-record isolation and permission-aware reporting.
- Add a single `npm start` path for the complete local Worker application.
- Bind clean-package verification to exact ZIP/source/build hashes; add terminal timeout/failure reports and Ubuntu verification.
- Serve preserved third-party notices and runtime SBOM with the website; document upstream attribution limitations.
- Pin Miniflare's sharp dependency to the patched 0.35.5 release.

Current acceptance evidence belongs to each exact candidate ZIP. See `docs/V1_2_DELIVERY.md`; this list does not claim public deployment or user validation.

## 1.1.0

The original v1.1 ZIP and evidence remain separate, immutable historical artifacts. They are not proof that v1.2 passed.
