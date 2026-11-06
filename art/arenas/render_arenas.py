"""Arenas v3: one battlefield per campaign act in the active style direction (Sunlit Meadow), for the 3/4 camera.

    blender -b --factory-startup -P art/arenas/render_arenas.py -- [--only 1,5] [--samples 16] [--quick]
    npm run art:arenas

Per act this renders, with the shared toon kit (art/muster_art: ink hulls, cel bands, violet shadow tint):
  - act<n>.jpg: the backdrop through the game's own camera (src/render/camera.ts: pinhole, TILT from straight down,
    DIST from the board centre). A ground point with board-centred (X, Y) lands on the normalised image plane at
    u = X / cz, v = Y cos(tilt) / cz, cz = DIST - Y sin(tilt), the same numbers the game uses, so the game draws the
    image with one scale + offset and the ground lines up with the board exactly on any screen. It holds the ground,
    the neutral strip and kerbs, the path, the keep plazas, the hedges (or walls, rails...) around the board and the
    trees and scenery beyond: everything that never moves and stays out of the play area.
  - act<n>_prop<0..2>.png: three obstacle props, modelled with their base on the unit circle (radius 1 = the
    obstacle's collision radius), rendered orthographic at the camera's mid-board elevation, contact shadow baked.
    The game stands them on their circles and depth-sorts them with units and keeps.
  - manifest.json: camera, image-plane view, prop frame/anchor, measured prop footprints.
Shapes and palettes are original, built from primitives; nothing is traced from another game.
"""
import argparse
import copy
import json
import math
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.dirname(HERE)
ROOT = os.path.dirname(ART)
sys.path.insert(0, ART)
OUT = os.path.join(ROOT, "public", "arenas")
BUILD = os.path.join(ART, "build", "arenas")

W, H, ZD = 9.0, 14.0, 5.9
TILT, DIST = 0.64, 30.0  # src/render/camera.ts
VIEW = {"u0": -0.26, "u1": 0.26, "v0": -0.42, "v1": 0.44}  # covers a phone (and most tablets) around the board
KPX = 2800  # backdrop px per normalised image-plane unit (a phone shows ~1100 css px per unit)
KEEPS = [(4.5, 1.55), (4.5, H - 0.6)]  # src/render/keeps.ts keepAnchor
PROP_X = (-1.6, 1.6)
PROP_U = (-1.3, 2.5)
PROP_PPU = 160

# Act themes: overrides on the direction's ground palette plus what grows around the board.
ACTS = {
    1: dict(name="Borderlands", g={}, border="hedge", trees=("broad",), scatter="flowers", obstacle="boulder"),
    2: dict(name="Ash Fields", g=dict(grass="#c3b85c", grass_dk="#a89c48", grass_lt="#d9cf7a", strip="#d8b98a", strip_dk="#b99a68",
                                       foliage="#e8913c", foliage_dk="#c0612c", path="#e6c48e", path_dk="#c69b62", moss="#b2a04a"),
            border="hedge", trees=("broad", "broad", "dead"), scatter="embers", obstacle="charstump"),
    3: dict(name="Hollow Wood", g=dict(grass="#6cb552", grass_dk="#54993f", grass_lt="#8ccb63", foliage="#46a04c", foliage_dk="#2e7a3a",
                                       strip="#c9b083", strip_dk="#a98f63"),
            border="hedge", trees=("broad", "pine", "broad"), scatter="mushrooms", obstacle="stump"),
    4: dict(name="Iron Pass", g=dict(grass="#a2bd72", grass_dk="#88a35d", grass_lt="#bcd38e", path="#ddd2b8", path_dk="#b8aa8c",
                                     strip="#cfc6b2", strip_dk="#aea38c", foliage="#4f9a5e", foliage_dk="#2f6f45", rock="#b4b0a8", rock_dk="#7d7972"),
            border="rocks", trees=("pine", "pine", "crag"), scatter="pebbles", obstacle="crag"),
    5: dict(name="High Keep", g=dict(grass="#8cc45e", grass_dk="#70ad4b", grass_lt="#a9d878", path="#cf5446", path_dk="#9c3a30",
                                     strip="#86c25a", strip_dk="#6aa947", court="#dcc6a0", court_dk="#a88d68"),
            court=True, strip_pat="patches", border="wall", trees=("topiary",), scatter="flowers", obstacle="pillar",
            relief="flagstones", stones=("#dcc6a0", "#e7d6b3", "#ccb38b", "#d5bf98"), trim="#ffcf4d"),
    6: dict(name="Frozen Reach", g=dict(grass="#eef5fb", grass_dk="#d3e2ef", grass_lt="#ffffff", path="#c5d7e8", path_dk="#9fb7cf",
                                        strip="#dbe7f2", strip_dk="#b9cde0", foliage="#3f8f6a", foliage_dk="#2b6b52", rock="#a9b4c2", rock_dk="#76828f",
                                        moss="#f4f9ff", edge="#8aa2bb"),
            border="snow", trees=("snowpine",), scatter="ice", obstacle="icerock", relief="snow"),
    7: dict(name="Sky Throne", g=dict(grass="#bfe0ff", grass_dk="#a6d0f7", grass_lt="#e6f3ff", path="#6f8fe0", path_dk="#4c69bd",
                                      strip="#efe3c8", strip_dk="#cdbd9a", court="#f5efe3", court_dk="#d9cdb6", rock="#f2ece0", rock_dk="#c9bfae"),
            court=True, border="rail", trees=("cloud",), scatter="none", obstacle="obelisk",
            relief="flagstones", stones=("#f5efe3", "#fbf8f1", "#ebe1cf", "#e9eef5"), strip_stones=("#efe3c8", "#f7eedb", "#e3d3b2"),
            inlay="#ffcf4d", trim="#ffcf4d", path_tiles=True),
}


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--quick", action="store_true")
    return ap.parse_args(argv)


