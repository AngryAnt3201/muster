"""Muster arenas: one Blender-rendered battlefield per campaign act, plus obstacle props.

    blender -b --factory-startup -P art/arenas/render_arenas.py -- [--only 1,4] [--samples 48] [--elev 60]
    npm run art:arenas

Writes, per act n (1..7):
  public/arenas/act<n>.jpg          the ground: texture, paths, edge props and baked sun + sky light
  public/arenas/act<n>_prop<v>.png  three obstacle prop variants with their own baked contact shadow
  public/arenas/manifest.json       how the game maps those images onto the board (see docs/ARENAS.md)

Conventions
- World units are board units. Blender X = board x, Blender Y = -board y (board y grows toward the player).
- One shared camera: orthographic, looking north from the player's side at `--elev` degrees above the ground.
  On the ground a board point (x, y) lands at image px ((x - x0) * ppu, (y - y0) * ppu * sin(elev)), so the
  game can map the backdrop exactly whatever height things have. Upright things lean up the screen.
- Obstacle props are modelled with their top-down silhouette exactly inside the unit circle, so drawn at
  radius r the prop covers the obstacle's collision circle. The render measures that silhouette back from the
  image (alpha) and stores it in the manifest; tests/arenas.test.ts holds it to +-8 %.
- Ground textures are built in numpy (value-noise fbm, path distance fields, tiles) and lit in Cycles with a
  sun, sky fill and the props' cast shadows, then saved as JPEG. Nothing is traced from any other game.
"""
import argparse
import json
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "public", "arenas")
BUILD = os.path.join(HERE, "build")

W, H = 9.0, 14.0
# The backdrop covers more than the board so it fills the screen behind the HUD on any phone.
X0, X1 = -4.0, 13.0
Y0, Y1 = -6.0, 20.0
PROP_FRAME = 4.6  # prop sprite frame width in prop radii
PROP_RES = 512


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--samples", type=int, default=48)
    ap.add_argument("--elev", type=float, default=60.0)
    ap.add_argument("--ppu", type=int, default=64)
    ap.add_argument("--no-props", action="store_true")
    ap.add_argument("--no-ground", action="store_true")
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--out", default=OUT)
    return ap.parse_args(argv)


def lin(hexcol):
    h = hexcol.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def lin4(hexcol, a=1.0):
    return tuple(lin(hexcol)) + (a,)


# ------------------------------------------------------------------ act themes
# Colours are sRGB hex. Each act: ground palette, path style, sky light, edge-prop set, obstacle prop.
ACTS = {
    1: dict(name="Borderlands", ground=("#5f9a3c", "#78b047", "#4c8434"), patch="#93b956", path="#b69466", path2="#9c7a52",
            edge="#4a7a30", sun=("#fff1d6", 3.6), sky=("#b9d7ff", 0.9), paths="road", props="borderlands", obstacle="boulder"),
    2: dict(name="Ash Fields", ground=("#6d625a", "#82766a", "#5a504a"), patch="#8b6f55", path="#3e3634", path2="#2c2626",
            edge="#3a3230", sun=("#ffd6a8", 3.2), sky=("#d9a58a", 0.75), paths="cinder", props="ash", obstacle="charstump", ember=True),
    3: dict(name="Hollow Wood", ground=("#3f6a3a", "#4f7c40", "#34572f"), patch="#6b5a3a", path="#7b6346", path2="#5e4a33",
            edge="#22361f", sun=("#ffe9b8", 2.8), sky=("#8fb7a0", 0.8), paths="trail", props="wood", obstacle="stump"),
    4: dict(name="Iron Pass", ground=("#7d7f86", "#8e9097", "#6b6d74"), patch="#8a7462", path="#a08a6c", path2="#85715a",
            edge="#4f5158", sun=("#fff4e0", 3.5), sky=("#a9c3e6", 0.85), paths="pass", props="iron", obstacle="crag"),
    5: dict(name="High Keep", ground=("#9a958a", "#aaa59a", "#8a857b"), patch="#7f8a5a", path="#8c4b45", path2="#6f3934",
            edge="#5d5a54", sun=("#fff0d8", 3.4), sky=("#b4c8e8", 0.85), paths="keep", props="keep", obstacle="pillar", tiles=True),
    6: dict(name="Frozen Reach", ground=("#e3eef7", "#f4f9ff", "#cfdfec"), patch="#a9d4ee", path="#b7c9d8", path2="#9fb4c6",
            edge="#9fb7cc", sun=("#fff6ea", 3.0), sky=("#9ec8ff", 1.1), paths="drift", props="frozen", obstacle="icecrystal", ice=True),
    7: dict(name="Sky Throne", ground=("#ece4d4", "#f6f0e2", "#ddd3c0"), patch="#e6c873", path="#5a7bc4", path2="#45619f",
            edge="#7fb2ff", sun=("#fffaf0", 3.3), sky=("#c7dcff", 1.1), paths="throne", props="sky", obstacle="obelisk", tiles=True, sky_edge=True),
}


# ------------------------------------------------------------------ numpy ground
def vnoise(h, w, cells, rng):
    """Smooth value noise on an h x w grid with `cells` lattice cells across the width."""
    cx = max(1, int(cells))
    cy = max(1, int(round(cells * h / w)))
    g = rng.random((cy + 2, cx + 2))
    ys = np.linspace(0, cy, h, endpoint=False)
    xs = np.linspace(0, cx, w, endpoint=False)
    yi, xi = np.floor(ys).astype(int), np.floor(xs).astype(int)
    fy, fx = ys - yi, xs - xi
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[yi][:, xi]
    b = g[yi][:, xi + 1]
    c = g[yi + 1][:, xi]
    d = g[yi + 1][:, xi + 1]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def fbm(h, w, cells, rng, octaves=4):
    out = np.zeros((h, w))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += vnoise(h, w, cells * (2 ** o), rng) * amp
        tot += amp
        amp *= 0.5
    return out / tot


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def seg_dist(px, py, pts):
    """Distance from grid points to a polyline (list of (x, y))."""
    d = np.full(px.shape, 1e9)
    for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
        vx, vy = bx - ax, by - ay
        L2 = vx * vx + vy * vy or 1e-9
        t = np.clip(((px - ax) * vx + (py - ay) * vy) / L2, 0, 1)
        dx, dy = px - (ax + t * vx), py - (ay + t * vy)
        d = np.minimum(d, np.sqrt(dx * dx + dy * dy))
    return d


