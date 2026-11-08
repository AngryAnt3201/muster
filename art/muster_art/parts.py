"""Shared parts: palette, chibi humanoid with tiered gear, weapons, Ascended trimmings.

Humanoid frame (before unit scale): feet at z=0, head centre ~z=0.54, shoulders at y=+-0.165.
Facing +X; the unit's right hand is at -Y.
"""
import math

from mathutils import Matrix, Vector

from . import kit as K


class Pal:
    def __init__(self):
        t, g, f = K.toon, K.glow, K.flat
        self.team = t("team.main")
        self.team_dk = t("team.dark")
        self.team_lt = t("team.light")
        self.glow = g("team.main", 1.5)
        self.glow_lt = g("team.light", 1.15)
        self.glow_soft = g("team.light", 1.0, alpha=0.55)
        self.skin = t("#f1c39b")
        self.hair = t("#5a3a26")
        self.cloth = t("#e2d2ad")
        self.cloth_dk = t("#9b8a69")
        self.leather = t("#9a643a")
        self.leather_dk = t("#5f3d24")
        self.wood = t("#b07743")
        self.wood_dk = t("#6f4628")
        self.steel = t("#dfe7ef", spec=0.3)
        self.iron = t("#848e9b", spec=0.15)
        self.iron_dk = t("#4d5561")
        self.dark = t("#363c4c")
        self.darker = t("#20242f")
        self.gold = t("#ffcf4d", spec=0.35)
        self.gold_dk = t("#c98d2a")
        self.bronze = t("#cf8746", spec=0.2)
        self.bone = t("#f1e8cf")
        self.bone_dk = t("#b9ab88")
        self.stone = t("#a49d92")
        self.stone_dk = t("#6f6a62")
        self.pearl = t("#f6f3ec", spec=0.25)
        self.violet = t("#9d7be6")
        self.violet_glow = g("#c9a8ff", 1.3)
        self.heal = g("#7dffa6", 1.25)
        self.heal_t = t("#5fd98a")
        self.fire = g("#ffd166", 1.4)
        self.fire_hot = g("#fff1c2", 1.2)
        self.ice = t("#d6f2ff", spec=0.4)
        self.ice_dk = t("#8fc3e0")
        self.ice_glow = g("#c8efff", 1.3)
        self.chitin = t("#6b4f7a")
        self.chitin_dk = t("#47344f")
        self.moss = t("#7f9a52")
        self.coat = t("#a8714a")
        self.coat_dk = t("#6e4630")
        self.mud = t("#8c6a4c")
        self.mud_dk = t("#5e4632")
        self.feather = t("#8d6644")
        self.feather_lt = t("#e3cfa6")
        self.zap = g("#d9efff", 1.4)
        self.copper = t("#d98a4e", spec=0.3)
        self.fur = t("#efe6d6")
        self.smoke = t("#b9bec7", alpha=0.85)
        self.eye = f("#0b0f18")
        self.white = f("#ffffff")
        self.black = f("#0b0f18")
        if K.STYLE.PALETTE:  # the style direction's material colours (art/style/<id>.json palette)
            spec = {"steel": 0.3, "iron": 0.15, "gold": 0.35, "pearl": 0.25}
            for name, col in K.STYLE.PALETTE.items():
                setattr(self, name, t(col, spec=spec.get(name, 0.0) * K.STYLE.SPEC))


# Animation state for the v3 frame renderer (art/render_all.py frame_plan sets it before each build). Builders keep
# their (k, P, tier, pose) signature and read it through the helpers below:
#   clip    idle | walk | attack | death | cast
#   gait    walk-cycle phase 0..1 (None outside walk); step() turns it into foot motion
#   idle    idle-loop phase 0..1 (None outside idle); breath() and flap() read it
#   blend   pose weight for attack/cast frames: < 0 wind-up (away from the strike), 0 ready, 1 strike, > 1 overshoot
#   fx      the strike's own effects (arcs, sparks, muzzle flash, spell bursts) show on this frame
#   bob     upper-body lift in body units (walk bounce, breathing); humanoid() applies it above the hips
#   swing   walk arm swing in body units (0 outside walk)
#   death   death progress 0..1 (None outside death): arms fling, wings go limp
#   weight  heavy | mid | light (the kind's motion class)
ANIM = {"gait": None, "clip": "idle", "idle": None, "blend": None, "fx": None, "bob": 0.0, "swing": 0.0, "death": None,
        "weight": "mid", "stride": 0.0}


