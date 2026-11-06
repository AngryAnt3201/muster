"""Pack post-processed v3 frames (art/build/v3post) into one atlas per body and tier, plus the manifest.

    python3 art/pack_atlas.py [--sheets-only]

Writes public/atlas/<kind>_t<tier>.png (colour with team parts in white, RGBA),
public/atlas/<kind>_t<tier>_m.png (team mask, RGB, same layout), public/atlas/manifest.json and the contact
sheets in art/contact/. Layout and manifest format: docs/ART-V3-ATLAS.md.
"""
import argparse
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from muster_art import style as STYLE  # noqa: E402
from post import CONTACT, NAMES, ORDER, POST3, TEAM, TIER_NAMES, font, save_sheet  # noqa: E402

OUT = os.path.join(ROOT, "public", "atlas")
PAD = 2
MAX_W = 2048


def shelf_pack(sizes):
    """Shelf-pack (w, h) boxes, tallest first. Returns (W, H, [(x, y)])."""
    area = sum((w + PAD) * (h + PAD) for w, h in sizes)
    W = min(MAX_W, max(max(w for w, _ in sizes) + PAD, int(math.ceil(math.sqrt(area * 1.12) / 16) * 16)))
    order = sorted(range(len(sizes)), key=lambda i: (-sizes[i][1], -sizes[i][0]))
    pos = [None] * len(sizes)
    x = y = shelf_h = 0
    for i in order:
        w, h = sizes[i]
        if x + w + PAD > W:
            y += shelf_h + PAD
            x = shelf_h = 0
        pos[i] = (x, y)
        x += w + PAD
        shelf_h = max(shelf_h, h)
    return W, y + shelf_h, pos


def quant_rgba(im):
    # palette PNG with alpha: toon-shaded frames survive 256 colours with no visible banding
    return im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)


def pack_one(kind, tier):
    src = os.path.join(POST3, kind, f"t{tier}")
    meta = json.load(open(os.path.join(src, "meta.json")))
    frs = meta["frames"]
    W, H, pos = shelf_pack([(f["w"], f["h"]) for f in frs])
    col = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    msk = Image.new("RGB", (W, H), (0, 0, 0))
    anims = {}
    for f, (x, y) in zip(frs, pos):
        col.paste(Image.open(os.path.join(src, f["file"] + ".png")), (x, y))
        msk.paste(Image.open(os.path.join(src, f["file"] + "_m.png")), (x, y))
        a = anims.setdefault(f["anim"], [[] for _ in STYLE.DIRS])
        lst = a[f["dir"]]
        while len(lst) <= f["i"]:
            lst.append(None)
        lst[f["i"]] = [x, y, f["w"], f["h"], f["ax"], f["ay"]]
    os.makedirs(OUT, exist_ok=True)
    name = f"{kind}_t{tier}"
    quant_rgba(col).save(os.path.join(OUT, name + ".png"), optimize=True)
    msk.quantize(colors=32, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(os.path.join(OUT, name + "_m.png"), optimize=True)
    if "walk" not in anims:
        anims["walk"] = "idle"
    return name, {"w": W, "h": H, "anims": anims}, meta["radius"]


def tint_preview(col, msk, team):
    """The runtime tint (src/render/sprites.ts) in numpy, for the contact sheets. Straight alpha in, straight out."""
    c = np.asarray(col.convert("RGBA")).astype(np.float32) / 255
    m = np.asarray(msk.convert("RGB")).astype(np.float32) / 255
    t = TEAM[team]
    k = np.ones_like(c[..., :3])
    for ch, key in enumerate(("main", "dark", "light")):
        k += m[..., ch:ch + 1] * (np.array(t[key], np.float32) / 255 - 1)
    rgb = c[..., :3] * k
    out = np.concatenate([np.clip(rgb, 0, 1), c[..., 3:4]], -1)
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA")


def get_frame(man, kind, tier, anim, i, d8, team, cache):
    key = f"{kind}_t{tier}"
    if (key, team) not in cache:
        col = Image.open(os.path.join(OUT, key + ".png"))
        msk = Image.open(os.path.join(OUT, key + "_m.png"))
        cache[(key, team)] = tint_preview(col, msk, team)
    sheet = man["sheets"][key]
    an = sheet["anims"][anim]
    if isinstance(an, str):
        an = sheet["anims"][an]
    di, mirror = STYLE.DIR8[d8]
    fr = an[di][i % len(an[di])]
    x, y, w, h, ax, ay = fr
    im = cache[(key, team)].crop((x, y, x + w, y + h))
    if mirror:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
        ax = w - ax
    return im, ax, ay


def ground(sheet, cx, cy, r, el):
    k = math.sin(math.radians(el))
    sh = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - r, cy - r * k, cx + r, cy + r * k], fill=(0, 0, 0, 80))
    sheet.alpha_composite(sh)


def bg(W, H):
    im = Image.new("RGBA", (W, H), (74, 96, 66, 255))
    d = ImageDraw.Draw(im)
    for y in range(0, H, 48):
        d.line([(0, y), (W, y)], fill=(68, 89, 61, 255))
    return im