def wiggle(x0, amp, freq, phase, ya=Y0, yb=Y1, n=90, xs=None):
    ys = np.linspace(ya, yb, n)
    return [(x0 + amp * math.sin(y * freq + phase) + (0 if xs is None else xs(y)), y) for y in ys]


# Keep pads: the commanders' keeps stand on these, just off each back edge.
# Keep pads: the commanders' keeps stand on the board at these points (src/render/keeps.ts keepAnchor), so each gets
# a paved plaza of PAD_R under it.
PADS = [(4.5, 1.55), (4.5, H - 0.6)]
PAD_R = 1.45


def path_layout(style):
    """(polylines with half widths, plaza radius) per act."""
    if style == "road":
        return [(wiggle(4.5, 0.55, 0.42, 0.3), 0.75)], 2.3
    if style == "cinder":
        return [(wiggle(4.5, 0.9, 0.33, 1.4), 0.6), (wiggle(1.6, 0.4, 0.5, 0.0, 3.0, 11.0), 0.35), (wiggle(7.4, 0.4, 0.5, 2.0, 3.0, 11.0), 0.35)], 2.2
    if style == "trail":
        return [(wiggle(3.0, 0.7, 0.38, 0.5, Y0, 7.0) + wiggle(6.0, 0.7, 0.38, 2.5, 7.0, Y1), 0.5),
                ([(3.0 + 0.7 * math.sin(7.0 * 0.38 + 0.5), 7.0), (6.0 + 0.7 * math.sin(7.0 * 0.38 + 2.5), 7.0)], 0.5),
                (wiggle(4.5, 0.3, 0.5, 0.0, Y0, 0.5), 0.5), (wiggle(4.5, 0.3, 0.5, 0.0, 13.5, Y1), 0.5)], 2.0
    if style == "pass":
        return [(wiggle(4.5, 0.35, 0.28, 0.2), 1.25)], 2.4
    if style == "keep":
        return [([(4.5, Y0), (4.5, Y1)], 0.85), ([(-1, 7.0), (10, 7.0)], 0.6)], 2.6
    if style == "drift":
        return [(wiggle(4.5, 1.1, 0.30, 0.9), 0.65), (wiggle(2.2, 0.5, 0.45, 2.0, 2.0, 12.0), 0.35)], 2.2
    if style == "throne":
        return [([(4.5, Y0), (4.5, Y1)], 0.7), ([(1.2, 7.0), (7.8, 7.0)], 0.45)], 2.6
    return [], 2.0


def ground_maps(act, ppu, seed):
    """Albedo (h,w,3 linear), height (h,w) and emission (h,w,3) for an act, in board orientation (row 0 = y0)."""
    A = ACTS[act]
    w = int((X1 - X0) * ppu)
    h = int((Y1 - Y0) * ppu)
    rng = np.random.default_rng(seed)
    xs = X0 + (np.arange(w) + 0.5) / ppu
    ys = Y0 + (np.arange(h) + 0.5) / ppu
    px, py = np.meshgrid(xs, ys)
    c0, c1, c2 = (np.array(lin(c)) for c in A["ground"])
    n1 = fbm(h, w, 6, rng, 5)
    n2 = fbm(h, w, 14, rng, 3)
    n3 = fbm(h, w, 3, rng, 3)
    t = smooth(0.25, 0.75, n1)[..., None]
    alb = c0 * (1 - t) + c1 * t
    alb = alb * (1 - 0.35 * smooth(0.55, 0.8, n3)[..., None]) + c2 * 0.35 * smooth(0.55, 0.8, n3)[..., None]
    patch = smooth(0.62, 0.72, fbm(h, w, 9, rng, 4))[..., None]
    alb = alb * (1 - patch * 0.6) + np.array(lin(A["patch"])) * patch * 0.6
    alb *= (0.9 + 0.2 * n2)[..., None]
    height = 0.25 * n1 + 0.12 * n2

    # tiles (keep courtyard, sky platform)
    if A.get("tiles"):
        tsz = 0.75 if act == 5 else 1.0
        jit = vnoise(h, w, 30, rng)
        ux = (px / tsz + (np.floor(py / tsz) % 2) * 0.5)
        uy = py / tsz
        fx = np.abs(ux - np.round(ux))
        fy = np.abs(uy - np.round(uy))
        grout = 1 - smooth(0.02, 0.06, np.minimum(fx, fy))
        tid = (np.floor(ux) * 7.13 + np.floor(uy) * 3.71)
        shade = 0.88 + 0.16 * np.abs(np.sin(tid * 12.9898) * 43758.5453 % 1)
        alb = alb * shade[..., None]
        gcol = np.array(lin("#5b564e" if act == 5 else "#c9ae6a"))
        alb = alb * (1 - grout[..., None] * 0.85) + gcol * grout[..., None] * 0.85
        height = height - grout * 0.35 + 0.05 * jit
        if act == 5:
            # moss and grass in the cracks of the outer yard
            moss = smooth(0.6, 0.7, fbm(h, w, 8, rng, 4)) * grout
            alb = alb * (1 - moss[..., None]) + np.array(lin("#5f7d3a")) * moss[..., None]

    # paths
    lines, plaza = path_layout(A["paths"])
    edge_n = (fbm(h, w, 20, rng, 3) - 0.5) * 0.35
    d_path = np.full(px.shape, 1e9)
    for pts, hw in lines:
        d_path = np.minimum(d_path, seg_dist(px, py, pts) - hw)
    for cx, cy in PADS:
        d_path = np.minimum(d_path, np.sqrt((px - cx) ** 2 + (py - cy) ** 2) - PAD_R)
    d_path = d_path + edge_n
    pm = 1 - smooth(-0.08, 0.08, d_path)
    pc0, pc1 = np.array(lin(A["path"])), np.array(lin(A["path2"]))
    pn = fbm(h, w, 18, rng, 3)
    pcol = pc0 * (1 - pn[..., None]) + pc1 * pn[..., None]
    if A["paths"] in ("keep", "throne"):
        # a laid runner: border stripes and a sheen
        stripe = smooth(0.0, 0.04, -d_path) * (1 - smooth(0.12, 0.16, -d_path))
        trim = np.array(lin("#d8b25a"))
        pcol = pcol * (1 - stripe[..., None]) + trim * stripe[..., None]
    # pebbles in the path
    peb = smooth(0.78, 0.82, fbm(h, w, 40, rng, 2)) * pm
    pcol = pcol * (1 - 0.35 * peb[..., None]) + np.array(lin("#d9d2c4")) * 0.35 * peb[..., None]
    # darker rim where the path meets the ground (worn edge)
    rim = smooth(-0.22, -0.02, d_path) * (1 - smooth(-0.02, 0.18, d_path))
    alb = alb * (1 - pm[..., None]) + pcol * pm[..., None]
    alb *= (1 - 0.22 * rim)[..., None]
    height = height * (1 - pm) + (0.05 * pn + 0.2 * peb) * pm - 0.08 * pm

    emis = np.zeros_like(alb)
    if A.get("ember"):
        # glowing cracks: thin valleys of a ridged noise
        rn = np.abs(fbm(h, w, 7, rng, 4) - 0.5)
        crack = 1 - smooth(0.0, 0.018, rn)
        crack *= smooth(0.45, 0.6, fbm(h, w, 4, rng, 2)) * (1 - pm)
        emis = np.array(lin("#ff7a2a"))[None, None, :] * crack[..., None] * 3.0
        alb = alb * (1 - crack[..., None] * 0.7) + np.array(lin("#2a1c18")) * crack[..., None] * 0.7
        height -= crack * 0.3
    if A.get("ice"):
        # glassy blue ice sheets in the snow
        ice = smooth(0.66, 0.70, fbm(h, w, 5, rng, 4)) * (1 - pm)
        alb = alb * (1 - ice[..., None] * 0.7) + np.array(lin("#8fc6ea")) * ice[..., None] * 0.7
        height = height * (1 - ice * 0.7)
        sparkle = (rng.random((h, w)) > 0.9975).astype(float) * (1 - ice)
        emis += sparkle[..., None] * 0.6

    rough = np.full((h, w), 0.9)
    if A.get("ice"):
        rough = np.where(ice > 0.5, 0.25, 0.9)
    if A.get("sky_edge"):
        # the throne is a floating platform: beyond its rim is open sky and cloud tops
        rx = np.maximum(-0.45 - px, px - (W + 0.45))
        ry = np.maximum(Y0 - 10 - py, py - (Y1 + 10))  # platform runs the full height
        dplat = np.maximum(rx, ry)
        off = smooth(-0.02, 0.02, dplat)
        rimg = smooth(-0.22, -0.18, dplat) * (1 - off)
        gold = np.array(lin("#e2b54d"))
        alb = alb * (1 - rimg[..., None]) + gold * rimg[..., None]
        height = height + rimg * 0.4
        cl = smooth(0.42, 0.62, fbm(h, w, 5, rng, 5))
        skyc = np.array(lin("#7fb2ff")) * (1 - cl[..., None]) + np.array(lin("#ffffff")) * cl[..., None]
        alb = alb * (1 - off[..., None]) + skyc * off[..., None]
        emis = emis * (1 - off[..., None]) + skyc * off[..., None] * 0.55
        height = height * (1 - off) - off * 2.0
        rough = rough * (1 - rimg) + 0.35 * rimg
    return alb, height, emis, rough