def reset_anim():
    ANIM.update(gait=None, clip="idle", idle=None, blend=None, fx=None, bob=0.0, swing=0.0, death=None, weight="mid", stride=0.0)


def gait():
    return ANIM["gait"]


def clip():
    return ANIM["clip"]


def breath():
    """-1..1 breathing phase in the idle loop (0 elsewhere)."""
    p = ANIM["idle"]
    return 0.0 if p is None else math.sin(2 * math.pi * p)


def blend(pose):
    """Pose weight towards the attack/cast pose (see ANIM). A plain build with pose='attack' gets 1."""
    if pose == "idle":
        return 0.0
    b = ANIM["blend"]
    return 1.0 if b is None else b


def strike(pose):
    """Whether the strike's own effects (arcs, sparks, bursts) belong on this frame."""
    if pose == "idle":
        return False
    f = ANIM["fx"]
    return True if f is None else bool(f)


def mix(pose, rest, hit, wind=None, k=0.5, cast=None):
    """Blend a point between the rest pose and the attack pose by blend(pose). Below 0 it moves towards `wind`
    (default: the rest pose pushed away from the strike by k), above 1 it overshoots past the strike. In the cast clip
    `cast` (when given) is the target instead of the attack pose."""
    if pose == "cast" and cast is not None:
        hit = cast
    t = blend(pose)
    a, b = Vector(rest), Vector(hit)
    if t >= 0:
        return a + (b - a) * t
    w = Vector(wind) if wind is not None else a + (a - b) * k
    return a + (w - a) * (-t)


def mixd(pose, rest, hit, wind=None, k=0.5, cast=None):
    """mix() for a direction (normalised)."""
    if pose == "cast" and cast is not None:
        hit = cast
    v = mix(pose, Vector(rest).normalized(), Vector(hit).normalized(), None if wind is None else Vector(wind).normalized(), k)
    return v.normalized() if v.length > 1e-6 else Vector(hit).normalized()


def mixf(pose, rest, hit, wind=None, k=0.5, cast=None):
    if pose == "cast" and cast is not None:
        hit = cast
    t = blend(pose)
    if t >= 0:
        return rest + (hit - rest) * t
    w = wind if wind is not None else rest + (rest - hit) * k
    return rest + (w - rest) * (-t)


def casting(pose):
    return pose == "cast"


def flap(cruise=34.0, hover=24.0):
    """Wing flap angle in degrees for fliers: a full beat over the walk (flight) cycle, a softer hover beat over the
    idle loop, wings swept and still for the strike and folding limp as it dies."""
    g, p, d = ANIM["gait"], ANIM["idle"], ANIM["death"]
    if g is not None:
        return cruise * math.cos(2 * math.pi * g)
    if p is not None:
        return hover * math.cos(2 * math.pi * p)
    if d is not None:
        return 20.0 - 50.0 * d
    b = ANIM["blend"]
    return 0.0 if b is None else -10.0 * max(-1.0, min(1.0, b))


def push(k, m):
    """Push a transform that lasts until the enclosing k.at()/k.mat() frame ends (everything the builder draws after
    this call follows it: weapons, packs, capes)."""
    k.stack.append(k.stack[-1] @ m)


def _scale_of(k):
    m = k.stack[-1]
    return (m.col[0].xyz.length + m.col[1].xyz.length) / 2


