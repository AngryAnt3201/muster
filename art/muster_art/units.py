"""Per-unit builders. Each builder(k, P, tier, pose) builds one model facing +X.

Registry entries: radius (game body radius, for scale), spawned (tier 1 only).
Humanoids are designed in a 0.25-radius frame and scaled by hum_scale().
"""
import math

from mathutils import Vector

from . import parts as H
from .parts import TIER_SCALE, humanoid, look_for

REG = {}
V = Vector


def unit(kind, radius, spawned=False):
    def deco(fn):
        REG[kind] = dict(build=fn, radius=radius, spawned=spawned)
        return fn
    return deco


def hum_scale(radius, tier, base=0.25):
    return (radius / base) * 1.3 * TIER_SCALE[tier]


def T(tier, a, b, c, d):
    return (a, b, c, d)[tier - 1]


def spark(k, P, c, r=0.06, mat=None, n=6):
    """Star burst (muzzle flash, fuse spark, impact)."""
    mat = mat or P.fire
    c = V(c)
    k.ball(r * 0.55, P.fire_hot, loc=c, outline=0)
    for i in range(n):
        a = 2 * math.pi * i / n
        d = V((math.cos(a), math.sin(a), 0.15))
        k.crystal_at(c, c + d * r * 1.6, r * 0.28, mat, sides=4, mid=0.3, outline=0)


def arc_fx(k, P, tier, R, a0, a1, z, mat=None, r=0.014):
    mat = mat or (P.glow_lt if tier == 4 else P.white)
    pts = [V((math.cos(math.radians(a)) * R, math.sin(math.radians(a)) * R, z)) for a in [a0 + (a1 - a0) * i / 8 for i in range(9)]]
    radii = [r * (0.3 + 0.7 * math.sin(math.pi * i / 8)) for i in range(9)]
    k.tube(pts, r, mat, outline=0, radii=radii, sides=6)


def emblem(k, P, kind, mat, z=0.145):
    c = H.HEAD + V((-0.03, 0, z))
    if kind == "plus":
        k.box((0.14, 0.045, 0.02), mat, loc=c, outline=0.006)
        k.box((0.045, 0.14, 0.02), mat, loc=c, outline=0.006)
    elif kind == "bolt":
        pts = [(0.075, 0.02), (0.0, 0.035), (0.01, -0.005), (-0.075, -0.02), (0.0, -0.035), (-0.01, 0.005)]
        k.prism(pts, 0.02, mat, loc=c, rot=(0, 0, 90), outline=0.006)
    elif kind == "flake":
        for i in range(3):
            k.box((0.15, 0.024, 0.02), mat, loc=c, rot=(0, 0, 60 * i), outline=0.005)


# ================================================================== 1 mine
@unit("mine", 0.22)
def mine(k, P, tier, pose):
    S = 0.22 / 0.2 * T(tier, 0.9, 1.0, 1.08, 1.16)
    armed = pose == "attack"
    with k.at(scale=S):
        if tier == 1:
            k.cyl(0.16, 0.07, P.wood, loc=(0, 0, 0.035), seg=18, bevel=0.015)
            for r in (0.16,):
                k.torus(r, 0.012, P.iron, loc=(0, 0, 0.05), seg=24)
            for i in range(3):
                k.box((0.3, 0.012, 0.012), P.wood_dk, loc=(0, -0.07 + 0.07 * i, 0.072), outline=0.006)
            k.cyl(0.075, 0.03, P.team, loc=(0, 0, 0.08), seg=14, bevel=0.008)
            k.torus(0.13, 0.016, P.team, loc=(0, 0, 0.072), seg=24)
            k.tube([(0.05, 0.05, 0.08), (0.12, 0.1, 0.1), (0.2, 0.06, 0.09), (0.22, -0.02, 0.08)], 0.01, P.cloth_dk, smooth_n=3)
            if armed:
                spark(k, P, (0.22, -0.02, 0.1), 0.05)
        else:
            body = T(tier, None, P.iron, P.steel, P.pearl)
            ring = T(tier, None, P.team, P.gold, P.gold)
            k.cyl(0.17, 0.07, body, loc=(0, 0, 0.035), seg=22, bevel=0.02)
            k.torus(0.17, 0.016, ring, loc=(0, 0, 0.055), seg=28)
            for i in range(6 if tier == 2 else 8):
                a = 2 * math.pi * i / (6 if tier == 2 else 8)
                p = V((math.cos(a) * 0.12, math.sin(a) * 0.12, 0.072))
                k.sphere(0.014, P.iron_dk if tier == 2 else P.gold, loc=p, outline=0.005)
                if tier >= 3:
                    out = 0.26 if armed else 0.22
                    k.spike(V((math.cos(a) * 0.15, math.sin(a) * 0.15, 0.04)), V((math.cos(a) * out, math.sin(a) * out, 0.04)), 0.025, P.steel if tier == 3 else P.glow_lt)
            k.cyl(0.075, 0.035, P.team, loc=(0, 0, 0.085 - (0.012 if armed else 0)), seg=16, bevel=0.01)
            k.sphere(0.04, P.team_lt if tier == 2 else P.glow, loc=(0, 0, 0.1 - (0.012 if armed else 0)), scale=(1, 1, 0.6))
            if tier == 4:
                for i in range(3):
                    a = 2 * math.pi * i / 3 + 0.5
                    p = V((math.cos(a) * 0.2, math.sin(a) * 0.2, 0.08))
                    k.ball(0.04, P.pearl, loc=p)
                    k.crystal_at(p + V((0, 0, 0.02)), p + V((0, 0, 0.08)), 0.022, P.glow, outline=0.004)
                k.torus(0.12, 0.01, P.glow_lt, loc=(0, 0, 0.075), seg=28, outline=0)
            if armed:
                spark(k, P, (0, 0, 0.13), 0.07 + 0.01 * tier, mat=P.fire if tier < 4 else P.glow_lt, n=8)


# ================================================================== 2 blades (one swordsman)
@unit("blades", 0.24)
def blades(k, P, tier, pose):
    S = hum_scale(0.24, tier) * 0.95
    atk = pose == "attack"
    lk = look_for(tier, cape=T(tier, None, None, "short", "energy"), head=T(tier, "hair", "helm", "helm", "helm"))
    if atk:
        hand = V((0.27, -0.05, 0.38))
        d = H.dir2(60, -0.05)
        off = V((0.12, 0.2, 0.3))
    else:
        hand = V((0.2, -0.19, 0.3))
        d = H.dir2(-15, 0.12)
        off = V((0.12, 0.2, 0.3))
    L = T(tier, 0.28, 0.33, 0.38, 0.42)
    with k.at(scale=S):
        humanoid(k, P, tier, {"R": hand, "L": off}, lk, head_turn=15 if atk else 0)
        H.sword(k, P, hand, d, L, tier, width=0.05 + 0.006 * tier)
        if atk:
            arc_fx(k, P, tier, 0.5, -40, 70, 0.36)


# ================================================================== 3 ranger
@unit("ranger", 0.25)
def ranger(k, P, tier, pose):
    S = hum_scale(0.25, tier)
    drawn = pose == "attack"
    lk = look_for(tier, head="hood", crest=None,
                  pads=T(tier, None, None, "steel", "crystal"),
                  chest=T(tier, None, "leather", "leather", "pearl"),
                  cape=T(tier, None, None, "long", "energy"),
                  legs=T(tier, "cloth_dk", "leather", "leather_dk", "pearl"),
                  arms=T(tier, None, "leather", "leather", None),
                  halo=False, gloves="leather")
    grip = V((0.33, 0.0, 0.40)) if drawn else V((0.24, 0.07, 0.36))
    draw_hand = V((0.03, -0.03, 0.42)) if drawn else V((0.12, -0.12, 0.34))
    span = T(tier, 0.2, 0.29, 0.32, 0.36)
    with k.at(scale=S):
        humanoid(k, P, tier, {"L": grip, "R": draw_hand}, lk)
        if drawn:
            H.bow(k, P, grip, tier, True, span=span, draw_to=draw_hand)
        else:
            with k.at(grip, rot=(0, 0, 25)):
                H.bow(k, P, (0, 0, 0), tier, False, span=span)
        if tier >= 2:
            k.rod((-0.12, 0.06, 0.3), (-0.15, -0.04, 0.5), 0.035, P.leather_dk)
            for i in range(3):
                k.sphere(0.013, P.team, loc=(-0.155 + 0.01 * i, -0.05 + 0.02 * i, 0.53), outline=0.004)
        if tier == 4:
            for i, a in enumerate((-35, 0, 35)):
                d = V((-math.cos(math.radians(a)), math.sin(math.radians(a)), 0.55)).normalized()
                p0 = H.HEAD + V((-0.04, 0, 0.1))
                k.crystal_at(p0, p0 + d * 0.17, 0.03, P.glow if i != 1 else P.glow_lt, sides=4, mid=0.5, outline=0.005)


# ================================================================== 4 bulwark
def tower_shield(k, P, tier, center, normal, w, h):
    face = P.team
    rim = T(tier, P.wood_dk, P.iron, P.gold, P.gold)
    from .kit import look_mat
    from mathutils import Matrix
    with k.mat(Matrix.Translation(V(center)) @ look_mat(normal)):
        # local X = world width (Y), local Y = height
        if tier == 1:
            pts = [(math.cos(a) * w / 2, math.sin(a) * h / 2) for a in [2 * math.pi * i / 16 for i in range(16)]]
        else:
            pts = [(-w / 2, h / 2), (-w / 2, -h * 0.2), (0, -h / 2), (w / 2, -h * 0.2), (w / 2, h / 2)]
            pts = pts[::-1]
        k.prism(pts, 0.05, rim, bevel=0.012)
        inner = [(x * 0.84, y * 0.84 + (0.0 if tier == 1 else 0.01)) for x, y in pts]
        k.prism(inner, 0.05, face, loc=(0, 0, 0.012), bevel=0.01)
        if tier == 1:
            for i in (-1, 0, 1):
                k.box((0.012, h * 0.8, 0.012), P.wood_dk, loc=(i * w * 0.25, 0, 0.042), outline=0.005)
        elif tier == 2:
            k.box((w * 0.85, 0.03, 0.02), P.iron, loc=(0, 0.02, 0.045), outline=0.006)
            k.box((0.03, h * 0.75, 0.02), P.iron, loc=(0, 0, 0.045), outline=0.006)
        elif tier == 3:
            k.cyl(w * 0.18, 0.03, P.gold, loc=(0, 0.03, 0.045), seg=16, bevel=0.008)
            k.cyl(w * 0.1, 0.03, P.team_dk, loc=(0, 0.03, 0.06), seg=16)
        else:
            k.crystal(w * 0.12, 0.12, P.glow, loc=(0, 0.03, 0.03))
            k.torus(w * 0.2, 0.012, P.glow_lt, loc=(0, 0.03, 0.045), outline=0)
            k.tube([(-w / 2, h / 2, 0.03), (w / 2, h / 2, 0.03)], 0.014, P.glow_lt, outline=0)