def sheet_tiers(man, team, d8=1, anim="idle", scale=1.0, name=None):
    """Every body at tiers 1 to 4, true in-game scale (PPU), one facing. The silhouette check."""
    kinds = [k for k in ORDER if any(s.startswith(k + "_t") for s in man["sheets"])]
    cell = int(250 * scale)
    lab = int(170 * scale)
    half = (len(kinds) + 1) // 2
    W = (lab + cell * 4) * 2 + 40
    H = 50 + half * cell + 20
    sh = bg(W, H)
    d = ImageDraw.Draw(sh)
    f, fs = font(max(11, int(17 * scale))), font(max(10, int(12 * scale)))
    cache = {}
    for b in range(2):
        x0 = 20 + b * (lab + cell * 4)
        for t in range(1, 5):
            d.text((x0 + lab + cell * (t - 1) + 8, 14), f"T{t} {TIER_NAMES[t]}", fill=(240, 245, 235, 255), font=f)
    for n, kind in enumerate(kinds):
        b, row = divmod(n, half)
        x0, y0 = 20 + b * (lab + cell * 4), 50 + row * cell
        u = man["units"][kind]
        d.text((x0, y0 + cell // 2 - 18), NAMES.get(kind, kind), fill=(250, 250, 245, 255), font=f)
        d.text((x0, y0 + cell // 2 + 4), kind, fill=(200, 215, 195, 255), font=fs)
        for t in u["tiers"]:
            im, ax, ay = get_frame(man, kind, t, anim, 0, d8, team, cache)
            if scale != 1.0:
                im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
                ax, ay = ax * scale, ay * scale
            cx, cy = x0 + lab + cell * (t - 1) + cell // 2, y0 + int(cell * 0.72)
            ground(sh, cx, cy, u["radius"] * STYLE.PPU * scale, STYLE.CAMERA_EL)
            sh.alpha_composite(im, (int(cx - ax), int(cy - ay)))
    os.makedirs(CONTACT, exist_ok=True)
    p = os.path.join(CONTACT, name or f"v3_tiers_{team}.png")
    save_sheet(sh, p)
    print("SHEET", p, sh.size)


def sheet_anims(man, kind, tier, team="tide", name=None):
    """All 8 facings x every animation frame for one body and tier."""
    plan = [(a, i) for a, n in STYLE.ANIMS.items() for i in range(n)]
    cache = {}
    cells = [[get_frame(man, kind, tier, a, i, d8, team, cache) for (a, i) in plan] for d8 in range(8)]
    cw = max(im.width for row in cells for im, _, _ in row) + 12
    ch = max(im.height for row in cells for im, _, _ in row) + 12
    sh = bg(cw * len(plan) + 20, ch * 8 + 40)
    d = ImageDraw.Draw(sh)
    for j, (a, i) in enumerate(plan):
        d.text((10 + j * cw + 4, 8), f"{a}{i}", fill=(240, 245, 235, 255), font=font(14))
    for d8, row in enumerate(cells):
        for j, (im, ax, ay) in enumerate(row):
            cx, cy = 10 + j * cw + cw // 2, 30 + d8 * ch + int(ch * 0.7)
            sh.alpha_composite(im, (int(cx - ax), int(cy - ay)))
    p = os.path.join(CONTACT, name or f"v3_anim_{kind}_t{tier}.png")
    save_sheet(sh, p)
    print("SHEET", p, sh.size)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheets-only", action="store_true")
    a = ap.parse_args()
    mp = os.path.join(OUT, "manifest.json")
    if a.sheets_only:
        man = json.load(open(mp))
    else:
        man = {"version": 3, "style": STYLE.ID, "ppu": STYLE.PPU, "el": STYLE.CAMERA_EL, "dirs": STYLE.DIRS, "dir8": STYLE.DIR8,
               "anims": STYLE.ANIMS, "teams": {k: v for k, v in STYLE.TEAMS.items() if k != "neutral"}, "units": {}, "sheets": {}}
        found = []
        for kind in os.listdir(POST3) if os.path.isdir(POST3) else []:
            for td in os.listdir(os.path.join(POST3, kind)):
                if os.path.exists(os.path.join(POST3, kind, td, "meta.json")):
                    found.append((kind, int(td[1:])))
        rank = {k: i for i, k in enumerate(ORDER)}
        found.sort(key=lambda kt: (rank.get(kt[0], 99), kt[1]))
        for kind, tier in found:
            name, sheet, radius = pack_one(kind, tier)
            man["sheets"][name] = sheet
            u = man["units"].setdefault(kind, {"tiers": [], "radius": radius})
            u["tiers"].append(tier)
            print("PACK_OK", name, sheet["w"], "x", sheet["h"], flush=True)
        with open(mp, "w") as f:
            json.dump(man, f, separators=(",", ":"))
    for team in TEAM:
        sheet_tiers(man, team)
    sheet_tiers(man, "tide", anim="attack", name="v3_tiers_tide_attack.png")
    sheet_tiers(man, "ember", d8=6, name="v3_tiers_ember_north.png")
    for kind, tier in (("ranger", 4), ("golem", 2), ("harrier", 3), ("blades", 1)):
        if f"{kind}_t{tier}" in man["sheets"]:
            sheet_anims(man, kind, tier)


if __name__ == "__main__":
    main()