def step(phase_offset=0.0, stride=1.0, lift=1.0, k=None):
    """(dx, dz) foot offset for a leg whose cycle is shifted by phase_offset (0..1). (0, 0) when not walking.

    Contact at phase 0 with the foot stride ahead, planted for half the cycle while it slides back at a constant rate
    (so a planted foot keeps pace with the ground when the runtime plays one cycle per manifest `stride` travelled),
    then lifted and swung forward with an ease. Pass k to record the stride for the manifest."""
    g = ANIM["gait"]
    if g is None:
        return 0.0, 0.0
    if k is not None:
        ANIM["stride"] = max(ANIM["stride"], 4.0 * stride * _scale_of(k))
    ph = (g + phase_offset) % 1.0
    if ph < 0.5:
        return stride * (1.0 - 4.0 * ph), 0.0
    u = (ph - 0.5) / 0.5
    e = u * u * (3 - 2 * u)
    return stride * (-1.0 + 2.0 * e), lift * math.sin(math.pi * u)


def arm_swing(side):
    """Walk arm swing for a hand (+x forward), opposite to the leg on the same side (L leg contacts at phase 0)."""
    g = ANIM["gait"]
    if g is None:
        return 0.0
    ph = g + (0.5 if side == "L" else 0.0)
    return ANIM["swing"] * math.cos(2 * math.pi * ph)


# tier scale: the silhouette grows with rank
TIER_SCALE = {1: 0.9, 2: 1.0, 3: 1.09, 4: 1.18}


def frame_dir(d, up=(0, 0, 1), origin=(0, 0, 0)):
    """Matrix whose local X runs along d, local Z as close to `up` as possible."""
    x = Vector(d).normalized()
    u = Vector(up)
    y = u.cross(x)
    if y.length < 1e-5:
        y = Vector((0, 1, 0))
    y.normalize()
    z = x.cross(y)
    m = Matrix((
        (x.x, y.x, z.x, origin[0]),
        (x.y, y.y, z.y, origin[1]),
        (x.z, y.z, z.z, origin[2]),
        (0, 0, 0, 1),
    ))
    return m


def dir2(deg, z=0.0):
    a = math.radians(deg)
    return Vector((math.cos(a), math.sin(a), z))


# ------------------------------------------------------------------ humanoid
DEFAULT_LOOK = {
    1: dict(torso="team", pads=None, head="hair", crest=None, cape=None, chest=None, belt="leather", legs="cloth_dk", boots="leather_dk", arms=None, halo=False, gloves="skin"),
    2: dict(torso="team", pads="steel", head="helm", crest="team", cape=None, chest="leather", belt="leather_dk", legs="leather", boots="leather_dk", arms=None, halo=False, gloves="leather"),
    3: dict(torso="team", pads="gold", head="helm", crest="plume", cape="long", chest="steel", belt="gold", legs="iron", boots="iron_dk", arms="steel", halo=False, gloves="iron"),
    4: dict(torso="team", pads="crystal", head="helm", crest="plume", cape="energy", chest="pearl", belt="gold", legs="pearl", boots="gold_dk", arms="pearl", halo=True, gloves="gold"),
}


def look_for(tier, **over):
    d = dict(DEFAULT_LOOK[tier])
    d.update(over)
    return d


def _m(P, name):
    return getattr(P, name) if isinstance(name, str) else name


SHOULDER = 0.165
HEAD = Vector((0.02, 0.0, 0.54))
HEAD_R = 0.108


