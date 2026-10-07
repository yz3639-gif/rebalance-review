"""Verify private observed Yahoo snapshots through CSV parsing and both numerical engines.

No network calls, new provider downloads, original-checkout imports, or public
price fixtures. Intermediate CSV, spec and daily results live only in a temporary
directory removed on completion. The optional output contains coverage and parity
evidence, not prices, returns, NAVs, account information or local source paths.
This is parser/engine integration evidence, not a browser or live-provider test.
"""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from zoneinfo import ZoneInfo

import exchange_calendars as xcals
import numpy as np
from sklearn.covariance import LedoitWolf

from generate import ledger


ROOT = Path(__file__).resolve().parent.parent
SYMBOLS = ["GLD", "IEF", "SPY"]


def observed_series(directory, symbol, start, end):
    path = directory / f"{symbol}.json"
    raw = path.read_bytes()
    metadata = json.loads(path.with_name(path.name + ".meta.json").read_text())
    digest = hashlib.sha256(raw).hexdigest()
    if digest != metadata["sha256"]:
        raise ValueError(f"{symbol}: original response checksum does not match retained metadata")
    chart = json.loads(raw)["chart"]
    if chart.get("error") or len(chart.get("result", [])) != 1:
        raise ValueError(f"{symbol}: unsuccessful source response")
    result = chart["result"][0]
    if result["meta"].get("symbol") != symbol or result["meta"].get("currency") != "USD":
        raise ValueError(f"{symbol}: unexpected identity or currency")
    zone = ZoneInfo(result["meta"]["exchangeTimezoneName"])
    timestamps, adjusted = result["timestamp"], result["indicators"]["adjclose"][0]["adjclose"]
    if len(timestamps) != len(adjusted):
        raise ValueError(f"{symbol}: timestamp/value alignment differs")
    series = {}
    for timestamp, value in zip(timestamps, adjusted):
        day = datetime.fromtimestamp(timestamp, tz=timezone.utc).astimezone(zone).date().isoformat()
        if start <= day <= end:
            if day in series or value is None or not np.isfinite(value) or value <= 0:
                raise ValueError(f"{symbol}: duplicate or invalid source observation")
            series[day] = float(value)
    return series, dict(symbol=symbol, retrievedAt=metadata["retrieved_at"], rawSha256=digest)


