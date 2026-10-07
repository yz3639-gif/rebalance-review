# Bring your own portfolio

Start with **Review my portfolio**. Enter holdings separately from prices. You can keep editing holdings when market data are missing; the application must not substitute example data. The short examples below illustrate formats only and are too short for a report.

## Holdings

Paste a table or select a CSV/TSV file, read its columns, and map the symbol and weight/value fields. Explicitly choose percent weights, decimal weights, or USD market values. Percent weights must total 100; decimal weights must total 1. Add cash explicitly rather than leaving the sum short. Market values are converted to weights using their total.

```csv
symbol,weight
SPY,55
BND,35
CASH,10
```

The equivalent market-value input, with **Market values in USD** selected, is:

```csv
ticker,market_value
SPY,55000
BND,35000
CASH,10000
```

Select **Preview holdings** after mapping and inspect the rows and diagnostics before choosing **Import holdings**. Price imports likewise require a preview before applying the data. Changes to the source or mapping invalidate the previous comparison.

Search ETF codes and names in the versioned US-listed directory. The union of A and B is limited to 50 noncash ETFs, plus cash; a directory result is not proof of provider history or prices in the correct currency/basis.

Duplicate symbols require explicit merge confirmation. Unknown symbols stay in the input, but their returns are not invented. A partial report requires confirmation and labels the normalized covered portion. If actual USD values were not supplied, dollar-value coverage is unknown. Manual changes to weights invalidate the previous market-value mapping.

## Market history

Obtain adjusted daily prices or a total-return index from a source whose terms permit your intended use. A CSV file is not by itself a data license. Confirm USD and the adjustment basis, name the source, and declare persistence/export permission only when applicable. An ordinary close series usually does not include distributions and cannot be relabeled as adjusted data.

The default risk calculation needs 253 common price observations for 252 daily returns. The 504-return sensitivity needs 505. The report uses one common A/B interval; a newer asset can shorten it. Keep data continuous across supplied trading sessions. No interpolation, provider splicing, or silent removal of internal missing cells is performed. The program does not independently certify every exchange holiday or provider adjustment.

Long format (the numbers here are synthetic):

```csv
date,symbol,adjusted_close
2025-01-02,SPY,100.00
2025-01-02,BND,100.00
2025-01-03,SPY,100.20
2025-01-03,BND,99.90
```

Wide format (the same synthetic observations):

```csv
date,SPY,BND
2025-01-02,100.00,100.00
2025-01-03,100.20,99.90
```

For a total-return index, select that basis and map its value column. Values must be positive and finite. Dates use real `YYYY-MM-DD` calendar dates, may not be in the future, and may not exceed the declared cutoff. No price series is needed for cash; its zero-return assumption is separate and requires confirmation.

Use **Download synthetic CSV example** for a complete format demonstration, then select **Synthetic test data** under **Data provenance** when importing that file. Generated weekday series are not observed exchange-session data. The example is not real ETF history and should not be used to support an investment conclusion. Identical price duplicates can be removed only after confirmation; conflicting duplicates always block.

## When validation stops

Correct the file or mapping in response to the visible message, then re-import. Holdings should remain intact if price import fails. Do not fix missing data by filling forward or renaming unsupported securities. If the source does not grant storage/export rights, keep the review session-only. Tiingo BYOK and customer REST JSON/CSV connections use the same price-validation pipeline. See [PROVIDERS.md](PROVIDERS.md) for formats, CORS, credentials and capability declarations. A failed connection never substitutes synthetic data.

Archives are versioned JSON review records, not price CSV files. Import an archive through the saved-review controls; importing it must not overwrite existing records on a validation failure. See [PRIVACY.md](PRIVACY.md) for local data handling and [METHODS.md](METHODS.md) for calculation assumptions.

## Cash-only reviews and archive versions

When both portfolios are entirely USD cash, choose a cash replay start/end date and confirm the 0% assumption. The default is the most recent 253 verified trading sessions, ending before today. No ETF file is required. The internal `cash_zero` basis is a modeled calendar-only source and cannot be selected to relabel an uploaded ETF CSV. Net wealth is constant, fees and volatility are zero, and relative risk contributions are undefined.

New archives use schema v2 and carry source policy/capabilities. v1 files remain readable historical snapshots; use their weights to start a new review. They are not silently upgraded or granted additional permissions. Raw retention, derived retention and full-report export are separate permissions. Restricted sources may produce a clearly labeled decision-only PDF containing your own inputs, assumptions and reasoning, with no market-derived results.

Cash symbols: `CASH`, `USD CASH` and `USD_CASH` explicitly designate modeled zero-return cash. The ticker `USD` is the ProShares Ultra Semiconductors ETF and must never be normalized to cash. ETF prices and product risks apply to `USD`.
