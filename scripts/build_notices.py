"""Collect license text for the locked, installed npm and Python dependencies.
Run after npm ci and uv sync: uv run --locked python scripts/build_notices.py
No network access. Package notices are copied verbatim, not relicensed.
"""
from pathlib import Path
import importlib.metadata as metadata
import hashlib
import json
import re
import shutil
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true", help="Read-only check of preserved notices and SBOM links")
parser.add_argument("--strict", action="store_true", help="Also fail on unresolved upstream attribution")
args = parser.parse_args()

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'licenses'
if not args.check: OUT.mkdir(exist_ok=True)
rows = []
upstream_path = ROOT / 'scripts/upstream-licenses.json'
upstream = json.loads(upstream_path.read_text()) if upstream_path.exists() else {'notices': [], 'unresolved': []}
for entry in upstream['notices'] + upstream['unresolved']:
    for f in entry.get('files', []) + entry.get('evidenceFiles', []):
        p = ROOT / f['path']
        if not p.resolve().is_relative_to(ROOT) or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest() != f['sha256']:
            raise SystemExit(f'Upstream notice missing or modified: {f["path"]}')
if args.check:
    notice = (ROOT / 'THIRD_PARTY_NOTICES.md').read_text()
    for target in re.findall(r'\]\(([^)]+)\)', notice):
        if not target.startswith(('https://', 'http://')) and not (ROOT / target).is_file():
            raise SystemExit('Notice link missing: ' + target)
    lock = json.loads((ROOT / 'package-lock.json').read_text())
    for relative, info in lock['packages'].items():
        if not relative or info.get('optional') or not (ROOT / relative / 'package.json').exists(): continue
        item = json.loads((ROOT / relative / 'package.json').read_text())
        if f"## npm: {item['name']} {item['version']}" not in notice:
            raise SystemExit('Locked package is absent from notices: ' + item['name'])
    for relative in ['public/sbom/runtime.cdx.json', 'licenses/sbom/development.cdx.json']:
        sbom = json.loads((ROOT / relative).read_text())
        if sbom['metadata']['component']['version'] != lock['version']:
            raise SystemExit('SBOM version differs from package lock: ' + relative)
    if args.strict and upstream['unresolved']:
        raise SystemExit('Upstream attribution limitations remain: ' + ', '.join(e['name'] for e in upstream['unresolved']))
    print(json.dumps({'status': 'preserved-notices-verified', 'upstreamLimitations': len(upstream['unresolved']), 'strict': args.strict}))
    raise SystemExit(0)
supplemental = {(e['ecosystem'],e['name'],e['version']): [f['path'] for f in e['files']] for e in upstream['notices']}
unresolved = {(e['ecosystem'],e['name'],e['version']): e for e in upstream['unresolved']}

def slug(value):
    return re.sub(r'[^A-Za-z0-9._-]+', '_', value)

def is_notice(path):
    name = path.name.lower()
    return name.startswith(('license', 'licence', 'copying', 'notice', 'third_party_notice', 'third-party-notice'))

def preserve(kind, name, version, files):
    result = []
    folder = OUT / f'{kind}-{slug(name)}-{slug(version)}'
    for i, path in enumerate(sorted(set(files), key=str)):
        if not path.is_file():
            continue
        folder.mkdir(exist_ok=True)
        target = folder / f'{i + 1:02d}-{slug(path.name)}'
        shutil.copyfile(path, target)
        result.append(target.relative_to(ROOT).as_posix())
    return result

lock = json.loads((ROOT / 'package-lock.json').read_text())
for relative, info in sorted(lock['packages'].items()):
    if not relative:
        continue
    package = ROOT / relative
    manifest = package / 'package.json'
    if not manifest.exists():
        if info.get('optional'):
            continue  # Platform-specific packages absent from this installation are not redistributed.
        raise SystemExit(f'Missing installed locked package: {relative}')
    item = json.loads(manifest.read_text())
    if item['version'] != info['version']:
        raise SystemExit(f'Installed version differs from lockfile: {relative}')
    files = [p for p in package.iterdir() if p.is_file() and is_notice(p)]
    for folder in ['licenses', 'LICENSES', 'vendor']:
        extra = package / folder
        if extra.is_dir():
            files += [p for p in extra.rglob('*') if p.is_file() and (folder != 'vendor' or is_notice(p))]
    links = preserve('npm', item['name'], item['version'], files)
    repo = item.get('repository', {})
    source = repo.get('url', '') if isinstance(repo, dict) else repo
    source = source or info.get('resolved', '')
    rows.append(('npm', item['name'], item['version'], str(item.get('license', info.get('license', 'See upstream'))), source, links))

for dist in sorted(metadata.distributions(), key=lambda d: d.metadata['Name'].lower()):
    name, version = dist.metadata['Name'], dist.version
    files = [Path(dist.locate_file(f)) for f in (dist.files or []) if is_notice(Path(f)) or '/licenses/' in str(f)]
    links = preserve('python', name, version, files)
    license_name = dist.metadata.get('License-Expression') or dist.metadata.get('License', '').split('\n')[0] or 'See preserved upstream license'
    urls = dist.metadata.get_all('Project-URL') or []
    source = next((u.split(', ', 1)[-1] for u in urls if any(x in u.lower() for x in ['source', 'repository', 'homepage'])), dist.metadata.get('Home-page', ''))
    rows.append(('python', name, version, license_name, source, links))

header = '''# Third-party notices\n\nGenerated from the installed lockfile environment by `scripts/build_notices.py`.\nRuntime, build and verification dependencies are listed separately by ecosystem.\nVersion and source metadata do not replace the preserved license text. Packages\nnot installed on this platform (optional native binaries) are not redistributed;\ninstallers obtain their platform-specific packages under the same lockfile.\nThe modified CJK font notice and source manifest are in `public/fonts/`.\n\n'''
parts = [header, f"Additional exact-source notices and hashes: [source manifest](scripts/upstream-licenses.json). {len(upstream['unresolved'])} upstream notice limitations remain explicitly recorded below; declared SPDX labels are not substituted for missing original text.\n\n"]
for kind, name, version, lic, source, links in rows:
    links = sorted(set(links + supplemental.get((kind,name,version), [])))
    parts.append(f'## {kind}: {name} {version}\n\nDeclared license: {lic.replace(chr(10), " ")}\n\n')
    if (kind,name,version) in unresolved:
        entry = unresolved[(kind,name,version)]
        parts.append('**Upstream notice limitation:** ' + entry['reason'] + '\n\n')
        parts.append('Declaration evidence (not full license text): ' + ', '.join(f"[{Path(f['path']).name}]({f['path']})" for f in entry.get('evidenceFiles', [])) + '\n\n')
    if source:
        parts.append(f'Upstream: {source}\n\n')
    if links:
        parts.append('Preserved notices: ' + ', '.join(f'[{Path(p).name}]({p})' for p in links) + '\n\n')
    else:
        parts.append('No standalone license file included in the installed package; consult the upstream source and package metadata.\n\n')
(ROOT / 'THIRD_PARTY_NOTICES.md').write_text(''.join(parts))
print(json.dumps({'dependencies': len(rows), 'preservedNoticeFiles': sum(len(r[-1]) for r in rows)}, indent=2))
