"""Build an immutable, allowlisted source ZIP; verification is an adjacent sidecar.
Never imports old verification records or local report/output directories. The package is a candidate until its exact
hash passes independent verification and the separately recorded external gates.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_FILES = ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'package.json', 'package-lock.json', 'pyproject.toml', 'uv.lock', '.python-version', '.nvmrc',
    '.gitignore', 'index.html', 'design/index.html', 'vite.config.ts', 'playwright.config.ts',
    'demo/index.html', 'vite.demo.config.ts', 'playwright.demo.config.ts', 'scripts/build_demo.mjs',
    'tsconfig.json', 'wrangler.jsonc',
    'public/fonts/RebalanceSansSC-Regular.ttf', 'public/fonts/OFL.txt', 'public/fonts/manifest.json',
    'public/sbom/runtime.cdx.json', 'licenses/sbom/development.cdx.json',
    'src/main.tsx', 'src/App.tsx', 'src/engine/index.ts', 'src/server/index.ts',
    'src/server/tiingo-identities.json', 'src/server/tiingo-identity.ts',
    'scripts/update-tiingo-identities.mjs', 'scripts/update-tiingo-identities.d.mts',
    'src/pdf/pdf.worker.ts', 'src/data/us-equity-calendar.json', 'src/data/etf-catalog.json',
    'scripts/upstream-licenses.json', 'scripts/start.mjs', 'scripts/prepare_notices.mjs',
    'scripts/verify_archive.py', 'scripts/verify_worker.mjs',
    'oracle/fixtures.json', 'oracle/legacy-fixture.json', 'oracle/expanded-50-fixture.json']
DOCS = ['USER_TEST_PROTOCOL.md', 'DATA_FORMATS.md', 'PROVIDERS.md', 'PRIVACY.md', 'REFERENCES.md',
    'METHODS.md', 'DEPLOYMENT.md', 'DEMO_AND_TECHNICAL_GUIDE.md', 'AI_QUICKSTART.md']
PUBLIC_MEDIA = ['terminal-overview.png', 'terminal-risk.png', 'terminal-holdings.png', 'terminal-preview.gif']
ORACLE_FILES = ['README.md', 'generate.py', 'generate_expanded.py', 'test_regeneration.py',
    'fixtures.json', 'legacy-fixture.json', 'expanded-50-fixture.json',
    'verify_local_market.py', 'verify_local_market.mjs', 'browser-performance.mjs', 'browser-performance.md']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--sample-pdf', type=Path, help='Explicitly include one reviewed synthetic report as examples/sample-report.pdf; local output folders are never scanned.')
    parser.add_argument('--strict-licenses', action='store_true', help='Fail until upstream attribution gaps are resolved.')
    args = parser.parse_args()
    version = json.loads((ROOT / 'package.json').read_text())['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', version):
        raise SystemExit('Invalid package version')
    output = (args.output or ROOT.parent / 'releases' / f'rebalance-review-v{version}.zip').resolve()
    if output.is_relative_to(ROOT):
        raise SystemExit('Write the release outside the source directory.')
    if output.exists():
        raise SystemExit('Archive already exists. Use a new candidate filename; never overwrite an accepted ZIP.')
    required = REQUIRED_FILES + ['docs/' + name for name in DOCS] + ['oracle/' + name for name in ORACLE_FILES] + ['docs/media/' + name for name in PUBLIC_MEDIA]
    missing = [name for name in required if not (ROOT / name).is_file() or (ROOT / name).stat().st_size == 0]
    if missing:
        raise SystemExit('Required release files missing or empty: ' + ', '.join(missing))
    package = json.loads((ROOT / 'package.json').read_text())
    lock = json.loads((ROOT / 'package-lock.json').read_text())
    if lock['version'] != version or lock['packages']['']['version'] != version:
        raise SystemExit('package.json and package-lock.json versions disagree')
    upstream = json.loads((ROOT / 'scripts/upstream-licenses.json').read_text())
    if args.strict_licenses and upstream['unresolved']:
        raise SystemExit('Unresolved upstream attribution: ' + ', '.join(e['name'] for e in upstream['unresolved']))
    paths = {ROOT / name for name in required}
    for folder in ['src', 'public', 'tests', 'scripts', 'licenses', '.github']:
        if not (ROOT / folder).is_dir():
            raise SystemExit('Required source folder missing: ' + folder)
        paths.update(p for p in (ROOT / folder).rglob('*') if p.is_file()
            and not any(part in {'__pycache__', '.DS_Store'} for part in p.parts)
            and p.suffix not in {'.pyc', '.tsbuildinfo'})
    for optional in ['CHANGELOG.md', 'SECURITY.md', 'CONTRIBUTING.md']:
        if (ROOT / optional).is_file(): paths.add(ROOT / optional)
    for p in paths:
        if p.is_symlink() or not p.resolve().is_relative_to(ROOT):
            raise SystemExit(f'Unexpected external path: {p.name}')
        if p.name.startswith(('.env', '.dev.vars')) or p.suffix in {'.log', '.har'} or p.name == 'trace.zip' or any(part in {'node_modules', '.venv', '.wrangler', '.git', 'verification', 'test-results', 'playwright-report', 'tmp', 'output'} for part in p.relative_to(ROOT).parts):
            raise SystemExit(f'Forbidden release path: {p.name}')
    contents = {p.relative_to(ROOT).as_posix(): p.read_bytes() for p in sorted(paths)}
    if args.sample_pdf:
        if args.sample_pdf.is_symlink() or not args.sample_pdf.is_file():
            raise SystemExit('The explicit synthetic sample PDF must be a regular file.')
        sample = args.sample_pdf.read_bytes()
        if not sample.startswith(b'%PDF-') or len(sample) > 20_000_000:
            raise SystemExit('The explicit synthetic sample must be a PDF no larger than 20 MB.')
        contents['examples/sample-report.pdf'] = sample
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in contents.items()}
    manifest = {'schemaVersion': 2, 'version': version, 'scope': 'Source and locked environments; exact-ZIP verification is a separate sidecar, not inherited v1.1 evidence.',
        'sourceDigest': hashlib.sha256(json.dumps(hashes, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
        'licenseLimitations': [e['name'] + '@' + e['version'] for e in upstream['unresolved']], 'files': hashes}
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, data in [*contents.items(), ('RELEASE_MANIFEST.json', (json.dumps(manifest, indent=2) + '\n').encode())]:
            info = zipfile.ZipInfo('rebalance-review/' + name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, data)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.sha256').write_text(digest + '  ' + output.name + '\n')
    print(json.dumps({'file': str(output), 'version': version, 'bytes': output.stat().st_size,
        'sha256': digest, 'sourceDigest': manifest['sourceDigest'], 'sourceFiles': len(contents),
        'licenseLimitations': manifest['licenseLimitations'], 'status': 'candidate-not-yet-verified'}, indent=2))


if __name__ == '__main__': main()
