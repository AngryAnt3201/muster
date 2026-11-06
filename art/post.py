"""Post-process raw Blender renders into game sprites, portraits, manifest and contact sheets.

python3 art/post.py [--only kind,kind] [--sheets-only]
Needs Pillow + numpy (system python3).
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(HERE, "build", "raw")
SPR = os.path.join(ROOT, "public", "sprites")
POR = os.path.join(ROOT, "public", "portraits")
CONTACT = os.path.join(HERE, "contact")
PPU = 120
SS = 2
INK = np.array([11, 15, 24], np.float32) / 255
TEAM = {
    "tide": {"main": (63, 208, 201), "light": (166, 255, 246), "dark": (22, 124, 122)},
    "ember": {"main": (255, 106, 77), "light": (255, 193, 173), "dark": (168, 51, 31)},
}
ORDER = ["mine", "blades", "ranger", "bulwark", "medic", "grenadier", "shade", "lancer", "ballista", "hive", "storm", "golem",
         "sapper", "harrier", "banner", "rime", "ravager", "grave", "bombard", "tinker", "duelist", "pikeman", "keg", "trickster",
         "mite", "golemling", "thrall", "turret", "decoy", "queen"]
NAMES = {"mine": "Mine", "blades": "Blade Trio", "ranger": "Ranger", "bulwark": "Bulwark", "medic": "Medic", "grenadier": "Grenadier",
         "shade": "Shade", "lancer": "Lancer", "ballista": "Ballista", "hive": "Hive", "storm": "Stormcaller", "golem": "Stone Colossus",
         "sapper": "Sapper", "harrier": "Harrier", "banner": "Standard Bearer", "rime": "Rimecaller", "ravager": "Ravager",
         "grave": "Gravecaller", "bombard": "Bombard", "tinker": "Tinker", "duelist": "Duelist", "pikeman": "Pikeman", "keg": "Kegrunner",
         "trickster": "Trickster", "mite": "Mite", "golemling": "Shardling", "thrall": "Thrall", "turret": "Turret", "decoy": "Decoy",
         "queen": "Brood Queen"}
TIER_NAMES = {1: "Recruit", 2: "Veteran", 3: "Elite", 4: "Ascended"}


def load_premul(path):
    a = np.asarray(Image.open(path).convert("RGBA")).astype(np.float32) / 255.0
    a[..., :3] *= a[..., 3:4]
    return a


def shift(img, dy, dx):
    out = np.zeros_like(img)
    H, W = img.shape[:2]
    ys, yd = slice(max(0, dy), H + min(0, dy)), slice(max(0, -dy), H + min(0, -dy))
    xs, xd = slice(max(0, dx), W + min(0, dx)), slice(max(0, -dx), W + min(0, -dx))
    out[ys, xs] = img[yd, xd]
    return out


def dilate(alpha, r):
    out = alpha.copy()
    rr = r + 0.35
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            d2 = dx * dx + dy * dy
            if 0 < d2 <= rr * rr:
                out = np.maximum(out, shift(alpha, dy, dx))
    return out


def over(top, bot):
    a = top[..., 3:4]
    return top + bot * (1.0 - a)


def blur(ch, radius):
    im = Image.fromarray(np.clip(ch * 255.0, 0, 255).astype(np.uint8), "L")
    return np.asarray(im.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255.0


def process(raw_path, glow_path, team, out_path, size, ink_r, glow_r, ghost=False, quant=True):
    img = load_premul(raw_path)
    al = img[..., 3]
    # ink silhouette behind everything (outer outline)
    ink_a = dilate(al, ink_r)
    ink = np.zeros_like(img)
    ink[..., :3] = INK * ink_a[..., None]
    ink[..., 3] = ink_a
    out = over(img, ink)
    if glow_path and os.path.exists(glow_path):
        g = load_premul(glow_path)
        ga = g[..., 3]
        col = np.array(TEAM[team]["main"], np.float32) / 255
        lt = np.array(TEAM[team]["light"], np.float32) / 255
        wide = np.clip(blur(ga, glow_r * 1.8) * 1.6, 0, 0.55)
        near = np.clip(blur(ga, glow_r * 0.7) * 1.8, 0, 0.9)
        halo = np.zeros_like(img)
        hc = (col * wide[..., None] * (1 - near[..., None]) + lt * near[..., None])
        ha = np.clip(wide + near * (1 - wide), 0, 1)
        halo[..., :3] = hc * 1.0
        halo[..., 3] = ha
        halo[..., :3] = np.minimum(halo[..., :3], ha[..., None])
        out = over(out, halo)
        # bloom lift on top of the glowing parts
        bl = np.stack([blur(g[..., i], glow_r * 0.6) for i in range(3)], -1)
        out[..., :3] = np.minimum(out[..., :3] + bl * 0.45 * out[..., 3:4], out[..., 3:4])
    if ghost:
        lt = np.array(TEAM[team]["light"], np.float32) / 255
        out[..., :3] = out[..., :3] * 0.5 + lt * out[..., 3:4] * 0.5
        out *= 0.66
    out8 = np.clip(out * 255.0 + 0.5, 0, 255).astype(np.uint8)
    im = Image.fromarray(out8, "RGBa")
    if im.size[0] != size:
        im = im.reduce(im.size[0] // size) if im.size[0] % size == 0 else im.resize((size, size), Image.LANCZOS)
    im = im.convert("RGBA")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    if quant:
        q = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        q.save(out_path, optimize=True)
    else:
        im.save(out_path, optimize=True)
    return im


RADIUS = {}


def load_radii():
    if not os.path.isdir(RAW):
        return
    for k in os.listdir(RAW):
        mp = os.path.join(RAW, k, "meta.json")
        if os.path.exists(mp):
            RADIUS[k] = json.load(open(mp)).get("radius", 0.25)


def sprites(kinds):
    manifest_path = os.path.join(SPR, "manifest.json")
    man = {"ppu": PPU, "units": {}}
    if os.path.exists(manifest_path):
        try:
            man = json.load(open(manifest_path))
            man["ppu"] = PPU
        except Exception:
            pass
    for kind in kinds:
        d = os.path.join(RAW, kind)
        meta_p = os.path.join(d, "meta.json")
        if not os.path.exists(meta_p):
            continue
        meta = json.load(open(meta_p))
        size = meta["size"]
        for t in meta["tiers"]:
            for team in TEAM:
                for pose in ("idle", "attack"):
                    raw = os.path.join(d, f"t{t}_{team}_{pose}.png")
                    if not os.path.exists(raw):
                        continue
                    glow = os.path.join(d, f"t{t}_{team}_{pose}_glow.png")
                    process(raw, glow, team, os.path.join(SPR, kind, f"t{t}_{team}_{pose}.png"), size, ink_r=3, glow_r=7,
                            ghost=kind == "decoy")
            por = os.path.join(RAW, "portraits", f"{kind}_t{t}.png")
            if os.path.exists(por):
                process(por, os.path.join(RAW, "portraits", f"{kind}_t{t}_glow.png"), "tide", os.path.join(POR, f"{kind}_t{t}.png"), 256,
                        ink_r=4, glow_r=10, ghost=kind == "decoy")
        man["units"][kind] = {"size": size, "tiers": meta["tiers"], "poses": ["idle", "attack"]}
        print(f"POST_OK {kind}", flush=True)
    ordered = {k: man["units"][k] for k in ORDER if k in man["units"]}
    ordered.update({k: v for k, v in man["units"].items() if k not in ordered})
    man["units"] = ordered
    os.makedirs(SPR, exist_ok=True)
    with open(manifest_path, "w") as f:
        json.dump(man, f, indent=2)
    return man


def font(sz):
    for p in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


def board_bg(w, h):
    bg = Image.new("RGBA", (w, h), (22, 32, 46, 255))
    d = ImageDraw.Draw(bg)
    for x in range(0, w, 60):
        d.line([(x, 0), (x, h)], fill=(30, 42, 58, 255))
    for y in range(0, h, 60):
        d.line([(0, y), (w, y)], fill=(30, 42, 58, 255))
    return bg


def shadow(sheet, cx, cy, r):
    sh = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(sh)
    d.ellipse([cx - r + r * 0.12, cy - r * 0.78 + r * 0.28, cx + r + r * 0.12, cy + r * 0.78 + r * 0.28], fill=(0, 0, 0, 90))
    sheet.alpha_composite(sh)


def contact(man, team, pose="idle", scale=1.0, name=None, cols_blocks=2):
    kinds = [k for k in ORDER if k in man["units"]]
    cell = int(200 * scale)
    lab_w = int(150 * scale) if scale >= 0.75 else 0
    head_h = 40
    per_block = (len(kinds) + cols_blocks - 1) // cols_blocks
    block_w = lab_w + cell * 4 + 20
    W = block_w * cols_blocks + 20
    Hh = head_h + per_block * cell + 20
    sheet = board_bg(W, Hh)
    d = ImageDraw.Draw(sheet)
    f = font(max(11, int(16 * scale)))
    fs = font(max(10, int(12 * scale)))
    for b in range(cols_blocks):
        x0 = 20 + b * block_w
        for t in range(1, 5):
            d.text((x0 + lab_w + cell * (t - 1) + 8, 10), f"T{t} {TIER_NAMES[t]}", fill=(200, 215, 230, 255), font=f)
    for i, kind in enumerate(kinds):
        b, row = divmod(i, per_block)
        x0 = 20 + b * block_w
        y0 = head_h + row * cell
        u = man["units"][kind]
        size = u["size"]
        s = scale
        rad = RADIUS.get(kind, 0.25)
        if lab_w:
            d.text((x0, y0 + cell // 2 - 18), NAMES.get(kind, kind), fill=(235, 240, 245, 255), font=f)
            d.text((x0, y0 + cell // 2 + 2), f"{kind} {size}px", fill=(130, 150, 170, 255), font=fs)
        for t in u["tiers"]:
            p = os.path.join(SPR, kind, f"t{t}_{team}_{pose}.png")
            if not os.path.exists(p):
                continue
            im = Image.open(p).convert("RGBA")
            ns = max(1, int(round(size * s)))
            if ns != size:
                im = im.resize((ns, ns), Image.LANCZOS)
            cx = x0 + lab_w + cell * (t - 1) + cell // 2
            cy = y0 + cell // 2
            shadow(sheet, cx, cy, rad * PPU * s * 1.1)
            # clip to the cell so true in-game scale is kept
            cl = cell // 2 - 2
            box = (ns // 2 - cl, ns // 2 - cl, ns // 2 + cl, ns // 2 + cl)
            crop = Image.new("RGBA", (2 * cl, 2 * cl), (0, 0, 0, 0))
            crop.alpha_composite(im, (max(0, -box[0]), max(0, -box[1])), (max(0, box[0]), max(0, box[1]), min(ns, box[2]), min(ns, box[3])))
            sheet.alpha_composite(crop, (cx - cl, cy - cl))
    os.makedirs(CONTACT, exist_ok=True)
    path = os.path.join(CONTACT, name or f"sheet_{team}.png")
    save_sheet(sheet, path)
    print("SHEET", path, sheet.size)
    return path


def save_sheet(sheet, path):
    sheet.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(path, optimize=True)


def portrait_sheet(man):
    kinds = [k for k in ORDER if k in man["units"] and os.path.exists(os.path.join(POR, f"{k}_t1.png"))]
    cols = 8
    cell = 128
    rows = (len(kinds) * 4 + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell, rows * cell), (34, 44, 60, 255))
    i = 0
    for kind in kinds:
        for t in man["units"][kind]["tiers"]:
            p = os.path.join(POR, f"{kind}_t{t}.png")
            if not os.path.exists(p):
                continue
            im = Image.open(p).convert("RGBA").resize((cell, cell), Image.LANCZOS)
            r, c = divmod(i, cols)
            sheet.alpha_composite(im, (c * cell, r * cell))
            i += 1
    path = os.path.join(CONTACT, "portraits.png")
    save_sheet(sheet, path)
    print("SHEET", path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--sheets-only", action="store_true")
    a = ap.parse_args()
    kinds = [k for k in ORDER if os.path.isdir(os.path.join(RAW, k))]
    kinds += [k for k in sorted(os.listdir(RAW)) if os.path.isdir(os.path.join(RAW, k)) and k not in kinds and k != "portraits"] if os.path.isdir(RAW) else []
    if a.only:
        want = {x.strip() for x in a.only.split(",")}
        kinds = [k for k in kinds if k in want]
    load_radii()
    if a.sheets_only:
        man = json.load(open(os.path.join(SPR, "manifest.json")))
    else:
        man = sprites(kinds)
    for team in TEAM:
        contact(man, team)
    contact(man, "tide", pose="attack", name="sheet_tide_attack.png")
    contact(man, "ember", pose="attack", name="sheet_ember_attack.png")
    contact(man, "tide", scale=0.5, name="sheet_tide_phone.png", cols_blocks=3)
    portrait_sheet(man)


if __name__ == "__main__":
    main()