@unit("bulwark", 0.4)
def bulwark(k, P, tier, pose):
    S = hum_scale(0.4, tier) * 0.68
    atk = pose == "attack"
    lk = look_for(tier, pads=T(tier, "cloth", "steel", "gold", "crystal"), chest=T(tier, "leather", "steel", "steel", "pearl"),
                  head=T(tier, "cap", "helm", "helm", "helm"), crest=T(tier, None, "team", "plume", "plume"),
                  cape=T(tier, None, None, "long", "energy"))
    sx = 0.36 if atk else 0.27
    sh_c = V((sx, 0.02, 0.33))
    nrm = V((1, 0, 0.75 if not atk else 0.55)).normalized()
    mace_hand = V((0.12, -0.22, 0.5)) if atk else V((0.16, -0.21, 0.3))
    with k.at(scale=S):
        humanoid(k, P, tier, {"L": sh_c + V((-0.06, 0.06, 0.0)), "R": mace_hand}, lk, bulk=1.25)
        w = T(tier, 0.44, 0.5, 0.54, 0.58)
        tower_shield(k, P, tier, sh_c, nrm, w, T(tier, 0.36, 0.48, 0.52, 0.56))
        md = H.dir2(-25, 0.6 if atk else 0.25).normalized()
        k.rod(mace_hand - md * 0.05, mace_hand + md * 0.2, 0.018, P.wood_dk)
        mh = mace_hand + md * 0.22
        k.ball(0.05 + 0.006 * tier, T(tier, P.iron, P.steel, P.gold, P.glow_lt), loc=mh)
        if tier >= 2:
            for i in range(4):
                a = math.pi / 2 * i
                k.spike(mh, mh + V((math.cos(a), math.sin(a), 0.3)).normalized() * 0.09, 0.02, P.steel if tier < 4 else P.glow)
        if atk:
            arc_fx(k, P, tier, 0.6, -25, 25, 0.33, r=0.02)


# ================================================================== 5 medic
@unit("medic", 0.25)
def medic(k, P, tier, pose):
    S = hum_scale(0.25, tier)
    atk = pose == "attack"
    lk = look_for(tier, head="hood_light", torso="team", pads=T(tier, None, "cloth", "gold", "crystal"),
                  chest=T(tier, None, None, "pearl", "pearl"), cape=T(tier, None, "short", "long", "energy"),
                  legs="cloth_dk", belt=T(tier, "leather", "leather", "gold", "gold"))
    sh = V((0.3, -0.1, 0.5)) if atk else V((0.14, -0.2, 0.3))
    top = V((0.46, -0.08, 0.7)) if atk else V((0.2, -0.24, 0.72))
    off = V((0.25, 0.12, 0.42)) if atk else V((0.1, 0.19, 0.3))
    with k.at(scale=S):
        humanoid(k, P, tier, {"R": sh, "L": off}, lk)
        H.staff(k, P, sh, top, tier)
        # green plus on the hood top: the heal mark
        emblem(k, P, "plus", P.heal_t if tier < 4 else P.heal)
        # satchel
        k.box((0.1, 0.07, 0.09), P.leather, loc=(-0.02, 0.17, 0.22), bevel=0.02)
        k.ball(T(tier, 0.045, 0.05, 0.055, 0.065), P.heal, loc=top)
        if tier >= 3:
            k.torus(0.06, 0.01, P.gold, loc=top, rot=(90, 0, 0))
        if tier == 4:
            H.halo(k, P, H.HEAD + V((0, 0, 0.17)))
            for s in (1, -1):
                k.prism([(0, 0), (-0.22, s * 0.1), (-0.3, s * 0.22), (-0.12, s * 0.14)], 0.02, P.glow_soft, loc=(-0.05, s * 0.06, 0.48), outline=0)
        if atk:
            k.ball(0.06 + 0.01 * tier, P.heal, loc=top + V((0.03, 0, 0)), outline=0)
            k.torus(0.11 + 0.01 * tier, 0.01, P.heal, loc=top, outline=0)


# ================================================================== 6 grenadier
def bomb(k, P, c, r, tier, lit=False):
    c = V(c)
    k.ball(r, T(tier, P.darker, P.iron_dk, P.iron_dk, P.pearl), loc=c)
    k.cyl(r * 0.35, r * 0.4, P.bronze if tier < 4 else P.gold, loc=c + V((0, 0, r * 0.95)))
    if tier == 4:
        k.crystal_at(c + V((0, 0, r * 0.2)), c + V((0, 0, r * 1.6)), r * 0.4, P.glow, outline=0.004)
        k.torus(r * 1.02, r * 0.12, P.glow, loc=c, outline=0)
    else:
        k.tube([c + V((0, 0, r)), c + V((-0.02, 0.01, r * 1.5)), c + V((-0.04, 0.0, r * 1.7))], 0.007, P.cloth_dk, outline=0.004)
    if lit:
        spark(k, P, c + V((-0.04, 0, r * 1.75)), 0.035)


@unit("grenadier", 0.27)
def grenadier(k, P, tier, pose):
    S = hum_scale(0.27, tier)
    atk = pose == "attack"
    lk = look_for(tier, head=T(tier, "cap", "helm", "helm", "helm"), crest=T(tier, None, None, "team", "plume"),
                  cape=T(tier, None, None, None, "energy"), chest=T(tier, None, "leather", "steel", "pearl"))
    throw = V((-0.08, -0.22, 0.58)) if atk else V((0.17, -0.18, 0.32))
    off = V((0.28, 0.08, 0.42)) if atk else V((0.12, 0.2, 0.3))
    with k.at(scale=S):
        humanoid(k, P, tier, {"R": throw, "L": off}, lk, bulk=1.05)
        br = T(tier, 0.075, 0.08, 0.088, 0.095)
        bomb(k, P, throw + V((0.02, 0, br * 0.6)), br, tier, lit=True)
        if tier >= 2:
            # bandolier with small bombs across the chest
            pts = [V((0.07, 0.15, 0.42)), V((0.11, 0.0, 0.36)), V((0.07, -0.14, 0.27))]
            k.tube(pts, 0.016, P.leather_dk, smooth_n=3)
            for i in range(3 if tier == 2 else 4):
                f = (i + 0.5) / (3 if tier == 2 else 4)
                p = pts[0].lerp(pts[2], f) + V((0.03, 0, 0.02))
                k.ball(0.028, P.iron_dk if tier < 4 else P.glow, loc=p)
        if tier >= 3:
            # bomb rack on the back
            k.box((0.1, 0.22, 0.14), P.wood_dk, loc=(-0.13, 0, 0.4), bevel=0.02)
            for s in (-1, 0, 1):
                k.ball(0.045, P.iron_dk if tier == 3 else P.pearl, loc=(-0.13, s * 0.07, 0.5))
                if tier == 4:
                    k.sphere(0.02, P.glow, loc=(-0.13, s * 0.07, 0.55), outline=0)


# ================================================================== 7 shade
@unit("shade", 0.24)
def shade(k, P, tier, pose):
    S = hum_scale(0.24, tier)
    atk = pose == "attack"
    lk = look_for(tier, head="hood_dark", torso="dark", crest=None, pads=T(tier, None, None, None, "crystal"),
                  chest=T(tier, None, "darker", "darker", "darker"), cape=None, legs="darker", boots="darker",
                  belt=T(tier, "leather_dk", "leather_dk", "team", "gold"), arms="dark", gloves="darker")
    if atk:
        r_h, l_h = V((0.33, -0.06, 0.36)), V((0.33, 0.07, 0.36))
        rd, ld = H.dir2(8, -0.1), H.dir2(-8, -0.1)
    else:
        r_h, l_h = V((0.12, -0.2, 0.3)), V((0.12, 0.2, 0.3))
        rd, ld = H.dir2(-50, 0.0), H.dir2(50, 0.0)
    L = T(tier, 0.16, 0.18, 0.22, 0.26)
    with k.at(scale=S, rot=(0, 10 if atk else 0, 0)):
        humanoid(k, P, tier, {"R": r_h, "L": l_h}, lk, lean=6)
        # team scarf trailing behind: the colour cue from above
        sc = [V((0.0, 0.08, 0.47)), V((-0.12, 0.1, 0.45)), V((-0.24, 0.05, 0.42)), V((-0.34, 0.1, 0.38))]
        k.tube(sc, T(tier, 0.03, 0.034, 0.038, 0.04), P.team if tier < 4 else P.glow, r_end=0.012, smooth_n=3)
        k.torus(0.075, 0.03, P.team, loc=(0.0, 0, 0.45))
        if tier >= 3:
            # tattered cloak
            for i, s in enumerate((-1, 1)):
                k.prism([(0, 0), (-0.28, s * 0.12), (-0.2, s * 0.2), (-0.32, s * 0.26), (-0.02, s * 0.2)], 0.018, P.darker,
                        loc=(-0.03, s * 0.02, 0.42), rot=(0, -12, 0))
        blades = [(r_h, rd)] + ([(l_h, ld)] if tier >= 2 or atk else [])
        for hand, d in blades:
            H.sword(k, P, hand, d, L, tier, width=0.038, blade=T(tier, P.iron, P.steel, P.steel, P.glow_lt), guard=P.darker)
        if tier == 4:
            for s in (1, -1):
                k.sphere(0.016, P.glow_lt, loc=H.HEAD + V((0.1, s * 0.035, 0.005)), outline=0)
            H.orbit_shards(k, P, H.HEAD + V((0, 0, 0.08)), 0.15, n=4, h=0.07)


