"""Failure-path regressions for exact-ZIP delivery tooling; no network required."""
from contextlib import redirect_stdout
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from unittest.mock import patch
import hashlib
import copy
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile

HERE = Path(__file__).resolve().parent


def packer():
    spec = spec_from_file_location('release_packager', HERE / 'package_release.py')
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ReleaseToolTests(unittest.TestCase):
    def test_browser_acceptance_rejects_missing_skipped_and_retried_engines(self):
        spec = spec_from_file_location('archive_verifier', HERE / 'verify_archive.py')
        module = module_from_spec(spec)
        spec.loader.exec_module(module)
        engines = ['chromium', 'firefox', 'webkit']
        valid = {'config': {'projects': [{'name': name} for name in engines]},
            'stats': {'expected': 3, 'skipped': 0, 'unexpected': 0, 'flaky': 0},
            'suites': [{'specs': [{'tests': [{'projectName': name, 'expectedStatus': 'passed',
                'results': [{'status': 'passed', 'retry': 0}]} for name in engines]}]}]}
        self.assertEqual(module.validate_browser_evidence(valid), dict.fromkeys(engines, 1))
        skipped = copy.deepcopy(valid); skipped['stats']['skipped'] = 1
        missing = copy.deepcopy(valid); missing['suites'][0]['specs'][0]['tests'].pop(); missing['stats']['expected'] = 2
        retried = copy.deepcopy(valid); retried['suites'][0]['specs'][0]['tests'][0]['results'][0]['retry'] = 1
        expected_failure = copy.deepcopy(valid); expected_failure['suites'][0]['specs'][0]['tests'][0]['expectedStatus'] = 'failed'
        empty = copy.deepcopy(valid); empty['stats']['expected'] = 0
        for invalid in [skipped, missing, retried, expected_failure, empty]:
            with self.subTest(report=invalid), self.assertRaises(RuntimeError): module.validate_browser_evidence(invalid)

    def seed(self, root, module):
        for name in module.REQUIRED_FILES + ['docs/' + name for name in module.DOCS] + ['oracle/' + name for name in module.ORACLE_FILES] + ['docs/media/' + name for name in module.PUBLIC_MEDIA]:
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('required content\n')
        for folder in ['src', 'public', 'tests', 'oracle', 'scripts', 'licenses', '.github']:
            (root / folder).mkdir(exist_ok=True)
        (root / 'package.json').write_text(json.dumps({'version': '9.8.7'}))
        (root / 'package-lock.json').write_text(json.dumps({'version': '9.8.7', 'packages': {'': {'version': '9.8.7'}}}))
        (root / 'scripts/upstream-licenses.json').write_text(json.dumps({'notices': [], 'unresolved': []}))

    def test_package_version_is_dynamic_and_old_evidence_is_excluded(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve() / 'source'
            root.mkdir()
            module = packer()
            self.seed(root, module)
            (root / 'verification').mkdir()
            (root / 'verification/v1.1-release.json').write_text('{"passed":true}')
            (root / 'output/pdf').mkdir(parents=True)
            (root / 'output/pdf/private-review.pdf').write_bytes(b'%PDF-private-user-report')
            (root / 'oracle/observed-market-verification.json').write_text('{"private":true}')
            archive = Path(temp) / 'candidate.zip'
            with patch.object(module, 'ROOT', root), patch.object(sys, 'argv', ['package_release.py', '--output', str(archive)]), redirect_stdout(io.StringIO()):
                module.main()
                before = archive.read_bytes()
                with self.assertRaisesRegex(SystemExit, 'already exists'): module.main()
                self.assertEqual(archive.read_bytes(), before)
            with zipfile.ZipFile(archive) as z:
                manifest = json.loads(z.read('rebalance-review/RELEASE_MANIFEST.json'))
                self.assertEqual(manifest['version'], '9.8.7')
                self.assertFalse(any('/verification/' in name for name in z.namelist()))
                self.assertFalse(any('/output/' in name for name in z.namelist()))
                self.assertFalse(any('observed-market-verification' in name for name in z.namelist()))

    def test_source_only_checkout_packages_without_local_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve() / 'source'; root.mkdir()
            module = packer(); self.seed(root, module)
            self.assertFalse((root / 'output').exists())
            archive = Path(temp) / 'candidate.zip'
            with patch.object(module, 'ROOT', root), patch.object(sys, 'argv', ['package_release.py', '--output', str(archive)]), redirect_stdout(io.StringIO()):
                module.main()
            self.assertTrue(archive.is_file())

    def test_only_an_explicit_synthetic_sample_is_included_at_a_fixed_portable_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve() / 'source'; root.mkdir()
            module = packer(); self.seed(root, module)
            sample = Path(temp) / 'reviewed-synthetic.pdf'; sample.write_bytes(b'%PDF-1.7\nreviewed synthetic fixture')
            archive = Path(temp) / 'candidate.zip'
            with patch.object(module, 'ROOT', root), patch.object(sys, 'argv', ['package_release.py', '--output', str(archive), '--sample-pdf', str(sample)]), redirect_stdout(io.StringIO()):
                module.main()
            with zipfile.ZipFile(archive) as z:
                self.assertEqual(z.read('rebalance-review/examples/sample-report.pdf'), sample.read_bytes())
                self.assertNotIn('reviewed-synthetic.pdf', '\n'.join(z.namelist()))

    def test_credentials_and_runtime_artifacts_cannot_hide_inside_source_folders(self):
        for relative in ['src/.dev.vars', 'scripts/session.log', 'public/trace.zip', 'tests/verification/private.json']:
            with self.subTest(path=relative), tempfile.TemporaryDirectory() as temp:
                root = Path(temp).resolve() / 'source'; root.mkdir()
                module = packer(); self.seed(root, module)
                forbidden = root / relative; forbidden.parent.mkdir(parents=True, exist_ok=True); forbidden.write_text('not for publication')
                archive = Path(temp) / 'candidate.zip'
                with patch.object(module, 'ROOT', root), patch.object(sys, 'argv', ['package_release.py', '--output', str(archive)]), self.assertRaisesRegex(SystemExit, 'Forbidden release path'):
                    module.main()
                self.assertFalse(archive.exists())

    def test_missing_required_font_fails_before_creating_archive(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve() / 'source'
            root.mkdir()
            module = packer()
            self.seed(root, module)
            (root / 'public/fonts/RebalanceSansSC-Regular.ttf').unlink()
            archive = Path(temp) / 'candidate.zip'
            with patch.object(module, 'ROOT', root), patch.object(sys, 'argv', ['package_release.py', '--output', str(archive)]):
                with self.assertRaisesRegex(SystemExit, 'Required release files'): module.main()
            self.assertFalse(archive.exists())

    def test_bad_archive_has_terminal_failure_record(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'unsafe.zip'
            report = Path(temp) / 'verification.json'
            with zipfile.ZipFile(archive, 'w') as z: z.writestr('rebalance-review/../../escape.txt', 'unsafe')
            run = subprocess.run([sys.executable, str(HERE / 'verify_archive.py'), str(archive), '--output', str(report)], capture_output=True, timeout=10)
            result = json.loads(report.read_text())
            self.assertEqual(run.returncode, 1)
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['failedPhase'], 'extract')
            self.assertIn('completedAt', result)
            self.assertFalse((Path(temp) / 'escape.txt').exists())

    @unittest.skipIf(os.name == 'nt', 'POSIX fake executable used to exercise process timeout')
    def test_hung_stage_has_timeout_exitcode_and_final_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            temp = Path(temp)
            source = {'.nvmrc': b'24.21.0\n'}
            hashes = {name: hashlib.sha256(content).hexdigest() for name, content in source.items()}
            manifest = {'version': '9.8.7', 'files': hashes, 'sourceDigest': hashlib.sha256(json.dumps(hashes, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}
            archive = temp / 'minimal.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                for name, data in source.items(): z.writestr('rebalance-review/' + name, data)
                z.writestr('rebalance-review/RELEASE_MANIFEST.json', json.dumps(manifest))
            bindir = temp / 'bin'
            bindir.mkdir()
            (bindir / 'node').write_text('#!/bin/sh\nsleep 20\n')
            (bindir / 'node').chmod(0o755)
            report = temp / 'result.json'
            run = subprocess.run([sys.executable, str(HERE / 'verify_archive.py'), str(archive), '--output', str(report), '--stage-timeout', '1'],
                env={**os.environ, 'PATH': str(bindir) + os.pathsep + os.environ['PATH']}, capture_output=True, timeout=15)
            result = json.loads(report.read_text())
            self.assertEqual(run.returncode, 1)
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['commands'][0]['status'], 'timed-out')
            self.assertIn('exitCode', result['commands'][0])


if __name__ == '__main__': unittest.main()