def rnd(i, k):
    return abs(math.sin(i * 127.1 + k * 311.7) * 43758.5453) % 1.0


def main():
    import bpy  # noqa: F401
    import numpy as np
    from bpy_extras.object_utils import world_to_camera_view
    from mathutils import Vector

    from muster_art import kit as K
    from muster_art import style as S

    a = parse()
    only = {int(x) for x in a.only.split(",") if x.strip()} or set(ACTS)
    ss = 1 if a.quick else 2
    base = S.load()
    stage = K.Stage(samples=4 if a.quick else a.samples)
    S.apply(base)
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(BUILD, exist_ok=True)
    wk = K.Kit(outline=base["outline"]["props"])
    coll = bpy.data.collections.new("Arena")
    bpy.context.scene.collection.children.link(coll)
    wk.coll = coll
    el_prop = math.pi / 2 - TILT

    def B(x, y, z=0.0):
        return (x, -y, z)

    man_path = os.path.join(OUT, "manifest.json")
    man = json.load(open(man_path)) if os.path.exists(man_path) else {}
    if man.get("version") != 3:
        man = {"acts": {}}
    man.update(version=3, style=base["id"], camera={"tilt": TILT, "dist": DIST}, view=VIEW)

    def render(path):
        stage.sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        return S.read_png(path)

    def to_jpeg(png, jpg, q=84):
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(q), png, "--out", jpg], capture_output=True)

    for act in sorted(only):
        t0 = time.time()
        th = ACTS[act]
        st = copy.deepcopy(base)
        st["id"] = f"{base['id']}_a{act}"
        g = st["ground"]
        g.update(th["g"])
        g.setdefault("court", g["strip"])
        g.setdefault("court_dk", g["strip_dk"])
        g.setdefault("lantern", "#ffd27a")
        wk.clear()

        def toon(key, spec=0.0):
            return K.toon(g.get(key) or key, spec=spec)

        sh_in = K.flat(st["shadow"]["color"], alpha=st["shadow"]["alpha"])
        sh_out = K.flat(st["shadow"]["color"], alpha=st["shadow"]["alpha"] * 0.45)

        def shadow(x, y, r):
            wk.cyl(r * 1.08, 0.004, sh_out, loc=B(x, y, 0.012), seg=28, outline=0)
            wk.cyl(r * 0.82, 0.004, sh_in, loc=B(x, y, 0.016), seg=28, outline=0)

        def ribbon(pts, width, mat, z):
            import bmesh
            bm = bmesh.new()
            P2 = [Vector(B(px, py, z)) for px, py in pts]
            L, R = [], []
            for i, p in enumerate(P2):
                d = (P2[min(i + 1, len(P2) - 1)] - P2[max(i - 1, 0)]).normalized()
                n = Vector((-d.y, d.x, 0)) * (width / 2)
                L.append(bm.verts.new(p + n))
                R.append(bm.verts.new(p - n))
            for i in range(len(P2) - 1):
                bm.faces.new((L[i], R[i], R[i + 1], L[i + 1]))
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
            for f in bm.faces:
                if f.normal.z < 0:
                    f.normal_flip()
            return wk._emit(bm, mat, smooth=False, outline=0, name="ribbon")

        # ---------------- scenery pieces
        def tree(kind, x, y, s, i):
            if kind == "cloud":
                for j in range(4):
                    aa = j * 1.9 + i
                    wk.ball(0.36 * s, K.toon("#ffffff"), loc=B(x + math.cos(aa) * 0.3 * s, y + math.sin(aa) * 0.2 * s, (0.05 + 0.1 * (j % 2)) * s),
                            scale=(1.2, 1.0, 0.7), subdiv=2)
                return
            shadow(x, y, 0.42 * s)
            if kind in ("pine", "snowpine"):
                wk.cyl(0.08 * s, 0.4 * s, toon("trunk"), loc=B(x, y, 0.2 * s))
                for j, (rr, zz) in enumerate(((0.5, 0.38), (0.39, 0.78), (0.27, 1.12))):
                    wk.cone(rr * s, 0.6 * s, toon("foliage" if j % 2 == 0 else "foliage_dk"), loc=B(x, y, zz * s), seg=9)
                    if kind == "snowpine":
                        wk.cone(rr * 0.62 * s, 0.32 * s, K.toon("#ffffff"), loc=B(x, y, zz * s + 0.16 * s), seg=9)
            elif kind == "dead":
                wk.cyl(0.08 * s, 0.9 * s, K.toon("#5a4636"), loc=B(x, y, 0.45 * s), r2=0.05 * s)
                for j in range(3):
                    aa = j * 2.2 + i
                    wk.rod(B(x, y, (0.55 + 0.12 * j) * s), B(x + math.cos(aa) * 0.4 * s, y + math.sin(aa) * 0.3 * s, (0.95 + 0.1 * j) * s), 0.035 * s,
                           K.toon("#5a4636"), r2=0.015 * s)
            elif kind == "crag":
                wk.ball(0.55 * s, toon("rock"), loc=B(x, y, 0.3 * s), scale=(1.0, 0.9, 0.95), subdiv=1, smooth=False, rot=(0, 0, 30 * i))
                wk.ball(0.32 * s, toon("rock_dk"), loc=B(x + 0.4 * s, y + 0.2 * s, 0.15 * s), subdiv=1, smooth=False)
            elif kind == "topiary":
                wk.box((0.6 * s, 0.6 * s, 0.35 * s), toon("court_dk"), loc=B(x, y, 0.17 * s), bevel=0.04)
                wk.cyl(0.05 * s, 0.4 * s, toon("trunk"), loc=B(x, y, 0.5 * s))
                wk.ball(0.36 * s, toon("foliage"), loc=B(x, y, 0.9 * s), subdiv=2)
            else:  # broadleaf
                wk.cyl(0.08 * s, 0.5 * s, toon("trunk"), loc=B(x, y, 0.25 * s), r2=0.06 * s)
                for j in range(4):
                    aa = j * 2.1 + i
                    wk.ball(0.3 * s, toon("foliage" if j else "foliage_dk"), loc=B(x + math.cos(aa) * 0.17 * s, y + math.sin(aa) * 0.12 * s, (0.72 + 0.12 * (j % 2)) * s), subdiv=2)
                wk.ball(0.26 * s, toon("foliage"), loc=B(x, y - 0.05, 0.98 * s), subdiv=2)

        def border_piece(x, y, along_x, i):
            kind = th["border"]
            if kind == "wall":
                wk.box((0.62, 0.42, 0.42) if along_x else (0.42, 0.62, 0.42), toon("court_dk"), loc=B(x, y, 0.21), bevel=0.04)
                wk.box((0.66, 0.46, 0.08) if along_x else (0.46, 0.66, 0.08), toon("court"), loc=B(x, y, 0.45), bevel=0.02)
            elif kind == "rail":
                wk.cyl(0.07, 0.42, toon("court"), loc=B(x, y, 0.21), seg=10)
                wk.sphere(0.07, K.toon("#ffcf4d", spec=0.4), loc=B(x, y, 0.48))
                if along_x:
                    wk.box((0.6, 0.1, 0.07), toon("court_dk"), loc=B(x + 0.3, y, 0.36), bevel=0.015)
                else:
                    wk.box((0.1, 0.6, 0.07), toon("court_dk"), loc=B(x, y + 0.3, 0.36), bevel=0.015)
            elif kind == "rocks":
                wk.ball(0.27, toon("rock" if i % 3 else "rock_dk"), loc=B(x, y, 0.13), scale=(1.15, 1.05, 0.75), subdiv=1, smooth=False, rot=(0, 0, 37 * i))
            elif kind == "snow":
                wk.ball(0.3, K.toon("#ffffff"), loc=B(x, y, 0.12), scale=(1.15, 1.1, 0.7), subdiv=2)
            else:
                wk.ball(0.3, toon("foliage_dk" if i % 3 == 0 else "foliage"), loc=B(x, y, 0.22), scale=(1.1, 1.1, 0.85), subdiv=2)

        def scatter(x, y, i):
            kind = th["scatter"]
            if kind == "flowers":
                col = ("#fff4d6", "#ffd84d", "#ff8fa3", "#b9a2ff")[i % 4]
                for j in range(3):
                    wk.sphere(0.05, K.toon(col), loc=B(x + 0.1 * math.cos(j * 2.1), y + 0.08 * math.sin(j * 2.1), 0.05), seg=8, rings=5, outline=0.006)
            elif kind == "mushrooms":
                wk.cyl(0.035, 0.12, K.toon("#f3ead0"), loc=B(x, y, 0.06), outline=0.008)
                wk.sphere(0.09, K.toon("#e2483a"), loc=B(x, y, 0.13), scale=(1, 1, 0.6), seg=12, rings=6, outline=0.008)
            elif kind == "embers":
                wk.cyl(0.12, 0.08, K.toon("#4a3a30"), loc=B(x, y, 0.04), seg=8, outline=0.008)
                wk.sphere(0.05, K.glow("#ff9a3c", 2.0), loc=B(x, y, 0.09), seg=8, rings=5, outline=0)
            elif kind == "pebbles":
                wk.ball(0.09, toon("rock"), loc=B(x, y, 0.04), scale=(1.2, 1, 0.6), subdiv=1, smooth=False, outline=0.008)
            elif kind == "ice":
                wk.crystal(0.08, 0.3, K.toon("#bfe9ff", spec=0.5), loc=B(x, y, 0.0), rot=(8, -6, 20 * i))

        FLAG_H = 0.05

        def flagstones(x0, y0, x1, y1, size, tones, seed, gap=0.05):
            """Running-bond slabs over [x0, x1] x [y0, y1]: bevelled, a hair of height and tilt jitter, a tone each."""
            rows = max(1, int(round((y1 - y0) / size)))
            dy = (y1 - y0) / rows
            ncol = max(1, int(round((x1 - x0) / size)))
            dx = (x1 - x0) / ncol
            mats = [toon(c, spec=0.15) for c in tones]
            for r in range(rows):
                off = (0.5 if r % 2 else 0.0) * dx
                cuts = sorted({x0, x1} | {x0 + off + c * dx for c in range(-1, ncol + 2) if x0 + 0.2 < x0 + off + c * dx < x1 - 0.2})
                c = 0
                while c < len(cuts) - 1:
                    xa, xb = cuts[c], cuts[c + 1]
                    # Now and then two slabs are one long one.
                    if c < len(cuts) - 2 and rnd(seed * 31 + r, c * 7) < 0.18:
                        xb = cuts[c + 2]
                        c += 1
                    c += 1
                    ya, yb = y0 + r * dy, y0 + (r + 1) * dy
                    h = rnd(seed + r * 13, c * 17)
                    tone = mats[int(rnd(seed * 7 + c, r * 3 + 5) * len(mats)) % len(mats)]
                    wk.box((xb - xa - gap, yb - ya - gap, FLAG_H), tone,
                           loc=B((xa + xb) / 2, (ya + yb) / 2, FLAG_H / 2 - 0.006 + (h - 0.5) * 0.014),
                           rot=((rnd(r, c + seed) - 0.5) * 1.6, (rnd(c, r + seed) - 0.5) * 1.6, 0), bevel=0.028, outline=0.007)

        # ---------------- the ground
        court = th.get("court")
        relief = th.get("relief")
        wk.box((44, 44, 0.04), S.ground_mat(st, "grass", "grass_dk", "patches", key_c="grass_lt"), loc=B(4.5, 3.0, -0.02), outline=0)

        def path_x(y):
            """Centre of the keep-to-keep path at board row y (the ribbon below)."""
            return 4.5 + 0.32 * math.sin(((y + 6.0) / 0.6) * 0.55)

        pts = [(path_x(-6.0 + i * 0.6), -6.0 + i * 0.6) for i in range(int((H + 6.5) / 0.6) + 1)]
        if relief == "flagstones":
            # Raised, bevelled flagstones in running bond with ink grout and a few tones each, so the courtyard has
            # real height (bevels catch the key light, outlines read as grout) instead of a flat brick texture.
            # Kept low (FLAG_H) so units still stand on the board plane.
            wk.box((W + 1.2, H + 1.2, 0.05), K.flat(g["court_dk"]), loc=B(W / 2, H / 2, -0.004), outline=0)
            wk.box((W + 1.5, H + 1.5, 0.12), toon("court_dk"), loc=B(W / 2, H / 2, -0.07), bevel=0.03)
            tones = th["stones"]
            flagstones(-0.6, -0.6, W + 0.6, ZD - 0.05, 0.82, tones, 1)
            flagstones(-0.6, H - ZD + 0.05, W + 0.6, H + 0.6, 0.82, tones, 2)
            if th.get("strip_stones"):
                flagstones(0.0, ZD + 0.05, W, H - ZD - 0.05, 1.1, th["strip_stones"], 3)
                wk.box((W, H - 2 * ZD, 0.04), K.flat(g["strip_dk"]), loc=B(W / 2, H / 2, 0.0), outline=0)  # grout, below the slabs
            else:
                # A sunken lawn between the zones, with tufts.
                wk.box((W, H - 2 * ZD, 0.02), S.ground_mat(st, "strip", "strip_dk", "patches", scale=1.3), loc=B(W / 2, H / 2, 0.024), outline=0)
                for n in range(34):
                    x, y = 0.3 + rnd(n, 41) * (W - 0.6), ZD + 0.25 + rnd(n, 42) * (H - 2 * ZD - 0.5)
                    if abs(x - path_x(y)) < 0.95:
                        continue
                    for j in range(3):
                        wk.cone(0.035, 0.11, toon("grass_dk" if j % 2 else "grass_lt"), loc=B(x + 0.05 * (j - 1), y + 0.02 * j, 0.05), rot=(12 * (j - 1), 0, 0), seg=5, outline=0.004)
            if th.get("inlay"):
                # Gold inlay ring at the centre of the board, under the runner.
                wk.torus(1.05, 0.035, K.toon(th["inlay"], spec=0.4), loc=B(W / 2, H / 2, 0.035), scale=(1, 1, 0.5), outline=0.004)
                wk.torus(0.7, 0.025, K.toon(th["inlay"], spec=0.4), loc=B(W / 2, H / 2, 0.035), scale=(1, 1, 0.5), outline=0.004)
            # Stone kerbs on the zone lines, with a gap where the path passes.
            kerb = th.get("kerb", "court_dk")
            for yy in (ZD, H - ZD):
                px = path_x(yy)
                for xa, xb in ((-0.05, px - 0.8), (px + 0.8, W + 0.05)):
                    wk.box((xb - xa, 0.16, 0.1), toon(kerb, spec=0.3), loc=B((xa + xb) / 2, yy, 0.05), bevel=0.03, outline=0.006)
                for xx in (px - 0.8, px + 0.8):
                    wk.cyl(0.11, 0.18, toon(kerb, spec=0.3), loc=B(xx, yy, 0.09), seg=12, bevel=0.025, outline=0.006)
                    wk.sphere(0.07, K.toon(th.get("inlay") or g["court"], spec=0.4), loc=B(xx, yy, 0.21), seg=10, rings=6, outline=0.004)
            ribbon(pts, 1.45, K.flat(g["path_dk"]), 0.075)
            ribbon(pts, 1.15, S.ground_mat(st, "path", "path_dk", "tiles" if th.get("path_tiles") else "flat", scale=2.0), 0.079)
            if th.get("trim"):
                for side in (-1, 1):
                    trim = [(x + side * 0.6, y) for x, y in pts]
                    ribbon(trim, 0.07, K.flat(th["trim"]), 0.083)
            for kx, ky in KEEPS:
                # A raised round dais under each keep.
                wk.cyl(1.52, 0.1, toon("court_dk"), loc=B(kx, ky, 0.05), seg=40, bevel=0.03, outline=0.006)
                wk.cyl(1.38, 0.02, S.ground_mat(st, "path", "path_dk", "tiles", scale=1.4), loc=B(kx, ky, 0.1), seg=40, outline=0)
        elif relief == "snow":
            # Frozen Reach: a frozen stream across the neutral strip, packed-snow banks along the zone lines and the
            # path, wind ripples and a few ice patches in the deploy zones: soft height on an otherwise flat field.
            wk.box((W + 1.2, H + 1.2, 0.02), S.ground_mat(st, "grass", "grass_dk", "patches", scale=1.6, key_c="grass_lt"), loc=B(W / 2, H / 2, 0.0), outline=0)
            wk.box((W, H - 2 * ZD, 0.02), S.ground_mat(st, "strip", "strip_dk", "patches", scale=2.4), loc=B(W / 2, H / 2, 0.006), outline=0)
            ice = K.toon("#bfe3f7", spec=0.7)
            wk.box((W, H - 2 * ZD - 0.5, 0.02), ice, loc=B(W / 2, H / 2, 0.014), outline=0.005)
            for n in range(9):  # cracks and glints on the ice
                x, y = 0.4 + rnd(n, 51) * (W - 0.8), ZD + 0.45 + rnd(n, 52) * (H - 2 * ZD - 0.9)
                a = rnd(n, 53) * 180
                wk.box((0.5 + rnd(n, 54) * 0.6, 0.025, 0.01), K.flat("#8fb8d6"), loc=B(x, y, 0.026), rot=(0, 0, a), outline=0)
                wk.box((0.22, 0.05, 0.01), K.flat("#ffffff"), loc=B(x + 0.3, y - 0.2, 0.027), rot=(0, 0, 35), outline=0)
            for yy in (ZD, H - ZD):  # snow banks on the zone lines (low, so they read as ground, not walls)
                x = -0.1
                k = 0
                while x < W + 0.1:
                    wk.ball(0.2 + 0.05 * rnd(k, yy), K.toon("#ffffff"), loc=B(x, yy + (rnd(k, 61) - 0.5) * 0.06, 0.0), scale=(1.4, 1.0, 0.42), subdiv=2, outline=0.005)
                    x += 0.3
                    k += 1
            for side in (-1, 1):  # ploughed banks along the path
                for i in range(int((H + 2.0) / 0.32)):
                    y = -1.0 + i * 0.32
                    if abs(y - ZD) < 0.3 or abs(y - (H - ZD)) < 0.3:
                        continue
                    wk.ball(0.13, K.toon("#ffffff"), loc=B(path_x(y) + side * (0.72 + 0.04 * rnd(i, side)), y, 0.0), scale=(1.0, 1.5, 0.4), subdiv=2, outline=0.004)
            for n in range(70):  # wind ripples (sastrugi)
                x, y = 0.2 + rnd(n, 71) * (W - 0.4), -0.4 + rnd(n, 72) * (H + 0.8)
                if abs(x - path_x(y)) < 1.0 or ZD - 0.3 < y < H - ZD + 0.3:
                    continue
                wk.ball(0.18 + 0.1 * rnd(n, 73), K.toon("#f4f9ff"), loc=B(x, y, -0.005), scale=(2.2, 0.55, 0.22), rot=(0, 0, 18 + 10 * rnd(n, 74)), subdiv=2, outline=0.003)
            for n in range(7):  # ice patches
                x, y = 0.6 + rnd(n, 81) * (W - 1.2), 0.6 + rnd(n, 82) * (H - 1.2)
                if abs(x - path_x(y)) < 1.2 or ZD - 0.5 < y < H - ZD + 0.5:
                    continue
                with wk.at(B(x, y, 0.01), rot=(0, 0, rnd(n, 84) * 90), scale=(1.3, 0.9, 1)):
                    wk.cyl(0.32 + 0.15 * rnd(n, 83), 0.012, ice, seg=18, outline=0.004)
                wk.box((0.2, 0.04, 0.01), K.flat("#ffffff"), loc=B(x - 0.08, y - 0.06, 0.02), rot=(0, 0, 30), outline=0)
            for n in range(22):  # boot prints along a trail through your zone
                y = H - 0.8 - n * 0.24
                x = 1.6 + 0.5 * math.sin(n * 0.35) + (0.07 if n % 2 else -0.07)
                with wk.at(B(x, y, 0.012), scale=(0.75, 1.3, 1)):
                    wk.cyl(0.045, 0.006, K.flat("#b9cde0"), seg=10, outline=0)
            ribbon(pts, 1.45, K.flat(g["path_dk"]), 0.02)
            ribbon(pts, 1.15, S.ground_mat(st, "path", "path_dk", "patches", scale=2.0), 0.024)
            for kx, ky in KEEPS:
                wk.cyl(1.5, 0.06, K.toon("#ffffff"), loc=B(kx, ky, 0.02), seg=40, bevel=0.025, outline=0.005)
                wk.cyl(1.38, 0.02, S.ground_mat(st, "path", "path_dk", "tiles", scale=1.4), loc=B(kx, ky, 0.05), seg=40, outline=0)
        else:
            if court:
                wk.box((W + 1.2, H + 1.2, 0.05), S.ground_mat(st, "court", "court_dk", "tiles", scale=1.2), loc=B(W / 2, H / 2, -0.004), outline=0)
                wk.box((W + 1.5, H + 1.5, 0.12), toon("court_dk"), loc=B(W / 2, H / 2, -0.07), bevel=0.03)
            strip_pat = th.get("strip_pat") or ("tiles" if court else "patches")
            wk.box((W, H - 2 * ZD, 0.02), S.ground_mat(st, "strip", "strip_dk", strip_pat, scale=1.3), loc=B(W / 2, H / 2, 0.012), outline=0)
            for yy in (ZD, H - ZD):
                wk.box((W, 0.09, 0.05), toon("edge"), loc=B(W / 2, yy, 0.03), bevel=0.015, outline=0)
            ribbon(pts, 1.45, K.flat(g["path_dk"]), 0.03)
            ribbon(pts, 1.15, S.ground_mat(st, "path", "path_dk", "tiles" if court else "patches", scale=2.0), 0.034)
            for kx, ky in KEEPS:
                wk.cyl(1.5, 0.02, K.flat(g["path_dk"]), loc=B(kx, ky, 0.036), seg=40, outline=0)
                wk.cyl(1.38, 0.02, S.ground_mat(st, "path", "path_dk", "tiles", scale=1.4), loc=B(kx, ky, 0.04), seg=40, outline=0)
        # ---------------- the border around the board
        i = 0
        yy = -0.3
        while yy < H + 0.6:
            for xx in (-0.45, W + 0.45):
                border_piece(xx, yy, False, i)
                i += 1
            yy += 0.6
        for yb in (-0.45, H + 0.55):
            xx = -0.45
            while xx < W + 0.6:
                if abs(xx - 4.5) > 0.95:
                    border_piece(xx, yb, True, i)
                i += 1
                xx += 0.6
        # ---------------- trees and scenery beyond it
        kinds = th["trees"]
        j = 0
        for gy in range(-17, 22):
            for gx in range(-12, 22):
                x = gx * 1.25 + (rnd(gx, gy) - 0.5) * 0.7 + (0.6 if gy % 2 else 0)
                y = gy * 1.05 + (rnd(gy, gx + 9) - 0.5) * 0.5
                inside = -1.3 < x < W + 1.3 and -1.25 < y < H + 1.4
                if inside or (abs(x - 4.5) < 1.2 and y < 0):
                    continue
                u, v = cam_uv(x, y)
                if not (VIEW["u0"] - 0.04 < u < VIEW["u1"] + 0.04 and VIEW["v0"] - 0.06 < v < VIEW["v1"] + 0.02):
                    continue
                if rnd(gx * 3, gy * 7) < 0.12:
                    scatter(x, y, j)
                    j += 1
                    continue
                tree(kinds[j % len(kinds)], x, y, 0.95 + rnd(gx, gy * 3) * 0.4, j)
                j += 1
        for n in range(26):  # small things in the margins between the border and the trees
            side = n % 2
            x = (-0.95 if side == 0 else W + 0.95) + (rnd(n, 2) - 0.5) * 0.4
            y = -0.8 + rnd(n, 3) * (H + 1.8)
            scatter(x, y, n)

        # ---------------- backdrop through the game camera
        cam = stage.cam
        d = cam.data
        d.type = "PERSP"
        d.sensor_fit = "HORIZONTAL"
        d.sensor_width = 36.0
        uw = VIEW["u1"] - VIEW["u0"]
        d.lens = 36.0 / uw
        d.shift_x = ((VIEW["u0"] + VIEW["u1"]) / 2) / uw
        d.shift_y = -((VIEW["v0"] + VIEW["v1"]) / 2) / uw
        d.clip_start, d.clip_end = 0.5, 200.0
        cam.location = B(W / 2, H / 2 + DIST * math.sin(TILT), DIST * math.cos(TILT))
        cam.rotation_euler = (TILT, 0, 0)
        rx = int(round(uw * KPX * ss))
        ry = int(round((VIEW["v1"] - VIEW["v0"]) * KPX * ss))
        sc = stage.sc
        sc.render.resolution_x, sc.render.resolution_y = rx, ry
        bpy.context.view_layer.update()
        err = 0.0
        for (x, y) in ((0, 0), (W, 0), (0, H), (W, H), (4.5, 7), (-3, -8)):
            p = world_to_camera_view(sc, cam, Vector(B(x, y, 0)))
            u, v = cam_uv(x, y)
            fx, fy = (u - VIEW["u0"]) / uw, 1 - (v - VIEW["v0"]) / (VIEW["v1"] - VIEW["v0"])
            err = max(err, abs(p.x - fx) * rx, abs(p.y - fy) * ry)
        print(f"ARENA {act} camera check: max error {err:.2f}px at {rx}x{ry}", flush=True)
        img = render(os.path.join(BUILD, f"act{act}_raw.png"))
        img = S.downsample(img, ss)
        img = S.grade(img, st, vignette=False)
        png = os.path.join(BUILD, f"act{act}.png")
        S.write_png(png, img)
        to_jpeg(png, os.path.join(OUT, f"act{act}.jpg"))

        # ---------------- obstacle props
        wk.clear()
        d.type = "ORTHO"
        c = {"camera": {"ppu": PROP_PPU, "supersample": ss, "elevation_deg": math.degrees(el_prop)}}
        props = []
        for v in range(3):
            wk.clear()
            build_obstacle(wk, th["obstacle"], v, toon, K, B)
            verts = wk.verts_world()
            low = verts[verts[:, 2] < 0.5]
            foot = float(np.sqrt(low[:, 0] ** 2 + low[:, 1] ** 2).max()) if len(low) else 1.0
            shadow(0.06, 0.08, 1.0)
            prx, pry, x0, x1, u0, u1 = S.camera_view(stage, c, PROP_X[0], PROP_X[1], PROP_U[0], PROP_U[1], ss, el=el_prop)
            pim = render(os.path.join(BUILD, f"act{act}_prop{v}_raw.png"))
            pim = S.grade(S.downsample(pim, ss), st, vignette=False)
            name = f"act{act}_prop{v}.png"
            S.write_png(os.path.join(OUT, name), pim)
            props.append({"file": name, "footprint": round(foot, 4)})
            man["prop"] = {"frame": [round(x1 - x0, 5), round(u1 - u0, 5)], "anchor": [round((0 - x0) / (x1 - x0), 5), round((u1 - 0) / (u1 - u0), 5)],
                           "res": [prx // ss, pry // ss], "elev": round(math.degrees(el_prop), 3)}
        man["size"] = [rx // ss, ry // ss]
        man["acts"][str(act)] = {"name": th["name"], "edge": g["grass"], "obstacle": th["obstacle"], "ground": f"act{act}.jpg", "props": props}
        with open(man_path, "w") as f:
            json.dump(man, f, indent=1)
        print(f"ARENA {act} {th['name']} done in {time.time() - t0:.0f}s", flush=True)
    print("ARENAS_DONE", flush=True)


def cam_uv(x, y):
    """The game camera's normalised image plane for a ground point (src/render/camera.ts project with k = 1)."""
    X, Y = x - W / 2, y - H / 2
    cz = DIST - Y * math.sin(TILT)
    return X / cz, (Y * math.cos(TILT)) / cz


def build_obstacle(wk, kind, v, toon, K, B):
    """One obstacle prop at the origin with its base silhouette on the unit circle."""
    r = 1.0
    if kind == "pillar":
        wk.cyl(r * 0.98, 0.3, toon("court_dk"), loc=B(0, 0, 0.15), seg=12, bevel=0.04)
        hgt = 1.0 if v == 1 else 1.55
        wk.cyl(r * 0.62, hgt, toon("court"), loc=B(0, 0, 0.3 + hgt / 2), seg=12)
        if v != 1:
            wk.cyl(r * 0.78, 0.2, toon("court_dk"), loc=B(0, 0, 0.3 + hgt + 0.1), seg=12, bevel=0.03)
            wk.cyl(r * 0.3, 0.16, toon("trunk"), loc=B(0, 0, 0.3 + hgt + 0.28), r2=r * 0.4)
            wk.ball(0.24, K.glow("#ffd27a", 2.2), loc=B(0, 0, 0.3 + hgt + 0.48), outline=0.006)
        else:
            wk.ball(r * 0.3, toon("court"), loc=B(0.5, 0.3, 0.12), scale=(1.2, 1, 0.6), subdiv=1, smooth=False)
        if v == 2:
            wk.sheet([B(-0.62, 0.62, 1.6), B(0.0, 0.62, 1.6), B(-0.02, 0.62, 0.7), B(-0.31, 0.62, 0.55), B(-0.6, 0.62, 0.7)], K.toon("team.main"), thick=0.03)
    elif kind == "obelisk":
        wk.cyl(r * 0.98, 0.26, toon("court_dk"), loc=B(0, 0, 0.13), seg=8, bevel=0.04)
        wk.cyl(r * 0.8, 0.12, K.toon("#ffcf4d", spec=0.4), loc=B(0, 0, 0.32), seg=8)
        wk.crystal(0.48 - 0.06 * v, 1.6 + 0.25 * v, K.toon("#7fb2ff", spec=0.7), loc=B(0, 0, 0.36), sides=6)
        wk.crystal(0.22, 0.7, K.toon("#a6c9ff", spec=0.7), loc=B(0.5, 0.25, 0.36), rot=(0, 18, 30 * v))
    elif kind in ("stump", "charstump"):
        wood = "#4a3a30" if kind == "charstump" else "#9a643a"
        top = "#2e2420" if kind == "charstump" else "#e1b47a"
        wk.cyl(r * 0.8, 0.6 + 0.12 * v, K.toon(wood), loc=B(0, 0, 0.3 + 0.06 * v), r2=r * 0.72, seg=14)
        wk.cyl(r * 0.66, 0.05, K.toon(top), loc=B(0, 0, 0.62 + 0.12 * v), seg=14, outline=0.008)
        for j in range(4):
            aa = j * 1.6 + v
            wk.rod(B(math.cos(aa) * 0.62, math.sin(aa) * 0.62, 0.12), B(math.cos(aa) * 0.98, math.sin(aa) * 0.98, 0.0), 0.15, K.toon(wood), r2=0.06)
        if kind == "charstump":
            for j in range(3):
                wk.sphere(0.09, K.glow("#ff9a3c", 2.4), loc=B(math.cos(j * 2.1) * 0.35, math.sin(j * 2.1) * 0.3, 0.66 + 0.12 * v), seg=8, rings=5, outline=0)
        else:
            wk.ball(0.4, toon("foliage"), loc=B(-0.2, 0.1, 0.66 + 0.12 * v), scale=(1.1, 1, 0.35), subdiv=2)
            for j in range(v + 1):
                wk.cyl(0.04, 0.16, K.toon("#f3ead0"), loc=B(0.55 - 0.15 * j, 0.55, 0.08), outline=0.008)
                wk.sphere(0.12, K.toon("#e2483a"), loc=B(0.55 - 0.15 * j, 0.55, 0.18), scale=(1, 1, 0.6), seg=12, rings=6, outline=0.008)
    elif kind == "crag":
        wk.ball(r * 0.95, toon("rock"), loc=B(0, 0, 0.5), scale=(1.0, 0.9, 1.1 + 0.15 * v), subdiv=1, smooth=False, rot=(0, 0, 25 + v * 50))
        wk.ball(r * 0.38, toon("rock_dk"), loc=B(0.45, 0.4, 0.2), scale=(1.0, 0.9, 0.8), subdiv=1, smooth=False)
        wk.box((0.08, 0.5, 0.7), K.toon("#6a7584", spec=0.5), loc=B(-0.2, 0.62, 0.65), rot=(0, 12, 20), outline=0.008)
    elif kind == "icerock":
        wk.ball(r * 1.07, toon("rock"), loc=B(0, 0, 0.42), scale=(1.0, 0.92, 0.72), subdiv=1, smooth=False, rot=(0, 0, 20 + v * 40))
        wk.ball(r * 0.7, K.toon("#ffffff"), loc=B(-0.05, -0.05, 0.72), scale=(1.0, 0.95, 0.4), subdiv=2)
        for j in range(2 + v):
            aa = j * 2.3 + v
            wk.crystal(0.16, 0.7, K.toon("#bfe9ff", spec=0.6), loc=B(math.cos(aa) * 0.55, math.sin(aa) * 0.45, 0.3), rot=(18 * math.cos(aa), 18 * math.sin(aa), 0))
    else:  # boulder
        wk.ball(r * 0.95, toon("rock"), loc=B(0, 0, 0.42), scale=(1.0, 0.92, 0.72 + 0.1 * v), subdiv=1, smooth=False, rot=(0, 0, 20 + v * 40))
        wk.ball(r * 0.4, toon("rock_dk"), loc=B(0.48, 0.38, 0.2), scale=(1.0, 0.9, 0.7), subdiv=1, smooth=False)
        wk.ball(r * 0.32, toon("rock"), loc=B(-0.52, 0.42, 0.16), scale=(1.0, 0.9, 0.7), subdiv=1, smooth=False)
        wk.ball(r * 0.55, toon("moss"), loc=B(-0.1, -0.05, 0.86 + 0.1 * v), scale=(1.0, 0.95, 0.35), subdiv=2)


if __name__ == "__main__":
    main()
