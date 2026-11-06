"""Commander keeps: one stone keep per side in team colour, four damage states, rendered in Blender.

    blender -b --factory-startup -P art/keeps/render_keeps.py -- [--samples 16] [--states intact,ruined]
    npm run art:keeps

Writes public/keeps/<team>_<state>.png and public/keeps/manifest.json. Post-processing (ink silhouette, glow
halo for embers, 2x downsample) runs inside Blender with numpy, so no Pillow is needed.

The keep is built in the shared art kit (art/muster_art/kit.py): unlit toon shading, inverted-hull outlines,
team colour from the TeamColor node group. It is seen from the south at a 3/4 angle so it stands upright on
the board, and every state shares one canvas and one ground anchor so the game can swap them in place.

States, driven in game by commander hp / max hp (src/render/keeps.ts):
  intact   full keep, lit braziers, pennant flying
  cracked  stones knocked out, cracks, merlons fallen, torn pennant
  burning  roof caved in and charred, windows lit from inside, scorch on the stone (flames are added in game)
  ruined   the tower broken off, rubble, snapped banner pole on the ground (smoke is added in game)
"""
import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.dirname(HERE)
ROOT = os.path.dirname(ART)
sys.path.insert(0, ART)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from muster_art import kit as K  # noqa: E402

OUT = os.path.join(ROOT, "public", "keeps")
RAW = os.path.join(ART, "build", "keeps")
STATES = ("intact", "cracked", "burning", "ruined")
TEAMS = ("tide", "ember")
PPU = 120  # output pixels per world unit (the unit sprites use the same)
SS = 2  # supersample
EL = 52.0  # camera elevation, degrees: the board's 3/4 look
AZ = -90.0  # camera looks north from the south, so the gate faces the viewer

# keep dimensions (world units, footprint centred on the origin, gate facing -Y)
R_TOWER = 0.74
ROWS = 7
ROW_H = 0.15
PER_ROW = 14


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    a = {"samples": 16, "states": ",".join(STATES)}
    for i in range(0, len(argv) - 1, 2):
        a[argv[i].lstrip("-")] = argv[i + 1]
    return a


class Mats:
    def __init__(self):
        t, g, f = K.toon, K.glow, K.flat
        self.stone = t("#b8b0a2")
        self.stone2 = t("#a39b8d")
        self.stone_lt = t("#d6cfc0")
        self.stone_dk = t("#7d766b")
        self.char = t("#4a4340")
        self.char2 = t("#5d5450")
        self.fill = f("#2a2522")
        self.hole = f("#151215")
        self.wood = t("#a8703f")
        self.wood_dk = t("#6b4528")
        self.burnt = t("#3a2c26")
        self.iron = t("#6f7885", spec=0.2)
        self.gold = t("#ffcf4d", spec=0.35)
        self.gold_dk = t("#c98d2a")
        self.team = t("team.main")
        self.team_dk = t("team.dark")
        self.team_lt = t("team.light")
        self.team_char = t("team.dark", mult=0.55)
        self.slit = f("#1b1820")
        self.ember = g("#ff9a3d", 1.6)
        self.ember_hot = g("#ffd27a", 1.5)
        self.window_fire = g("#ffb347", 1.7)
        self.cloth = t("#efe4c8")


def jitter(rng, a):
    return (rng.random() * 2 - 1) * a


