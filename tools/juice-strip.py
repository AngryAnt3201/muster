# Stitch tools/juice-shots.mjs frames into one strip per effect: python3 tools/juice-strip.py <dir> <tag>
# Writes <dir>/strip-<effect>-<tag>.png (frames left to right, frame number under each) and removes the loose frames.
import sys, glob, os, re
from PIL import Image, ImageDraw
d, tag = sys.argv[1], sys.argv[2]
groups = {}
for p in sorted(glob.glob(f"{d}/*-{tag}-f*.png")):
    m = re.match(rf".*/(.+)-{tag}-f(\d+)\.png$", p)
    if m: groups.setdefault(m.group(1), []).append((int(m.group(2)), p))
for name, frames in groups.items():
    frames.sort()
    ims = [Image.open(p).convert("RGB") for _, p in frames]
    w, h = ims[0].size
    out = Image.new("RGB", (w * len(ims) + 6 * (len(ims) - 1), h + 34), (20, 22, 28))
    dr = ImageDraw.Draw(out)
    for i, ((n, _), im) in enumerate(zip(frames, ims)):
        out.paste(im, (i * (w + 6), 0))
        dr.text((i * (w + 6) + 8, h + 8), f"+{n}f", fill=(230, 230, 230))
    out.save(f"{d}/strip-{name}-{tag}.png")
    for _, p in frames: os.remove(p)