def humanoid(k, P, tier, hands, look=None, bulk=1.0, lean=0.0, head_turn=0.0, elbows=None, seated=False, grip2=False):
    """hands: {'R': (x,y,z), 'L': (x,y,z)} in body frame. Returns dict of anchor points.

    Motion (ANIM): the upper body (torso, arms, head and everything the builder draws after this call) rides the walk
    bounce and breathing through a transform pushed until the builder's frame ends; legs step from the bobbing hips
    to feet that stay on the ground. Hands passed as Vectors are moved in place by the arm swing and the death fling,
    so weapons the builder draws at them afterwards follow. seated: a rider (no stepping, no own bounce). grip2: both
    hands hold one weapon, so the off hand swings with the weapon hand."""
    lk = look or look_for(tier)
    sh = SHOULDER * bulk
    bob = 0.0 if seated else ANIM["bob"]
    d = ANIM["death"]
    # per-hand secondary motion, applied in place so the builder's weapons follow
    for side in ("R", "L"):
        hp = hands.get(side)
        if not isinstance(hp, Vector):
            continue
        s = -1 if side == "R" else 1
        sw = 0.0 if seated else arm_swing("R" if grip2 else side) * (0.55 if (side == "R" or grip2) else 1.0)
        off = Vector((sw, 0.0, abs(sw) * 0.25))
        if d is not None:
            # thrown up and out by the blow, then flopping down
            f = math.sin(math.pi * min(1.0, d * 1.6))
            off += Vector((-0.05, s * 0.06, 0.1)) * f + Vector((0.0, s * 0.03, -0.12)) * max(0.0, d - 0.55)
        hp += off
    with k.at(rot=(0, lean, 0)):
        # legs + boots (hips ride the bounce, planted feet stay put)
        for s in (1, -1):
            fx, fz = (0.0, 0.0) if seated else step(0.0 if s > 0 else 0.5, stride=STRIDE.get(ANIM["weight"], 0.08), lift=0.05, k=k)
            k.rod((0.0, s * 0.065, 0.21 + bob), (0.015 + fx, s * 0.075, 0.05 + fz), 0.042, _m(P, lk["legs"]))
            k.sphere(0.05, _m(P, lk["boots"]), loc=(0.035 + fx, s * 0.076, 0.035 + fz), scale=(1.45, 1.0, 0.72))
    push(k, Matrix.Translation((0.0, 0.0, bob)))
    br = breath()
    with k.at(rot=(0, lean, 0)):
        # torso (the chest swells a touch on the in-breath)
        k.sphere(1.0, _m(P, lk["torso"]), loc=(0, 0, 0.31), scale=(0.122, 0.158 * bulk, 0.148 * (1 + 0.025 * br)))
        k.sphere(1.0, _m(P, lk["belt"]), loc=(0.0, 0, 0.225), scale=(0.124, 0.152 * bulk, 0.04))
        if lk.get("chest"):
            k.sphere(1.0, _m(P, lk["chest"]), loc=(0.03, 0, 0.33), scale=(0.11, 0.14 * bulk, 0.115))
        # cape behind
        if lk.get("cape"):
            cape(k, P, tier, lk["cape"], bulk)
        # shoulders + arms
        anchors = {}
        for side, s in (("R", -1), ("L", 1)):
            sp = Vector((0.0, s * sh, 0.405 + 0.006 * br))
            hp = Vector(hands[side])
            # elbow: out to the side and a little down/back
            mid = (sp + hp) / 2
            out = Vector((0, s * 0.07, -0.05))
            if elbows and side in elbows:
                el = Vector(elbows[side])
            else:
                el = mid + out
            arm_m = _m(P, lk["arms"]) if lk.get("arms") else _m(P, lk["torso"])
            k.tube([sp, el, hp], 0.04, arm_m, r_end=0.034, sides=8, smooth_n=3)
            k.sphere(0.043, _m(P, lk["gloves"]), loc=hp)
            anchors[side] = hp
            if lk.get("pads"):
                pauldron(k, P, tier, lk["pads"], sp, s, bulk)
        # head
        with k.at(HEAD, rot=(0, 0, head_turn)):
            head(k, P, tier, lk)
        if lk.get("halo"):
            halo(k, P, Vector(HEAD) + Vector((0, 0, 0.15)))
    anchors["head"] = Vector(HEAD)
    return anchors


# humanoid stride (half a step, body units) by motion class: heavy bodies take long slow steps, light ones short quick ones
STRIDE = {"heavy": 0.09, "mid": 0.085, "light": 0.08}


