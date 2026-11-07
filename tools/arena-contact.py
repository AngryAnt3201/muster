"""Contact sheet of the arena before/after shots: python3 tools/arena-contact.py -> outputs/review/polish2/arenas/contact.png
Two rows per four acts: before on top, after below, each labelled."""
import os
from PIL import Image, ImageDraw, ImageFont

D = "outputs/review/polish2/arenas"
NAMES = ["Borderlands", "Ash Fields", "Hollow Wood", "Iron Pass", "High Keep", "Frozen Reach", "Sky Throne", "Mirelight Fen"]
TW, CROP = 300, (0, 120, 780, 1240)  # the board area of a 780x1688 shot
th = int(TW * (CROP[3] - CROP[1]) / (CROP[2] - CROP[0]))
pad, lab = 10, 26
cols, rows = 8, 2
sheet = Image.new("RGB", (pad + cols * (TW + pad), pad + rows * (th + lab + pad)), (36, 28, 22))
dr = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 16)
except OSError:
    font = ImageFont.load_default()
for a in range(1, 9):
    for r, tag in enumerate(("before", "after")):
        p = os.path.join(D, f"act{a}-{tag}.png")
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert("RGB").crop(CROP).resize((TW, th), Image.LANCZOS)
        x, y = pad + (a - 1) * (TW + pad), pad + r * (th + lab + pad)
        dr.text((x + 2, y + 4), f"Act {a} {NAMES[a - 1]}: {tag}", fill=(255, 240, 210), font=font)
        sheet.paste(im, (x, y + lab))
sheet.save(os.path.join(D, "contact.png"))
print("contact", sheet.size)