def np_image(name, arr, alpha=None, non_color=False):
    """numpy (h,w,3) or (h,w) board-oriented -> Blender image (rows flipped to Blender's bottom-up)."""
    if arr.ndim == 2:
        arr = np.repeat(arr[..., None], 3, axis=2)
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    a = np.ones((h, w, 1)) if alpha is None else alpha[..., None]
    rgba = np.concatenate([arr, a], axis=2)[::-1].astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


# ------------------------------------------------------------------ materials
_MAT = {}


def mat(col, rough=0.85, emit=None, emit_k=0.0, metal=0.0):
    key = (col, rough, emit, emit_k, metal)
    if key in _MAT:
        return _MAT[key]
    m = bpy.data.materials.new(f"m_{col}_{rough}_{emit}")
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = lin4(col)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if emit:
        p.inputs["Emission Color"].default_value = lin4(emit)
        p.inputs["Emission Strength"].default_value = emit_k
    _MAT[key] = m
    return m


def outline_mat():
    if "outline" in _MAT:
        return _MAT["outline"]
    m = bpy.data.materials.new("outline")
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    lp = nt.nodes.new("ShaderNodeLightPath")
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    nt.links.new(lp.outputs["Is Camera Ray"], inv.inputs[1])
    mx = nt.nodes.new("ShaderNodeMath")
    mx.operation = "MAXIMUM"
    mx.use_clamp = True
    nt.links.new(geo.outputs["Backfacing"], mx.inputs[0])
    nt.links.new(inv.outputs[0], mx.inputs[1])
    ink = nt.nodes.new("ShaderNodeEmission")
    ink.inputs["Color"].default_value = lin4("#141016")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(mx.outputs[0], mix.inputs[0])
    nt.links.new(ink.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    _MAT["outline"] = m
    return m


# ------------------------------------------------------------------ mesh kit
class Kit:
    """Builds props from primitives. Each call adds one object; `outline` is in world units."""

    def __init__(self, coll, outline=0.03):
        self.coll = coll
        self.outline = outline
        self.objs = []

    def _emit(self, bm, m, loc, rot, scale, smooth=False, outline=None, name="p"):
        # Authored in board coordinates (y toward the player); F maps them to Blender (y north) without mirroring meshes.
        F = Matrix.Diagonal((1, -1, 1, 1))
        R = F @ (rot or Matrix.Identity(4)) @ F
        M = Matrix.Translation(Vector((loc[0], -loc[1], loc[2]))) @ R
        if isinstance(scale, (int, float)):
            S = Matrix.Diagonal((scale, scale, scale, 1))
        else:
            S = Matrix.Diagonal((scale[0], scale[1], scale[2], 1))
        bm.transform(M @ S)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = smooth
        ob = bpy.data.objects.new(name, me)
        self.coll.objects.link(ob)
        me.materials.append(m)
        th = self.outline if outline is None else outline
        if th > 0:
            me.materials.append(outline_mat())
            mod = ob.modifiers.new("Outline", "SOLIDIFY")
            mod.thickness = th
            mod.offset = 1.0
            mod.use_flip_normals = True
            mod.use_rim = False
            mod.material_offset = 1
        self.objs.append(ob)
        return ob

    def rock(self, m, loc, r, h, seed, sub=1, jit=0.22, rot=0.0, smooth=False, outline=None, flat_base=True):
        rr = random.Random(seed)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
        for v in bm.verts:
            k = 1 + rr.uniform(-jit, jit)
            v.co *= k
            if flat_base and v.co.z < -0.15:
                v.co.z = -0.15
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 0.15))
        return self._emit(bm, m, loc, Matrix.Rotation(rot, 4, "Z"), (r, r, h / 1.15), smooth, outline, "rock")

    def blob(self, m, loc, r, sz=1.0, seed=0, sub=2, jit=0.12, smooth=True, outline=None):
        rr = random.Random(seed)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
        for v in bm.verts:
            v.co *= 1 + rr.uniform(-jit, jit)
        sc = (r, r, r * sz)
        return self._emit(bm, m, loc, None, sc, smooth, outline, "blob")

    def cyl(self, m, loc, r1, r2, h, seg=10, rot=None, smooth=False, outline=None, cap=True):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h)
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, h / 2))
        return self._emit(bm, m, loc, rot, 1.0, smooth, outline, "cyl")

    def box(self, m, loc, sx, sy, sz, rot=0.0, outline=None):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 0.5))
        return self._emit(bm, m, loc, Matrix.Rotation(rot, 4, "Z"), (sx, sy, sz), False, outline, "box")

    def crystal(self, m, loc, r, h, tilt=(0.0, 0.0), seg=6, outline=None):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r * 0.8, depth=h * 0.7)
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, h * 0.35))
        top = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r * 0.8, radius2=0.0, depth=h * 0.3)
        bmesh.ops.translate(bm, verts=top["verts"], vec=(0, 0, h * 0.85))
        R = Matrix.Rotation(tilt[0], 4, "X") @ Matrix.Rotation(tilt[1], 4, "Y")
        return self._emit(bm, m, loc, R, 1.0, False, outline, "crystal")

    def branch(self, m, base, length, r, yaw, pitch, outline=None):
        R = Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(pitch, 4, "Y")
        return self.cyl(m, base, r, r * 0.45, length, seg=6, rot=R, outline=outline)