def pauldron(k, P, tier, kind, sp, s, bulk=1.0):
    big = {1: 0.06, 2: 0.07, 3: 0.082, 4: 0.088}[tier] * (0.8 + 0.2 * bulk)
    loc = sp + Vector((0.0, s * 0.012, 0.012))
    if kind == "cloth":
        k.sphere(big, P.team, loc=loc, scale=(1.0, 1.0, 0.7))
        return
    if kind == "steel":
        k.sphere(big, P.team, loc=loc, scale=(1.05, 1.0, 0.72))
        k.torus(big * 0.98, 0.013, P.steel, loc=loc + Vector((0, 0, -0.005)), scale=(1.05, 1.0, 1.0))
        return
    if kind == "gold":
        k.sphere(big, P.team, loc=loc, scale=(1.1, 1.0, 0.75))
        k.torus(big * 1.0, 0.016, P.gold, loc=loc + Vector((0, 0, -0.004)), scale=(1.1, 1.0, 1.0))
        k.sphere(big * 0.62, P.steel, loc=loc + Vector((0, 0, big * 0.42)), scale=(1.05, 1.0, 0.55))
        return
    if kind == "crystal":
        k.sphere(big, P.pearl, loc=loc, scale=(1.1, 1.0, 0.75))
        k.torus(big * 1.0, 0.016, P.gold, loc=loc + Vector((0, 0, -0.004)), scale=(1.1, 1.0, 1.0))
        k.crystal_at(loc + Vector((0, 0, 0.02)), loc + Vector((-0.03, s * 0.07, 0.13)), 0.026, P.glow)
        k.crystal_at(loc + Vector((0, 0, 0.02)), loc + Vector((0.04, s * 0.05, 0.10)), 0.018, P.glow_lt)
        return
    if kind == "spiked":
        k.sphere(big, P.iron, loc=loc, scale=(1.1, 1.0, 0.75))
        k.spike(loc, loc + Vector((0, s * 0.05, 0.10)), 0.022, P.bone)
        return


def head(k, P, tier, lk):
    """Head at local origin. lk['head'] picks the headgear."""
    hd = lk["head"]
    k.sphere(HEAD_R, P.skin, loc=(0, 0, 0))
    # eyes (only visible in portraits)
    for s in (1, -1):
        k.sphere(0.014, P.eye, loc=(HEAD_R * 0.9, s * 0.036, 0.005), outline=0)
    if hd == "hair":
        k.sphere(HEAD_R * 1.06, P.hair, loc=(-0.022, 0, 0.018), scale=(0.98, 1.0, 0.96))
    elif hd == "bald":
        pass
    elif hd == "cap":
        k.sphere(HEAD_R * 1.06, P.team, loc=(-0.01, 0, 0.03), scale=(1.0, 1.0, 0.8))
        k.cyl(HEAD_R * 0.75, 0.012, P.team_dk, loc=(0.07, 0, 0.035), rot=(0, 12, 0), seg=14)
    elif hd == "hood":
        k.sphere(HEAD_R * 1.18, P.team, loc=(-0.03, 0, 0.012), scale=(1.0, 1.0, 1.0))
        k.spike((-0.1, 0, 0.03), (-0.21, 0, -0.04), 0.06, P.team)
    elif hd == "hood_light":
        k.sphere(HEAD_R * 1.18, P.cloth, loc=(-0.03, 0, 0.012))
        k.spike((-0.1, 0, 0.03), (-0.21, 0, -0.04), 0.06, P.cloth)
        k.torus(HEAD_R * 1.0, 0.016, P.team, loc=(0.04, 0, 0.0), rot=(0, 90, 0))
    elif hd == "hood_dark":
        k.sphere(HEAD_R * 1.2, P.dark, loc=(-0.03, 0, 0.012))
        k.spike((-0.1, 0, 0.03), (-0.22, 0, -0.05), 0.06, P.dark)
        k.torus(HEAD_R * 1.02, 0.014, P.team, loc=(0.035, 0, 0.0), rot=(0, 90, 0), scale=(1, 1, 1))
    elif hd in ("helm", "helm_open"):
        mat = {1: P.leather, 2: P.steel, 3: P.steel, 4: P.pearl}[tier]
        k.sphere(HEAD_R * 1.12, mat, loc=(-0.005, 0, 0.022), scale=(1.0, 1.0, 0.86))
        rim = P.iron if tier < 3 else P.gold
        k.torus(HEAD_R * 1.1, 0.014, rim, loc=(-0.005, 0, -0.005))
        cr = lk.get("crest")
        if cr == "team":
            k.box((0.2, 0.028, 0.05), P.team, loc=(-0.01, 0, 0.11), bevel=0.012)
        elif cr == "plume":
            k.tube([(0.06, 0, 0.1), (0.0, 0, 0.135), (-0.09, 0, 0.12), (-0.17, 0, 0.06)], 0.035, P.team if tier < 4 else P.glow,
                   r_end=0.015, sides=8, smooth_n=3)
    elif hd == "hat":
        k.cyl(HEAD_R * 1.55, 0.016, P.team_dk, loc=(0, 0, 0.05), seg=18)
        k.sphere(HEAD_R * 0.9, P.team, loc=(-0.005, 0, 0.07), scale=(1.0, 1.0, 0.75))
    elif hd == "mask":
        k.sphere(HEAD_R * 1.08, P.team_dk, loc=(-0.02, 0, 0.02))
        k.sphere(HEAD_R * 0.75, P.pearl, loc=(0.05, 0, 0.0), scale=(0.6, 1.1, 1.0))