# ================================================================== 8 lancer
def mount(k, P, tier, gallop):
    coat = T(tier, P.coat, P.coat, P.coat_dk, P.pearl)
    mane = T(tier, P.hair, P.hair, P.darker, P.glow)
    legs_f = 0.12 if gallop else 0.0
    for sx, sy in ((0.17, 0.08), (0.17, -0.08), (-0.17, 0.08), (-0.17, -0.08)):
        dx = legs_f if sx > 0 else -legs_f
        # diagonal pairs move together in the gait
        gx, gz = H.step(0.0 if (sx > 0) == (sy > 0) else 0.5, stride=0.11, lift=0.06)
        dx += gx
        k.rod((sx, sy, 0.36), (sx + dx, sy, 0.04 + gz), 0.035, coat)
        k.cyl(0.04, 0.05, P.darker if tier < 4 else P.glow, loc=(sx + dx, sy, 0.03 + gz))
    k.sphere(1.0, coat, loc=(0, 0, 0.42), scale=(0.31, 0.175, 0.15))
    neck_top = V((0.36, 0, 0.62)) if not gallop else V((0.42, 0, 0.56))
    k.tube([V((0.2, 0, 0.45)), neck_top], 0.08, coat, r_end=0.055)
    hd = neck_top + V((0.08, 0, -0.03))
    k.sphere(1.0, coat, loc=hd, scale=(0.13, 0.065, 0.065), rot=(0, 25, 0))
    for s in (1, -1):
        k.cone(0.02, 0.06, coat, loc=neck_top + V((0.0, s * 0.03, 0.03)), rot=(0, -20, 0))
    k.tube([V((0.2, 0, 0.53)), neck_top + V((-0.02, 0, 0.05))], 0.03, mane, outline=0.008 if tier < 4 else 0)
    k.tube([V((-0.28, 0, 0.48)), V((-0.4, 0, 0.4)), V((-0.45, 0, 0.28))], 0.035, mane, r_end=0.015, smooth_n=3)
    if tier == 1:
        k.sphere(1.0, P.team, loc=(-0.03, 0, 0.5), scale=(0.12, 0.17, 0.06))
    if tier >= 2:
        k.sphere(1.0, P.team, loc=(-0.02, 0, 0.47), scale=(0.25, 0.19, 0.1))
        k.torus(1.0, 0.014, T(tier, None, P.iron, P.gold, P.gold), loc=(-0.02, 0, 0.47), scale=(0.25, 0.19, 1.0))
    if tier >= 3:
        k.sphere(1.0, P.steel if tier == 3 else P.gold, loc=hd + V((0.01, 0, 0.012)), scale=(0.12, 0.07, 0.06), rot=(0, 25, 0))
        k.sphere(1.0, P.steel if tier == 3 else P.pearl, loc=(0.22, 0, 0.5), scale=(0.12, 0.15, 0.1))
    if tier == 4:
        k.crystal_at(hd + V((0.03, 0, 0.04)), hd + V((0.14, 0, 0.12)), 0.022, P.glow)
    return hd


@unit("lancer", 0.36)
def lancer(k, P, tier, pose):
    S = TIER_SCALE[tier] * 1.12
    atk = pose == "attack"
    lk = look_for(tier, head=T(tier, "hair", "helm", "helm", "helm"), crest=T(tier, None, "team", "plume", "plume"),
                  cape=T(tier, None, None, "short", "energy"), pads=T(tier, None, "steel", "gold", "crystal"))
    with k.at(scale=S):
        mount(k, P, tier, atk)
        with k.at((-0.04, 0, 0.3), scale=0.78, rot=(0, 12 if atk else 0, 0)):
            hand = V((0.12, -0.18, 0.38))
            humanoid(k, P, tier, {"R": hand, "L": V((0.2, 0.12, 0.34))}, lk)
            d = V((1, 0.05, -0.05 if atk else 0.12)).normalized()
            tip = H.spear(k, P, hand, d, T(tier, 0.62, 0.72, 0.78, 0.84) + (0.12 if atk else 0), tier, back=0.3, head_len=0.14)
            if tier >= 3:
                # pennant on the lance
                base = V(hand) + d * 0.45
                k.prism([(0, 0), (-0.16, 0.0), (-0.2, 0.06), (-0.04, 0.07)], 0.012, P.team, loc=base + V((0, 0.015, 0.0)), rot=(0, 0, 3))
            if tier == 2:
                k.cone(0.05, 0.1, P.iron, loc=V(hand) + d * 0.04, rot=(0, 90, 0))
            elif tier >= 3:
                k.cone(0.06, 0.12, P.gold, loc=V(hand) + d * 0.04, rot=(0, 90, 0))


# ================================================================== 9 ballista
@unit("ballista", 0.42)
def ballista(k, P, tier, pose):
    S = T(tier, 0.88, 1.0, 1.08, 1.16) * 1.3
    fire = pose == "attack"
    wood = T(tier, P.wood, P.wood, P.wood_dk, P.pearl)
    with k.at(scale=S):
        if tier >= 3:
            k.cyl(0.3, 0.06, P.stone_dk if tier == 3 else P.gold_dk, loc=(0, 0, 0.03), seg=24, bevel=0.015)
        # cross base
        k.box((0.5, 0.09, 0.07), wood, loc=(0, 0, 0.1), bevel=0.02)
        k.box((0.09, 0.5, 0.07), wood, loc=(0, 0, 0.1), bevel=0.02)
        k.cyl(0.07, 0.15, P.iron if tier > 1 else P.wood_dk, loc=(0, 0, 0.2))
        # stock
        k.box((0.56, 0.14, 0.08), wood, loc=(0.04, 0, 0.3), bevel=0.025)
        k.box((-0.0 + 0.16, 0.12, 0.05), P.team, loc=(-0.12, 0, 0.35), bevel=0.015)
        k.box((0.12, 0.2, 0.12), T(tier, P.wood_dk, P.iron, P.steel, P.pearl), loc=(0.3, 0, 0.32), bevel=0.02)
        # bow arms
        arm = T(tier, P.wood_dk, P.wood_dk, P.wood_dk, P.glow)
        span = T(tier, 0.36, 0.4, 0.44, 0.48)
        bend = 0.05 if fire else 0.16
        for s in (1, -1):
            pts = [V((0.32, s * 0.08, 0.34)), V((0.3, s * span * 0.6, 0.35)), V((0.32 - bend, s * span, 0.36))]
            k.tube(pts, 0.042 if tier < 4 else 0.046, arm, r_end=0.026, smooth_n=3)
            if tier >= 2:
                k.sphere(0.03, P.iron if tier == 2 else P.gold, loc=pts[-1])
        nock_x = 0.32 - bend if fire else -0.12
        for s in (1, -1):
            k.rod(V((0.32 - bend, s * span, 0.36)), V((nock_x, 0, 0.35)), 0.007, P.bone if tier < 4 else P.glow_lt, outline=0.004)
        # bolt
        bx0 = 0.3 if fire else -0.12
        bl = T(tier, 0.52, 0.54, 0.56, 0.58)
        k.rod(V((bx0, 0, 0.37)), V((bx0 + bl, 0, 0.37)), 0.02, P.wood if tier < 4 else P.glow_lt)
        k.spike(V((bx0 + bl, 0, 0.37)), V((bx0 + bl + 0.1, 0, 0.37)), 0.032, P.steel if tier < 4 else P.white)
        for s in (1, -1):
            k.prism([(0, 0), (0.08, 0), (0.0, s * 0.045)], 0.008, P.team, loc=(bx0 + 0.01, 0, 0.375))
        if fire:
            for i in range(3):
                k.rod(V((bx0 - 0.1 - i * 0.12, (i - 1) * 0.03, 0.37)), V((bx0 - 0.02 - i * 0.12, (i - 1) * 0.03, 0.37)), 0.006,
                      P.white if tier < 4 else P.glow_lt, outline=0)
        # team plates
        if tier >= 2:
            for s in (1, -1):
                k.box((0.1, 0.03, 0.12), P.team, loc=(0.24, s * 0.12, 0.27), bevel=0.012, rot=(s * 15, 0, 0))
        if tier >= 3:
            for s in (1, -1):
                k.rod(V((-0.18, s * 0.18, 0.08)), V((-0.18, s * 0.18, 0.52)), 0.012, P.wood_dk)
                k.prism([(0, 0), (-0.18, 0), (-0.14, -0.05), (-0.18, -0.1), (0, -0.1)], 0.012, P.team,
                        loc=(-0.18, s * 0.18, 0.5), rot=(s * 20, 0, 0))
                k.sphere(0.02, P.gold, loc=(-0.18, s * 0.18, 0.53))
        if tier == 4:
            H.orbit_shards(k, P, V((0, 0, 0.12)), 0.3, n=6, h=0.09)


# ================================================================== 10 hive
@unit("hive", 0.45)
def hive(k, P, tier, pose):
    S = T(tier, 0.82, 0.95, 1.06, 1.16)
    spawn = pose == "attack"
    shell = T(tier, P.mud, P.mud, P.chitin, P.chitin)
    with k.at(scale=S):
        k.sphere(0.32, shell, loc=(0, 0, 0.0), scale=(1.0, 1.0, 0.75), seg=20)
        k.sphere(0.22, T(tier, P.mud_dk, P.mud, P.chitin_dk, P.pearl), loc=(-0.02, 0, 0.18), scale=(1, 1, 0.8))
        n = T(tier, 3, 5, 6, 6)
        for i in range(n):
            a = 2 * math.pi * i / n + 0.3
            r = 0.24
            p = V((math.cos(a) * r, math.sin(a) * r, 0.16))
            nrm = V((math.cos(a), math.sin(a), 1.1)).normalized()
            from .kit import look_mat
            from mathutils import Matrix
            with k.mat(Matrix.Translation(p) @ look_mat(nrm)):
                k.cyl(T(tier, 0.095, 0.085, 0.08, 0.08), 0.07, P.team if tier < 4 else P.pearl, seg=6, loc=(0, 0, 0.0))
                op = 0.05 if (spawn and i % 2 == 0) else 0.035
                k.cyl(op, 0.08, P.black if tier < 3 else P.team_dk, seg=6, loc=(0, 0, 0.005), outline=0)
                if spawn and i % 2 == 0:
                    k.ball(0.03, P.glow if tier == 4 else P.team_lt, loc=(0, 0, 0.05), outline=0.005)
        if tier == 1:
            k.torus(0.13, 0.03, P.team, loc=(-0.02, 0, 0.3))
        if tier >= 2:
            k.cyl(0.11, 0.06, P.team, loc=(-0.02, 0, 0.36), seg=6)
            k.cyl(0.06, 0.07, P.black, loc=(-0.02, 0, 0.37), seg=6, outline=0)
        if tier >= 3:
            for i in range(8):
                a = 2 * math.pi * i / 8
                p = V((math.cos(a) * 0.3, math.sin(a) * 0.3, 0.05))
                k.spike(p, p + V((math.cos(a) * 0.14, math.sin(a) * 0.14, 0.16)), 0.035, P.bone)
        if tier == 4:
            c = V((-0.02, 0, 0.36))
            for i in range(5):
                a = 2 * math.pi * i / 5
                k.crystal_at(c + V((math.cos(a) * 0.05, math.sin(a) * 0.05, 0)), c + V((math.cos(a) * 0.14, math.sin(a) * 0.14, 0.18)), 0.04, P.glow)
            k.crystal_at(c, c + V((0, 0, 0.26)), 0.06, P.glow_lt)
        if spawn:
            with k.at((0.32, -0.12, 0.05), scale=0.8):
                bug(k, P, 1, True)