# ------------------------------------------------------------------ build
def build(k, M, state):
    s = STATES.index(state)
    rng = random.Random(7)  # same stones in every state: damage only takes away and chars
    gate_dir = -math.pi / 2  # gate faces -Y

    # ---- plinth: two octagonal steps, the top one trimmed in team colour
    oct8 = [(math.cos(math.pi / 8 + i * math.pi / 4), math.sin(math.pi / 8 + i * math.pi / 4)) for i in range(8)]
    k.prism([(x * 1.22, y * 1.12) for x, y in oct8], 0.14, M.stone_dk, loc=(0, 0, 0.07), bevel=0.02)
    k.prism([(x * 1.06, y * 0.98) for x, y in oct8], 0.1, M.team_dk if s < 3 else M.team_char, loc=(0, 0, 0.19), bevel=0.015)
    k.prism([(x * 1.0, y * 0.92) for x, y in oct8], 0.06, M.stone if s < 2 else M.stone2, loc=(0, 0, 0.27), bevel=0.012)
    base = 0.3

    # ---- tower: rows of chunky stone blocks around a dark core
    # the cut-off height per angle for the ruined state: a jagged broken top, lowest at the front-left
    def cutoff(a):
        if s < 3:
            return ROWS
        return 2.2 + 1.6 * (0.5 + 0.5 * math.sin(a * 2 + 1.1)) + 1.2 * (0.5 + 0.5 * math.sin(a * 5 + 0.3))

    # missing stones per state (deterministic)
    gone = set()
    if s >= 1:
        gone |= {(5, 3), (6, 4), (4, 9), (6, 11), (3, 2), (5, 10), (6, 9), (3, 11), (2, 10), (4, 12)}
    if s >= 2:
        gone |= {(5, 4), (4, 3), (6, 10), (5, 11), (3, 12), (2, 9), (6, 5)}
    # the dark core behind the stones; sunk inside the walls once the roof has gone
    core_h = {0: ROWS, 1: ROWS, 2: ROWS - 1.6, 3: 1.6}[s] * ROW_H
    k.cyl(R_TOWER - 0.09, core_h - 0.02, M.fill, loc=(0, 0, base + (core_h - 0.02) / 2), seg=24, outline=0)
    if s >= 2:
        # charred debris heaped on the sunken floor
        for i in range(10 if s == 2 else 16):
            a = rng.random() * 2 * math.pi
            rr = rng.random() * (R_TOWER - 0.25)
            sz = 0.08 + rng.random() * 0.08
            k.box((sz * 1.4, sz, sz * 0.7), M.char if i % 2 else M.burnt, loc=(math.cos(a) * rr, math.sin(a) * rr, base + core_h + 0.01),
                  rot=(jitter(rng, 30), jitter(rng, 30), math.degrees(rng.random() * 6)), bevel=0.015)
    for row in range(ROWS):
        off = (row % 2) * 0.5
        for i in range(PER_ROW):
            a = (i + off) / PER_ROW * 2 * math.pi + jitter(rng, 0.03)
            if row >= cutoff(a):
                continue
            if (row, i) in gone and not (abs(math.sin(a) + 1) < 0.25 and row < 3):
                continue
            w = 2 * math.pi * R_TOWER / PER_ROW - 0.03
            h = ROW_H - 0.018
            dz = jitter(rng, 0.006)
            r = R_TOWER - 0.04 + jitter(rng, 0.012)
            top = row >= ROWS - 2
            scorched = (s == 2 and (top or rng.random() < 0.25)) or (s == 3 and rng.random() < 0.55)
            mat = (M.char if rng.random() < 0.5 else M.char2) if scorched else (M.stone if rng.random() < 0.55 else (M.stone2 if rng.random() < 0.7 else M.stone_lt))
            with k.at((math.cos(a) * r, math.sin(a) * r, base + row * ROW_H + ROW_H / 2 + dz), rot=(0, 0, math.degrees(a))):
                k.box((0.2, w, h), mat, bevel=0.025, outline=0.009)
            # arrow slits on the upper rows
            if row == 4 and i % 3 == 1 and abs(math.sin(a) + 1) > 0.3 and (row, i) not in gone and row < cutoff(a):
                with k.at((math.cos(a) * (r + 0.1), math.sin(a) * (r + 0.1), base + row * ROW_H + ROW_H / 2), rot=(0, 0, math.degrees(a))):
                    k.box((0.02, 0.05, 0.12), M.window_fire if s >= 2 else M.slit, outline=0)

    top_z = base + ROWS * ROW_H
    # ---- team trim band, corbels and battlements
    if s < 3:
        k.torus(R_TOWER + 0.0, 0.045, M.team_dk if s < 2 else M.team_char, loc=(0, 0, top_z - 0.25), seg=32, rseg=8)
        k.torus(R_TOWER + 0.02, 0.075, M.stone_dk if s < 2 else M.char2, loc=(0, 0, top_z + 0.045), seg=32, rseg=8, scale=(1, 1, 0.75))
        merlons = 10
        fallen = {2, 6, 7} if s == 1 else ({1, 2, 5, 7, 8} if s == 2 else set())
        for i in range(merlons):
            if i in fallen:
                continue
            a = (i + 0.5) / merlons * 2 * math.pi
            r = R_TOWER + 0.03
            mat = M.stone_lt if s < 2 else M.char2
            with k.at((math.cos(a) * r, math.sin(a) * r, top_z + 0.09 + 0.09), rot=(0, 0, math.degrees(a))):
                k.box((0.16, 0.22, 0.18), mat, bevel=0.025)

    # ---- roof: a team-colour cone with a gold finial and a pennant
    if s <= 1:
        k.cone(R_TOWER - 0.06, 0.82, M.team, loc=(0, 0, top_z + 0.06), seg=16)
        k.cyl(R_TOWER - 0.04, 0.06, M.team_dk, loc=(0, 0, top_z + 0.09), seg=16)
        # tile ridges
        for i in range(8):
            a = i / 8 * 2 * math.pi + 0.2
            k.rod((math.cos(a) * (R_TOWER - 0.07), math.sin(a) * (R_TOWER - 0.07), top_z + 0.1), (0, 0, top_z + 0.86), 0.018, M.team_dk, outline=0.006)
        if s == 1:
            # a hole knocked through the roof, splintered battens round it
            a = math.radians(-55)
            k.ball(0.15, M.hole, loc=(math.cos(a) * 0.4, math.sin(a) * 0.4, top_z + 0.36), scale=(1.0, 1.0, 0.75), outline=0)
            for d in (-0.5, 0.0, 0.45):
                p0 = (math.cos(a + d * 0.3) * 0.5, math.sin(a + d * 0.3) * 0.5, top_z + 0.3 + d * 0.08)
                k.rod(p0, (p0[0] * 0.75, p0[1] * 0.75, p0[2] + 0.12), 0.014, M.wood_dk, outline=0.005)
        k.ball(0.07, M.gold, loc=(0, 0, top_z + 0.92))
        k.rod((0, 0, top_z + 0.9), (0, 0, top_z + 1.42), 0.018, M.wood_dk)
        tl = 0.5 if s == 0 else 0.34  # torn shorter when cracked
        pts = [(0, -0.02, top_z + 1.38), (0, -0.02, top_z + 1.12)]
        tail = [(tl * 0.55, 0.0, top_z + 1.2), (tl, 0.02, top_z + 1.3), (tl * 0.6, 0.0, top_z + 1.36)]
        k.sheet([pts[0], pts[1]] + tail, M.team, thick=0.014)
    elif s == 2:
        # caved-in, charred roof: a broken cone sitting low with beams sticking out
        k.cone(R_TOWER - 0.32, 0.36, M.team_char, loc=(0.18, 0.22, base + core_h), rot=(18, -22, 0), seg=10)
        for a, l, tilt in ((0.4, 0.62, 40), (2.2, 0.55, 55), (3.9, 0.7, 35), (5.3, 0.5, 60)):
            z0 = base + core_h
            p1 = (math.cos(a) * 0.15, math.sin(a) * 0.15, z0)
            p2 = (math.cos(a) * 0.15 + math.cos(a) * l * math.cos(math.radians(tilt)), math.sin(a) * 0.15 + math.sin(a) * l * math.cos(math.radians(tilt)), z0 + l * math.sin(math.radians(tilt)))
            k.rod(p1, p2, 0.035, M.burnt)
        for i in range(9):
            a = rng.random() * 2 * math.pi
            rr = rng.random() * 0.4
            k.ball(0.03 + rng.random() * 0.03, M.ember if i % 2 else M.ember_hot, loc=(math.cos(a) * rr, math.sin(a) * rr, base + core_h + 0.06 + rng.random() * 0.08), outline=0)
    else:
        # ruined: charred beams jutting from the broken top, embers in the core
        for a, l, tilt in ((0.9, 0.5, 30), (2.6, 0.42, 48), (4.4, 0.55, 25)):
            z0 = base + core_h
            p1 = (math.cos(a) * 0.2, math.sin(a) * 0.2, z0)
            p2 = (math.cos(a) * (0.2 + l * math.cos(math.radians(tilt))), math.sin(a) * (0.2 + l * math.cos(math.radians(tilt))), z0 + l * math.sin(math.radians(tilt)))
            k.rod(p1, p2, 0.035, M.burnt)
        for i in range(7):
            a = rng.random() * 2 * math.pi
            rr = rng.random() * 0.45
            k.ball(0.03 + rng.random() * 0.025, M.ember if i % 2 else M.ember_hot, loc=(math.cos(a) * rr, math.sin(a) * rr, base + core_h + 0.07), outline=0)

    # ---- side turrets (left and right), with team-colour caps
    for sx in (-1, 1):
        cx, cy = sx * (R_TOWER + 0.12), 0.1
        broken = s == 3 or (s == 2 and sx > 0)
        h = 0.45 if s == 3 else (0.82 if not broken else 0.62)
        mat = M.stone2 if s < 2 else M.char2
        k.cyl(0.27, h, mat, loc=(cx, cy, base + h / 2), seg=14, bevel=0.02)
        for j in range(int(h / 0.15)):
            k.cyl(0.285, 0.022, M.stone_dk, loc=(cx, cy, base + 0.15 * (j + 1)), seg=14, outline=0)
        if not broken:
            k.cyl(0.31, 0.07, M.stone_lt if s < 2 else M.char2, loc=(cx, cy, base + h + 0.035), seg=14, bevel=0.01)
            k.cone(0.29, 0.46 if s < 2 else 0.3, M.team_dk if s < 2 else M.team_char, loc=(cx, cy, base + h + 0.07), seg=12)
            k.ball(0.04, M.gold if s < 2 else M.burnt, loc=(cx, cy, base + h + (0.55 if s < 2 else 0.4)))
        else:
            # jagged stub top
            for i in range(6):
                a = i / 6 * 2 * math.pi
                with k.at((cx + math.cos(a) * 0.2, cy + math.sin(a) * 0.2, base + h + 0.03 + (i % 2) * 0.05), rot=(0, 0, math.degrees(a))):
                    k.box((0.12, 0.17, 0.08 + (i % 2) * 0.08), M.char2, bevel=0.015)

    # ---- the gate on the front
    gx, gy = 0.0, -R_TOWER + 0.0
    with k.at((gx, gy, base), rot=(0, 0, 0)):
        # stone arch frame
        k.box((0.5, 0.12, 0.44), M.stone_lt if s < 2 else M.char2, loc=(0, -0.04, 0.22), bevel=0.02)
        k.cyl(0.25, 0.12, M.stone_lt if s < 2 else M.char2, loc=(0, -0.04, 0.44), rot=(90, 0, 0), seg=16)
        # keystone in team colour
        k.box((0.1, 0.06, 0.1), M.team if s < 3 else M.team_char, loc=(0, -0.1, 0.68), bevel=0.015)
        if s < 3:
            # wooden door with iron bands and studs
            door = M.wood if s < 2 else M.burnt
            k.box((0.36, 0.05, 0.4), door, loc=(0, -0.11, 0.2), bevel=0.012)
            k.cyl(0.18, 0.05, door, loc=(0, -0.11, 0.4), rot=(90, 0, 0), seg=14)
            for z in (0.1, 0.3):
                k.box((0.38, 0.03, 0.035), M.iron, loc=(0, -0.14, z), outline=0.006)
            for x in (-0.1, 0.1):
                for z in (0.18, 0.4):
                    k.ball(0.016, M.iron, loc=(x, -0.145, z), outline=0)
            if s == 2:
                k.box((0.08, 0.02, 0.12), M.window_fire, loc=(0.07, -0.14, 0.24), outline=0)
        else:
            # broken in: a dark opening and splintered planks
            k.box((0.34, 0.04, 0.36), M.hole, loc=(0, -0.1, 0.18), outline=0)
            k.cyl(0.17, 0.04, M.hole, loc=(0, -0.1, 0.36), rot=(90, 0, 0), seg=14, outline=0)
            k.box((0.08, 0.04, 0.3), M.burnt, loc=(-0.12, -0.13, 0.15), rot=(0, 12, 0))
            k.box((0.4, 0.04, 0.07), M.burnt, loc=(0.1, -0.3, 0.03), rot=(0, 0, 20))

    # ---- banners either side of the gate (fall and char with damage)
    for sx in (-1, 1):
        bx = sx * 0.4
        a = math.atan2(-0.62, bx)
        r = R_TOWER + 0.0
        px, py = math.cos(a) * r, math.sin(a) * r
        if s <= 1 or (s == 2 and sx < 0):
            ln = 0.55 if s == 0 else (0.42 if sx > 0 else 0.55)
            z0 = base + 0.92
            mat = M.team if s < 2 else M.team_char
            k.rod((px - 0.13, py - 0.05, z0 + 0.02), (px + 0.13, py - 0.05, z0 + 0.02), 0.014, M.wood_dk, outline=0.006)
            pts = [(px - 0.12, py - 0.06, z0), (px + 0.12, py - 0.06, z0), (px + 0.12, py - 0.07, z0 - ln), (px, py - 0.08, z0 - ln - 0.08), (px - 0.12, py - 0.07, z0 - ln)]
            k.sheet(pts, mat, thick=0.012)
            if s == 0:
                # gold emblem: a small diamond
                k.sheet([(px, py - 0.075, z0 - 0.12), (px + 0.06, py - 0.075, z0 - 0.22), (px, py - 0.075, z0 - 0.32), (px - 0.06, py - 0.075, z0 - 0.22)], M.gold, thick=0.01, outline=0.005)

    # ---- braziers on the front corners of the plinth
    for sx in (-1, 1):
        bx, by = sx * 0.78, -0.7
        if s == 3 and sx > 0:
            k.cyl(0.07, 0.05, M.iron, loc=(bx + 0.1, by - 0.05, base + 0.03), rot=(80, 0, 30), seg=10)
            continue
        k.cyl(0.03, 0.16, M.iron, loc=(bx, by, base + 0.08), seg=8)
        k.cyl(0.09, 0.07, M.iron, loc=(bx, by, base + 0.19), r2=0.06, seg=12)
        if s < 3:
            k.crystal(0.07, 0.16, M.ember, loc=(bx, by, base + 0.2), sides=5, mid=0.3, outline=0)
            k.crystal(0.04, 0.1, M.ember_hot, loc=(bx, by, base + 0.21), sides=5, mid=0.3, outline=0)

    # ---- rubble and cracks
    if s >= 1:
        n = {1: 6, 2: 12, 3: 30}[s]
        for i in range(n):
            a = rng.random() * 2 * math.pi
            r = (R_TOWER + 0.1 + rng.random() * (0.35 if s < 3 else 0.5))
            if s < 3 and math.sin(a) > 0.2:
                a = -a
            z = base + 0.04 if r < 1.0 else 0.18
            sz = 0.07 + rng.random() * (0.08 if s < 3 else 0.12)
            mat = (M.stone2 if rng.random() < 0.6 else M.stone_dk) if s < 2 else (M.char2 if rng.random() < 0.5 else M.stone2)
            k.box((sz * 1.3, sz, sz * 0.8), mat, loc=(math.cos(a) * r, math.sin(a) * r, z), rot=(jitter(rng, 25), jitter(rng, 25), math.degrees(rng.random() * 6)), bevel=0.015)
        if s == 3:
            # the snapped banner pole lies on the plinth so the side is still clear
            k.rod((-0.95, -0.55, base + 0.05), (0.15, -1.0, base + 0.04), 0.022, M.wood_dk)
            k.sheet([(-0.55, -0.72, base + 0.06), (-0.05, -0.92, base + 0.06), (-0.12, -1.12, base + 0.04), (-0.62, -0.95, base + 0.05)], M.team, thick=0.014)
            k.ball(0.05, M.gold_dk, loc=(0.18, -1.01, base + 0.05))
    if s in (1, 2):
        # cracks: dark zig-zags pressed into the front face
        for (a0, z0, z1, wob) in ((-1.95, 0.25, 0.8, 0.07), (-1.15, 0.45, 1.0, 0.06), (-1.6, 0.7, 1.05, 0.05)):
            pts = []
            for j in range(6):
                f = j / 5
                a = a0 + (wob if j % 2 else -wob) * (1 - f * 0.5)
                pts.append((math.cos(a) * (R_TOWER + 0.075), math.sin(a) * (R_TOWER + 0.075), base + z0 + (z1 - z0) * f))
            k.tube(pts, 0.022, M.hole, r_end=0.008, sides=5, outline=0)