def cape(k, P, tier, kind, bulk=1.0, mat=None, trim=None):
    mat = mat or P.team
    L = {"short": 0.15, "long": 0.21, "energy": 0.24}[kind]
    w = 0.27 * bulk
    w2 = 0.33 * bulk
    with k.at((-0.07, 0, 0.44), rot=(0, -32, 0)):
        k.prism([(0.02, w / 2), (0.02, -w / 2), (-L * 0.5, -w2 * 0.5), (-L * 0.5, w2 * 0.5)], 0.02, mat, bevel=0.006)
        with k.at((-L * 0.5, 0, 0), rot=(0, -28, 0)):
            pts = [(0.0, w2 * 0.5), (0.0, -w2 * 0.5), (-L * 0.42, -w2 * 0.47), (-L * 0.55, -w2 * 0.2), (-L * 0.58, 0.0), (-L * 0.55, w2 * 0.2), (-L * 0.42, w2 * 0.47)]
            k.prism(pts, 0.02, mat, bevel=0.006)
            if kind == "energy":
                k.tube([(-L * 0.42, -w2 * 0.47, 0.014), (-L * 0.55, -w2 * 0.2, 0.014), (-L * 0.58, 0, 0.014), (-L * 0.55, w2 * 0.2, 0.014), (-L * 0.42, w2 * 0.47, 0.014)],
                       0.013, P.glow_lt, outline=0, smooth_n=3)
    if kind in ("long", "energy"):
        trim = trim or (P.gold if kind == "long" else P.glow)
        k.tube([(-0.05, -w / 2, 0.43), (-0.03, 0, 0.45), (-0.05, w / 2, 0.43)], 0.016, trim, smooth_n=3)


def halo(k, P, c, R=0.12):
    k.torus(R, 0.016, P.glow_lt, loc=c, seg=32, outline=0.006)
    for i in range(6):
        a = math.radians(30 + 60 * i)
        p = Vector(c) + Vector((math.cos(a) * R, math.sin(a) * R, 0))
        k.crystal_at(p - Vector((0, 0, 0.01)), p + Vector((0, 0, 0.05)), 0.012, P.glow, outline=0.004)


def crown(k, P, c, R=0.09, n=5, mat=None):
    mat = mat or P.gold
    k.torus(R, 0.014, mat, loc=c, seg=24)
    for i in range(n):
        a = 2 * math.pi * i / n
        p = Vector(c) + Vector((math.cos(a) * R, math.sin(a) * R, 0))
        k.crystal_at(p, p + Vector((0, 0, 0.06)), 0.016, P.glow if i % 2 == 0 else mat)


