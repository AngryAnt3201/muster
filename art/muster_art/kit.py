"""Muster art kit: scene, toon materials, team colour, primitives with baked transforms, renderer.

Conventions
- World units match the game (1.0 = one board unit). Units face +X, Z is up.
- Every primitive is baked into world space through a matrix stack (`with k.at(...)`),
  so the inverted-hull outline (Solidify) has the same world thickness everywhere.
- Shading is unlit toon: an emission colour = base x ramp(dot(normal, L)). L is one shared
  vector (straight down for sprites, so the game can rotate them; angled for portraits).
- Team colour comes from one node group (TeamColor) so a model renders tide and ember
  without rebuilding. GlowPass (0/1) turns every non-glow material into a holdout, which
  gives a clean emissive-only image for the Ascended bloom.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

PPU = 120
INK = "#0b0f18"

TEAMS = {
    "tide": {"main": "#3fd0c9", "dark": "#167c7a", "light": "#a6fff6"},
    "ember": {"main": "#ff6a4d", "dark": "#a8331f", "light": "#ffc1ad"},
}


def lin(hexcol, a=1.0):
    h = hexcol.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    f = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (f[0], f[1], f[2], a)


# ------------------------------------------------------------------ node groups
_G = {}


def _group_team():
    g = bpy.data.node_groups.new("TeamColor", "ShaderNodeTree")
    out = g.nodes.new("NodeGroupOutput")
    for key in ("main", "dark", "light"):
        g.interface.new_socket(key, in_out="OUTPUT", socket_type="NodeSocketColor")
    for i, key in enumerate(("main", "dark", "light")):
        rgb = g.nodes.new("ShaderNodeRGB")
        rgb.name = key
        g.links.new(rgb.outputs[0], out.inputs[i])
    return g


def _group_glowpass():
    g = bpy.data.node_groups.new("GlowPass", "ShaderNodeTree")
    g.interface.new_socket("Value", in_out="OUTPUT", socket_type="NodeSocketFloat")
    out = g.nodes.new("NodeGroupOutput")
    v = g.nodes.new("ShaderNodeValue")
    v.name = "v"
    v.outputs[0].default_value = 0.0
    g.links.new(v.outputs[0], out.inputs[0])
    return g


def _group_toon():
    """Color, Spec -> shaded Color. Light vector lives in node 'L' (Combine XYZ)."""
    g = bpy.data.node_groups.new("Toon", "ShaderNodeTree")
    g.interface.new_socket("Color", in_out="INPUT", socket_type="NodeSocketColor")
    g.interface.new_socket("Spec", in_out="INPUT", socket_type="NodeSocketFloat")
    g.interface.new_socket("Color", in_out="OUTPUT", socket_type="NodeSocketColor")
    gi = g.nodes.new("NodeGroupInput")
    go = g.nodes.new("NodeGroupOutput")
    geo = g.nodes.new("ShaderNodeNewGeometry")
    L = g.nodes.new("ShaderNodeCombineXYZ")
    L.name = "L"
    L.inputs[2].default_value = 1.0
    dot = g.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    g.links.new(geo.outputs["Normal"], dot.inputs[0])
    g.links.new(L.outputs[0], dot.inputs[1])
    ramp = g.nodes.new("ShaderNodeValToRGB")
    ramp.name = "ramp"
    cr = ramp.color_ramp
    cr.interpolation = "LINEAR"
    # three cel bands with short soft edges (soft edges keep tiny sprites from aliasing)
    stops = [(0.0, 0.50), (0.30, 0.50), (0.36, 0.78), (0.70, 0.78), (0.76, 1.0), (1.0, 1.0)]
    cr.elements[0].position = stops[0][0]
    cr.elements[0].color = (stops[0][1] ** 2.2,) * 3 + (1,)
    cr.elements[1].position = stops[-1][0]
    cr.elements[1].color = (1, 1, 1, 1)
    for p, v in stops[1:-1]:
        e = cr.elements.new(p)
        e.color = (v ** 2.2,) * 3 + (1,)
    g.links.new(dot.outputs["Value"], ramp.inputs[0])
    mul = g.nodes.new("ShaderNodeVectorMath")
    mul.operation = "MULTIPLY"
    g.links.new(gi.outputs["Color"], mul.inputs[0])
    g.links.new(ramp.outputs["Color"], mul.inputs[1])
    # small top highlight for metals
    hl = g.nodes.new("ShaderNodeMapRange")
    hl.clamp = True
    hl.inputs["From Min"].default_value = 0.90
    hl.inputs["From Max"].default_value = 0.93
    g.links.new(dot.outputs["Value"], hl.inputs["Value"])
    hm = g.nodes.new("ShaderNodeMath")
    hm.operation = "MULTIPLY"
    g.links.new(hl.outputs[0], hm.inputs[0])
    g.links.new(gi.outputs["Spec"], hm.inputs[1])
    add = g.nodes.new("ShaderNodeVectorMath")
    add.operation = "ADD"
    g.links.new(mul.outputs[0], add.inputs[0])
    g.links.new(hm.outputs[0], add.inputs[1])
    g.links.new(add.outputs[0], go.inputs[0])
    return g


def groups():
    if not _G:
        _G["team"] = _group_team()
        _G["glow"] = _group_glowpass()
        _G["toon"] = _group_toon()
    return _G


def set_team(team):
    g = groups()["team"]
    for key, hexcol in TEAMS[team].items():
        g.nodes[key].outputs[0].default_value = lin(hexcol)


def set_glowpass(on):
    groups()["glow"].nodes["v"].outputs[0].default_value = 1.0 if on else 0.0


def set_light(vec):
    v = Vector(vec).normalized()
    L = groups()["toon"].nodes["L"]
    for i in range(3):
        L.inputs[i].default_value = v[i]


# ------------------------------------------------------------------ materials
_M = {}


def matname(name):
    """Blender reads a trailing '.NNN' as a duplicate counter and aborts (stoi out of range) on long float tails."""
    return name.replace(".", "p")


def _new_mat(name):
    m = bpy.data.materials.new(matname(name))
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    return m, nt, out


def _color_socket(nt, col):
    """col: '#hex' or 'team.main' / 'team.dark' / 'team.light'."""
    if col.startswith("team."):
        tg = nt.nodes.new("ShaderNodeGroup")
        tg.node_tree = groups()["team"]
        return tg.outputs[col.split(".")[1]]
    rgb = nt.nodes.new("ShaderNodeRGB")
    rgb.outputs[0].default_value = lin(col)
    return rgb.outputs[0]


def _finish(m, nt, out, shader, holdout=True, alpha=1.0):
    if alpha < 1.0:
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mx = nt.nodes.new("ShaderNodeMixShader")
        mx.inputs[0].default_value = alpha
        nt.links.new(tr.outputs[0], mx.inputs[1])
        nt.links.new(shader, mx.inputs[2])
        shader = mx.outputs[0]
        m.surface_render_method = "BLENDED"
    if holdout:
        gp = nt.nodes.new("ShaderNodeGroup")
        gp.node_tree = groups()["glow"]
        ho = nt.nodes.new("ShaderNodeHoldout")
        mx = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(gp.outputs[0], mx.inputs[0])
        nt.links.new(shader, mx.inputs[1])
        nt.links.new(ho.outputs[0], mx.inputs[2])
        shader = mx.outputs[0]
    nt.links.new(shader, out.inputs["Surface"])
    return m


def toon(col, spec=0.0, alpha=1.0, mult=1.0):
    key = ("toon", col, spec, alpha, mult)
    if key in _M:
        return _M[key]
    m, nt, out = _new_mat(f"toon_{col}_{spec}_{alpha}_{mult}")
    c = _color_socket(nt, col)
    if mult != 1.0:
        mm = nt.nodes.new("ShaderNodeVectorMath")
        mm.operation = "SCALE"
        mm.inputs["Scale"].default_value = mult
        nt.links.new(c, mm.inputs[0])
        c = mm.outputs[0]
    tg = nt.nodes.new("ShaderNodeGroup")
    tg.node_tree = groups()["toon"]
    nt.links.new(c, tg.inputs["Color"])
    tg.inputs["Spec"].default_value = spec
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(tg.outputs[0], em.inputs["Color"])
    _M[key] = _finish(m, nt, out, em.outputs[0], alpha=alpha)
    return _M[key]


def glow(col, strength=1.0, alpha=1.0):
    """Unlit emissive (energy, runes, halos). Stays visible in the glow pass."""
    key = ("glow", col, strength, alpha)
    if key in _M:
        return _M[key]
    m, nt, out = _new_mat(f"glow_{col}_{strength}_{alpha}")
    c = _color_socket(nt, col)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    nt.links.new(c, em.inputs["Color"])
    _M[key] = _finish(m, nt, out, em.outputs[0], holdout=False, alpha=alpha)
    return _M[key]


def flat(col, alpha=1.0):
    """Unlit flat colour that is NOT part of the glow pass (eyes, dark holes)."""
    key = ("flat", col, alpha)
    if key in _M:
        return _M[key]
    m, nt, out = _new_mat(f"flat_{col}_{alpha}")
    c = _color_socket(nt, col)
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(c, em.inputs["Color"])
    _M[key] = _finish(m, nt, out, em.outputs[0], alpha=alpha)
    return _M[key]


def outline_mat(col=None):
    col = col or INK  # read at call time so a style direction can set kit.INK
    key = ("outline", col)
    if key in _M:
        return _M[key]
    m, nt, out = _new_mat(f"outline_{col}")
    c = _color_socket(nt, col)
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(c, em.inputs["Color"])
    m.use_backface_culling = True
    _M[key] = _finish(m, nt, out, em.outputs[0])
    return _M[key]


# ------------------------------------------------------------------ mesh helpers
def _rot(rot):
    """rot: (rx, ry, rz) degrees, XYZ euler -> Matrix."""
    if rot is None:
        return Matrix.Identity(4)
    from mathutils import Euler
    return Euler([math.radians(a) for a in rot], "XYZ").to_matrix().to_4x4()


def _scale(s):
    if isinstance(s, (int, float)):
        s = (s, s, s)
    return Matrix.Diagonal((s[0], s[1], s[2], 1.0))


def look_mat(direction, up=(0, 0, 1)):
    """Matrix that maps local +Z onto `direction` (for cylinders/tubes)."""
    z = Vector(direction).normalized()
    ref = Vector(up)
    if abs(z.dot(ref)) > 0.98:
        ref = Vector((1, 0, 0))
    x = ref.cross(z).normalized()
    y = z.cross(x)
    return Matrix(((x.x, y.x, z.x, 0), (x.y, y.y, z.y, 0), (x.z, y.z, z.z, 0), (0, 0, 0, 1)))


def catmull(pts, n=6):
    """Smooth a polyline through its points (Catmull-Rom)."""
    P = [Vector(p) for p in pts]
    if len(P) < 3:
        return P
    out = []
    ext = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for j in range(n):
            t = j / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-1])
    return out


class Kit:
    """Builds one model. All geometry is baked into world space."""

    def __init__(self, outline=0.011):
        self.coll = bpy.data.collections.get("Unit") or bpy.data.collections.new("Unit")
        if self.coll.name not in bpy.context.scene.collection.children:
            bpy.context.scene.collection.children.link(self.coll)
        self.stack = [Matrix.Identity(4)]
        self.outline = outline
        self.objs = []

    # ---- transform stack
    class _Frame:
        def __init__(self, k, m):
            self.k, self.m = k, m

        def __enter__(self):
            self.k.stack.append(self.k.stack[-1] @ self.m)
            return self.k

        def __exit__(self, *a):
            self.k.stack.pop()

    def at(self, loc=(0, 0, 0), rot=None, scale=1.0):
        return Kit._Frame(self, Matrix.Translation(Vector(loc)) @ _rot(rot) @ _scale(scale))

    def mat(self, m):
        return Kit._Frame(self, m)

    def M(self):
        return self.stack[-1]

    def world(self, p):
        return self.stack[-1] @ Vector(p)

    # ---- object creation
    def _emit(self, bm, mat, loc=(0, 0, 0), rot=None, scale=1.0, smooth=True, outline=None, name="p"):
        m = self.stack[-1] @ Matrix.Translation(Vector(loc)) @ _rot(rot) @ _scale(scale)
        bm.transform(m)
        if m.determinant() < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = smooth
        ob = bpy.data.objects.new(name, me)
        self.coll.objects.link(ob)
        me.materials.append(mat)
        th = self.outline if outline is None else outline
        if th and th > 0:
            om = outline_mat()
            me.materials.append(om)
            mod = ob.modifiers.new("Outline", "SOLIDIFY")
            mod.thickness = th
            mod.offset = 1.0
            mod.use_flip_normals = True
            mod.use_even_offset = False
            mod.use_quality_normals = True
            mod.use_rim = False
            mod.material_offset = 1
            mod.material_offset_rim = 1
        self.objs.append(ob)
        return ob

    def sphere(self, r, mat, loc=(0, 0, 0), scale=1.0, rot=None, seg=18, rings=10, smooth=True, outline=None):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
        return self._emit(bm, mat, loc, rot, scale, smooth, outline, "sph")

    def ball(self, r, mat, loc=(0, 0, 0), scale=1.0, rot=None, subdiv=2, smooth=True, outline=None):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
        return self._emit(bm, mat, loc, rot, scale, smooth, outline, "ico")

    def box(self, size, mat, loc=(0, 0, 0), rot=None, bevel=0.0, seg=2, smooth=None, outline=None, taper=None):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        sx, sy, sz = size
        for v in bm.verts:
            if taper is not None and v.co.z > 0:  # taper top face (tx, ty multipliers)
                v.co.x *= taper[0]
                v.co.y *= taper[1]
            v.co.x *= sx
            v.co.y *= sy
            v.co.z *= sz
        b = min(bevel, sx / 2 - 1e-4, sy / 2 - 1e-4, sz / 2 - 1e-4)
        if b > 0:
            bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=b, segments=seg, profile=0.5, affect="EDGES", clamp_overlap=True)
        return self._emit(bm, mat, loc, rot, 1.0, bevel > 0 if smooth is None else smooth, outline, "box")

    def cyl(self, r, h, mat, loc=(0, 0, 0), rot=None, r2=None, seg=14, smooth=True, outline=None, cap=True, bevel=0.0):
        """Cylinder/cone along local Z, centred."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
        if bevel > 0:
            rim = [e for e in bm.edges if all(abs(abs(v.co.z) - h / 2) < 1e-5 for v in e.verts) and e.verts[0].co.xy.length > 0.5 * min(r, r if r2 is None else r2)]
            bmesh.ops.bevel(bm, geom=rim, offset=bevel, segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
        ob = self._emit(bm, mat, loc, rot, 1.0, smooth, outline, "cyl")
        if smooth:
            for p in ob.data.polygons:
                ax = Vector(p.normal)
                p.use_smooth = True
        return ob

    def rod(self, p1, p2, r, mat, r2=None, seg=10, outline=None, cap=True):
        """Cylinder between two points (in current frame)."""
        a, b = Vector(p1), Vector(p2)
        d = b - a
        L = d.length
        if L < 1e-6:
            return None
        with self.mat(Matrix.Translation((a + b) / 2) @ look_mat(d)):
            return self.cyl(r, L, mat, r2=r2, seg=seg, outline=outline, cap=cap)

    def cone(self, r, h, mat, loc=(0, 0, 0), rot=None, seg=12, smooth=False, outline=None):
        """Cone with base at z=0 pointing +Z."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=True, segments=seg, radius1=r, radius2=0.0, depth=h)
        bm.transform(Matrix.Translation((0, 0, h / 2)))
        return self._emit(bm, mat, loc, rot, 1.0, smooth, outline, "cone")

    def spike(self, p1, p2, r, mat, seg=8, outline=None):
        a, b = Vector(p1), Vector(p2)
        d = b - a
        with self.mat(Matrix.Translation(a) @ look_mat(d)):
            return self.cone(r, d.length, mat, seg=seg, outline=outline)

    def torus(self, R, r, mat, loc=(0, 0, 0), rot=None, seg=28, rseg=8, scale=1.0, outline=None, arc=360.0, smooth=True):
        bm = bmesh.new()
        rings = []
        full = arc >= 359.9
        n = seg if full else max(3, int(seg * arc / 360.0)) + 1
        for i in range(n):
            a = math.radians(arc) * i / (seg if full else (n - 1))
            c = Vector((math.cos(a) * R, math.sin(a) * R, 0))
            radial = Vector((math.cos(a), math.sin(a), 0))
            ring = []
            for j in range(rseg):
                b = 2 * math.pi * j / rseg
                ring.append(bm.verts.new(c + radial * (math.cos(b) * r) + Vector((0, 0, math.sin(b) * r))))
            rings.append(ring)
        for i in range(n if full else n - 1):
            r0, r1 = rings[i], rings[(i + 1) % n]
            for j in range(rseg):
                bm.faces.new((r0[j], r1[j], r1[(j + 1) % rseg], r0[(j + 1) % rseg]))
        if not full:
            bm.faces.new(rings[0][::-1])
            bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        return self._emit(bm, mat, loc, rot, scale, smooth, outline, "tor")

    def prism(self, pts, depth, mat, loc=(0, 0, 0), rot=None, bevel=0.0, smooth=False, outline=None, scale=1.0, taper=1.0):
        """Extrude a 2D polygon (local XY, CCW) along Z, centred on z=0. taper scales the top face."""
        bm = bmesh.new()
        n = len(pts)
        bot = [bm.verts.new((x, y, -depth / 2)) for x, y in pts]
        top = [bm.verts.new((x * taper, y * taper, depth / 2)) for x, y in pts]
        bm.faces.new(bot[::-1])
        bm.faces.new(top)
        for i in range(n):
            bm.faces.new((bot[i], bot[(i + 1) % n], top[(i + 1) % n], top[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, profile=0.5, affect="EDGES", clamp_overlap=True)
        return self._emit(bm, mat, loc, rot, scale, smooth, outline, "prism")

    def crystal(self, r, h, mat, loc=(0, 0, 0), rot=None, sides=6, mid=0.35, outline=None, scale=1.0):
        """Bipyramid crystal along +Z from z=0 to z=h."""
        bm = bmesh.new()
        b = bm.verts.new((0, 0, 0))
        t = bm.verts.new((0, 0, h))
        ring = [bm.verts.new((r * math.cos(2 * math.pi * i / sides), r * math.sin(2 * math.pi * i / sides), h * mid)) for i in range(sides)]
        for i in range(sides):
            bm.faces.new((ring[i], ring[(i + 1) % sides], t))
            bm.faces.new((ring[(i + 1) % sides], ring[i], b))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        return self._emit(bm, mat, loc, rot, scale, False, outline, "crys")

    def crystal_at(self, base, tip, r, mat, sides=6, mid=0.35, outline=None):
        a, b = Vector(base), Vector(tip)
        d = b - a
        with self.mat(Matrix.Translation(a) @ look_mat(d)):
            return self.crystal(r, d.length, mat, sides=sides, mid=mid, outline=outline)

    def tube(self, pts, r, mat, r_end=None, sides=8, smooth_n=0, outline=None, cap=True, radii=None):
        """Sweep a circle along a polyline (optionally Catmull-Rom smoothed). r tapers to r_end."""
        P = catmull(pts, smooth_n) if smooth_n else [Vector(p) for p in pts]
        n = len(P)
        if n < 2:
            return None
        bm = bmesh.new()
        rings = []
        # parallel transport frame
        t0 = (P[1] - P[0]).normalized()
        ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
        nrm = t0.cross(ref).normalized()
        for i in range(n):
            if i == 0:
                t = (P[1] - P[0]).normalized()
            elif i == n - 1:
                t = (P[-1] - P[-2]).normalized()
            else:
                t = (P[i + 1] - P[i - 1]).normalized()
            nrm = (nrm - t * nrm.dot(t)).normalized()
            bin_ = t.cross(nrm)
            f = i / (n - 1)
            rr = radii[i] if radii else (r if r_end is None else r + (r_end - r) * f)
            ring = []
            for j in range(sides):
                a = 2 * math.pi * j / sides
                ring.append(bm.verts.new(P[i] + (nrm * math.cos(a) + bin_ * math.sin(a)) * max(rr, 1e-4)))
            rings.append(ring)
        for i in range(n - 1):
            for j in range(sides):
                bm.faces.new((rings[i][j], rings[i][(j + 1) % sides], rings[i + 1][(j + 1) % sides], rings[i + 1][j]))
        if cap:
            bm.faces.new(rings[0][::-1])
            bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        return self._emit(bm, mat, smooth=True, outline=outline, name="tube")

    def sheet(self, pts, mat, thick=0.012, outline=None, smooth=False):
        """A thin plate through arbitrary 3D points (convex-ish outline, fan-triangulated)."""
        P = [Vector(p) for p in pts]
        c = sum(P, Vector()) / len(P)
        nrm = Vector()
        for i in range(len(P)):
            nrm += (P[i] - c).cross(P[(i + 1) % len(P)] - c)
        nrm.normalize()
        bm = bmesh.new()
        bot = [bm.verts.new(p - nrm * thick / 2) for p in P]
        top = [bm.verts.new(p + nrm * thick / 2) for p in P]
        bm.faces.new(bot[::-1])
        bm.faces.new(top)
        n = len(P)
        for i in range(n):
            bm.faces.new((bot[i], bot[(i + 1) % n], top[(i + 1) % n], top[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        return self._emit(bm, mat, smooth=smooth, outline=outline, name="sheet")

    # ---- measuring
    def verts_world(self):
        import numpy as np
        dg = bpy.context.evaluated_depsgraph_get()
        arrs = []
        for ob in self.objs:
            me = ob.data
            n = len(me.vertices)
            a = np.empty(n * 3, dtype=np.float32)
            me.vertices.foreach_get("co", a)
            arrs.append(a.reshape(-1, 3))
        return np.concatenate(arrs) if arrs else np.zeros((0, 3), dtype=np.float32)

    def clear(self):
        for ob in list(self.coll.objects):
            me = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if me and me.users == 0:
                bpy.data.meshes.remove(me)
        self.objs = []
        self.stack = [Matrix.Identity(4)]


# ------------------------------------------------------------------ scene + render
class Stage:
    def __init__(self, samples=16):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = bpy.context.scene
        self.sc = sc
        r = sc.render
        r.engine = "BLENDER_EEVEE"
        r.film_transparent = True
        r.resolution_percentage = 100
        r.filter_size = 1.0
        ee = sc.eevee
        ee.taa_render_samples = samples
        for attr, val in (("use_shadows", False), ("use_raytracing", False), ("use_fast_gi", False), ("use_bloom", False)):
            if hasattr(ee, attr):
                try:
                    setattr(ee, attr, val)
                except Exception:
                    pass
        sc.view_settings.view_transform = "Standard"
        sc.view_settings.look = "None"
        sc.view_settings.exposure = 0.0
        sc.view_settings.gamma = 1.0
        ims = r.image_settings
        ims.file_format = "PNG"
        ims.color_mode = "RGBA"
        ims.color_depth = "8"
        ims.compression = 40
        w = bpy.data.worlds.new("World")
        w.color = (0, 0, 0)
        sc.world = w
        cd = bpy.data.cameras.new("Cam")
        cd.type = "ORTHO"
        cd.clip_start = 0.01
        cd.clip_end = 100.0
        self.cam = bpy.data.objects.new("Cam", cd)
        sc.collection.objects.link(self.cam)
        sc.camera = self.cam
        groups()
        self.top_view()

    def top_view(self):
        self.cam.location = (0, 0, 20)
        self.cam.rotation_euler = (0, 0, 0)
        self.cam.data.shift_x = 0
        self.cam.data.shift_y = 0
        set_light((0, 0, 1))

    def portrait_view(self, az=-38.0, el=24.0):
        a, e = math.radians(az), math.radians(el)
        d = Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))
        self.cam.location = d * 20
        self.cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        # light from upper-left of the viewer, a bit in front
        m = self.cam.rotation_euler.to_matrix()
        right, up, back = m.col[0], m.col[1], m.col[2]
        set_light(up * 0.95 - right * 0.45 + back * 0.55)
        return d

    def project(self, verts):
        """Camera-space XY of world verts (numpy Nx3) for framing."""
        import numpy as np
        mi = self.cam.matrix_world.inverted()
        M = np.array(mi)
        h = np.c_[verts, np.ones(len(verts))]
        cs = h @ M.T
        return cs[:, :2]

    def render(self, path, res, ortho_scale, shift=(0.0, 0.0)):
        sc = self.sc
        sc.render.resolution_x = res
        sc.render.resolution_y = res
        self.cam.data.ortho_scale = ortho_scale
        self.cam.data.shift_x = shift[0]
        self.cam.data.shift_y = shift[1]
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