# ------------------------------------------------------------------ edge props
def tree_round(k, x, y, s, rr, leaf="#4f8f37", leaf2="#6aa847", trunk="#6b4a2f"):
    k.cyl(mat(trunk), (x, y, 0), 0.16 * s, 0.11 * s, 0.9 * s, seg=7)
    for i in range(3):
        a = rr.uniform(0, math.tau)
        k.blob(mat(leaf if i else leaf2), (x + math.cos(a) * 0.25 * s, y + math.sin(a) * 0.25 * s, (1.0 + 0.25 * i) * s),
               (0.55 - 0.08 * i) * s, 0.85, seed=rr.randint(0, 999))


def pine(k, x, y, s, rr, leaf="#2f6b3c", snow=False):
    k.cyl(mat("#5a3d28"), (x, y, 0), 0.12 * s, 0.09 * s, 0.5 * s, seg=6)
    for i in range(3):
        r = (0.62 - 0.16 * i) * s
        z = (0.35 + 0.42 * i) * s
        k.cyl(mat(leaf), (x, y, z), r, 0.04 * s, 0.75 * s, seg=8)
        if snow:
            k.cyl(mat("#f4f9ff", 0.6), (x, y, z + 0.32 * s), r * 0.6, 0.03 * s, 0.42 * s, seg=8, outline=0)


def dead_tree(k, x, y, s, rr, col="#2e2522"):
    k.cyl(mat(col), (x, y, 0), 0.15 * s, 0.07 * s, 1.5 * s, seg=6)
    for i in range(4):
        k.branch(mat(col), (x, y, (0.6 + 0.22 * i) * s), (0.55 - 0.08 * i) * s, 0.06 * s, rr.uniform(0, math.tau), rr.uniform(0.6, 1.1))


def bush(k, x, y, s, rr, col="#4f8f37", berry=None):
    for i in range(3):
        a = rr.uniform(0, math.tau)
        k.blob(mat(col), (x + math.cos(a) * 0.18 * s, y + math.sin(a) * 0.18 * s, 0.15 * s), 0.3 * s, 0.75, seed=rr.randint(0, 999))
    if berry:
        for i in range(4):
            a = rr.uniform(0, math.tau)
            k.blob(mat(berry, 0.4), (x + math.cos(a) * 0.3 * s, y + math.sin(a) * 0.3 * s, 0.32 * s), 0.05 * s, 1.0, outline=0.01)


def fence(k, x0, y0, x1, y1, col="#8a6038"):
    n = max(2, int(math.hypot(x1 - x0, y1 - y0) / 0.8) + 1)
    ang = math.atan2(y1 - y0, x1 - x0)
    for i in range(n):
        t = i / (n - 1)
        k.box(mat(col), (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0), 0.12, 0.12, 0.55, ang)
    L = math.hypot(x1 - x0, y1 - y0)
    for z in (0.22, 0.42):
        k.box(mat(col), ((x0 + x1) / 2, (y0 + y1) / 2, z), L, 0.07, 0.07, ang)