# ================================================================== 11 stormcaller
def bolt(k, P, a, b, mat, jag=0.05, n=5, seed=1):
    a, b = V(a), V(b)
    d = b - a
    side = V((-d.y, d.x, 0)).normalized()
    pts = [a]
    for i in range(1, n):
        f = i / n
        j = jag * (1 if (i + seed) % 2 else -1)
        pts.append(a + d * f + side * j)
    pts.append(b)
    k.tube(pts, 0.016, mat, r_end=0.008, outline=0, sides=6)


@unit("storm", 0.27)
def storm(k, P, tier, pose):
    S = hum_scale(0.27, tier)
    atk = pose == "attack"
    lk = look_for(tier, head=T(tier, "hood", "hood", "hood", "hood"), torso="team", pads=T(tier, None, "steel", "gold", "crystal"),
                  chest=T(tier, None, None, "dark", "pearl"), cape=T(tier, None, "short", "long", "energy"), legs="team_dk",
                  belt=T(tier, "leather", "copper", "gold", "gold"))
    hand = V((0.34, -0.1, 0.5)) if atk else V((0.15, -0.2, 0.3))
    top = V((0.5, -0.1, 0.62)) if atk else V((0.22, -0.24, 0.75))
    off = V((0.28, 0.14, 0.44)) if atk else V((0.12, 0.19, 0.32))
    with k.at(scale=S, rot=(0, 0, 0)):
        humanoid(k, P, tier, {"R": hand, "L": off}, lk)
        H.staff(k, P, hand, top, tier, shaft=T(tier, P.wood, P.wood_dk, P.dark, P.pearl))
        emblem(k, P, "bolt", P.fire if tier < 4 else P.glow_lt)
        k.torus(0.12, 0.025, P.copper if tier < 3 else P.gold, loc=(0.0, 0, 0.45), scale=(0.95, 1.2, 1))
        k.ball(T(tier, 0.045, 0.05, 0.055, 0.065), P.zap if tier < 4 else P.glow_lt, loc=top + V((0, 0, 0.035)), outline=0.006)
        if tier == 1:
            k.tube([top + V((0, 0, -0.05)), top + V((0.02, 0.02, -0.02)), top + V((0, -0.02, 0.01)), top + V((0.02, 0, 0.04))], 0.012, P.copper)
        else:
            if tier >= 3:
                for i in range(3):
                    a = 2 * math.pi * i / 3
                    k.spike(top + V((0, 0, -0.04)), top + V((math.cos(a) * 0.05, math.sin(a) * 0.05, 0.05)), 0.012, P.gold)
            k.ball(T(tier, 0, 0.04, 0.05, 0.06), P.zap if tier < 4 else P.glow_lt, loc=top + V((0, 0, 0.03)), outline=0.006)
        if tier == 4:
            H.crown(k, P, H.HEAD + V((0, 0, 0.12)), R=0.08)
            H.orbit_shards(k, P, V((0, 0, 0.3)), 0.28, n=4, h=0.08)
        if atk:
            o = top + V((0.03, 0, 0.03))
            bolt(k, P, o, o + V((0.26, 0.02, -0.1)), P.zap if tier < 4 else P.glow_lt, seed=tier)
            bolt(k, P, o, o + V((0.18, 0.12, -0.1)), P.zap if tier < 4 else P.glow_lt, seed=tier + 1, n=4)
            k.ball(0.05, P.white, loc=o, outline=0)


# ================================================================== 12 golem
def rock(k, mat, c, r, scale=(1, 1, 1), rot=None):
    return k.ball(r, mat, loc=c, scale=scale, rot=rot, subdiv=1, smooth=False)


@unit("golem", 0.55)
def golem(k, P, tier, pose):
    S = 0.55 / 0.5 * T(tier, 0.9, 1.0, 1.07, 1.14)
    atk = pose == "attack"
    st = T(tier, P.stone, P.stone, P.stone, P.stone_dk)
    with k.at(scale=S):
        # legs
        for s in (1, -1):
            gx, gz = H.step(0.0 if s > 0 else 0.5, stride=0.09, lift=0.05)
            rock(k, P.stone_dk, (gx, s * 0.16, 0.15 + gz), 0.155, scale=(1, 1, 1.2))
        with k.at((0, 0, 0.12)):
            # torso boulders
            rock(k, st, (0, 0, 0.42), 0.27, scale=(0.95, 1.15, 0.9))
            rock(k, P.stone_dk, (-0.12, 0, 0.48), 0.2, scale=(1, 1.2, 0.9), rot=(0, 0, 20))
            # head
            hp = V((0.22, 0, 0.78))
            rock(k, st, hp, 0.14, scale=(1.1, 1.15, 0.95))
            k.box((0.05, 0.2, 0.04), P.stone_dk, loc=hp + V((0.08, 0, 0.06)), bevel=0.015)
            for s in (1, -1):
                k.sphere(0.028, P.glow_lt if tier == 4 else (P.fire if tier >= 2 else P.team_lt), loc=hp + V((0.12, s * 0.05, 0.0)), outline=0)
            # shoulders + arms + fists
            for s in (1, -1):
                sh = V((0.0, s * 0.33, 0.55))
                rock(k, st, sh, 0.15, scale=(1.05, 1, 0.9))
                if atk:
                    fist = V((0.42, s * 0.18, 0.4))
                else:
                    fist = V((0.18, s * 0.44, 0.22))
                el = (sh + fist) / 2 + V((-0.04 if atk else -0.05, s * 0.06, 0.05))
                rock(k, P.stone_dk, el, 0.1)
                rock(k, st, fist, T(tier, 0.13, 0.14, 0.15, 0.16), scale=(1.15, 1, 0.9))
                if tier >= 2:
                    k.torus(0.16, 0.022, P.iron if tier == 2 else P.gold, loc=sh + V((0, 0, -0.02)), scale=(1.05, 1, 1))
                    k.torus(0.12, 0.02, P.iron if tier < 3 else P.gold, loc=el, rot=(0, 70, s * 30))
                if tier >= 3:
                    k.sphere(0.15, T(tier, None, None, P.steel, P.pearl), loc=sh + V((0, s * 0.02, 0.07)), scale=(1.1, 1.0, 0.55))
                    for i in range(3):
                        k.spike(sh + V((-0.04 + i * 0.05, s * 0.06, 0.1)), sh + V((-0.06 + i * 0.05, s * 0.13, 0.24)), 0.025,
                                P.gold if tier == 3 else P.glow)
            # team glyph / bands on chest
            if tier == 1:
                k.cyl(0.07, 0.02, P.team, loc=(0.14, 0, 0.62), rot=(0, 30, 0), seg=6)
                for s in (1, -1):
                    k.cyl(0.075, 0.03, P.team, loc=(0.0, s * 0.33, 0.68), seg=6)
                k.box((0.16, 0.08, 0.04), P.team, loc=(-0.12, 0, 0.66), rot=(0, 0, 0), bevel=0.015)
            elif tier == 2:
                k.torus(0.28, 0.025, P.iron, loc=(0, 0, 0.44), scale=(0.95, 1.15, 1))
                k.box((0.1, 0.42, 0.05), P.team, loc=(0.0, 0, 0.66), bevel=0.02)
            elif tier == 3:
                k.box((0.26, 0.5, 0.06), P.steel, loc=(0.02, 0, 0.66), bevel=0.03)
                k.box((0.12, 0.32, 0.07), P.team, loc=(0.02, 0, 0.67), bevel=0.02)
                k.prism([(0, 0.08), (-0.25, 0.08), (-0.2, 0.0), (-0.25, -0.08), (0, -0.08)], 0.016, P.team, loc=(-0.24, 0.0, 0.6), rot=(0, -30, 0))
            else:
                k.crystal_at(V((-0.02, 0, 0.55)), V((0.06, 0, 0.82)), 0.09, P.glow_lt)
                for i in range(6):
                    a = 2 * math.pi * i / 6
                    p = V((-0.08 + math.cos(a) * 0.14, math.sin(a) * 0.2, 0.62))
                    k.crystal_at(p, p + V((math.cos(a) * 0.06 - 0.06, math.sin(a) * 0.08, 0.16)), 0.035, P.glow)
                k.tube([V((0.15, -0.2, 0.62)), V((0.05, -0.05, 0.68)), V((0.12, 0.12, 0.66)), V((0.05, 0.22, 0.6))], 0.014, P.glow_lt, outline=0, smooth_n=2)
            if atk:
                for s in (1, -1):
                    spark(k, P, V((0.56, s * 0.18, 0.4)), 0.06, mat=P.white if tier < 4 else P.glow_lt)


# ================================================================== 13 sapper
def pick(k, P, grip, d, tier, length=0.3):
    with k.mat(H.frame_dir(d, origin=grip)):
        k.rod((-0.06, 0, 0), (length, 0, 0), 0.016, P.wood if tier < 4 else P.pearl)
        head = T(tier, P.iron, P.steel, P.steel, P.glow_lt)
        k.tube([V((length - 0.01, -0.13, 0.0)), V((length + 0.02, 0, 0.0)), V((length - 0.01, 0.13, 0.0))], 0.025, head, r_end=0.008, smooth_n=3)
        k.box((0.05, 0.05, 0.05), P.iron_dk if tier < 3 else P.gold, loc=(length + 0.01, 0, 0), bevel=0.01)