def orbit_shards(k, P, c, R, n=5, h=0.07, mat=None, z=0.0, tilt=20):
    mat = mat or P.glow
    for i in range(n):
        a = 2 * math.pi * i / n + 0.3
        p = Vector(c) + Vector((math.cos(a) * R, math.sin(a) * R, z))
        d = Vector((math.cos(a), math.sin(a), 0)) * math.sin(math.radians(tilt)) + Vector((0, 0, 1))
        k.crystal_at(p, p + d.normalized() * h, h * 0.32, mat, outline=0.005)


# ------------------------------------------------------------------ weapons
def sword(k, P, grip, d, length, tier, width=0.05, blade=None, guard=None, glow_edge=False):
    blade = blade or {1: P.iron, 2: P.steel, 3: P.steel, 4: P.glow_lt}[tier]
    guard = guard or {1: P.wood_dk, 2: P.iron, 3: P.gold, 4: P.gold}[tier]
    with k.mat(frame_dir(d, origin=grip)):
        k.rod((-0.06, 0, 0), (0.0, 0, 0), 0.016, P.leather_dk)
        k.sphere(0.022, guard, loc=(-0.07, 0, 0))
        k.box((0.025, width * 2.2, 0.025), guard, loc=(0.015, 0, 0), bevel=0.008)
        L = length
        pts = [(0.02, width / 2), (0.02, -width / 2), (L * 0.82, -width / 2), (L, 0.0), (L * 0.82, width / 2)]
        k.prism(pts, 0.02, blade, bevel=0.004, outline=0.01 if tier < 4 else 0.007)
        if tier >= 3 and not glow_edge:
            k.box((L * 0.6, width * 0.22, 0.024), P.gold if tier == 3 else P.glow, loc=(0.02 + L * 0.32, 0, 0), outline=0)
        if tier == 4 or glow_edge:
            k.box((L * 0.7, width * 0.3, 0.025), P.white, loc=(0.02 + L * 0.37, 0, 0), outline=0)


def axe(k, P, grip, d, length, tier, head_mat=None, double=False):
    head_mat = head_mat or {1: P.iron, 2: P.steel, 3: P.steel, 4: P.glow_lt}[tier]
    with k.mat(frame_dir(d, origin=grip)):
        k.rod((-0.05, 0, 0), (length, 0, 0), 0.02, P.wood if tier < 3 else P.wood_dk)
        hs = 0.08 + 0.02 * tier
        for s in ((1, -1) if double else (1,)):
            pts = [(length - 0.02, 0.0), (length - 0.06, s * hs), (length + 0.06, s * hs * 1.1), (length + 0.05, 0.0)]
            if s < 0:
                pts = pts[::-1]
            k.prism(pts, 0.026, head_mat, bevel=0.005)
        if tier >= 3:
            k.sphere(0.03, P.gold, loc=(length + 0.04, 0, 0))


def bow(k, P, grip, tier, drawn, span=0.3, draw_to=None, mats=None):
    """Horizontal bow held at `grip`, facing +X. Limbs curve back toward the archer."""
    limb = {1: P.wood, 2: P.wood_dk, 3: P.wood_dk, 4: P.glow}[tier]
    g = Vector(grip)
    tipz = g.z + 0.0
    curve = 0.10 + 0.03 * (span / 0.3)
    if drawn:
        curve *= 1.35
    tipL = g + Vector((-curve, span, 0.0))
    tipR = g + Vector((-curve, -span, 0.0))
    pts = [tipR, g + Vector((-curve * 0.35, -span * 0.62, 0)), g, g + Vector((-curve * 0.35, span * 0.62, 0)), tipL]
    k.tube(pts, 0.022 if tier < 4 else 0.026, limb, r_end=0.022, sides=8, smooth_n=4,
           radii=None)
    if tier >= 3:
        for tp in (tipL, tipR):
            k.sphere(0.024, P.gold if tier == 3 else P.glow_lt, loc=tp)
        k.sphere(0.03, P.gold, loc=g)
    if tier == 4:
        # feathered energy wings on the limbs
        for s in (1, -1):
            base = g + Vector((-curve * 0.2, s * span * 0.5, 0.0))
            k.crystal_at(base, base + Vector((-0.05, s * 0.12, 0.04)), 0.02, P.glow_lt, outline=0.004)
    # string
    nock = Vector(draw_to) if (drawn and draw_to is not None) else g + Vector((-curve, 0, 0))
    smat = P.bone if tier < 4 else P.glow_lt
    k.rod(tipL, nock, 0.006, smat, outline=0.004)
    k.rod(tipR, nock, 0.006, smat, outline=0.004)
    if drawn:
        arrow(k, P, nock, g + Vector((0.12, 0, 0)), tier)