def hay(k, x, y, s, rr):
    k.cyl(mat("#d9b65a"), (x, y, 0.28 * s), 0.28 * s, 0.28 * s, 0.6 * s, seg=12,
          rot=Matrix.Rotation(rr.uniform(0, 3), 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Translation((0, 0, -0.3 * s)))


def mushroom(k, x, y, s, cap="#c8423a"):
    k.cyl(mat("#efe6d2"), (x, y, 0), 0.06 * s, 0.05 * s, 0.25 * s, seg=6)
    k.blob(mat(cap, 0.5), (x, y, 0.25 * s), 0.17 * s, 0.55, sub=1)


def wall(k, x, y, length, rot, col="#8d877c", top="#a39d92"):
    k.box(mat(col), (x, y, 0), length, 0.7, 1.1, rot)
    n = int(length / 0.5)
    for i in range(n):
        if i % 2:
            continue
        t = (i + 0.5) / n - 0.5
        k.box(mat(top), (x + math.cos(rot) * t * length, y + math.sin(rot) * t * length, 1.1), 0.42, 0.72, 0.3, rot)


def banner(k, x, y, s, col):
    k.cyl(mat("#4a3a2a"), (x, y, 0), 0.05 * s, 0.04 * s, 1.9 * s, seg=6)
    k.box(mat(col, 0.7), (x + 0.2 * s, y, 1.1 * s), 0.4 * s, 0.03 * s, 0.75 * s)
    k.blob(mat("#e2b54d", 0.3, metal=0.8), (x, y, 1.95 * s), 0.08 * s, 1.0, sub=1)


def brazier(k, x, y, s):
    k.cyl(mat("#3d3a40", 0.5, metal=0.6), (x, y, 0), 0.12 * s, 0.08 * s, 0.6 * s, seg=8)
    k.cyl(mat("#3d3a40", 0.5, metal=0.6), (x, y, 0.6 * s), 0.18 * s, 0.28 * s, 0.18 * s, seg=10)
    k.blob(mat("#ffb347", 0.5, "#ff8a2a", 6.0), (x, y, 0.82 * s), 0.17 * s, 1.3, sub=1, outline=0)


def cloud(k, x, y, s, rr, z=0.1):
    for i in range(5):
        a = rr.uniform(0, math.tau)
        k.blob(mat("#ffffff", 0.95, "#ffffff", 0.35), (x + math.cos(a) * 0.5 * s, y + math.sin(a) * 0.5 * s, z),
               rr.uniform(0.35, 0.6) * s, 0.6, seed=rr.randint(0, 999), outline=0)


def edge_spots(rr, n, inner=0.3, outer=1.6, keep_clear=2.8):
    """Positions in the margins: left/right strips and the far ends, clear of the keep pads."""
    pts = []
    tries = 0
    while len(pts) < n and tries < 5000:
        tries += 1
        side = rr.random()
        if side < 0.72:
            x = rr.uniform(-outer, -inner) if rr.random() < 0.5 else rr.uniform(W + inner, W + outer)
            y = rr.uniform(Y0 + 0.5, Y1 - 0.5)
        else:
            x = rr.uniform(-1.5, 2.6) if rr.random() < 0.5 else rr.uniform(W - 2.6, W + 1.5)  # off the road
            y = rr.uniform(Y0 + 0.5, -inner) if rr.random() < 0.5 else rr.uniform(H + inner, Y1 - 0.5)
        if any(math.hypot(x - px, y - py) < keep_clear for px, py in PADS):
            continue
        if any(math.hypot(x - qx, y - qy) < 0.9 for qx, qy in pts):
            continue
        pts.append((x, y))
    return pts


def rim_spots(rr, step=1.15):
    """Low props hugging both long board edges (half on, half off the board) so the edge reads on a phone, where
    the board fills the screen width."""
    pts = []
    for side in (0, 1):
        y = -0.6 + rr.uniform(0, step)
        while y < H + 0.6:
            x = rr.uniform(-0.32, -0.02) if side == 0 else rr.uniform(W + 0.02, W + 0.32)
            if not any(math.hypot(x - px, y - py) < 2.2 for px, py in PADS):
                pts.append((x, y))
            y += step * rr.uniform(0.75, 1.25)
    return pts


def build_rim(k, act, rr):
    P = ACTS[act]["props"]
    for x, y in rim_spots(rr):
        r = rr.random()
        s = rr.uniform(0.45, 0.7)
        if P == "borderlands":
            if r < 0.55: bush(k, x, y, s, rr, berry="#d8433b" if rr.random() < 0.3 else None)
            elif r < 0.8: k.rock(mat("#8b8d8f"), (x, y, 0), 0.24, 0.18, rr.randint(0, 999))
            else:
                for j in range(3): k.blob(mat(rr.choice(["#f2d75a", "#f2f0e8", "#d86aa8"])), (x + rr.uniform(-0.18, 0.18), y + rr.uniform(-0.18, 0.18), 0.03), 0.05, 0.6, sub=1, outline=0.01)
        elif P == "ash":
            if r < 0.6: k.rock(mat("#3a3436"), (x, y, 0), 0.26, 0.22, rr.randint(0, 999), jit=0.3)
            else:
                k.cyl(mat("#2a2220"), (x, y, 0), 0.2, 0.16, 0.22, seg=8)
                k.cyl(mat("#ff8a3a", 0.6, "#ff6a1a", 4.0), (x, y, 0.22), 0.13, 0.13, 0.02, seg=8, outline=0)
        elif P == "wood":
            if r < 0.6: bush(k, x, y, s, rr, col="#355f2c")
            else:
                for j in range(2): mushroom(k, x + rr.uniform(-0.15, 0.15), y + rr.uniform(-0.15, 0.15), rr.uniform(0.6, 0.9), cap=rr.choice(["#c8423a", "#d98c3a"]))
        elif P == "iron":
            k.rock(mat(rr.choice(["#6e7179", "#80838b", "#5d6068"])), (x, y, 0), 0.3 * s / 0.55, 0.28, rr.randint(0, 999), sub=1, jit=0.3, rot=rr.uniform(0, 3))
        elif P == "keep":
            k.box(mat("#8d877c"), (x, y, 0), 0.34, 0.34, 0.16, rr.uniform(-0.2, 0.2))  # kerb stones
        elif P == "frozen":
            if r < 0.6: k.rock(mat("#e8f2fa", 0.7), (x, y, 0), 0.3, 0.18, rr.randint(0, 999), sub=2, jit=0.12, smooth=True)
            else: k.crystal(mat("#9fdcff", 0.15, "#6cc6ff", 0.6), (x, y, 0), 0.08, rr.uniform(0.3, 0.5), (rr.uniform(-0.3, 0.3), rr.uniform(-0.3, 0.3)))
        elif P == "sky":
            if r < 0.5: cloud(k, x, y, s * 0.6, rr, z=0.0)


def build_edges(k, act, rr):
    A = ACTS[act]
    P = A["props"]
    build_rim(k, act, random.Random(act * 31337))
    if P == "borderlands":
        for i, (x, y) in enumerate(edge_spots(rr, 34)):
            r = rr.random()
            s = rr.uniform(0.8, 1.15)
            if r < 0.45: tree_round(k, x, y, s, rr)
            elif r < 0.8: bush(k, x, y, s, rr, berry="#d8433b" if rr.random() < 0.3 else None)
            else: hay(k, x, y, s, rr)
        fence(k, -0.35, 1.0, -0.35, 5.0)
        fence(k, W + 0.35, 9.0, W + 0.35, 13.0)
        for x, y in edge_spots(rr, 10, 0.3, 1.2):
            k.rock(mat("#8b8d8f"), (x, y, 0), 0.22, 0.18, rr.randint(0, 999))
    elif P == "ash":
        for x, y in edge_spots(rr, 26):
            r = rr.random()
            s = rr.uniform(0.8, 1.2)
            if r < 0.45: dead_tree(k, x, y, s, rr)
            elif r < 0.75: k.rock(mat("#3a3436"), (x, y, 0), 0.45 * s, 0.4 * s, rr.randint(0, 999), jit=0.3)
            else:
                k.cyl(mat("#2a2220"), (x, y, 0), 0.3 * s, 0.25 * s, 0.35 * s, seg=8)
                k.cyl(mat("#ff8a3a", 0.6, "#ff6a1a", 4.0), (x, y, 0.35 * s), 0.2 * s, 0.2 * s, 0.02, seg=8, outline=0)
        for x, y in edge_spots(rr, 8, 0.6, 1.6):
            brazier(k, x, y, 1.0)
    elif P == "wood":
        for x, y in edge_spots(rr, 30, 0.45):
            r = rr.random()
            s = rr.uniform(0.9, 1.35)
            if r < 0.6: tree_round(k, x, y, s, rr, leaf="#2f5a2a", leaf2="#3d6f33", trunk="#4a3322")
            elif r < 0.85: bush(k, x, y, s, rr, col="#355f2c")
            else:
                for j in range(3): mushroom(k, x + rr.uniform(-0.3, 0.3), y + rr.uniform(-0.3, 0.3), rr.uniform(0.8, 1.3), cap=rr.choice(["#c8423a", "#d98c3a"]))
    elif P == "iron":
        for x, y in edge_spots(rr, 30, 0.35, 2.2, 2.6):
            s = rr.uniform(0.7, 1.4)
            k.rock(mat(rr.choice(["#6e7179", "#80838b", "#5d6068"])), (x, y, 0), 0.6 * s, 0.75 * s, rr.randint(0, 999), sub=1, jit=0.3, rot=rr.uniform(0, 3))
        for x, y in edge_spots(rr, 6, 0.6, 1.8):
            pine(k, x, y, rr.uniform(0.8, 1.1), rr, leaf="#3a5a40")
    elif P == "keep":
        wall(k, -0.55, 3.0, 5.5, math.pi / 2)
        wall(k, -0.55, 11.0, 5.5, math.pi / 2)
        wall(k, W + 0.55, 3.0, 5.5, math.pi / 2)
        wall(k, W + 0.55, 11.0, 5.5, math.pi / 2)
        for y in (6.0, 8.0):
            banner(k, -0.45, y, 1.0, "#3fd0c9" if y > 7 else "#ff6a4d")
            banner(k, W + 0.45, y, 1.0, "#3fd0c9" if y > 7 else "#ff6a4d")
        for x, y in edge_spots(rr, 8, 0.4, 1.0):
            k.cyl(mat("#7d5a3a"), (x, y, 0), 0.22, 0.2, 0.45, seg=10)  # barrels
        for x, y in edge_spots(rr, 6, 0.4, 1.0):
            brazier(k, x, y, 1.0)
    elif P == "frozen":
        for x, y in edge_spots(rr, 32):
            r = rr.random()
            s = rr.uniform(0.8, 1.3)
            if r < 0.55: pine(k, x, y, s, rr, leaf="#2d5a4e", snow=True)
            elif r < 0.8: k.rock(mat("#e8f2fa", 0.7), (x, y, 0), 0.5 * s, 0.35 * s, rr.randint(0, 999), sub=2, jit=0.12, smooth=True)
            else:
                for j in range(3):
                    k.crystal(mat("#9fdcff", 0.15, "#6cc6ff", 0.6), (x + rr.uniform(-0.2, 0.2), y + rr.uniform(-0.2, 0.2), 0), 0.12 * s, rr.uniform(0.5, 0.9) * s,
                              (rr.uniform(-0.3, 0.3), rr.uniform(-0.3, 0.3)))
    elif P == "sky":
        for x, y in [(-0.45, yy) for yy in np.arange(-5.5, 20, 2.0)] + [(W + 0.45, yy) for yy in np.arange(-4.5, 20, 2.0)]:
            k.cyl(mat("#f2ede2", 0.4), (x, y, -0.2), 0.16, 0.16, 0.75, seg=10)
            k.blob(mat("#e2b54d", 0.3, metal=0.9), (x, y, 0.62), 0.13, 1.0, sub=1)
        for x, y in edge_spots(rr, 14, 1.2, 3.5):
            cloud(k, x, y, rr.uniform(0.9, 1.5), rr, z=rr.uniform(0.0, 0.25))
        for x, y in [(-0.9, -1.0), (W + 0.9, -1.0), (-0.9, H + 1.0), (W + 0.9, H + 1.0)]:
            brazier(k, x, y, 1.1)


# ------------------------------------------------------------------ obstacle props (unit radius, normalised)
def build_obstacle(k, act, v):
    rr = random.Random(act * 101 + v * 17)
    kind = ACTS[act]["obstacle"]
    if kind == "boulder":
        k.rock(mat(rr.choice(["#8c8f93", "#7f8388"])), (0, 0, 0), 0.95, 1.15, rr.randint(0, 999), sub=2, jit=0.12, rot=rr.uniform(0, 3))
        k.blob(mat("#5f9a3c"), (rr.uniform(-0.2, 0.2), rr.uniform(-0.2, 0.2), 1.0), 0.4, 0.3, seed=v)
        for i in range(3):
            a = rr.uniform(0, math.tau)
            k.blob(mat("#78b047"), (math.cos(a) * 0.8, math.sin(a) * 0.8, 0.05), 0.15, 0.8, sub=1, outline=0.02)
    elif kind == "charstump":
        k.cyl(mat("#2a2220"), (0, 0, 0), 0.82, 0.62, 0.9, seg=9)
        k.cyl(mat("#4a2a1c", 0.6, "#ff6a1a", 3.0), (0, 0, 0.9), 0.55, 0.45, 0.04, seg=9, outline=0)
        for i in range(5):
            a = i / 5 * math.tau + rr.uniform(-0.3, 0.3)
            k.cyl(mat("#2a2220"), (math.cos(a) * 0.62, math.sin(a) * 0.62, 0), 0.22, 0.05, 0.35, seg=5,
                  rot=Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(0.9, 4, "Y"))
        k.box(mat("#ff8a3a", 0.5, "#ff6a1a", 5.0), (0, 0, 0.92), 0.6, 0.06, 0.02, rr.uniform(0, 3), outline=0)
    elif kind == "stump":
        k.cyl(mat("#6b4a2f"), (0, 0, 0), 0.85, 0.7, 0.7, seg=11)
        k.cyl(mat("#c9a36f"), (0, 0, 0.7), 0.62, 0.62, 0.03, seg=11, outline=0)
        k.cyl(mat("#3b2a1c"), (0, 0, 0.72), 0.3, 0.3, 0.02, seg=10, outline=0)
        k.blob(mat("#4f8f37"), (0.35, -0.3, 0.55), 0.35, 0.45, seed=v)
        for i in range(2 + v % 2):
            # on the trunk's front edge, inside its footprint, so the stump's round silhouette stays the collision circle
            a = -math.pi / 2 + (i - 1) * 0.75 + rr.uniform(-0.2, 0.2)
            mushroom(k, math.cos(a) * 0.6, math.sin(a) * 0.6, rr.uniform(0.9, 1.15))
    elif kind == "crag":
        for i in range(5):
            a = i / 5 * math.tau + rr.uniform(0, 0.6)
            k.rock(mat(rr.choice(["#6e7179", "#80838b"])), (math.cos(a) * 0.35, math.sin(a) * 0.35, 0), 0.6, rr.uniform(0.9, 1.4),
                   rr.randint(0, 999), sub=1, jit=0.25, rot=rr.uniform(0, 3))
        k.box(mat("#a5583a", 0.7), (0.1, -0.2, 0.6), 0.4, 0.08, 0.08, 0.6, outline=0)
    elif kind == "pillar":
        broken = v == 2
        k.cyl(mat("#8d877c"), (0, 0, 0), 0.7, 0.7, 0.25, seg=12)  # round plinth: the footprint is the collision circle
        k.cyl(mat("#b0aa9e", 0.7), (0, 0, 0.25), 0.55, 0.5, 0.8 if broken else 1.25, seg=12)
        if broken:
            k.rock(mat("#b0aa9e"), (0.3, -0.32, 0.25), 0.2, 0.18, 3)
        else:
            k.cyl(mat("#8d877c"), (0, 0, 1.5), 0.64, 0.64, 0.22, seg=12)
        if v == 1:
            k.box(mat("#ff6a4d" if rr.random() < 0.5 else "#3fd0c9", 0.7), (0, -0.6, 0.35), 0.5, 0.06, 0.8)
    elif kind == "icecrystal":
        k.rock(mat("#e8f2fa", 0.7), (0, 0, 0), 0.92, 0.45, rr.randint(0, 999), sub=2, jit=0.1, smooth=True)
        for i in range(4 + v):
            a = rr.uniform(0, math.tau)
            d = rr.uniform(0.0, 0.45)
            k.crystal(mat("#9fdcff", 0.1, "#6cc6ff", 0.8), (math.cos(a) * d, math.sin(a) * d, 0.2), rr.uniform(0.14, 0.22),
                      rr.uniform(0.9, 1.6), (rr.uniform(-0.35, 0.35), rr.uniform(-0.35, 0.35)))
    elif kind == "obelisk":
        k.cyl(mat("#e2b54d", 0.3, metal=0.9), (0, 0, 0), 0.92, 0.85, 0.22, seg=12)
        k.cyl(mat("#f2ede2", 0.4), (0, 0, 0.22), 0.7, 0.65, 0.25, seg=12)
        k.crystal(mat("#7fb2ff", 0.1, "#4f8cff", 1.5 + v * 0.5), (0, 0, 0.45), 0.36, 1.8, seg=6 if v != 1 else 4)
        for i in range(3):
            a = i / 3 * math.tau + 0.4
            k.crystal(mat("#a9caff", 0.1, "#4f8cff", 1.0), (math.cos(a) * 0.45, math.sin(a) * 0.45, 0.45), 0.12, 0.6, (math.sin(a) * 0.4, -math.cos(a) * 0.4))
    # normalise the silhouette so the widest point from above is exactly radius 1
    rmax = 0.0
    for ob in k.objs:
        for vtx in ob.data.vertices:
            rmax = max(rmax, math.hypot(vtx.co.x, vtx.co.y))
    sc = 1.0 / rmax
    for ob in k.objs:
        ob.data.transform(Matrix.Diagonal((sc, sc, sc, 1)))
        ob.data.update()
    return rmax


# ------------------------------------------------------------------ scene
def setup_scene(samples, cpu=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    r = sc.render
    r.engine = "CYCLES"
    cy = sc.cycles
    cy.samples = samples
    cy.use_denoising = True
    cy.max_bounces = 4
    try:
        if cpu:
            raise RuntimeError("cpu")
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        cy.device = "GPU"
    except Exception:
        cy.device = "CPU"
    r.resolution_percentage = 100
    r.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    for look in ("AgX - Punchy", "Punchy"):
        try:
            sc.view_settings.look = look
            break
        except Exception:
            pass
    w = bpy.data.worlds.new("World")
    sc.world = w
    cd = bpy.data.cameras.new("Cam")
    cd.type = "ORTHO"
    # ortho_scale must span the image width (AUTO fits the larger side, and backdrops are taller than wide)
    cd.sensor_fit = "HORIZONTAL"
    cd.clip_start = 0.01
    cd.clip_end = 200.0
    cam = bpy.data.objects.new("Cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam


def set_world(sc, col, k):
    w = sc.world
    nt = w.node_tree
    bg = nt.nodes["Background"]
    bg.inputs[0].default_value = lin4(col)
    bg.inputs[1].default_value = k


def add_sun(sc, col, k, elev=50.0, azim=135.0):
    """Sun from the north-west (upper left on screen), shadows fall down-right."""
    ld = bpy.data.lights.new("Sun", "SUN")
    ld.energy = k
    ld.color = lin(col)
    ld.angle = math.radians(4.0)
    ob = bpy.data.objects.new("Sun", ld)
    sc.collection.objects.link(ob)
    a, e = math.radians(azim), math.radians(elev)
    d = Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))  # toward the sun
    ob.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    return ob


def aim_camera(cam, cx, cy_board, elev):
    """Ortho camera looking north (+Blender Y) at elev degrees, centred on board point (cx, cy)."""
    e = math.radians(elev)
    target = Vector((cx, -cy_board, 0))
    d = Vector((0, -math.cos(e), math.sin(e)))  # from target toward camera (south and up)
    cam.location = target + d * 60
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()


def ground_plane(sc, act, ppu, seed):
    alb, hgt, emis, rough = ground_maps(act, ppu, seed)
    me = bpy.data.meshes.new("ground")
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in ((X0, -Y1, 0), (X1, -Y1, 0), (X1, -Y0, 0), (X0, -Y0, 0))]
    f = bm.faces.new(v)
    uv = bm.loops.layers.uv.new()
    for loop, t in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = t
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("ground", me)
    sc.collection.objects.link(ob)
    m = bpy.data.materials.new("ground")
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    ia = nt.nodes.new("ShaderNodeTexImage")
    ia.image = np_image("alb", alb)
    ih = nt.nodes.new("ShaderNodeTexImage")
    ih.image = np_image("hgt", hgt, non_color=True)
    ie = nt.nodes.new("ShaderNodeTexImage")
    ie.image = np_image("emi", emis)
    ir = nt.nodes.new("ShaderNodeTexImage")
    ir.image = np_image("rough", rough, non_color=True)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    bump.inputs["Distance"].default_value = 0.04
    nt.links.new(ia.outputs[0], p.inputs["Base Color"])
    nt.links.new(ih.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs[0], p.inputs["Normal"])
    nt.links.new(ie.outputs[0], p.inputs["Emission Color"])
    nt.links.new(ir.outputs[0], p.inputs["Roughness"])
    p.inputs["Emission Strength"].default_value = 1.0
    me.materials.append(m)
    return ob