@unit("sapper", 0.26)
def sapper(k, P, tier, pose):
    S = hum_scale(0.26, tier)
    atk = pose == "attack"
    lk = look_for(tier, head=T(tier, "cap", "helm", "helm", "helm"), crest=None, cape=T(tier, None, None, None, "energy"),
                  chest=T(tier, "leather", "leather", "steel", "pearl"), pads=T(tier, None, "steel", "gold", "crystal"))
    hand = V((0.28, -0.08, 0.42)) if atk else V((0.16, -0.2, 0.3))
    d = V((1, 0.1, -0.5)).normalized() if atk else V((0.3, -0.3, 1)).normalized()
    with k.at(scale=S):
        humanoid(k, P, tier, {"R": hand, "L": hand + V((-0.04, 0.12, 0.0)) if atk else V((0.12, 0.2, 0.3))}, lk)
        pick(k, P, hand, d, tier, T(tier, 0.24, 0.28, 0.32, 0.36))
        # lamp on the helmet + goggles
        if tier >= 2:
            k.cyl(0.03, 0.04, P.iron_dk, loc=H.HEAD + V((0.1, 0, 0.07)), rot=(0, 70, 0))
            k.sphere(0.024, P.fire if tier < 4 else P.glow_lt, loc=H.HEAD + V((0.125, 0, 0.075)), outline=0)
        for s in (1, -1):
            k.cyl(0.026, 0.02, P.copper if tier < 3 else P.gold, loc=H.HEAD + V((0.095, s * 0.04, 0.03)), rot=(0, 75, 0))
        # pack of charges
        k.box((0.12, 0.2, 0.15), P.leather_dk, loc=(-0.13, 0, 0.36), bevel=0.025)
        for s in (-1, 1):
            k.cyl(0.03, 0.14, P.team, loc=(-0.13, s * 0.06, 0.48), seg=10)
        if tier >= 3:
            k.box((0.13, 0.24, 0.03), P.gold if tier == 3 else P.pearl, loc=(-0.13, 0, 0.45), bevel=0.01)
        if tier == 4:
            H.orbit_shards(k, P, V((0, 0, 0.18)), 0.3, n=5, h=0.08)
        if atk:
            tipp = hand + d * 0.36
            spark(k, P, tipp, 0.05, mat=P.white if tier < 4 else P.glow_lt)
            for i in range(4):
                a = 2 * math.pi * i / 4 + 0.4
                rock(k, P.mud_dk, tipp + V((math.cos(a) * 0.09, math.sin(a) * 0.09, 0.0)), 0.025)


# ================================================================== 14 harrier (flying)
def wing(k, P, tier, s, sweep, span, flap=0.0):
    """One wing from the shoulder outwards. s=+1 left wing (+Y). flap > 0 raises the wing (degrees)."""
    base = V((0.02, s * 0.06, 0.45))
    feathers = T(tier, P.feather, P.feather, P.feather, P.pearl)
    tip_col = T(tier, P.team, P.team, P.team, P.glow)
    with k.at(base, rot=(s * flap, 0, s * sweep)):
        pts = [(0.06, 0.0), (0.04, s * span * 0.55), (-0.02, s * span), (-0.12, s * span * 0.92), (-0.14, s * span * 0.6), (-0.16, s * span * 0.3), (-0.12, 0.0)]
        if s < 0:
            pts = pts[::-1]
        k.prism(pts, 0.025, feathers, bevel=0.006)
        # primary feathers
        for i in range(4):
            f = 0.55 + i * 0.13
            y = s * span * f
            k.prism([(0.0, y - s * 0.02), (0.0, y + s * 0.03), (-0.24 - 0.03 * i, y + s * 0.05), (-0.22 - 0.03 * i, y)] if s > 0 else
                    [(-0.22 - 0.03 * i, y), (-0.24 - 0.03 * i, y + s * 0.05), (0.0, y + s * 0.03), (0.0, y - s * 0.02)],
                    0.016, tip_col if i >= 2 else feathers, loc=(-0.02, 0, 0.012), bevel=0.004)
        if tier >= 3:
            k.tube([V((0.06, s * 0.02, 0.016)), V((0.05, s * span * 0.5, 0.016)), V((-0.02, s * span, 0.016))], 0.012, P.gold if tier == 3 else P.glow_lt, smooth_n=2, outline=0.005)


@unit("harrier", 0.3)
def harrier(k, P, tier, pose):
    S = 0.3 / 0.3 * T(tier, 0.85, 1.0, 1.1, 1.2)
    dive = pose == "attack"
    body = T(tier, P.feather, P.feather, P.feather, P.pearl)
    with k.at(scale=S):
        span = T(tier, 0.36, 0.42, 0.46, 0.5) * (0.82 if dive else 1.0)
        flap = 0.0 if H.gait() is None else 32.0 * math.cos(2 * math.pi * H.gait())
        for s in (1, -1):
            wing(k, P, tier, s, 38 if dive else -6, span, flap=flap)
        k.sphere(1.0, body, loc=(0, 0, 0.45), scale=(0.2, 0.1, 0.09))
        k.sphere(1.0, P.feather_lt, loc=(0.02, 0, 0.41), scale=(0.17, 0.08, 0.07))
        # tail fan
        tail = T(tier, P.feather, P.feather, P.feather, P.pearl)
        k.prism([(0, 0.03), (0, -0.03), (-0.2, -0.1), (-0.24, 0.0), (-0.2, 0.1)], 0.02, tail, loc=(-0.14, 0, 0.45), bevel=0.005)
        k.prism([(0, 0.02), (0, -0.02), (-0.12, -0.05), (-0.14, 0), (-0.12, 0.05)], 0.022, P.team if tier < 4 else P.glow, loc=(-0.24, 0, 0.452), bevel=0.004)
        # head + beak
        hp = V((0.22, 0, 0.48)) if not dive else V((0.26, 0, 0.44))
        k.sphere(0.075, body, loc=hp)
        k.sphere(0.06, P.feather_lt, loc=hp + V((0.025, 0, -0.02)))
        k.cone(0.03, 0.08, P.gold, loc=hp + V((0.06, 0, -0.005)), rot=(0, 100, 0))
        for s in (1, -1):
            k.sphere(0.014, P.eye if tier < 4 else P.glow_lt, loc=hp + V((0.05, s * 0.045, 0.02)), outline=0)
        # harness / saddle in team colour
        k.torus(0.1, 0.02, P.team, loc=(0.05, 0, 0.45), rot=(0, 90, 0), scale=(1, 1.0, 1.0))
        k.sphere(1.0, P.team, loc=(-0.02, 0, 0.53), scale=(0.08, 0.07, 0.03))
        if tier >= 2:
            k.sphere(0.078, P.iron if tier == 2 else (P.steel if tier == 3 else P.gold), loc=hp + V((0.0, 0, 0.012)), scale=(1.05, 0.95, 0.8))
        if tier >= 3:
            k.tube([hp + V((-0.02, 0, 0.07)), hp + V((-0.1, 0, 0.1)), hp + V((-0.18, 0, 0.07))], 0.02, P.team if tier == 3 else P.glow, r_end=0.008, smooth_n=2)
        if tier == 4:
            for i, a in enumerate((-30, 0, 30)):
                d = V((-math.cos(math.radians(a)), math.sin(math.radians(a)), 0.5)).normalized()
                k.crystal_at(hp + V((-0.03, 0, 0.06)), hp + V((-0.03, 0, 0.06)) + d * 0.14, 0.025, P.glow_lt, sides=4, mid=0.5)
        # talons
        if dive:
            for s in (1, -1):
                k.rod(V((0.05, s * 0.05, 0.38)), V((0.2, s * 0.06, 0.3)), 0.016, P.gold)
                for j in (-1, 0, 1):
                    k.spike(V((0.2, s * 0.06, 0.3)), V((0.26, s * 0.06 + j * 0.03, 0.28)), 0.01, P.darker)


# ================================================================== 15 standard bearer
@unit("banner", 0.26)
def banner(k, P, tier, pose):
    S = hum_scale(0.26, tier)
    atk = pose == "attack"
    lk = look_for(tier, head=T(tier, "hair", "helm", "helm", "helm"), crest=T(tier, None, "team", "plume", "plume"),
                  cape=T(tier, None, None, "long", "energy"))
    h1, h2 = (V((0.2, -0.12, 0.42)), V((0.14, -0.02, 0.52))) if atk else (V((0.1, -0.16, 0.34)), V((0.13, -0.1, 0.48)))
    with k.at(scale=S):
        humanoid(k, P, tier, {"R": h1, "L": h2}, lk)
        up = V((0.5, -0.25, 0.85)).normalized() if atk else V((-0.3, -0.22, 1)).normalized()
        foot = h1 - up * 0.15
        L = T(tier, 0.75, 0.85, 0.9, 0.95)
        top = h1 + up * L
        k.rod(foot, top, 0.018, T(tier, P.wood, P.wood_dk, P.wood_dk, P.pearl))
        # flag streams backwards nearly horizontal so it reads from above
        fw = T(tier, 0.22, 0.32, 0.36, 0.4)
        fl = T(tier, 0.28, 0.36, 0.42, 0.46)
        with k.at(top - up * 0.04, rot=(0, 0, 180)):
            with k.at((0, 0, 0), rot=(22, 0, 0)):
                if tier == 1:
                    pts = [(0, 0), (fl, -fw * 0.25), (0, -fw * 0.5)]
                elif tier == 2:
                    pts = [(0, 0), (fl, 0), (fl * 0.85, -fw * 0.5), (fl, -fw), (0, -fw)]
                else:
                    pts = [(0, 0), (fl, 0), (fl * 1.1, -fw * 0.2), (fl * 0.85, -fw * 0.45), (fl * 1.1, -fw * 0.7), (fl, -fw), (0, -fw)]
                k.prism(pts[::-1], 0.018, P.team, bevel=0.005)
                if tier >= 2:
                    c = (fl * 0.45, -fw * 0.5)
                    k.cyl(fw * 0.22, 0.03, T(tier, None, P.cloth, P.gold, P.glow_lt), loc=(c[0], c[1], 0.0), seg=16)
                    if tier >= 3:
                        k.crystal(fw * 0.1, 0.04, P.team_dk if tier == 3 else P.glow, loc=(c[0], c[1], 0.012))
                if tier >= 3:
                    k.box((0.02, fw, 0.03), P.gold, loc=(0.01, -fw / 2, 0))
        if tier == 1:
            k.sphere(0.025, P.wood_dk, loc=top)
        elif tier == 2:
            k.cone(0.03, 0.08, P.iron, loc=top)
        else:
            k.cone(0.035, 0.1, P.gold, loc=top)
            k.torus(0.07, 0.014, P.gold if tier == 3 else P.glow_lt, loc=top + V((0, 0, 0.04)), rot=(90, 0, 0))
            if tier == 4:
                k.ball(0.04, P.glow_lt, loc=top + V((0, 0, 0.04)), outline=0)
        if tier == 4:
            H.halo(k, P, top + V((0, 0, 0.08)), R=0.14)


