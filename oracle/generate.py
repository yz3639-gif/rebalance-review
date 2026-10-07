"""Independent numerical fixtures; Python/NumPy/sklearn + SciPy root solver.

Run with `uv run --locked python oracle/generate.py`.
This does not import the TypeScript implementation or another research repository.
The separately frozen legacy-fixture.json is never read or overwritten here.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import platform
from pathlib import Path
import numpy as np
import pandas as pd
import scipy
from scipy.optimize import brentq
import sklearn
from sklearn.covariance import LedoitWolf


def ledger(dates, prices, target, frequency, bps, initial=100000.0, lag=1):
    target = np.asarray(target, dtype=float)
    prices = np.asarray(prices, dtype=float)
    holdings = np.zeros(len(target))
    cash = initial
    rate = bps / 10000
    pending = None
    rows = []
    total_fees = 0.0
    turnover = 0.0
    peak = initial
    drawdowns = []
    def period(date):
        return date[:7] if frequency == "monthly" else (date[:4], (int(date[5:7]) - 1) // 3)
    for i, date in enumerate(dates):
        if i:
            holdings *= prices[i] / prices[i - 1]
        if i and frequency != "buy-hold" and period(date) != period(dates[i - 1]):
            pending = i + lag - 1
        before = float(holdings.sum() + cash)
        fee = 0.0
        traded = 0.0
        nav = before
        if i == 0 or pending == i:
            def self_financing(value):
                return value + rate * np.abs(target * value - holdings).sum() - before
            nav = brentq(self_financing, 0.0, before, xtol=1e-10, rtol=1e-14)
            traded = float(np.abs(target * nav - holdings).sum())
            fee = traded * rate
            holdings = target * nav
            cash = (1 - target.sum()) * nav
            pending = None
            total_fees += fee
            turnover += traded / before
        peak = max(peak, nav)
        drawdowns.append(nav / peak - 1)
        rows.append(dict(nav=nav, cash=float(cash), fee=fee, before=before, traded=traded))
    navs = np.array([r["nav"] for r in rows])
    returns = navs[1:] / navs[:-1] - 1
    years = (pd.Timestamp(dates[-1]) - pd.Timestamp(dates[0])).days / 365.25
    return dict(rows=rows, totalReturn=float(navs[-1]/initial-1), cagr=float((navs[-1]/initial)**(1/years)-1),
                volatility=float(returns.std(ddof=1)*np.sqrt(252)), maxDrawdown=-min(drawdowns), fees=total_fees, turnover=turnover)


def generate():
    rng = np.random.default_rng(73192)
    dates = pd.bdate_range("2022-01-03", periods=321).strftime("%Y-%m-%d").tolist()
    shocks = rng.normal(size=(320, 3))
    returns = shocks @ np.array([[.009, .004, -.003], [0, .005, .001], [0, 0, .008]]) + [.0003, .0001, .0002]
    prices = np.vstack([np.ones(3) * 100, 100 * np.cumprod(1 + returns, axis=0)])
    covariance_cases = []
    cases = {
        "random3": returns[-252:],
        "single": returns[-252:, :1],
        "identical": np.tile(returns[-252:, :1], (1, 3)),
        "constant": np.zeros((252, 3)),
        "random20": rng.normal(0, .01, size=(504, 20)),
    }
    for name, sample in cases.items():
        covariance_cases.append(dict(name=name, samples=sample.tolist(), covariance=LedoitWolf().fit(sample).covariance_.tolist()))
    risky_target = [.55, .30, 0.0]
    scenarios = []
    for name, target in [("cash-15pct", risky_target), ("fully-invested", [.55, .30, .15])]:
        for frequency in ["monthly", "quarterly", "buy-hold"]:
            for lag in [1, 2]:
                scenarios.append(dict(name=name, frequency=frequency, lag=lag, costBps=5, target=target,
                                      expected=ledger(dates, prices, target, frequency, 5, lag=lag)))
    risk = []
    for window in [252, 126]:
        cov = LedoitWolf().fit(returns[-window:]).covariance_ * 252
        w = np.array(risky_target)
        vol = float(np.sqrt(w @ cov @ w))
        risk.append(dict(window=window, covariance=cov.tolist(), volatility=vol,
                         contributions=(w * (cov @ w) / vol).tolist()))
    root = Path(__file__).resolve().parent.parent
    return dict(provenance=dict(python=platform.python_version(), numpy=np.__version__, scipy=scipy.__version__, sklearn=sklearn.__version__, pandas=pd.__version__,
                                 generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                                 dependencyLockSha256=hashlib.sha256((root / "uv.lock").read_bytes()).hexdigest(),
                                 seed=73192, data="synthetic; independent NumPy RNG, not ETF observations",
                                 ledger="scipy.optimize.brentq self-financing root; pure Python loop"),
                  dates=dates, symbols=["SPY", "IEF", "GLD"], prices=prices.tolist(), covarianceCases=covariance_cases,
                  scenarios=scenarios, risk=risk)


def assert_equivalent(actual, expected, path="fixture"):
    """Fail on the first mismatch, allowing only documented floating-point noise.

    Dates, dimensions, provenance, keys and integer values compare exactly.
    Monetary ledger values use 1e-8 dollars + 1e-10 relative; covariance
    elements use 1e-12 + 1e-8 relative; other floats use 1e-10 + 1e-8 relative.
    """
    if isinstance(actual, dict) and isinstance(expected, dict):
        if actual.keys() != expected.keys():
            raise ValueError(f"{path}: object fields differ")
        for key in actual:
            assert_equivalent(actual[key], expected[key], f"{path}.{key}")
    elif isinstance(actual, list) and isinstance(expected, list):
        if len(actual) != len(expected):
            raise ValueError(f"{path}: length {len(actual)} != {len(expected)}")
        for index, (value, reference) in enumerate(zip(actual, expected)):
            assert_equivalent(value, reference, f"{path}[{index}]")
    elif isinstance(actual, float) and type(expected) in (int, float):
        if ".rows[" in path or path.endswith(".fees"):
            absolute, relative = 1e-8, 1e-10
        elif ".covariance[" in path:
            absolute, relative = 1e-12, 1e-8
        else:
            absolute, relative = 1e-10, 1e-8
        if not np.isfinite(actual) or not np.isfinite(expected) or abs(actual - expected) > absolute + relative * abs(expected):
            raise ValueError(f"{path}: numerical mismatch ({actual!r} != {expected!r})")
    elif type(actual) is not type(expected) or actual != expected:
        raise ValueError(f"{path}: {actual!r} != {expected!r}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("fixtures.json"), help="Destination, or reference path when using --check.")
    parser.add_argument("--check", action="store_true", help="Regenerate in memory and verify the reference without writing any files.")
    args = parser.parse_args()
    output = generate()
    if args.check:
        try:
            assert_equivalent(output, json.loads(args.output.read_text()))
        except (OSError, ValueError) as error:
            parser.exit(1, f"Oracle verification failed: {error}\n")
        print(json.dumps(dict(status="verified", scenarios=len(output["scenarios"]), reference=args.output.name)))
        return
    args.output.write_text(json.dumps(output, separators=(",", ":"), allow_nan=False) + "\n")
    print(json.dumps(dict(status="generated", reference=args.output.name, bytes=args.output.stat().st_size)))


if __name__ == "__main__":
    main()
