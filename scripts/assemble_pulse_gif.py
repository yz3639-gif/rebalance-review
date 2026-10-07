"""Encode unedited product screenshots; optional Pillow dependency, no generated financial images."""
from pathlib import Path
from PIL import Image
frames = []
for path in sorted(Path('tmp/pulse-media-frames').glob('[0-9][0-9][0-9].png')):
    with Image.open(path) as image:
        image.thumbnail((1120, 800), Image.Resampling.LANCZOS)
        frames.append(image.convert('RGB').quantize(colors=192))
if len(frames) != 24:
    raise SystemExit('Run scripts/capture_pulse_media.mjs first; expected exactly 24 frames.')
frames[0].save('docs/media/market-pulse.gif',save_all=True,append_images=frames[1:],duration=[1300]+[180]*22+[1000],loop=0,optimize=True,disposal=2)
print('Encoded 24 actual synthetic UI frames.')