# ================================================================== 16 rimecaller
@unit("rime", 0.27)
def rime(k, P, tier, pose):
    S = hum_scale(0.27, tier)
    atk = pose == "attack"
    lk = look_for(tier, head="hood", torso="team", pads=T(tier, None, "cloth", "gold", "crystal"),
                  chest=T(tier, None, "fur", "ice", "pearl"), cape=T(tier, None, "short", "long", "energy"), legs="team_dk", belt="leather_dk")
    hand = V((0.34, -0.1, 0.48)) if atk else V((0.15, -0.2, 0.3))
    top = V((0.5, -0.12, 0.6)) if atk else V((0.2, -0.24, 0.74))
    off = V((0.26, 0.14, 0.44)) if atk else V((0.12, 0.19, 0.32))
    with k.at(scale=S):
        humanoid(k, P, tier, {"R": hand, "L": off}, lk)
        # fur collar
        k.torus(0.11, 0.045, P.fur, loc=(0.0, 0, 0.44), scale=(0.95, 1.2, 1))
        emblem(k, P, "flake", P.ice if tier < 4 else P.ice_glow)
        for sd in (1, -1):
            sp = V((0.0, sd * 0.17, 0.44))
            k.crystal_at(sp, sp + V((-0.03, sd * 0.05, 0.1 + 0.02 * tier)), 0.03, P.ice if tier < 4 else P.ice_glow)
        H.staff(k, P, hand, top, tier, shaft=T(tier, P.wood, P.wood_dk, P.ice_dk, P.pearl))
        d = (top - hand).normalized()
        k.crystal_at(top - d * 0.03, top + d * T(tier, 0.08, 0.11, 0.13, 0.15), T(tier, 0.025, 0.032, 0.038, 0.045), P.ice if tier < 4 else P.ice_glow)
        if tier >= 3:
            for i in range(5):
                a = math.pi * (0.3 + 0.35 * i)
                p = H.HEAD + V((math.cos(a) * 0.09 - 0.01, math.sin(a) * 0.09, 0.08))
                k.crystal_at(p, p + V((0, 0, 0.08)), 0.018, P.ice if tier == 3 else P.ice_glow)
        if tier == 4:
            H.orbit_shards(k, P, V((0, 0, 0.32)), 0.3, n=6, h=0.1, mat=P.ice_glow)
            H.halo(k, P, H.HEAD + V((0, 0, 0.2)), R=0.1)
        if atk:
            o = top + d * 0.12
            k.crystal_at(o + V((0.04, 0, 0)), o + V((0.22, 0.0, -0.04)), 0.04, P.ice_glow)
            for s in (1, -1):
                k.crystal_at(o + V((0.02, s * 0.04, 0)), o + V((0.16, s * 0.1, -0.02)), 0.022, P.ice_glow, outline=0.004)


# ================================================================== 17 ravager
@unit("ravager", 0.3)
def ravager(k, P, tier, pose):
    S = hum_scale(0.3, tier) * 0.84
    atk = pose == "attack"
    lk = look_for(tier, torso="skin", arms="skin", head=T(tier, "hair", "helm", "helm", "helm"), crest=None,
                  pads=T(tier, None, "cloth", "spiked", "crystal"), chest=None, belt=T(tier, "leather", "leather_dk", "iron", "gold"),
                  legs=T(tier, "team", "team", "team_dk", "team_dk"), cape=None, gloves=T(tier, "leather", "leather", "iron", "gold"))
    if atk:
        r_h, l_h = V((0.3, -0.2, 0.42)), V((0.3, 0.2, 0.42))
        rd, ld = H.dir2(-15, 0.1), H.dir2(15, 0.1)
    else:
        r_h, l_h = V((0.12, -0.25, 0.3)), V((0.12, 0.25, 0.3))
        rd, ld = H.dir2(-35, 0.6), H.dir2(35, 0.6)
    with k.at(scale=S):
        humanoid(k, P, tier, {"R": r_h, "L": l_h}, lk, bulk=1.2)
        # fur mantle across the shoulders + war paint (team) stripes
        k.torus(0.15, 0.065, P.team, loc=(-0.02, 0, 0.43), scale=(0.75, 1.15, 0.8))
        k.torus(0.15, 0.03, P.fur if tier < 4 else P.glow_lt, loc=(-0.02, 0, 0.47), scale=(0.75, 1.15, 0.8), outline=0.006)
        k.box((0.06, 0.3, 0.02), P.team, loc=(0.08, 0, 0.42), rot=(0, 25, 0), outline=0.006)
        if tier >= 2:
            for s in (1, -1):
                hc = H.HEAD + V((-0.0, s * 0.1, 0.05))
                k.tube([hc, hc + V((0.02, s * 0.06, 0.05)), hc + V((0.08, s * 0.08, 0.1))], T(tier, 0, 0.026, 0.03, 0.03),
                       P.bone if tier < 4 else P.glow, r_end=0.006, smooth_n=3)
        axes = [(r_h, rd)] + ([(l_h, ld)] if tier >= 2 else [])
        for hand, d in axes:
            H.axe(k, P, hand, d, T(tier, 0.2, 0.22, 0.26, 0.28), tier, double=tier >= 3)
        if tier == 1:
            k.sphere(0.035, P.hair, loc=H.HEAD + V((-0.1, 0, 0.0)))
        if tier == 4:
            k.torus(0.2, 0.012, P.glow_lt, loc=(0, 0, 0.3), outline=0)
        if atk:
            arc_fx(k, P, tier, 0.6, -60, -10, 0.4)
            arc_fx(k, P, tier, 0.6, 10, 60, 0.4)


# ================================================================== 18 gravecaller
def skull(k, P, c, r, eyes=None, mat=None):
    c = V(c)
    k.sphere(r, mat or P.bone, loc=c, scale=(1.05, 0.95, 0.95))
    k.sphere(r * 0.7, mat or P.bone, loc=c + V((r * 0.45, 0, -r * 0.45)), scale=(0.9, 0.9, 0.7))
    for s in (1, -1):
        k.sphere(r * 0.24, eyes or P.black, loc=c + V((r * 0.85, s * r * 0.38, -r * 0.05)), outline=0)


@unit("grave", 0.27)
def grave(k, P, tier, pose):
    S = hum_scale(0.27, tier)
    atk = pose == "attack"
    lk = look_for(tier, head=T(tier, "hood_dark", "hood_dark", "hood_dark", "hood_dark"), torso="dark", pads=T(tier, None, None, "gold", "crystal"),
                  chest=T(tier, None, "bone", "bone", "bone"), cape=T(tier, None, "short", "long", "energy"), legs="darker", boots="darker",
                  belt="team", arms="dark", gloves="bone")
    hand = V((0.3, -0.12, 0.52)) if atk else V((0.15, -0.2, 0.3))
    top = V((0.4, -0.14, 0.78)) if atk else V((0.2, -0.24, 0.76))
    off = V((0.3, 0.16, 0.5)) if atk else V((0.12, 0.19, 0.32))
    eyes = P.glow if tier >= 3 else P.team
    with k.at(scale=S):
        humanoid(k, P, tier, {"R": hand, "L": off}, lk)
        H.staff(k, P, hand, top, tier, shaft=T(tier, P.bone_dk, P.bone_dk, P.darker, P.pearl))
        skull(k, P, top + V((0, 0, 0.04)), T(tier, 0.04, 0.05, 0.055, 0.06), eyes=eyes)
        # cape is team-dark under, team trim; ribcage pauldrons from tier 2
        if tier >= 2:
            for s in (1, -1):
                for i in range(3):
                    k.tube([V((-0.04 + i * 0.04, s * 0.11, 0.47)), V((-0.04 + i * 0.04, s * 0.2, 0.44)), V((-0.04 + i * 0.04, s * 0.22, 0.38))], 0.012, P.bone, smooth_n=2)
        if tier >= 3:
            H.crown(k, P, H.HEAD + V((-0.01, 0, 0.11)), R=0.085, mat=P.bone)
        if tier == 4:
            for i in range(3):
                a = 2 * math.pi * i / 3 + 0.8
                skull(k, P, V((math.cos(a) * 0.32, math.sin(a) * 0.32, 0.55)), 0.045, eyes=P.glow_lt)
                k.ball(0.03, P.glow, loc=V((math.cos(a) * 0.32 - 0.06, math.sin(a) * 0.32, 0.55)), outline=0)
        if atk:
            k.ball(0.07, P.glow if tier == 4 else P.violet_glow, loc=off + V((0.05, 0, 0.06)), outline=0)
            k.torus(0.1, 0.01, P.violet_glow if tier < 4 else P.glow_lt, loc=off + V((0.05, 0, 0.06)), outline=0)


# ================================================================== 19 bombard
@unit("bombard", 0.42)
def bombard(k, P, tier, pose):
    S = T(tier, 0.88, 1.0, 1.08, 1.16)
    fire = pose == "attack"
    wood = T(tier, P.wood, P.wood, P.wood_dk, P.pearl)
    barrel = T(tier, P.wood_dk, P.iron, P.bronze, P.pearl)
    band = T(tier, P.iron, P.iron_dk, P.gold, P.gold)
    with k.at(scale=S):
        k.box((0.56, 0.5, 0.1), wood, loc=(0, 0, 0.06), bevel=0.025)
        for s in (1, -1):
            k.box((0.5, 0.07, 0.07), P.team if tier < 4 else P.gold, loc=(0, s * 0.27, 0.07), bevel=0.018)
            k.box((0.22, 0.08, 0.2), wood, loc=(0.0, s * 0.17, 0.2), bevel=0.02)
        recoil = -0.06 if fire else 0.0
        with k.at((recoil, 0, 0.28), rot=(0, 40, 0)):
            r0 = T(tier, 0.13, 0.14, 0.15, 0.16)
            k.cyl(r0, 0.42, barrel, loc=(0, 0, 0.1), r2=r0 * 1.12, seg=20, cap=True, bevel=0.01)
            k.cyl(r0 * 0.72, 0.03, P.black, loc=(0, 0, 0.31), seg=18, outline=0)
            for z in (-0.06, 0.12, 0.28):
                k.torus(r0 * (1.0 + 0.14 * (z + 0.1)), 0.02, band, loc=(0, 0, z), seg=24)
            k.sphere(r0 * 0.9, barrel, loc=(0, 0, -0.12))
            if tier == 4:
                for z in (0.0, 0.2):
                    k.torus(r0 * 1.12, 0.012, P.glow_lt, loc=(0, 0, z + 0.04), seg=24, outline=0)
            if fire:
                with k.at((0, 0, 0.36)):
                    spark(k, P, (0, 0, 0.04), 0.1, mat=P.fire if tier < 4 else P.glow_lt, n=8)
                    for i in range(4):
                        a = 2 * math.pi * i / 4
                        k.ball(0.06, P.smoke, loc=(math.cos(a) * 0.12, math.sin(a) * 0.12, 0.08), outline=0.006)
        # shell pile + team flags
        if tier >= 2:
            for i, p in enumerate(((-0.2, 0.12), (-0.2, 0.02), (-0.13, 0.07))):
                k.ball(0.05, P.iron_dk if tier < 4 else P.pearl, loc=(p[0], p[1], 0.16))
            for s in (1, -1):
                k.box((0.03, 0.12, 0.14), P.team, loc=(0.22, s * 0.2, 0.18), bevel=0.012)
        if tier >= 3:
            k.rod(V((-0.24, -0.2, 0.1)), V((-0.24, -0.2, 0.55)), 0.012, P.wood_dk)
            k.prism([(0, 0), (-0.2, 0), (-0.16, -0.06), (-0.2, -0.12), (0, -0.12)], 0.012, P.team, loc=(-0.24, -0.2, 0.53), rot=(-20, 0, 0))
        if tier == 4:
            H.orbit_shards(k, P, V((0, 0, 0.12)), 0.33, n=6, h=0.09)


