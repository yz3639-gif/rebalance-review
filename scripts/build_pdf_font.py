"""Rebuild the checked-in, static PDF font from a pinned OFL upstream font.

python -m venv /tmp/rebalance-font-build
/tmp/rebalance-font-build/bin/pip install -r scripts/pdf-font-requirements.txt
/tmp/rebalance-font-build/bin/python scripts/build_pdf_font.py

An optional --source path avoids downloading the same upstream font again.
The released WOFF is included in the app; ordinary npm builds need no Python.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path
import urllib.request
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

COMMIT = '7085eb89a950e85db5b166b7a58d414544b4140c'
BASE = f'https://raw.githubusercontent.com/google/fonts/{COMMIT}/ofl/notosanssc'
URL = BASE + '/NotoSansSC%5Bwght%5D.ttf'
SOURCE_SHA256 = 'a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da'
ROOT = Path(__file__).resolve().parents[1]

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path)
    args = parser.parse_args()
    data = args.source.read_bytes() if args.source else urllib.request.urlopen(URL, timeout=60).read()
    if hashlib.sha256(data).hexdigest() != SOURCE_SHA256:
        raise SystemExit('Upstream font checksum mismatch; no output was written.')
    source = TTFont(io.BytesIO(data), recalcTimestamp=False)
    font = instantiateVariableFont(source, {'wght': 400}, inplace=False, optimize=True)
    # Use a distinct family for this converted font and retain copyright/license records.
    names = {1: 'Rebalance Sans SC', 2: 'Regular', 3: 'RebalanceSansSC-Regular-1', 4: 'Rebalance Sans SC Regular', 6: 'RebalanceSansSC-Regular', 16: 'Rebalance Sans SC', 17: 'Regular'}
    for name_id, value in names.items():
        for platform, encoding, language in [(3, 1, 0x409), (1, 0, 0)]:
            font['name'].setName(value, name_id, platform, encoding, language)
    font.recalcTimestamp = False
    font.flavor = None
    target = ROOT / 'public' / 'fonts'
    target.mkdir(parents=True, exist_ok=True)
    output = target / 'RebalanceSansSC-Regular.ttf'
    font.save(output, reorderTables=True)
    codepoints = sorted(font.getBestCmap())
    ranges: list[list[int]] = []
    for codepoint in codepoints:
        if ranges and ranges[-1][1] + 1 == codepoint:
            ranges[-1][1] = codepoint
        else:
            ranges.append([codepoint, codepoint])
    (target / 'glyph-ranges.json').write_text(json.dumps(ranges, separators=(',', ':')) + '\n')
    license_text = urllib.request.urlopen(BASE + '/OFL.txt', timeout=30).read()
    (target / 'OFL.txt').write_bytes(license_text)
    metadata = {'sourceUrl': URL, 'sourceCommit': COMMIT, 'sourceSha256': SOURCE_SHA256,
        'sourceLicense': 'SIL Open Font License 1.1', 'sourceLicenseUrl': BASE + '/OFL.txt',
        'buildTool': 'fonttools==4.60.1', 'axes': {'wght': 400}, 'format': 'static TTF',
        'family': 'Rebalance Sans SC', 'file': output.name, 'bytes': output.stat().st_size,
        'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'glyphCodepoints': len(codepoints)}
    (target / 'manifest.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata, indent=2))

if __name__ == '__main__':
    main()
