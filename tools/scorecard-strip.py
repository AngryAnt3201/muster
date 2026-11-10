# Stitch screenshots into one labelled contact strip for the polish scorecard (tools/scorecard-shots.mjs):
#   python3 tools/scorecard-strip.py <out.jpg> <cols> <scale> <frame.png>...
# Each frame is labelled with its file name (minus the extension); prints the share of pixels that change between
# consecutive frames.
import os, sys
from PIL import Image, ImageChops, ImageDraw

out, cols, scale, files = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), sys.argv[4:]
ims = []
for p in files:
    im = Image.open(p).convert("RGB")
    ims.append(im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS))
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w + 6 * (cols - 1), rows * (h + 6)), (20, 22, 28))
dr = ImageDraw.Draw(sheet)
moved = []
for i, im in enumerate(ims):
    x, y = (i % cols) * (w + 6), (i // cols) * (h + 6)
    sheet.paste(im, (x, y))
    label = os.path.splitext(os.path.basename(files[i]))[0]
    dr.rectangle((x, y, x + 8 + 7 * len(label), y + 16), fill=(0, 0, 0))
    dr.text((x + 4, y + 2), label, fill=(255, 255, 255))
    if i:
        diff = ImageChops.difference(im, ims[i - 1]).convert("L").point(lambda v: 255 if v > 16 else 0)
        moved.append(round(100 * sum(diff.histogram()[255:]) / (w * h), 1))
sheet.save(out, quality=84)
print(f"{os.path.basename(out)}: {len(ims)} frames, moved % between frames: {moved}")