# ================================================================== 20 tinker
def wrench(k, P, grip, d, tier, L=0.22):
    with k.mat(H.frame_dir(d, origin=grip)):
        k.box((L, 0.035, 0.025), T(tier, P.iron, P.steel, P.steel, P.pearl), loc=(L / 2 - 0.04, 0, 0), bevel=0.008)
        k.torus(0.045, 0.018, T(tier, P.iron, P.steel, P.gold, P.glow_lt), loc=(L - 0.02, 0, 0), arc=280, rot=(0, 0, 40))


def gear(k, P, c, r, mat, rot=(0, 0, 0), teeth=8):
    with k.at(c, rot=rot):
        k.cyl(r, 0.03, mat, seg=teeth * 2)
        for i in range(teeth):
            a = 2 * math.pi * i / teeth
            k.box((0.035, 0.03, 0.03), mat, loc=(math.cos(a) * r, math.sin(a) * r, 0), rot=(0, 0, math.degrees(a)), outline=0.006)
        k.cyl(r * 0.35, 0.04, P.iron_dk, outline=0.005)


@unit("tinker", 0.25)
def tinker(k, P, tier, pose):
    S = hum_scale(0.25, tier)
    atk = pose == "attack"
    lk = look_for(tier, head=T(tier, "cap", "helm", "helm", "helm"), crest=None, cape=T(tier, None, None, None, "energy"),
                  chest=T(tier, "leather", "leather", "leather", "pearl"), pads=T(tier, None, "steel", "gold", "crystal"))
    hand = V((0.3, -0.1, 0.5)) if atk else V((0.16, -0.2, 0.3))
    d = V((0.6, 0.0, -0.8)).normalized() if atk else V((0.5, -0.3, 0.8)).normalized()
    with k.at(scale=S):
        humanoid(k, P, tier, {"R": hand, "L": V((0.2, 0.12, 0.34))}, lk)
        wrench(k, P, hand, d, tier, T(tier, 0.2, 0.22, 0.24, 0.26))
        for s in (1, -1):
            k.cyl(0.028, 0.02, P.copper if tier < 3 else P.gold, loc=H.HEAD + V((0.09 if tier == 1 else 0.06, s * 0.04, 0.06 if tier == 1 else 0.09)),
                  rot=(0, 75 if tier == 1 else 30, 0))
        # backpack with gears
        k.box((0.13, 0.22, 0.18), P.leather_dk if tier < 3 else P.iron, loc=(-0.14, 0, 0.38), bevel=0.025)
        gear(k, P, V((-0.14, 0.0, 0.49)), T(tier, 0.06, 0.07, 0.08, 0.08), P.copper if tier < 3 else P.gold)
        if tier >= 2:
            gear(k, P, V((-0.2, -0.09, 0.47)), 0.045, P.team)
        if tier >= 3:
            # mech arm over the shoulder
            k.tube([V((-0.15, 0.1, 0.48)), V((-0.08, 0.18, 0.62)), V((0.12, 0.18, 0.58))], 0.022, P.iron, smooth_n=2)
            for s in (1, -1):
                k.spike(V((0.12, 0.18, 0.58)), V((0.19, 0.18 + s * 0.03, 0.55)), 0.016, P.steel)
        if tier == 4:
            k.torus(0.15, 0.012, P.glow_lt, loc=H.HEAD + V((0, 0, 0.16)), outline=0)
            for i in range(4):
                a = 2 * math.pi * i / 4
                gear(k, P, H.HEAD + V((math.cos(a) * 0.15, math.sin(a) * 0.15, 0.16)), 0.03, P.glow, teeth=6)
        if atk:
            spark(k, P, hand + d * 0.24, 0.05, mat=P.fire if tier < 4 else P.glow_lt)


# ================================================================== 21 duelist
@unit("duelist", 0.24)
def duelist(k, P, tier, pose):
    S = hum_scale(0.24, tier)
    atk = pose == "attack"
    lk = look_for(tier, head=T(tier, "hair", "hat", "hat", "hat"), crest=None, pads=T(tier, None, None, "gold", "crystal"),
                  chest=T(tier, None, "cloth", "pearl", "pearl"), cape=T(tier, None, None, "short", "energy"), legs="darker", boots="leather_dk")
    if atk:
        hand, d, off = V((0.42, -0.06, 0.42)), H.dir2(2, -0.02), V((-0.12, 0.2, 0.42))
    else:
        hand, d, off = V((0.2, -0.17, 0.34)), H.dir2(25, 0.12), V((0.04, 0.22, 0.28))
    L = T(tier, 0.36, 0.4, 0.44, 0.48)
    with k.at(scale=S):
        humanoid(k, P, tier, {"R": hand, "L": off}, lk, lean=12 if atk else 0, bulk=0.92)
        with k.mat(H.frame_dir(d, origin=hand)):
            k.rod((-0.06, 0, 0), (0.0, 0, 0), 0.014, P.leather_dk)
            k.torus(0.04, 0.009, T(tier, P.iron, P.steel, P.gold, P.gold), loc=(0.0, 0, 0), rot=(0, 90, 0))
            k.rod((0.0, 0, 0), (L, 0, 0), 0.012, T(tier, P.iron, P.steel, P.steel, P.glow_lt), r2=0.004)
        if tier >= 2:
            # feather plume on the hat
            k.tube([H.HEAD + V((0.0, 0.05, 0.1)), H.HEAD + V((-0.1, 0.1, 0.13)), H.HEAD + V((-0.2, 0.08, 0.1))], 0.03,
                   T(tier, None, P.cloth, P.team_lt, P.glow), r_end=0.008, smooth_n=3)
        if tier >= 2 and not atk:
            H.round_shield(k, P, off + V((0.02, 0.02, 0.02)), V((0.7, 0.3, 0.6)), 0.07, tier)
        if tier == 4:
            H.halo(k, P, H.HEAD + V((0, 0, 0.2)), R=0.1)
        if atk:
            k.tube([hand + V((0.05, 0, 0)), hand + V((L + 0.15, 0, 0))], 0.012, P.white if tier < 4 else P.glow_lt, r_end=0.002, outline=0)


# ================================================================== 22 pikeman
@unit("pikeman", 0.27)
def pikeman(k, P, tier, pose):
    S = hum_scale(0.27, tier) * 0.95
    atk = pose == "attack"
    lk = look_for(tier, head=T(tier, "cap", "helm", "helm", "helm"), crest=T(tier, None, None, "plume", "plume"),
                  cape=T(tier, None, None, "short", "energy"), pads=T(tier, None, "steel", "gold", "crystal"))
    if atk:
        rh, lh = V((0.08, -0.08, 0.36)), V((0.3, -0.04, 0.38))
        d = V((1, 0.04, -0.04)).normalized()
    else:
        rh, lh = V((0.1, -0.16, 0.32)), V((0.24, -0.1, 0.4))
        d = V((1, 0.04, 0.5)).normalized()
    with k.at(scale=S):
        humanoid(k, P, tier, {"R": rh, "L": lh}, lk)
        L = T(tier, 0.62, 0.7, 0.74, 0.78)
        tip = H.spear(k, P, rh, d, L, tier, back=0.22, head_len=0.13)
        if tier >= 3:
            base = V(rh) + d * (L * 0.72)
            k.prism([(0, 0), (-0.14, 0), (-0.1, -0.05), (-0.14, -0.1), (0, -0.1)], 0.012, P.team, loc=base + V((0, 0.0, -0.01)), rot=(20, 0, 0))
        if tier == 2:
            k.cyl(0.155, 0.014, P.steel, loc=H.HEAD + V((0, 0, 0.0)), seg=20)
        if tier == 4:
            H.halo(k, P, H.HEAD + V((0, 0, 0.2)), R=0.1)


# ================================================================== 23 kegrunner
def keg(k, P, c, r, h, tier, axis=(1, 0, 0), fuse=False):
    from mathutils import Matrix
    from .kit import look_mat
    with k.mat(Matrix.Translation(V(c)) @ look_mat(axis)):
        body = T(tier, P.wood, P.wood, P.wood_dk, P.pearl)
        k.cyl(r, h, body, r2=r, seg=16, bevel=0.012)
        k.sphere(r * 1.05, body, loc=(0, 0, 0), scale=(1, 1, h / r * 0.42))
        for z in (-h * 0.35, h * 0.35):
            k.torus(r * 1.04, 0.013, T(tier, P.iron_dk, P.iron, P.gold, P.gold), loc=(0, 0, z), seg=20)
        k.box((r * 0.9, 0.02, h * 0.5), P.team if tier < 4 else P.glow, loc=(r * 0.62, 0, 0), outline=0.005)
        if tier == 4:
            k.torus(r * 1.08, 0.01, P.glow_lt, loc=(0, 0, 0), seg=20, outline=0)
        k.cyl(0.012, 0.04, P.cloth_dk, loc=(0, 0, h / 2 + 0.02))
        if fuse:
            spark(k, P, (0, 0, h / 2 + 0.05), 0.045, mat=P.fire if tier < 4 else P.glow_lt)


@unit("keg", 0.25)
def kegrunner(k, P, tier, pose):
    S = hum_scale(0.25, tier)
    atk = pose == "attack"
    lk = look_for(tier, head=T(tier, "hair", "cap", "helm", "helm"), crest=None, cape=None, chest=T(tier, None, "leather", "leather", "pearl"),
                  pads=T(tier, None, None, "steel", "crystal"))
    with k.at(scale=S, rot=(0, 14 if atk else 6, 0)):
        if atk:
            hands = {"R": V((0.24, -0.11, 0.58)), "L": V((0.24, 0.11, 0.58))}
        else:
            hands = {"R": V((-0.04, -0.18, 0.56)), "L": V((-0.04, 0.18, 0.56))}
        humanoid(k, P, tier, hands, lk)
        r = T(tier, 0.1, 0.12, 0.12, 0.13)
        if atk:
            keg(k, P, V((0.28, 0, 0.66)), r, r * 2.1, tier, axis=(0, 1, 0), fuse=True)
        else:
            keg(k, P, V((-0.12, 0, 0.6)), r, r * 2.1, tier, axis=(0, 1, 0), fuse=False)
            if tier >= 3:
                keg(k, P, V((-0.27, 0, 0.5)), r * 0.85, r * 1.8, tier, axis=(0, 1, 0))
            # fuse smoulder
            k.sphere(0.02, P.fire, loc=V((-0.12, 0, 0.6 + r + 0.05)), outline=0)
        if tier == 4:
            H.orbit_shards(k, P, V((0, 0, 0.2)), 0.28, n=5, h=0.08)
        if tier >= 2:
            k.torus(0.1, 0.015, P.team, loc=H.HEAD + V((0, 0, 0.02)))