def clear_scene(sc):
    for ob in list(sc.collection.objects):
        if ob.type != "CAMERA":
            bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.lights, bpy.data.images):
        for x in list(coll):
            if x.users == 0:
                coll.remove(x)


def render_ground(sc, cam, act, a):
    A = ACTS[act]
    clear_scene(sc)
    set_world(sc, *A["sky"])
    add_sun(sc, *A["sun"])
    ground_plane(sc, act, a.ppu, 1000 + act)
    k = Kit(sc.collection, 0.035)
    build_edges(k, act, random.Random(act * 7919))
    e = math.radians(a.elev)
    wpx = int((X1 - X0) * a.ppu)
    hpx = int(round((Y1 - Y0) * math.sin(e) * a.ppu))
    sc.render.resolution_x, sc.render.resolution_y = wpx, hpx
    sc.render.film_transparent = False
    cam.data.ortho_scale = X1 - X0
    cam.data.shift_x = cam.data.shift_y = 0
    aim_camera(cam, (X0 + X1) / 2, (Y0 + Y1) / 2, a.elev)
    ims = sc.render.image_settings
    ims.file_format = "JPEG"
    ims.color_mode = "RGB"
    ims.quality = 84
    sc.render.filepath = os.path.join(OUT, f"act{act}.jpg")
    bpy.ops.render.render(write_still=True)
    return {"w": wpx, "h": hpx}


