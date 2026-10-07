# Security and privacy reporting

Never include an API key, customer price history, private allocation or authorization header in a public issue. For a non-sensitive bug, provide a minimal synthetic reproduction, application version and browser version. If the hosting repository enables private vulnerability reporting, use that private channel; otherwise contact its maintainer through a verified private channel before sharing details. No unconfigured mailbox or guaranteed response time is advertised.

API keys belong only in the in-memory connection UI. The server accepts fixed Tiingo routes, not arbitrary relay URLs, and does not need holdings, weights or notes. API bodies and authorization headers must not be captured by deployment logging or analytics. Local journal storage is opt-in and is not an encrypted vault.

`npm audit` and dependency updates are maintenance inputs, not a complete security assessment. Never use a successful smoke test as evidence of universal safety or provider entitlement. CI has read-only repository permissions and does not expose deployment secrets to pull requests.
