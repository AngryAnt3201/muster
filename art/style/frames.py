"""Style frames: render each style direction at the v3 contract camera for Jack's pick.

    blender -b --factory-startup -P art/style/frames.py -- [--only meadow,dusk] [--samples 16] [--quick]
    npm run art:style

For every direction in art/style/ (meadow, dusk, toy) this builds, with the same unit models and the
same camera, and composites the way the game will (ground layer, contact shadows, unit sprites with an
outer ink silhouette, bloom on Ascended glow):
  - lineup:    Ranger tiers 1-4, Stormcaller tier 4, Stone Colossus tier 2, all facing SE
  - slice:     the enemy keep and the top half of the board to just past the midline: ground, path,
               neutral strip, border, two obstacles drawn on their collision circles, nine units fighting
  - turntable: Ranger tier 3 in the five rendered facings (the page mirrors the other three), idle + attack
into outputs/signoff/muster-style/<direction>/, plus data.js (style params + frame geometry) for the page.
Every colour, outline, band and light comes from the direction file through muster_art.style.
"""
import argparse
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
OUT = os.path.join(ROOT, "outputs", "signoff", "muster-style")
BUILD = os.path.join(ART, "build", "style")

# game coordinates: x right, y toward the player, angle 0 = +x, 90 = toward the player (screen down)
OBSTACLES = [{"x": 2.2, "y": 7.0, "r": 0.6}, {"x": 6.8, "y": 7.0, "r": 0.6}]  # campaign level 1
KEEP = {"x": 4.5, "y": -0.9, "r": 1.1}
SLICE_UNITS = [
    # kind, tier, pose, team, x, y, target (x, y)
    ("golem", 2, "attack", "ember", 3.15, 4.7, (3.55, 6.15)),
    ("ranger", 2, "attack", "ember", 6.7, 3.3, (5.1, 8.9)),
    ("bulwark", 3, "idle", "ember", 5.25, 5.3, (5.2, 9.0)),
    ("medic", 1, "idle", "ember", 3.9, 2.7, (3.1, 4.7)),
    ("blades", 3, "attack", "tide", 3.55, 6.15, (3.15, 4.7)),
    ("lancer", 2, "idle", "tide", 6.15, 7.3, (5.6, 5.0)),
    ("storm", 4, "attack", "tide", 5.1, 8.9, (5.25, 5.3)),
    ("ranger", 1, "attack", "tide", 7.5, 9.1, (6.7, 3.3)),
    ("medic", 2, "idle", "tide", 2.4, 9.2, (3.0, 6.0)),
]
SLICE_VIEW = {"x0": -0.7, "x1": 9.7, "y0": -2.9, "y1": 10.2}
LINEUP = [("ranger", 1, 0.0), ("ranger", 2, 1.5), ("ranger", 3, 3.0), ("ranger", 4, 4.55), ("storm", 4, 6.2), ("golem", 2, 8.25)]
LINEUP_FACING = 45  # SE
TURN = ("ranger", 3)


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--worker", default="")
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--quick", action="store_true", help="supersample 1, 4 samples: layout checks only")
    return ap.parse_args(argv)