def alpha_of(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1, :, 3]  # top-down rows


def fade_edges(path, band=0.07):
    """Fades alpha to 0 over the outer band of a prop sprite so a long shadow never ends in a hard frame edge."""
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    ramp = lambda n: np.clip(np.minimum(np.arange(n) + 0.5, n - np.arange(n) - 0.5) / (band * n), 0.0, 1.0)
    px[:, :, 3] *= np.outer(ramp(h), ramp(w))
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def render_prop(sc, cam, act, v, a):
    A = ACTS[act]
    clear_scene(sc)
    set_world(sc, *A["sky"])
    add_sun(sc, *A["sun"])
    k = Kit(sc.collection, 0.045)
    build_obstacle(k, act, v)
    e = math.radians(a.elev)
    sc.render.resolution_x = sc.render.resolution_y = PROP_RES
    sc.render.film_transparent = True
    cam.data.ortho_scale = PROP_FRAME
    aim_camera(cam, 0.0, 0.0, a.elev)
    # put the footprint centre a little below the image centre: props rise up the screen
    anchor = (0.5, 0.62)
    cam.data.shift_x = 0.0
    cam.data.shift_y = anchor[1] - 0.5
    ims = sc.render.image_settings
    ims.file_format = "PNG"
    ims.color_mode = "RGBA"
    ims.color_depth = "8"
    ims.compression = 90
    # 1) silhouette only, to measure the footprint back from the image
    tmp = os.path.join(BUILD, f"act{act}_prop{v}_mask.png")
    sc.render.filepath = tmp
    sc.cycles.samples = 8
    bpy.ops.render.render(write_still=True)
    al = alpha_of(tmp)
    cols = np.where((al > 0.5).any(axis=0))[0]
    ppr = PROP_RES / PROP_FRAME  # px per prop radius
    measured = (cols.max() - cols.min() + 1) / 2 / ppr if len(cols) else 0.0
    cx_img = (cols.max() + cols.min() + 1) / 2 / PROP_RES if len(cols) else 0.5
    # 2) the prop with its shadow on a catcher
    bpy.ops.mesh.primitive_plane_add(size=PROP_FRAME * 3, location=(0, 0, 0))
    catcher = bpy.context.active_object
    catcher.is_shadow_catcher = True
    sc.cycles.samples = a.samples
    path = os.path.join(OUT, f"act{act}_prop{v}.png")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    fade_edges(path)
    return {"file": os.path.basename(path), "footprint": round(float(measured), 4), "cx": round(float(cx_img), 4)}, anchor