# ------------------------------------------------------------------ stage
def setup(samples):
    st = K.Stage(samples=samples)
    a, e = math.radians(AZ), math.radians(EL)
    d = Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))
    st.cam.location = d * 20
    st.cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    st.cam.data.sensor_fit = "HORIZONTAL"
    m = st.cam.rotation_euler.to_matrix()
    right, up, back = m.col[0], m.col[1], m.col[2]
    K.set_light(up * 0.9 - right * 0.5 + back * 0.6)
    return st


def project(st, verts):
    bpy.context.view_layer.update()
    mi = np.array(st.cam.matrix_world.inverted())
    h = np.c_[verts, np.ones(len(verts))]
    return (h @ mi.T)[:, :2]


def render(st, path, w, h, span_x, cx, cy):
    sc = st.sc
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    st.cam.data.ortho_scale = span_x
    st.cam.data.shift_x = cx / span_x
    st.cam.data.shift_y = cy / span_x
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------ post (numpy in Blender)
def load_rgba(path):
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]  # top row first
    bpy.data.images.remove(im)
    return a


def save_rgba(path, a):
    h, w = a.shape[:2]
    im = bpy.data.images.new("out", w, h, alpha=True)
    im.alpha_mode = "STRAIGHT"
    im.colorspace_settings.name = "sRGB"
    out = a.copy()
    al = out[..., 3:4]
    out[..., :3] = np.where(al > 1e-4, out[..., :3] / np.maximum(al, 1e-4), 0)  # unpremultiply
    im.pixels[:] = np.clip(out[::-1], 0, 1).ravel()
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)


