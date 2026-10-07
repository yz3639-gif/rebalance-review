"""Independent 50-asset v1.2 reference using NumPy/sklearn and SciPy, not TypeScript."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.covariance import LedoitWolf
from generate import ledger, assert_equivalent

SYMBOLS = 'SPY VOO VTI QQQ VEA VWO VXUS SHY IEF TLT BND TIP LQD HYG GLD VNQ AGG BIL BIV BLV BNDX BSV DIA DVY EEM EFA EMB EWA EWC EWG EWJ EWL EWM EWT EWU EWY EWZ GDX IAU IBB ICF IEI IGV IJH IJR IJT IUSG IUSV IVV IWB'.split()

def generate_expanded():
    rng = np.random.default_rng(125050)
    dates = pd.bdate_range('2023-01-03', periods=505).strftime('%Y-%m-%d').tolist()
    common = rng.normal(0, .006, size=(504, 1))
    returns = common * np.linspace(-.3, 1.2, 50) + rng.normal(0, .005, size=(504, 50)) + .0001
    prices = np.vstack([np.full(50, 100.), 100 * np.cumprod(1 + returns, axis=0)])
    target_a = np.arange(1, 51) / np.arange(1, 51).sum() * .9
    target_b = np.arange(50, 0, -1) / np.arange(1, 51).sum()
    risk = []
    for window in [126, 252, 504]:
        covariance = LedoitWolf().fit(returns[-window:]).covariance_ * 252
        values = []
        for target in [target_a, target_b]:
            volatility = np.sqrt(target @ covariance @ target)
            values.append(dict(volatility=float(volatility), contributions=(target * (covariance @ target) / volatility).tolist()))
        risk.append(dict(window=window, covariance=covariance.tolist(), a=values[0], b=values[1]))
    root = Path(__file__).resolve().parent.parent
    return dict(provenance=dict(generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                ledgerGeneratorSha256=hashlib.sha256((root/'oracle/generate.py').read_bytes()).hexdigest(),
                dependencyLockSha256=hashlib.sha256((root/'uv.lock').read_bytes()).hexdigest(),
                data='Synthetic 50-asset paths; no observed or predictive return claim', seed=125050),
                symbols=SYMBOLS, dates=dates, prices=prices.tolist(), risk=risk,
                scenarios=[dict(name=name, target=target.tolist(), lag=lag,
                           expected=ledger(dates, prices, target, 'monthly', 5, lag=lag))
                           for name,target in [('cash-10pct', target_a), ('fully-invested', target_b)] for lag in [1,2]])

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--output', type=Path, default=Path(__file__).with_name('expanded-50-fixture.json'))
    args=parser.parse_args(); output=generate_expanded()
    if args.check:
        try: assert_equivalent(output, json.loads(args.output.read_text()))
        except (OSError, ValueError) as error: parser.exit(1, f'Expanded oracle verification failed: {error}\n')
        print(json.dumps(dict(status='verified', assets=50, scenarios=len(output['scenarios']))))
    else:
        args.output.write_text(json.dumps(output, separators=(',', ':'), allow_nan=False)+'\n')
        print(json.dumps(dict(status='generated', assets=50, bytes=args.output.stat().st_size)))