def main():
    global OUT
    a = args()
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(BUILD, exist_ok=True)
    acts = sorted(ACTS)
    if a.only:
        acts = [int(x) for x in a.only.split(",") if x.strip()]
    OUT = a.out
    os.makedirs(OUT, exist_ok=True)
    sc, cam = setup_scene(a.samples, a.cpu)
    man_path = os.path.join(OUT, "manifest.json")
    man = {}
    if os.path.exists(man_path):
        with open(man_path) as f:
            man = json.load(f)
    man.update({
        "version": 1,
        "elev": a.elev,
        "ppu": a.ppu,
        "world": {"x": X0, "y": Y0, "w": X1 - X0, "h": Y1 - Y0},
        "propFrame": PROP_FRAME,
        "propRes": PROP_RES,
    })
    man.setdefault("acts", {})
    for act in acts:
        A = ACTS[act]
        entry = man["acts"].get(str(act), {})
        entry["name"] = A["name"]
        entry["edge"] = A["edge"]
        entry["obstacle"] = A["obstacle"]
        if not a.no_ground:
            g = render_ground(sc, cam, act, a)
            entry["ground"] = f"act{act}.jpg"
            entry["size"] = [g["w"], g["h"]]
            print(f"[arena] act {act} ground {g}", flush=True)
        if not a.no_props:
            props = []
            for v in range(3):
                p, anchor = render_prop(sc, cam, act, v, a)
                props.append(p)
                entry["anchor"] = list(anchor)
                print(f"[arena] act {act} prop {v} {p}", flush=True)
            entry["props"] = props
        man["acts"][str(act)] = entry
        with open(man_path, "w") as f:
            json.dump(man, f, indent=1)
    print("[arena] done", flush=True)


if __name__ == "__main__":
    main()