def premul(a):
    a = a.copy()
    a[..., :3] *= a[..., 3:4]
    return a


def shift(img, dy, dx):
    out = np.zeros_like(img)
    H, W = img.shape[:2]
    out[max(0, dy):H + min(0, dy), max(0, dx):W + min(0, dx)] = img[max(0, -dy):H + min(0, -dy), max(0, -dx):W + min(0, -dx)]
    return out


def dilate(al, r):
    out = al.copy()
    rr = r + 0.35
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if 0 < dx * dx + dy * dy <= rr * rr:
                out = np.maximum(out, shift(al, dy, dx))
    return out


def box_blur(ch, r):
    """Three passes of a separable box blur ~ gaussian."""
    out = ch
    for _ in range(3):
        for axis in (0, 1):
            c = np.cumsum(np.pad(out, [(r + 1, r) if i == axis else (0, 0) for i in range(2)], mode="edge"), axis=axis)
            hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
            lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
            out = (hi - lo) / (2 * r + 1)
    return out


def over(top, bot):
    return top + bot * (1 - top[..., 3:4])


def post(raw, glow, out_path):
    img = premul(load_rgba(raw))
    ink_a = dilate(img[..., 3], 3 * SS // 2 + 1)
    ink = np.zeros_like(img)
    ink[..., :3] = np.array([11, 15, 24], np.float32)[None, None] / 255 * ink_a[..., None]
    ink[..., 3] = ink_a
    out = over(img, ink)
    if glow and os.path.exists(glow):
        g = premul(load_rgba(glow))
        ga = g[..., 3]
        if ga.max() > 0.01:
            wide = np.clip(box_blur(ga, 9) * 2.2, 0, 0.6)
            col = np.array([255, 150, 60], np.float32) / 255
            halo = np.zeros_like(img)
            halo[..., :3] = col * wide[..., None]
            halo[..., 3] = wide
            out = over(out, halo)
            bl = np.stack([box_blur(g[..., i], 3) for i in range(3)], -1)
            out[..., :3] = np.minimum(out[..., :3] + bl * 0.5 * out[..., 3:4], out[..., 3:4])
    # 2x box downsample
    H, W = out.shape[:2]
    out = out[:H - H % SS, :W - W % SS].reshape(H // SS, SS, W // SS, SS, 4).mean((1, 3))
    save_rgba(out_path, out)
    return out.shape[1], out.shape[0]


# ------------------------------------------------------------------ main
def main():
    a = args()
    states = [x for x in a["states"].split(",") if x in STATES]
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    st = setup(int(a["samples"]))
    k = K.Kit(outline=0.012)
    M = Mats()
    # one canvas for every state: frame on the union of all of them
    lo, hi = None, None
    for state in STATES:
        k.clear()
        build(k, M, state)
        xy = project(st, k.verts_world())
        l, h = xy.min(0), xy.max(0)
        lo = l if lo is None else np.minimum(lo, l)
        hi = h if hi is None else np.maximum(hi, h)
    pad = 0.08
    lo, hi = lo - pad, hi + pad
    span = hi - lo
    w = int(math.ceil(span[0] * PPU / 4) * 4)
    h = int(math.ceil(span[1] * PPU / 4) * 4)
    span_x = w / PPU
    c = (lo + hi) / 2
    # the ground anchor (footprint centre) and effect anchors, in output pixels from the top-left
    def px(p):
        q = project(st, np.array([p], np.float32))[0]
        return [round(float((q[0] - c[0]) * PPU + w / 2), 1), round(float((c[1] - q[1]) * PPU + h / 2), 1)]
    top_z = 0.3 + ROWS * ROW_H
    anchors = {
        "ground": px((0, 0, 0)),
        "gate": px((0, -R_TOWER - 0.1, 0.55)),
        "top": px((0, 0, top_z + 0.3)),
        # where flames and smoke rise from in the burning and ruined states
        "fires": [px((0.05, 0, top_z + 0.15)), px((-0.42, -0.5, 0.95)), px((0.87, 0.1, 0.9)), px((0.35, -0.62, 0.72))],
        "smoke": [px((0, 0, 0.7)), px((-0.5, -0.4, 0.5)), px((0.6, -0.2, 0.55))],
    }
    for state in states:
        k.clear()
        build(k, M, state)
        for team in TEAMS:
            K.set_team(team)
            raw = os.path.join(RAW, f"{team}_{state}.png")
            glow = os.path.join(RAW, f"{team}_{state}_glow.png")
            K.set_glowpass(False)
            render(st, raw, w * SS, h * SS, span_x, float(c[0]), float(c[1]))
            K.set_glowpass(True)
            render(st, glow, w * SS, h * SS, span_x, float(c[0]), float(c[1]))
            K.set_glowpass(False)
            post(raw, glow, os.path.join(OUT, f"{team}_{state}.png"))
            print(f"KEEP_OK {team}_{state} {w}x{h}", flush=True)
    man = {"ppu": PPU, "w": w, "h": h, "elevation": EL, "states": list(STATES), "teams": list(TEAMS),
           "footprint": round(1.22, 2), "anchors": anchors}
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(man, f, indent=1)
    print("KEEPS_DONE", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
