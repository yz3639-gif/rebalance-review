"""Compare regenerated references using the existing frozen numerical tolerances."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'oracle'))
from generate import assert_equivalent

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('reference', type=Path)
parser.add_argument('regenerated', type=Path)
args = parser.parse_args()
assert_equivalent(json.loads(args.regenerated.read_text()), json.loads(args.reference.read_text()))
print(json.dumps({'status': 'equivalent-with-existing-tolerances',
    'referenceSha256': hashlib.sha256(args.reference.read_bytes()).hexdigest(),
    'regeneratedSha256': hashlib.sha256(args.regenerated.read_bytes()).hexdigest()}))
