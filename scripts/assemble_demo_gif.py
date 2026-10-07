"""Encode browser-captured frames into a README walkthrough (optional Pillow tool)."""
from pathlib import Path
from PIL import Image

frames = []
for path in sorted(Path('tmp/demo-media-frames').glob('[0-9][0-9][0-9].png')):
    with Image.open(path) as image:
        image.thumbnail((1120, 800), Image.Resampling.LANCZOS)
        frames.append(image.convert('RGB').quantize(colors=192))
if not frames:
    raise SystemExit('Capture the running synthetic demo with scripts/capture_demo_media.mjs first.')
durations = [1500] * len(frames)
for index in range(3, min(8, len(frames))):
    durations[index] = 240
frames[0].save('docs/media/terminal-preview.gif', save_all=True, append_images=frames[1:],
               duration=durations, loop=0, optimize=True, disposal=2)
print('Encoded', len(frames), 'actual UI frames; no rendered values or charts were edited.')
