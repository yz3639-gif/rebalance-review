"""Run the exact release ZIP in a disposable Ubuntu Docker container.
Docker runs the image without repository, credentials or user-home mounts.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    archive, output = args.archive.resolve(), args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    image = 'rebalance-review-verifier:node24.21.0-uv0.12.21'
    name = 'rebalance-verify-' + uuid.uuid4().hex[:12]
    stage = 'build Ubuntu verifier image'
    try:
        with tempfile.TemporaryDirectory(prefix='rebalance-docker-build-') as temp:
            context = Path(temp)
            (context / 'Dockerfile').write_bytes((ROOT / 'scripts/Dockerfile.verify').read_bytes())
            subprocess.run(['docker', 'build', '--tag', image, str(context)], check=True, timeout=1800)
            identity = subprocess.run(['docker', 'image', 'inspect', image, '--format', '{{.Id}}'], text=True, capture_output=True, check=True, timeout=30).stdout.strip()
            (output.parent / (output.stem + '-container.json')).write_text(json.dumps({'imageId': identity, 'base': 'ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55',
                'scope': 'Disposable Ubuntu container. Only exact ZIP, matching verifier script and output directory are mounted; no source checkout or credentials.'}, indent=2)+'\n')
            stage = 'full verification in Ubuntu container'
            subprocess.run(['docker', 'run', '--name', name, '--rm', '--init', '--ipc=host',
                '--mount', f'type=bind,source={archive},target=/input/release.zip,readonly',
                '--mount', f'type=bind,source={ROOT / "scripts/verify_archive.py"},target=/tools/verify_archive.py,readonly',
                '--mount', f'type=bind,source={output.parent},target=/results', image,
                '/input/release.zip', '--output', '/results/' + output.name, '--full'], check=True, timeout=3600)
    except (OSError, subprocess.SubprocessError) as error:
        # Preserve the verifier's own detailed terminal failure when available.
        existing = json.loads(output.read_text()) if output.is_file() else {}
        if existing.get('status') != 'failed':
            output.write_text(json.dumps({'status': 'failed', 'failedPhase': stage, 'error': str(error),
                'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest() if archive.is_file() else None,
                'completedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, indent=2)+'\n')
        return 1
    finally:
        # A docker client timeout must not leave an orphan verification container.
        try: subprocess.run(['docker', 'rm', '--force', name], capture_output=True, timeout=30)
        except (OSError, subprocess.SubprocessError): pass
    return 0

if __name__ == '__main__': raise SystemExit(main())
