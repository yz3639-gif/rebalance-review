"""Regression checks for a self-contained, non-destructive verification package."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent


class StandaloneRegeneration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="rebalance-oracle-check-")
        cls.root = Path(cls.temporary.name)
        (cls.root / "oracle").mkdir()
        (cls.root / "src/data").mkdir(parents=True)
        for name in ["uv.lock", "oracle/generate.py", "oracle/generate_expanded.py", "oracle/legacy-fixture.json", "src/data/generate_calendar.py"]:
            shutil.copy2(ROOT / name, cls.root / name)
        cls.frozen_hash = hashlib.sha256((cls.root / "oracle/legacy-fixture.json").read_bytes()).hexdigest()

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def run_tool(self, script, *arguments, expected=0):
        result = subprocess.run([sys.executable, script, *arguments], cwd=self.root, text=True, capture_output=True, timeout=60)
        self.assertEqual(result.returncode, expected, result.stderr)
        return result

    def test_default_regeneration_preserves_frozen_legacy_and_checks_without_writing(self):
        self.run_tool("oracle/generate.py")
        path = self.root / "oracle/fixtures.json"
        content = path.read_bytes()
        fixture = json.loads(content)
        self.assertNotIn("legacy", fixture)
        self.assertEqual({s["name"] for s in fixture["scenarios"]}, {"cash-15pct", "fully-invested"})
        self.assertEqual(len(fixture["scenarios"]), 12)
        self.assertEqual(fixture["provenance"]["pandas"], "2.3.3")
        self.run_tool("oracle/generate.py", "--check")
        self.assertEqual(path.read_bytes(), content)
        self.run_tool("oracle/generate.py", "--output", "oracle/second.json")
        self.assertEqual((self.root / "oracle/second.json").read_bytes(), content)
        self.assertEqual(hashlib.sha256((self.root / "oracle/legacy-fixture.json").read_bytes()).hexdigest(), self.frozen_hash)

    def test_expanded_fifty_asset_reference_is_standalone_and_read_only(self):
        self.run_tool("oracle/generate_expanded.py")
        path = self.root / "oracle/expanded-50-fixture.json"
        content = path.read_bytes()
        fixture = json.loads(content)
        self.assertEqual(len(fixture["symbols"]), 50)
        self.assertEqual(len(fixture["scenarios"]), 4)
        self.run_tool("oracle/generate_expanded.py", "--check")
        self.assertEqual(path.read_bytes(), content)
        fixture["scenarios"][0]["expected"]["rows"][0]["nav"] += 1
        path.write_text(json.dumps(fixture))
        corrupted = path.read_bytes()
        self.run_tool("oracle/generate_expanded.py", "--check", expected=1)
        self.assertEqual(path.read_bytes(), corrupted)

    def test_oracle_check_rejects_numerical_drift_without_repairing_it(self):
        reference = self.root / "oracle/corrupt.json"
        self.run_tool("oracle/generate.py", "--output", str(reference))
        fixture = json.loads(reference.read_text())
        fixture["scenarios"][0]["expected"]["rows"][0]["nav"] += 1
        reference.write_text(json.dumps(fixture))
        before = reference.read_bytes()
        failed = self.run_tool("oracle/generate.py", "--output", str(reference), "--check", expected=1)
        self.assertIn("numerical mismatch", failed.stderr)
        self.assertEqual(reference.read_bytes(), before)

    def test_oracle_check_rejects_boolean_values_in_numeric_reference(self):
        reference = self.root / "oracle/boolean-corrupt.json"
        self.run_tool("oracle/generate.py", "--output", str(reference))
        fixture = json.loads(reference.read_text())
        constant = next(case for case in fixture["covarianceCases"] if case["name"] == "constant")
        constant["covariance"][0][0] = False
        reference.write_text(json.dumps(fixture))
        before = reference.read_bytes()
        self.run_tool("oracle/generate.py", "--output", str(reference), "--check", expected=1)
        self.assertEqual(reference.read_bytes(), before)

    def test_check_never_creates_missing_or_repairs_malformed_reference(self):
        for script in ["oracle/generate.py", "src/data/generate_calendar.py"]:
            with self.subTest(script=script):
                reference = self.root / (Path(script).stem + "-missing.json")
                self.run_tool(script, "--output", str(reference), "--check", expected=1)
                self.assertFalse(reference.exists())
                malformed = b'{"broken":'
                reference.write_bytes(malformed)
                self.run_tool(script, "--output", str(reference), "--check", expected=1)
                self.assertEqual(reference.read_bytes(), malformed)

    def test_calendar_check_detects_a_missing_extraordinary_closure(self):
        self.run_tool("src/data/generate_calendar.py")
        path = self.root / "src/data/us-equity-calendar.json"
        content = path.read_bytes()
        self.run_tool("src/data/generate_calendar.py", "--check")
        self.assertEqual(path.read_bytes(), content)
        calendar = json.loads(content)
        self.assertEqual(calendar["end"], "2028-12-31")
        calendar["closedWeekdays"].remove("2025-01-09")
        path.write_text(json.dumps(calendar))
        before = path.read_bytes()
        failed = self.run_tool("src/data/generate_calendar.py", "--check", expected=1)
        self.assertIn("snapshot differs", failed.stderr)
        self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
