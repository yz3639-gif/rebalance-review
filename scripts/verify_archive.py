"""Verify the exact delivery ZIP in a fresh directory. No source checkout needed.
Use --full for all three browser engines against an owned real local Worker.
A passing engineering record is not live-provider, HTTPS, phone or user evidence.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import platform
import signal
import shutil
import socket
import stat
import subprocess
import tempfile
import time
import urllib.request
import zipfile


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def stamp(): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

def validate_browser_evidence(report):
    """A successful command alone does not prove all required browsers actually ran."""
    required = {'chromium', 'firefox', 'webkit'}
    stats = report.get('stats', {})
    if not stats.get('expected') or any(stats.get(key, 0) for key in ['unexpected', 'flaky', 'skipped']):
        raise RuntimeError('Browser evidence contains empty, failed, retried or skipped checks')
    if {p['name'] for p in report.get('config', {}).get('projects', [])} != required:
        raise RuntimeError('Browser evidence does not configure all three required engines')
    counts = dict.fromkeys(required, 0)
    def visit(suites):
        for suite in suites:
            for spec in suite.get('specs', []):
                for test in spec.get('tests', []):
                    runs = test.get('results', [])
                    name = test.get('projectName')
                    if name not in required or test.get('expectedStatus') != 'passed' or len(runs) != 1 or runs[0].get('status') != 'passed' or runs[0].get('retry', 0):
                        raise RuntimeError('Browser evidence includes an incomplete or retried test')
                    counts[name] += 1
            visit(suite.get('suites', []))
    visit(report.get('suites', []))
    if any(count == 0 for count in counts.values()) or sum(counts.values()) != stats['expected']:
        raise RuntimeError('Browser evidence is missing executed tests for a required engine')
    return counts


def stop(process):
    if process is None or process.poll() is not None: return
    if os.name == 'posix': os.killpg(process.pid, signal.SIGTERM)
    else: process.terminate()
    try: process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        if os.name == 'posix': os.killpg(process.pid, signal.SIGKILL)
        else: process.kill()
        process.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--full', action='store_true')
    parser.add_argument('--install-browsers', action='store_true')
    parser.add_argument('--stage-timeout', type=int, default=600)
    parser.add_argument('--browser-timeout', type=int, default=1800)
    args = parser.parse_args()
    if args.stage_timeout <= 0 or args.browser_timeout <= 0: parser.error('Timeouts must be positive')
    args.output = args.output.resolve()
    archive = args.archive.resolve()
    artifacts = args.output.parent / (args.output.stem + '-artifacts')
    artifacts.mkdir(parents=True, exist_ok=True)
    result = {'schemaVersion': 2, 'status': 'running', 'checkedAt': stamp(), 'mode': 'full' if args.full else 'core',
        'environment': {'system': platform.system(), 'release': platform.release(), 'machine': platform.machine()},
        'scope': 'Independent source ZIP extraction; fresh node_modules and Python venv; no old research directory.',
        'externalGates': {'authenticatedTiingo': 'not-tested', 'publicHttps': 'not-tested', 'physicalPhone': 'not-tested',
            'deploymentRollback': 'not-tested', 'realUsers': 'not-tested', 'privateObservedData': 'not-tested-in-public-ZIP'}, 'commands': []}
    def save():
        temp_output = args.output.with_suffix(args.output.suffix + '.tmp')
        temp_output.write_text(json.dumps(result, indent=2) + '\n')
        temp_output.replace(args.output)
    save()
    worker = None
    worker_log = None
    try:
        result['archiveSha256'] = sha(archive)
        with tempfile.TemporaryDirectory(prefix='rebalance-clean-') as temp:
            destination = Path(temp).resolve()
            result['phase'] = 'extract'
            with zipfile.ZipFile(archive) as z:
                names = z.namelist()
                if len(names) != len(set(names)): raise RuntimeError('Duplicate archive paths')
                if sum(i.file_size for i in z.infolist()) > 300 * 1024 * 1024: raise RuntimeError('Unexpected archive size')
                for item in z.infolist():
                    p = destination / item.filename
                    if not p.resolve().is_relative_to(destination) or not item.filename.startswith('rebalance-review/') or stat.S_ISLNK(item.external_attr >> 16):
                        raise RuntimeError('Unsafe archive path')
                z.extractall(destination)
            source = destination / 'rebalance-review'
            manifest = json.loads((source / 'RELEASE_MANIFEST.json').read_text())
            actual = {p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()} - {'RELEASE_MANIFEST.json'}
            if actual != set(manifest['files']): raise RuntimeError('Archive file list differs from manifest')
            for name, digest in manifest['files'].items():
                if sha(source / name) != digest: raise RuntimeError('Archive hash mismatch: ' + name)
            source_digest = hashlib.sha256(json.dumps(manifest['files'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            if manifest.get('sourceDigest') != source_digest: raise RuntimeError('Source digest differs from manifest')
            result['verifierSha256'] = sha(Path(__file__))
            if 'scripts/verify_archive.py' in manifest['files'] and result['verifierSha256'] != manifest['files']['scripts/verify_archive.py']:
                raise RuntimeError('Verification script differs from the script packaged in this ZIP')
            result.update({'version': manifest['version'], 'manifestFilesVerified': len(actual), 'sourceDigest': source_digest,
                'testedSourceSha256': manifest['files'], 'licenseLimitations': manifest.get('licenseLimitations', [])})
            result['licenseClearance'] = 'pending-upstream-notices' if result['licenseLimitations'] else 'notices-complete'
            environment = {**os.environ, 'CI': '1', 'WRANGLER_SEND_METRICS': 'false'}
            environment.pop('VIRTUAL_ENV', None)
            environment.pop('UV_PROJECT_ENVIRONMENT', None)
            def run(command, timeout=None, env=None):
                print('Running:', ' '.join(command), flush=True)
                result['phase'] = ' '.join(command)
                started = time.monotonic()
                entry = {'command': command, 'status': 'running'}
                result['commands'].append(entry)
                save()
                try:
                    process = subprocess.Popen(command, cwd=source, env=env or environment,
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=os.name == 'posix')
                except OSError as error:
                    entry.update({'status': 'failed', 'exitCode': None, 'error': str(error), 'elapsedSeconds': round(time.monotonic() - started, 3)})
                    save()
                    raise
                try:
                    output, _ = process.communicate(timeout=timeout or args.stage_timeout)
                    entry.update({'status': 'passed' if process.returncode == 0 else 'failed', 'exitCode': process.returncode})
                except subprocess.TimeoutExpired:
                    stop(process)
                    output, _ = process.communicate()
                    entry.update({'status': 'timed-out', 'exitCode': process.returncode, 'timeoutSeconds': timeout or args.stage_timeout})
                except BaseException:
                    stop(process)
                    process.communicate()
                    entry.update({'status': 'interrupted', 'exitCode': process.returncode, 'elapsedSeconds': round(time.monotonic() - started, 3)})
                    save()
                    raise
                entry['elapsedSeconds'] = round(time.monotonic() - started, 3)
                log_name = f'{len(result["commands"]):02d}.log'
                (artifacts / log_name).write_text(output)
                entry['log'] = log_name
                if 'test:e2e' in command:
                    for folder in ['test-results', 'playwright-report']:
                        if (source / folder).is_dir(): shutil.copytree(source / folder, artifacts / folder, dirs_exist_ok=True)
                save()
                if entry['status'] != 'passed':
                    print(output[-6000:], flush=True)
                    raise RuntimeError(f'{entry["status"]}: ' + ' '.join(command))
                return output.strip()
            result['node'] = run(['node', '--version'])
            expected = 'v' + (source / '.nvmrc').read_text().strip()
            if result['node'] != expected: raise RuntimeError(f'Expected Node {expected}; got {result["node"]}')
            npm = 'npm.cmd' if os.name == 'nt' else 'npm'
            result['npm'] = run([npm, '--version'])
            result['uv'] = run(['uv', '--version'])
            run([npm, 'ci'])
            run([npm, 'audit', '--audit-level=high'])
            run([npm, 'run', 'typecheck'])
            run([npm, 'test', '--', '--reporter=json', '--outputFile=clean-unit-results.json'])
            unit = json.loads((source / 'clean-unit-results.json').read_text())
            result['unit'] = {k: unit[k] for k in ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'success']}
            run(['uv', 'sync', '--locked'])
            result['oracleRegeneration'] = []
            for generator, reference in [('oracle/generate.py', 'oracle/fixtures.json'), ('oracle/generate_expanded.py', 'oracle/expanded-50-fixture.json')]:
                run(['uv', 'run', '--locked', 'python', generator, '--check'])
                generated = destination / ('regenerated-' + Path(reference).name)
                run(['uv', 'run', '--locked', 'python', generator, '--output', str(generated)])
                comparison = json.loads(run(['uv', 'run', '--locked', 'python', 'scripts/compare_oracles.py', reference, str(generated)]))
                result['oracleRegeneration'].append({'reference': reference, **comparison})
            for name in ['oracle/fixtures.json', 'oracle/legacy-fixture.json', 'oracle/expanded-50-fixture.json']:
                if sha(source / name) != manifest['files'][name]: raise RuntimeError('Verification changed packaged reference bytes: ' + name)
            run(['uv', 'run', '--locked', 'python', 'src/data/generate_calendar.py', '--check'])
            run(['uv', 'run', '--locked', 'python', '-m', 'unittest', 'discover', '-s', 'oracle', '-p', 'test_*.py'])
            run(['uv', 'run', '--locked', 'python', '-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_*.py'])
            run([npm, 'run', 'build'])
            run(['node', 'node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run'])
            result['buildSha256'] = {p.relative_to(source / 'dist').as_posix(): sha(p) for p in sorted((source / 'dist').rglob('*')) if p.is_file()}
            if args.full:
                if args.install_browsers: run(['node', 'node_modules/playwright/cli.js', 'install', 'chromium', 'firefox', 'webkit'])
                with socket.socket() as free:
                    free.bind(('127.0.0.1', 0))
                    port = free.getsockname()[1]
                origin = f'http://127.0.0.1:{port}'
                worker_log = (artifacts / 'worker.log').open('w')
                # Exercise the documented end-user launcher, not a test-only web server.
                worker = subprocess.Popen([npm, 'start', '--', '--port', str(port)], cwd=source, env=environment,
                    stdout=worker_log, stderr=subprocess.STDOUT, start_new_session=os.name == 'posix')
                result['phase'] = 'start local Worker'
                save()
                deadline = time.monotonic() + 120
                while time.monotonic() < deadline:
                    if worker.poll() is not None: raise RuntimeError('Local Worker exited during startup')
                    try:
                        with urllib.request.urlopen(origin, timeout=2) as response:
                            if response.status == 200: break
                    except Exception: time.sleep(0.25)
                else: raise RuntimeError('Local Worker startup timed out')
                browser_env = {**environment, 'E2E_BASE_URL': origin, 'E2E_EXTERNAL_SERVER': '1',
                    'WORKER_TEST_ORIGIN': origin, 'WORKER_TEST_OUTPUT': str(artifacts / 'worker-runtime.json')}
                run([npm, 'run', 'test:e2e'], args.browser_timeout, browser_env)
                browser = json.loads((source / 'test-results/browser-results.json').read_text())
                result['browser'] = browser['stats']
                result['browserPassedByEngine'] = validate_browser_evidence(browser)
                run(['node', 'scripts/verify_worker.mjs'], args.browser_timeout, browser_env)
                result['workerRuntime'] = json.loads((artifacts / 'worker-runtime.json').read_text())
                if result['workerRuntime']['status'] != 'passed': raise RuntimeError('Worker runtime did not pass')
                result['browserEvidence'] = 'all three browser engines against the exact ZIP local Worker'
                stop(worker)
                worker = None
            else:
                result['browserEvidence'] = 'not-tested: use --full'
            # Regeneration and checks must not silently rewrite the tested source.
            for name, digest in manifest['files'].items():
                if sha(source / name) != digest: raise RuntimeError('Verification modified packaged source: ' + name)
            result.update({'passed': True, 'status': 'passed', 'phase': 'completed'})
    except BaseException as error:
        result.update({'passed': False, 'status': 'failed', 'failedPhase': result.get('phase', 'initialization'), 'error': str(error)})
    finally:
        stop(worker)
        if worker_log: worker_log.close()
        result['completedAt'] = stamp()
        save()
    print(json.dumps({'status': result['status'], 'output': str(args.output), 'failedPhase': result.get('failedPhase')}), flush=True)
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__': raise SystemExit(main())