# ------------------------------------------------------------------ worker (inside Blender)
def worker(a):
    import bpy
    import numpy as np

    from muster_art import kit as K
    from muster_art import style as S
    from muster_art.units import REG

    st = S.load(a.worker)
    c = S.contract()
    el = S.elevation(c)
    ss = 1 if a.quick else c["camera"]["supersample"]
    ppu = c["camera"]["ppu"]
    stage = K.Stage(samples=4 if a.quick else a.samples)
    S.apply(st)
    P = S.make_pal(st)
    gnd = st["ground"]
    out = os.path.join(OUT, st["id"])
    raw = os.path.join(BUILD, st["id"])
    os.makedirs(out, exist_ok=True)
    os.makedirs(raw, exist_ok=True)

    uk = K.Kit(outline=st["outline"]["hull"])
    wk = K.Kit(outline=st["outline"]["props"])
    wcoll = bpy.data.collections.new("World")
    bpy.context.scene.collection.children.link(wcoll)
    wk.coll = wcoll

    def B(x, y, z=0.0):
        return (x, -y, z)

    mt = {}

    def toon(key, spec=0.0):
        col = gnd.get(key) or st["keep"].get(key) or key
        return K.toon(col, spec=spec)

    shadow_in = K.flat(st["shadow"]["color"], alpha=st["shadow"]["alpha"])
    shadow_out = K.flat(st["shadow"]["color"], alpha=st["shadow"]["alpha"] * 0.45)

    def shadow(x, y, r):
        wk.cyl(r * 1.08, 0.004, shadow_out, loc=B(x, y, 0.012), seg=28, outline=0)
        wk.cyl(r * 0.82, 0.004, shadow_in, loc=B(x, y, 0.016), seg=28, outline=0)

    def ribbon(pts, width, mat, z):
        import bmesh
        from mathutils import Vector
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

    def rnd(i, k):
        return abs(math.sin(i * 127.1 + k * 311.7) * 43758.5453) % 1.0

    # ---------------- props
    def tree(x, y, s=1.0, i=0):
        kind = gnd["border"]
        shadow(x, y, 0.42 * s)
        if kind == "wall":  # dusk: pines
            wk.cyl(0.07 * s, 0.4 * s, toon("trunk"), loc=B(x, y, 0.2 * s))
            for j, (rr, zz) in enumerate(((0.46, 0.35), (0.36, 0.72), (0.25, 1.05))):
                wk.cone(rr * s, 0.55 * s, toon("foliage" if j % 2 == 0 else "foliage_dk"), loc=B(x, y, zz * s), seg=9)
        elif kind == "fence":  # toy: lollipop trees on a peg
            wk.cyl(0.06 * s, 0.6 * s, toon("trunk"), loc=B(x, y, 0.3 * s), bevel=0.02)
            wk.sphere(0.36 * s, toon("foliage"), loc=B(x, y, 0.85 * s), seg=20, rings=12)
            wk.torus(0.36 * s, 0.035 * s, toon("foliage_dk"), loc=B(x, y, 0.85 * s), rot=(90, 0, 0))
        else:  # meadow: round broadleaf
            wk.cyl(0.08 * s, 0.5 * s, toon("trunk"), loc=B(x, y, 0.25 * s), r2=0.06 * s)
            for j in range(4):
                a = j * 2.1 + i
                wk.ball(0.3 * s, toon("foliage" if j else "foliage_dk"), loc=B(x + math.cos(a) * 0.17 * s, y + math.sin(a) * 0.12 * s, (0.72 + 0.12 * (j % 2)) * s), subdiv=2)
            wk.ball(0.26 * s, toon("foliage"), loc=B(x, y - 0.05, 0.98 * s), subdiv=2)

    def border_piece(x, y, along_x, i):
        kind = gnd["border"]
        if kind == "wall":
            if along_x:
                wk.box((0.62, 0.42, 0.42), toon("rock"), loc=B(x, y, 0.21), bevel=0.04)
            else:
                wk.box((0.42, 0.62, 0.42), toon("rock"), loc=B(x, y, 0.21), bevel=0.04)
            if i % 5 == 2:
                wk.cyl(0.04, 0.5, toon("trunk"), loc=B(x, y, 0.67))
                wk.sphere(0.09, K.glow(gnd["lantern"], 2.2), loc=B(x, y, 0.98), outline=0.006)
                wk.cyl(0.11, 0.04, toon("rock_dk"), loc=B(x, y, 1.09))
        elif kind == "fence":
            wk.box((0.1, 0.1, 0.42), toon("path"), loc=B(x, y, 0.21), bevel=0.02)
            wk.cone(0.075, 0.1, toon("path"), loc=B(x, y, 0.42), seg=4, rot=(0, 0, 45))
            if along_x:
                wk.box((0.6, 0.05, 0.07), toon("edge"), loc=B(x + 0.3, y, 0.3), bevel=0.015)
            else:
                wk.box((0.05, 0.6, 0.07), toon("edge"), loc=B(x, y + 0.3, 0.3), bevel=0.015)
        else:
            wk.ball(0.3, toon("foliage_dk" if i % 3 == 0 else "foliage"), loc=B(x, y, 0.22), scale=(1.1, 1.1, 0.85), subdiv=2)

    def obstacle(o, i):
        x, y, r = o["x"], o["y"], o["r"]
        kind = gnd["obstacle"]
        shadow(x, y, r)
        if kind == "pillars":
            wk.cyl(r * 0.98, 0.16, toon("rock_dk"), loc=B(x, y, 0.08), seg=12, bevel=0.03)
            wk.cyl(r * 0.6, 0.85, toon("rock"), loc=B(x, y, 0.58), seg=10)
            wk.cyl(r * 0.72, 0.12, toon("rock_dk"), loc=B(x, y, 1.05), seg=10, rot=(6, -4, 0))
            wk.cyl(r * 0.28, 0.1, toon("trunk"), loc=B(x, y, 1.15), r2=r * 0.36)
            wk.ball(0.16, K.glow(gnd["lantern"], 2.4), loc=B(x, y, 1.27), outline=0.006)
            wk.ball(r * 0.32, toon("rock"), loc=B(x + r * 0.7, y + r * 0.4, 0.12), scale=(1.2, 1, 0.6), subdiv=1, smooth=False)
        elif kind == "blocks":
            s = r * 1.15
            wk.box((s, s, s * 0.8), toon("rock"), loc=B(x, y, s * 0.4), rot=(0, 0, 18 + i * 20), bevel=0.06, seg=3)
            wk.box((s * 0.72, s * 0.72, s * 0.6), toon("path_dk"), loc=B(x - 0.05, y + 0.02, s * 0.8 + s * 0.3), rot=(0, 0, -12 + i * 30), bevel=0.05, seg=3)
            wk.sphere(s * 0.26, toon("foliage"), loc=B(x - 0.05, y + 0.02, s * 1.1 + s * 0.6), seg=20, rings=12)
        else:  # boulders
            wk.ball(r * 0.95, toon("rock"), loc=B(x, y, r * 0.42), scale=(1.0, 0.92, 0.72), subdiv=1, smooth=False, rot=(0, 0, 20 + i * 40))
            wk.ball(r * 0.55, toon("rock_dk"), loc=B(x + r * 0.6, y + r * 0.45, r * 0.22), scale=(1.0, 0.9, 0.7), subdiv=1, smooth=False)
            wk.ball(r * 0.4, toon("rock"), loc=B(x - r * 0.62, y + r * 0.5, r * 0.18), scale=(1.0, 0.9, 0.7), subdiv=1, smooth=False)
            wk.ball(r * 0.55, toon("moss"), loc=B(x - r * 0.1, y - r * 0.05, r * 0.86), scale=(1.0, 0.95, 0.35), subdiv=2)

    def keep(x, y, team):
        kp = st["keep"]
        K.set_team(team)
        stone, stone_dk = K.toon(kp["stone"]), K.toon(kp["stone_dk"])
        trim = K.toon(kp["trim"], spec=0.35)
        roof = K.toon(kp["roof"]) if kp["roof"].startswith("team.") else K.toon(kp["roof"])
        win = K.glow(kp["window"], 2.0) if kp["window_glow"] else K.flat(kp["window"])
        seg = 8 if gnd["obstacle"] == "blocks" else 18
        shadow(x, y, KEEP["r"] * 1.05)
        wk.cyl(1.12, 0.28, stone_dk, loc=B(x, y, 0.14), seg=seg, bevel=0.05)
        wk.cyl(0.9, 1.25, stone, loc=B(x, y, 0.9), r2=0.84, seg=seg)
        wk.cyl(0.97, 0.13, trim, loc=B(x, y, 1.55), seg=seg)
        for j in range(10):
            a = 2 * math.pi * j / 10 + 0.3
            wk.box((0.24, 0.24, 0.24), stone, loc=B(x + math.cos(a) * 0.86, y + math.sin(a) * 0.86, 1.72), rot=(0, 0, math.degrees(a)), bevel=0.03)
        wk.cone(0.74, 0.95, roof, loc=B(x, y, 1.6), seg=seg)
        wk.sphere(0.09, trim, loc=B(x, y, 2.6))
        wk.cyl(0.02, 0.5, K.toon(kp["wood"]), loc=B(x, y, 2.82))
        wk.sheet([B(x, y, 3.05), B(x + 0.42, y, 2.97), B(x + 0.36, y, 2.86), B(x, y, 2.82)], K.toon("team.main"), thick=0.02)
        # gate and windows face the field (toward the player = screen down)
        fy = y + 0.86
        wk.box((0.56, 0.16, 0.62), K.toon(kp["wood"]), loc=B(x, fy, 0.56), bevel=0.03)
        wk.cyl(0.28, 0.16, K.toon(kp["wood"]), loc=B(x, fy, 0.87), rot=(90, 0, 0), seg=16)
        wk.box((0.7, 0.2, 0.1), trim, loc=B(x, fy + 0.02, 0.24), bevel=0.02)
        for dx in (-0.48, 0.48):
            wk.box((0.16, 0.08, 0.26), win, loc=B(x + dx, y + 0.78, 1.12), bevel=0.02, outline=0.006)
            wk.sheet([B(x + dx * 1.35, y + 0.6, 1.45), B(x + dx * 1.35 + 0.22, y + 0.6, 1.45), B(x + dx * 1.35 + 0.2, y + 0.6, 0.8), B(x + dx * 1.35 + 0.11, y + 0.6, 0.7), B(x + dx * 1.35 + 0.02, y + 0.6, 0.8)],
                     K.toon("team.main"), thick=0.02)
        if kp["window_glow"]:
            for dx in (-0.62, 0.62):
                wk.cyl(0.035, 0.7, K.toon(kp["wood"]), loc=B(x + dx, fy + 0.25, 0.35))
                wk.sphere(0.1, K.glow(gnd.get("lantern", kp["trim"]), 2.4), loc=B(x + dx, fy + 0.25, 0.76), outline=0.006)

    # ---------------- units
    def place(kind, tier, pose, x, y, angle, alt=0.0):
        n0 = len(uk.objs)
        with uk.at(loc=B(x, y, alt), rot=(0, 0, S.yaw_for_angle(angle)), scale=US):
            REG[kind]["build"](uk, P, tier, pose)
        return uk.objs[n0:]

    def bounds_u(objs, e):
        xs, us = [], []
        for ob in objs:
            me = ob.data
            v = np.empty(len(me.vertices) * 3, np.float32)
            me.vertices.foreach_get("co", v)
            v = v.reshape(-1, 3)
            xs.append(v[:, 0])
            us.append(v[:, 1] * math.sin(e) + v[:, 2] * math.cos(e))
        xs, us = np.concatenate(xs), np.concatenate(us)
        return float(xs.min()), float(xs.max()), float(us.min()), float(us.max())

    def render(path):
        stage.sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        return S.read_png(path)

    el_s = S.sprite_elevation(c)
    US = c["camera"]["unit_scale"]
    PAD = 0.24  # world units around a sprite: ink + bloom room

    def sprite(name, kind, tier, pose, angle, team, box=None):
        """One unit as the game will draw it: rendered alone at the sprite camera, ink silhouette baked,
        bloom kept separate. Returns premultiplied image, bloom layer and the feet anchor (pixels, SS res)."""
        uk.clear()
        obs = place(kind, tier, pose, 0, 0, angle)
        bx0, bx1, bu0, bu1 = box or bounds_u(obs, el_s)
        rx, ry, x0, x1, u0, u1 = S.camera_view(stage, c, bx0 - PAD, bx1 + PAD, bu0 - PAD, bu1 + PAD, ss, el=el_s)
        K.set_team(team)
        K.set_glowpass(False)
        U = render(os.path.join(raw, f"{name}.png"))
        img = S.over(U, S.ink(U, st, ss))
        K.set_glowpass(True)
        G = render(os.path.join(raw, f"{name}_glow.png"))
        K.set_glowpass(False)
        bl = S.bloom(G, st, ss) if G[..., 3].max() > 0.02 else None
        return {"img": img, "bloom": bl, "ax": (0 - x0) * ppu * ss, "ay": (u1 - 0) * ppu * ss}

    def world_layer(name, x0, x1, u0, u1):
        uk.clear()
        rx, ry, x0, x1, u0, u1 = S.camera_view(stage, c, x0, x1, u0, u1, ss)
        K.set_team("ember")
        K.set_glowpass(False)
        W = render(os.path.join(raw, f"{name}_world.png"))
        K.set_glowpass(True)
        G = render(os.path.join(raw, f"{name}_world_glow.png"))
        K.set_glowpass(False)
        if G[..., 3].max() > 0.02:
            W[..., :3] += S.bloom(G, st, ss)[..., :3] * 0.6
        return W, (x0, x1, u0, u1)

    def stamp(canvas, glowacc, sp, x, y, view, alt=0.0):
        x0, x1, u0, u1 = view
        px = (x - x0) * ppu * ss - sp["ax"]
        py = (u1 - S.screen_u(y, alt, el)) * ppu * ss - sp["ay"]
        S.paste(canvas, sp["img"], int(round(px)), int(round(py)))
        if sp["bloom"] is not None:
            S.add_into(glowacc, sp["bloom"], int(round(px)), int(round(py)))

    def finish(canvas, glowacc, path, opaque=True):
        canvas[..., :3] += glowacc[..., :3]
        if not opaque:
            canvas[..., 3] = np.maximum(canvas[..., 3], np.clip(glowacc[..., :3].max(-1), 0, 1))
        img = np.clip(canvas, 0, 1)
        img = S.downsample(img, ss)
        img = S.grade(img, st, vignette=opaque)
        S.write_png(path, img)
        return img.shape[1], img.shape[0]

    meta = {"id": st["id"], "ppu": ppu, "elevation_deg": c["camera"]["elevation_deg"], "sprite_elevation_deg": c["camera"]["sprite_elevation_deg"]}
    t0 = time.time()

    # ================= lineup
    uk.clear()
    wk.clear()
    sprites, labels, top = [], [], 0.0
    for kind, tier, x in LINEUP:
        sp = sprite(f"lineup_{kind}{tier}", kind, tier, "idle", LINEUP_FACING, "tide")
        sprites.append((sp, x))
        top = max(top, sp["ay"] / (ppu * ss))
        labels.append({"kind": kind, "tier": tier, "x": x})
    x0, x1 = -0.9, 9.35
    u1 = top - PAD + 0.3
    u0 = S.screen_u(1.05, 0, el)
    wk.box((x1 - x0 + 2, 10.0, 0.04), S.ground_mat(st, "grass", "grass_dk", "tiles" if gnd["pattern"] == "tiles" else "patches", key_c="grass_lt"),
           loc=B((x0 + x1) / 2, 0.0, -0.02), outline=0)
    for kind, tier, x in LINEUP:
        shadow(x, 0.0, REG[kind]["radius"] * US * (1.0 if kind != "golem" else 0.9))
    W, view = world_layer("lineup", x0, x1, u0, u1)
    canvas, glowacc = W.copy(), np.zeros_like(W)
    for sp, x in sprites:
        stamp(canvas, glowacc, sp, x, 0.0, view)
    w, h = finish(canvas, glowacc, os.path.join(out, "lineup.png"))
    meta["lineup"] = {"file": "lineup", "w": w, "h": h, "x0": view[0], "x1": view[1], "u0": view[2], "u1": view[3], "units": labels}
    print(f"STYLE {st['id']} lineup {w}x{h} t={time.time() - t0:.1f}s", flush=True)

    # ================= turntable (sprites exactly as the game gets them: transparent, no shadow, feet anchor)
    wk.clear()
    kind, tier = TURN
    allb = []
    for f in c["facings"]["rendered"]:
        for pose in ("idle", "attack"):
            uk.clear()
            allb.append(bounds_u(place(kind, tier, pose, 0, 0, c["facings"]["angles_deg"][f]), el_s))
    e = max(max(abs(b[0]), abs(b[1])) for b in allb)
    box = (-e, e, min(b[2] for b in allb), max(b[3] for b in allb))
    turn = {"frames": {}}
    for f in c["facings"]["rendered"]:
        for pose in ("idle", "attack"):
            sp = sprite(f"turn_{f}_{pose}", kind, tier, pose, c["facings"]["angles_deg"][f], "tide", box=box)
            name = f"turn_{f}_{pose}.png"
            cv = sp["img"].copy()
            turn["w"], turn["h"] = finish(cv, sp["bloom"] if sp["bloom"] is not None else np.zeros_like(cv), os.path.join(out, name), opaque=False)
            turn["ax"], turn["ay"] = sp["ax"] / ss, sp["ay"] / ss
            turn["frames"][f"{f}_{pose}"] = name
    meta["turntable"] = turn
    print(f"STYLE {st['id']} turntable t={time.time() - t0:.1f}s", flush=True)

    # ================= battlefield slice
    uk.clear()
    wk.clear()
    placed, sprites = [], []
    for i, (kind, tier, pose, team, x, y, (tx, ty)) in enumerate(SLICE_UNITS):
        ang = math.degrees(math.atan2(ty - y, tx - x))
        sprites.append((sprite(f"slice_{i}_{kind}", kind, tier, pose, ang, team), x, y))
        placed.append({"kind": kind, "tier": tier, "team": team, "x": x, "y": y, "r": REG[kind]["radius"]})
    V = SLICE_VIEW
    pat = gnd["pattern"]
    wk.box((V["x1"] - V["x0"] + 6, V["y1"] - V["y0"] + 6, 0.04), S.ground_mat(st, "grass", "grass_dk", "tiles" if pat == "tiles" else "patches", key_c="grass_lt"),
           loc=B(4.5, (V["y0"] + V["y1"]) / 2, -0.02), outline=0)
    # neutral strip between the two deploy zones, with a kerb on each zone line
    zd = c["world"]["zone_depth"]
    H = c["world"]["board_h"]
    strip_pat = "tiles" if pat == "tiles" or gnd["border"] == "wall" else "patches"
    wk.box((9.0, H - 2 * zd, 0.02), S.ground_mat(st, "strip", "strip_dk", strip_pat, scale=1.3), loc=B(4.5, H / 2, 0.0), outline=0)
    for yy in (zd, H - zd):
        wk.box((9.0, 0.09, 0.05), toon("edge"), loc=B(4.5, yy, 0.025), bevel=0.015, outline=0)
    # path from the keep gate down the field
    pts = [(4.5 + 0.35 * math.sin(i * 0.55), -0.1 + i * 0.6) for i in range(20)]
    ribbon(pts, 1.45, K.flat(gnd["path_dk"]), 0.006)
    ribbon(pts, 1.15, S.ground_mat(st, "path", "path_dk", "tiles" if pat == "tiles" else "patches", scale=2.0), 0.009)
    # plaza in front of the keep
    wk.cyl(1.55, 0.02, S.ground_mat(st, "path", "path_dk", "tiles", scale=1.4), loc=B(KEEP["x"], KEEP["y"] + 0.2, 0.004), seg=32, outline=0)
    # borders and trees
    i = 0
    yy = -0.25
    while yy < V["y1"] + 0.5:
        for xx in (-0.42, 9.42):
            border_piece(xx, yy, False, i)
            i += 1
        yy += 0.6
    xx = -0.4
    while xx < 9.6:
        if abs(xx - KEEP["x"]) > 1.75:
            border_piece(xx, -0.3, True, i)
        i += 1
        xx += 0.6
    for j, (tx, ty, s) in enumerate([(-0.55, -1.6, 1.1), (1.0, -1.9, 1.25), (2.4, -1.5, 0.95), (6.7, -1.5, 1.0), (8.0, -1.9, 1.2), (9.6, -1.4, 1.0),
                                     (-0.95, 2.6, 1.0), (10.0, 4.4, 1.1), (-1.0, 6.4, 1.15), (10.05, 8.6, 1.0), (-0.95, 9.9, 1.05)]):
        tree(tx, ty, s, j)
    for j, o in enumerate(OBSTACLES):
        obstacle(o, j)
    keep(KEEP["x"], KEEP["y"], "ember")
    for p in placed:
        shadow(p["x"], p["y"], p["r"] * US * (0.9 if p["kind"] in ("golem", "lancer", "bulwark") else 1.0))
    u0 = S.screen_u(V["y1"], 0, el)
    u1 = S.screen_u(KEEP["y"], 3.25, el)
    W, view = world_layer("slice", V["x0"], V["x1"], u0, u1)
    canvas, glowacc = W.copy(), np.zeros_like(W)
    for sp, x, y in sorted(sprites, key=lambda t: t[2]):
        stamp(canvas, glowacc, sp, x, y, view)
    w, h = finish(canvas, glowacc, os.path.join(out, "slice.png"))
    meta["slice"] = {"file": "slice", "w": w, "h": h, "x0": view[0], "x1": view[1], "u0": view[2], "u1": view[3],
                     "obstacles": OBSTACLES, "keep": KEEP, "units": placed, "zone_depth": zd, "board_w": c["world"]["board_w"], "board_h": H}
    print(f"STYLE {st['id']} slice {w}x{h} t={time.time() - t0:.1f}s", flush=True)
    with open(os.path.join(raw, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"STYLE_DONE {st['id']} t={time.time() - t0:.1f}s", flush=True)


# ------------------------------------------------------------------ driver
def to_jpeg(png, jpg, q=86):
    r = subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(q), png, "--out", jpg], capture_output=True)
    if r.returncode == 0 and os.path.exists(jpg):
        os.remove(png)
        return os.path.basename(jpg)
    return os.path.basename(png)