def arrow(k, P, tail, tip, tier):
    a, b = Vector(tail), Vector(tip)
    k.rod(a, b, 0.009, P.wood if tier < 4 else P.glow_lt, outline=0.006)
    d = (b - a).normalized()
    k.spike(b - d * 0.01, b + d * 0.06, 0.02, P.steel if tier < 4 else P.white, outline=0.006)
    # fletching
    for s in (1, -1):
        k.prism([(0, 0), (0.05, 0), (0.0, s * 0.03)], 0.006, P.team, loc=a + d * 0.01, rot=(0, 0, math.degrees(math.atan2(d.y, d.x))))


def staff(k, P, hand, top, tier, shaft=None, foot=None):
    a, b = Vector(hand), Vector(top)
    d = (b - a).normalized()
    foot = foot if foot is not None else a - d * 0.16
    shaft = shaft or {1: P.wood, 2: P.wood_dk, 3: P.wood_dk, 4: P.pearl}[tier]
    k.rod(foot, b, 0.017, shaft)
    if tier >= 2:
        k.torus(0.022, 0.008, P.iron if tier == 2 else P.gold, loc=b - d * 0.02, rot=_rot_to(d))
    return b


def _rot_to(d):
    q = Vector(d).to_track_quat("Z", "Y")
    e = q.to_euler()
    return (math.degrees(e.x), math.degrees(e.y), math.degrees(e.z))


def spear(k, P, grip, d, length, tier, back=0.25, head_len=0.12, head_mat=None, shaft=None, banner=False):
    d = Vector(d).normalized()
    g = Vector(grip)
    shaft = shaft or {1: P.wood, 2: P.wood, 3: P.wood_dk, 4: P.pearl}[tier]
    head_mat = head_mat or {1: P.iron, 2: P.steel, 3: P.steel, 4: P.glow_lt}[tier]
    tail = g - d * back
    tipb = g + d * length
    k.rod(tail, tipb, 0.016, shaft)
    with k.mat(frame_dir(d, origin=tipb)):
        w = 0.045 + 0.006 * tier
        k.prism([(-0.01, w / 2), (-0.01, -w / 2), (head_len * 0.35, -w * 0.62), (head_len, 0), (head_len * 0.35, w * 0.62)], 0.02, head_mat, bevel=0.004)
        if tier >= 2:
            k.cyl(0.024, 0.03, P.iron if tier == 2 else P.gold, loc=(-0.02, 0, 0), rot=(0, 90, 0))
    return tipb


def round_shield(k, P, center, normal, R, tier, face=None, rim=None, boss=None):
    face = face or P.team
    rim = rim or {1: P.wood_dk, 2: P.iron, 3: P.gold, 4: P.glow_lt}[tier]
    boss = boss or {1: P.iron, 2: P.steel, 3: P.gold, 4: P.glow}[tier]
    with k.mat(Matrix.Translation(Vector(center)) @ K.look_mat(normal)):
        k.cyl(R, 0.035, face, seg=20, bevel=0.01)
        k.torus(R, 0.018, rim, loc=(0, 0, 0.01), seg=24)
        k.sphere(R * 0.3, boss, loc=(0, 0, 0.02), scale=(1, 1, 0.6))