def assert_close(actual, expected, absolute, relative, category, maxima):
    actual, expected = np.asarray(actual, dtype=float), np.asarray(expected, dtype=float)
    if actual.shape != expected.shape or not np.isfinite(actual).all() or not np.isfinite(expected).all():
        raise ValueError(f"{category}: shape or finiteness mismatch")
    error = np.abs(actual - expected)
    maxima[category] = max(maxima.get(category, 0.0), float(error.max(initial=0)))
    if np.any(error > absolute + relative * np.abs(expected)):
        raise ValueError(f"{category}: numerical parity tolerance exceeded")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True, help="Private directory of original Yahoo JSON and matching .meta.json files.")
    parser.add_argument("--start", default="2023-01-01")
    parser.add_argument("--end", default="2025-12-31")
    parser.add_argument("--output", type=Path, help="Optional sanitized verification evidence destination.")
    args = parser.parse_args()
    series, sources = {}, []
    for symbol in SYMBOLS:
        series[symbol], source = observed_series(args.source_dir, symbol, args.start, args.end)
        sources.append(source)
    dates = xcals.get_calendar("XNYS", start=args.start, end=args.end).sessions.strftime("%Y-%m-%d").tolist()
    if len(dates) < 505 or any(set(series[symbol]) != set(dates) for symbol in SYMBOLS):
        raise ValueError("Observed input must contain at least 505 complete common exchange sessions; no missing observations are filled.")
    prices = np.asarray([[series[symbol][day] for symbol in SYMBOLS] for day in dates])
    targets = {"a": [0.0, .30, .55], "b": [.20, .30, .35]}
    today = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    manifest = dict(id="private-observed-verification", source="Yahoo Finance, retained as-retrieved historical snapshot; private verification only", currency="USD", basis="adjusted_close", asOf=dates[-1], synthetic=False, retention="session",
                    rights=dict(display=True, rawPersistence=False, derivedPersistence=False, export=False, publicDisplay=False, evidence="Existing private historical research snapshot; no downstream storage/export or public-display permission asserted", verifiedAt=today))
    settings = dict(frequency="monthly", costBps=5, initialNav=100000, cashReturnConfirmed=True, partialCoverageConfirmed=False)
    for name, target in targets.items():
        settings[name] = dict(id=name, name=name.upper(), holdings=[dict(symbol=symbol, weight=weight) for symbol, weight in zip(SYMBOLS, target)] + [dict(symbol="CASH", weight=.15)])
    with tempfile.TemporaryDirectory(prefix="rebalance-private-market-") as temporary:
        private = Path(temporary)
        csv_path = private / "market.csv"
        with csv_path.open("w", newline="") as handle:
            writer = csv.writer(handle); writer.writerow(["date", *SYMBOLS]); writer.writerows([[day, *row] for day, row in zip(dates, prices)])
        spec_path, result_path = private / "request.json", private / "result.json"
        spec_path.write_text(json.dumps(dict(csvPath=str(csv_path), manifest=manifest, settings=settings)))
        bridge = subprocess.run(["node", "oracle/verify_local_market.mjs", str(spec_path), str(result_path)], cwd=ROOT, text=True, capture_output=True, timeout=60)
        if bridge.returncode:
            raise RuntimeError("Local TypeScript parser/engine bridge failed; no observed data were published. " + bridge.stderr[-1500:])
        actual = json.loads(result_path.read_text())
    maxima = {}
    if actual["start"] != dates[0] or actual["end"] != dates[-1] or actual["observations"] != len(dates)-1 or actual["partial"]:
        raise ValueError("TypeScript result coverage differs from the private observed input")
    returns = prices[1:] / prices[:-1] - 1
    for name, target in targets.items():
        expected = ledger(dates, prices, target, "monthly", 5)
        assert_close(actual["history"][name]["nav"], [row["nav"] for row in expected["rows"]], 1e-8, 1e-10, "navDollars", maxima)
        for metric in ["totalReturn", "cagr", "volatility", "maxDrawdown", "fees", "turnover"]:
            assert_close(actual["history"][name][metric], expected[metric], 1e-10, 1e-8, "historySummary", maxima)
        for observed in actual["risk"]["windows"]:
            covariance = LedoitWolf().fit(returns[-observed["window"]:]).covariance_ * 252
            cov_with_cash = np.zeros((4, 4)); cov_with_cash[:3, :3] = covariance
            weights = np.array(target)
            volatility = float(np.sqrt(weights @ covariance @ weights))
            contributions = list(weights * (covariance @ weights) / volatility) + [0.0]
            assert_close(observed["covariance"], cov_with_cash, 1e-12, 1e-8, "annualCovariance", maxima)
            assert_close(observed[name]["volatility"], volatility, 1e-10, 1e-8, "annualVolatility", maxima)
            assert_close([observed[name]["contributions"][s] for s in [*SYMBOLS, "CASH"]], contributions, 1e-10, 1e-8, "eulerContributions", maxima)
    report = dict(checkedAt=today, status="passed", scope="Private observed CSV parser + TypeScript engine + independent Python oracle. Not a browser test, live API connection, licensed public dataset, or investment outcome.", symbols=SYMBOLS, start=dates[0], end=dates[-1], observations=len(dates), returns=len(dates)-1, source="Yahoo Finance retained historical snapshots", sourceEvidence=sources, pricesRedistributed=False, temporaryObservedFilesRemoved=True, sourceDataModified=False, maximumAbsoluteDifferences=maxima,
                  codeSha256={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ["oracle/verify_local_market.py", "oracle/verify_local_market.mjs", "oracle/generate.py", "src/engine/index.ts", "src/engine/covariance.ts", "src/engine/ledger.ts", "src/data/market.ts"]})
    if args.output:
        args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(json.dumps(dict(status=report["status"], observations=len(dates), maximumAbsoluteDifferences=maxima)))


if __name__ == "__main__":
    main()