def main():
    a = parse()
    if a.worker:
        worker(a)
        return
    import bpy
    sys.path.insert(0, ART)
    from muster_art import style as S
    names = [x for x in (a.only.split(",") if a.only else S.DIRECTIONS) if x]
    os.makedirs(BUILD, exist_ok=True)
    t0 = time.time()
    procs = []
    for n in names:
        cmd = [bpy.app.binary_path, "-b", "--factory-startup", "-P", os.path.abspath(__file__), "--", "--worker", n, "--samples", str(a.samples)]
        if a.quick:
            cmd.append("--quick")
        log = open(os.path.join(BUILD, f"{n}.log"), "w")
        procs.append((n, subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT), log))
    bad = []
    for n, p, log in procs:
        p.wait()
        log.close()
        if p.returncode != 0:
            bad.append(n)
    if bad:
        print(f"STYLE_FAILED {bad}; see art/build/style/<name>.log")
        sys.exit(1)
    # opaque frames to JPEG for a light page; turntable sprites stay PNG (alpha)
    data = {"contract": S.contract(), "active": S.active_id(), "directions": []}
    for n in S.DIRECTIONS:
        mp = os.path.join(BUILD, n, "meta.json")
        if not os.path.exists(mp):
            continue
        with open(mp) as f:
            meta = json.load(f)
        for key in ("lineup", "slice"):
            png = os.path.join(OUT, n, meta[key]["file"] + ".png")
            if os.path.exists(png):
                meta[key]["src"] = f"{n}/" + to_jpeg(png, png[:-4] + ".jpg")
            else:
                meta[key]["src"] = f"{n}/{meta[key]['file']}.jpg"
        meta["style"] = S.load(n)
        data["directions"].append(meta)
    with open(os.path.join(OUT, "data.js"), "w") as f:
        f.write("// generated by art/style/frames.py\nwindow.STYLE_DATA = ")
        json.dump(data, f, indent=1)
        f.write(";\n")
    print(f"STYLE_FRAMES_DONE {time.time() - t0:.1f}s -> {os.path.relpath(OUT, ROOT)}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