# ================================================================== 24 trickster
@unit("trickster", 0.25)
def trickster(k, P, tier, pose, ghost=False):
    S = hum_scale(0.25, tier)
    atk = pose == "attack"
    lk = look_for(tier, head="mask", torso="team", pads=T(tier, None, None, "gold", "crystal"), chest=T(tier, "dark", "dark", "darker", "pearl"),
                  cape=T(tier, None, "short", "long", "energy"), legs="darker", boots="darker", belt="gold" if tier >= 3 else "leather_dk",
                  arms="dark", gloves="pearl")
    if atk:
        hands = {"R": V((0.18, -0.3, 0.46)), "L": V((0.18, 0.3, 0.46))}
    else:
        hands = {"R": V((0.12, -0.2, 0.3)), "L": V((0.18, 0.12, 0.38))}
    with k.at(scale=S):
        humanoid(k, P, tier, hands, lk)
        # two-pointed cowl in team colour with gold bells
        for s in (1, -1):
            b = H.HEAD + V((-0.02, s * 0.05, 0.06))
            tip = H.HEAD + V((-0.16, s * 0.2, 0.0))
            k.tube([b, b + V((-0.04, s * 0.08, 0.06)), tip], 0.05, P.team if s > 0 else P.team_dk, r_end=0.01, smooth_n=3)
            k.sphere(0.022, P.gold, loc=tip)
        if tier >= 2:
            # ruff collar
            for i in range(10):
                a = 2 * math.pi * i / 10
                k.sphere(0.035, P.pearl if i % 2 else P.team, loc=(0.0 + math.cos(a) * 0.1, math.sin(a) * 0.13, 0.45), scale=(1, 1, 0.6))
        # mirror / card in the left hand
        mh = hands["L"]
        if tier >= 3 or atk:
            k.cyl(0.06, 0.015, P.gold, loc=mh + V((0.04, 0, 0.03)), rot=(0, 30, 0), seg=16)
            k.cyl(0.048, 0.02, P.ice if tier < 4 else P.glow_lt, loc=mh + V((0.04, 0, 0.035)), rot=(0, 30, 0), seg=16, outline=0)
        if tier == 4:
            H.orbit_shards(k, P, V((0, 0, 0.36)), 0.3, n=6, h=0.08, mat=P.glow_lt)
            H.crown(k, P, H.HEAD + V((0, 0, 0.12)), R=0.075)
        if atk:
            for s in (1, -1):
                o = hands["R" if s < 0 else "L"]
                for j in range(3):
                    a = math.radians(s * (20 + 25 * j))
                    p = V(o) + V((math.cos(a) * 0.12, math.sin(a) * 0.12, 0.0))
                    k.prism([(0, -0.03), (0.05, -0.03), (0.05, 0.03), (0, 0.03)], 0.01, P.pearl if j % 2 else P.team, loc=p, rot=(0, 0, math.degrees(a)))


# ================================================================== spawned bodies
def bug(k, P, tier, open_jaw, queen=False):
    shell = P.team
    k.sphere(1.0, P.chitin_dk, loc=(-0.08, 0, 0.1), scale=(0.11, 0.08, 0.07))
    k.sphere(1.0, shell, loc=(-0.08, 0, 0.12), scale=(0.1, 0.075, 0.05))
    k.sphere(1.0, P.chitin, loc=(0.03, 0, 0.1), scale=(0.06, 0.06, 0.055))
    k.sphere(0.05, P.chitin_dk, loc=(0.1, 0, 0.1))
    for s in (1, -1):
        k.sphere(0.014, P.glow_lt if queen else P.team_lt, loc=(0.135, s * 0.025, 0.12), outline=0)
        a = 30 if open_jaw else 8
        base = V((0.14, s * 0.02, 0.09))
        tip = base + V((math.cos(math.radians(s * a)) * 0.07, math.sin(math.radians(s * a)) * 0.07 + s * 0.0, 0))
        k.tube([base, base + (tip - base) * 0.6 + V((0, s * 0.012, 0)), tip], 0.012, P.bone_dk, r_end=0.004, smooth_n=2)
        for i, x in enumerate((0.06, 0.02, -0.03)):
            p0 = V((x, s * 0.04, 0.1))
            gx, gz = H.step((i % 2) * 0.5 + (0.0 if s > 0 else 0.5), stride=0.035, lift=0.025)
            k.tube([p0, p0 + V((0.02 * (1 - i) + gx * 0.5, s * 0.07, 0.03 + gz)), p0 + V((0.04 * (1 - i) - 0.02 + gx, s * 0.12, -0.08 + gz))], 0.011, P.chitin_dk, r_end=0.005, smooth_n=2)


@unit("mite", 0.15, spawned=True)
def mite(k, P, tier, pose):
    with k.at(scale=1.15):
        bug(k, P, tier, pose == "attack")


@unit("queen", 0.3, spawned=True)
def queen(k, P, tier, pose):
    with k.at(scale=2.0):
        bug(k, P, tier, pose == "attack", queen=True)
        # crown of carapace spikes + glowing abdomen
        for i in range(5):
            a = math.radians(-60 + 30 * i)
            p = V((0.03, 0, 0.14))
            k.spike(p, p + V((-math.cos(a) * 0.02 + 0.0, math.sin(a) * 0.05, 0.06)), 0.012, P.gold)
        k.sphere(1.0, P.glow, loc=(-0.12, 0, 0.14), scale=(0.05, 0.04, 0.03), outline=0)
        for s in (1, -1):
            k.prism([(0, 0), (-0.16, s * 0.06), (-0.2, s * 0.13), (-0.04, s * 0.07)], 0.008, P.glow_soft, loc=(-0.02, s * 0.02, 0.17), outline=0)


@unit("golemling", 0.36, spawned=True)
def golemling(k, P, tier, pose):
    atk = pose == "attack"
    with k.at(scale=0.36 / 0.5 * 1.05):
        for s in (1, -1):
            gx, gz = H.step(0.0 if s > 0 else 0.5, stride=0.08, lift=0.045)
            rock(k, P.stone_dk, (gx, s * 0.15, 0.12 + gz), 0.12)
        rock(k, P.stone, (0, 0, 0.4), 0.25, scale=(0.95, 1.1, 0.9))
        hp = V((0.17, 0, 0.56))
        rock(k, P.stone, hp, 0.1)
        for s in (1, -1):
            k.sphere(0.02, P.team_lt, loc=hp + V((0.09, s * 0.04, 0.0)), outline=0)
            sh = V((0.0, s * 0.3, 0.5))
            fist = V((0.4, s * 0.16, 0.36)) if atk else V((0.16, s * 0.38, 0.2))
            rock(k, P.stone, sh, 0.12)
            rock(k, P.stone, fist, 0.12)
        for i in range(4):
            a = 2 * math.pi * i / 4 + 0.4
            p = V((-0.06 + math.cos(a) * 0.1, math.sin(a) * 0.15, 0.58))
            k.crystal_at(p, p + V((math.cos(a) * 0.08 - 0.05, math.sin(a) * 0.1, 0.2)), 0.06, P.team)
        k.crystal_at(V((-0.05, 0, 0.6)), V((-0.08, 0, 0.84)), 0.07, P.team_lt)


@unit("thrall", 0.22, spawned=True)
def thrall(k, P, tier, pose):
    atk = pose == "attack"
    lk = dict(torso="bone", pads=None, head="bald", crest=None, cape=None, chest=None, belt="team", legs="bone", boots="bone_dk",
              arms="bone", halo=False, gloves="bone")
    hand = V((0.27, -0.05, 0.38)) if atk else V((0.18, -0.18, 0.3))
    d = H.dir2(55, -0.05) if atk else H.dir2(-15, 0.12)
    with k.at(scale=hum_scale(0.22, 1) * 1.05):
        humanoid(k, P, 1, {"R": hand, "L": V((0.12, 0.2, 0.3))}, lk, bulk=0.85)
        skull(k, P, H.HEAD + V((0.0, 0, 0.0)), 0.11, eyes=P.team_lt)
        # ribs
        for i in range(3):
            k.torus(0.1 - i * 0.012, 0.012, P.bone_dk, loc=(0.0, 0, 0.36 - i * 0.05), scale=(0.9, 1.2, 1))
        # team rag
        k.prism([(0.02, 0.12), (0.02, -0.12), (-0.18, -0.1), (-0.22, 0.0), (-0.18, 0.1)], 0.018, P.team, loc=(-0.04, 0, 0.43), rot=(0, -25, 0))
        H.sword(k, P, hand, d, 0.26, 1, width=0.045, blade=P.iron_dk, guard=P.iron_dk)


@unit("turret", 0.24, spawned=True)
def turret(k, P, tier, pose):
    fire = pose == "attack"
    with k.at(scale=1.3):
        for i in range(3):
            a = 2 * math.pi * i / 3 + math.pi / 3
            k.rod(V((0, 0, 0.22)), V((math.cos(a) * 0.2, math.sin(a) * 0.2, 0.02)), 0.018, P.wood_dk)
        k.cyl(0.08, 0.08, P.iron, loc=(0, 0, 0.24), seg=12)
        k.box((0.32, 0.08, 0.07), P.wood, loc=(0.04, 0, 0.32), bevel=0.02)
        k.box((0.12, 0.3, 0.14), P.team, loc=(0.1, 0, 0.3), bevel=0.025)
        k.cyl(0.11, 0.04, P.team_dk, loc=(-0.02, 0, 0.27), seg=14)
        for s in (1, -1):
            k.tube([V((0.18, s * 0.04, 0.34)), V((0.16, s * 0.15, 0.34)), V((0.1, s * 0.22, 0.34))], 0.016, P.iron, smooth_n=2)
        k.ball(0.04, P.copper, loc=(-0.1, 0, 0.36))
        bx = 0.26 if fire else 0.06
        k.rod(V((bx, 0, 0.37)), V((bx + 0.22, 0, 0.37)), 0.01, P.wood)
        k.spike(V((bx + 0.22, 0, 0.37)), V((bx + 0.28, 0, 0.37)), 0.02, P.steel)
        if fire:
            spark(k, P, V((0.22, 0, 0.37)), 0.035, mat=P.white)


@unit("decoy", 0.25, spawned=True)
def decoy(k, P, tier, pose):
    trickster(k, P, 1, pose)
