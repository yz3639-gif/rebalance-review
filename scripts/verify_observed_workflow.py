"""Opt-in private observed-data browser workflow. Never packages source prices.
OBSERVED_MARKET_DIR must point to retained SPY/IEF/GLD JSON plus matching metadata.
Absent input is explicitly not-run. This is separate from clean public ZIP checks.
"""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', default='http://127.0.0.1:8787')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result = {'status': 'not-run', 'checkedAt': datetime.now(timezone.utc).isoformat(),
        'scope': 'Private observed CSV validated by the existing independent oracle and actual browser own-portfolio workflow. Not live-provider, public deployment, source-license or investment-performance evidence.',
        'pricesRedistributed': False, 'screenshotsTracesOrExportsCaptured': False, 'sourceDataModified': False}
    directory = os.environ.get('OBSERVED_MARKET_DIR')
    if not directory:
        result['reason'] = 'OBSERVED_MARKET_DIR is absent. No synthetic substitute was used.'
        args.output.write_text(json.dumps(result, indent=2)+'\n')
        print(json.dumps({'status': 'not-run', 'reason': 'Private source input absent'}))
        return 0
    stage = 'validate private source'
    try:
        with tempfile.TemporaryDirectory(prefix='rebalance-private-browser-') as temp:
            temporary = Path(temp)
            parity_output = temporary / 'parity.json'
            original = subprocess.run(['uv', 'run', '--locked', 'python', 'oracle/verify_local_market.py', '--source-dir', directory,
                '--start', '2023-01-01', '--end', '2025-12-31', '--output', str(parity_output)], cwd=ROOT, capture_output=True, text=True, timeout=120)
            if original.returncode: raise RuntimeError('Private source or independent numerical validation failed')
            parity = json.loads(parity_output.read_text())
            if parity['status'] != 'passed': raise RuntimeError('Private oracle validation did not pass')
            # Import the same checksum/currency/date validator; only temporary CSV exists.
            import sys
            sys.path.insert(0, str(ROOT / 'oracle'))
            spec = importlib.util.spec_from_file_location('private_market_validation', ROOT / 'oracle/verify_local_market.py')
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            symbols = module.SYMBOLS
            series = {symbol: module.observed_series(Path(directory), symbol, '2023-01-01', '2025-12-31')[0] for symbol in symbols}
            dates = sorted(series[symbols[0]])
            if len(dates) != parity['observations'] or any(set(series[s]) != set(dates) for s in symbols): raise RuntimeError('Private source coverage changed')
            csv_path = temporary / 'private-prices.csv'
            with csv_path.open('w', newline='') as file:
                writer = csv.writer(file)
                writer.writerow(['date', *symbols])
                writer.writerows([[date, *[series[s][date] for s in symbols]] for date in dates])
            csv_path.chmod(0o600)
            request = {'csvPath': str(csv_path), 'origin': args.origin, 'observations': len(dates), 'symbolCount': len(symbols), 'start': dates[0], 'end': dates[-1]}
            request_path, browser_output = temporary / 'request.json', temporary / 'browser.json'
            request_path.write_text(json.dumps(request))
            request_path.chmod(0o600)
            stage = 'observed browser workflow'
            browser = subprocess.run(['node', 'scripts/verify_observed_browser.mjs', str(request_path), str(browser_output)], cwd=ROOT, capture_output=True, text=True, timeout=240)
            checked = json.loads(browser_output.read_text()) if browser_output.exists() else {}
            if browser.returncode or checked.get('status') != 'passed':
                result['failedStage'] = checked.get('failedStage', stage)
                result['displayedReturnObservationCounts'] = checked.get('displayedReturnObservationCounts', [])
                result['expectedReturnObservations'] = len(dates)-1
                raise RuntimeError('Private browser verification did not pass')
            result.update({'status': 'passed', 'observations': len(dates), 'returnObservations': len(dates)-1, 'assets': len(symbols),
                'independentNumericalParity': 'passed', 'servedHtmlSha256': checked['servedHtmlSha256'], 'browsers': checked['browsers'], 'temporaryObservedFilesRemoved': True,
                'verificationCodeSha256': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in ['scripts/verify_observed_workflow.py', 'scripts/verify_observed_browser.mjs', 'oracle/verify_local_market.py', 'oracle/verify_local_market.mjs']}})
    except Exception:
        result.update({'status': 'failed', 'failedStage': result.get('failedStage', stage), 'error': 'Verification failed. Private data, source paths and raw exception text were not recorded.', 'temporaryObservedFilesRemoved': True})
    result['completedAt'] = datetime.now(timezone.utc).isoformat()
    args.output.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({k: result[k] for k in ['status', 'observations', 'returnObservations', 'assets', 'failedStage'] if k in result}))
    return 0 if result['status'] == 'passed' else 1

if __name__ == '__main__': raise SystemExit(main())
