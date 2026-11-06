"""Muster unit art: build every unit procedurally in Blender and render the v3 battle frames (+ portraits).

    blender -b --factory-startup -P art/render_all.py -- [--only ranger,golem] [--tiers 1,4] [--jobs 6]
                                                         [--no-post] [--portraits] [--samples 16]
    npm run art

Battle frames (docs/ART-V3-ATLAS.md): the diorama camera from art/muster_art/style.py, 5 rendered facings
(the other 3 are mirrors), idle/walk/attack/death frames, every frame framed tightly around its own geometry.
Three passes per frame: colour with team parts in neutral white, the team mask (R=main, G=dark, B=light) and,
for Ascended, the emissive-only glow pass. Raw renders land in art/build/v3/<kind>/t<tier>/; then
art/post.py (system python3 + Pillow + numpy) inks, blooms, downsamples and art/pack_atlas.py packs them
into public/atlas/<kind>_t<tier>.png + _m.png with public/atlas/manifest.json and contact sheets in
art/contact/.

--portraits also re-renders the 3/4 card portraits (public/portraits, tide colours) in the v2 framing.
"""
import argparse
import json
import math
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

RAW3 = os.path.join(HERE, "build", "v3")
RAW = os.path.join(HERE, "build", "raw")
PORTRAIT = 256
# portraits framed on the body (dense geometry) rather than the long pole/pike
BODY_FRAME = {"banner": 7.0, "pikeman": 2.0, "duelist": 2.0, "lancer": 2.0}
# portrait camera elevation per kind (flat things look better from higher up)
PORTRAIT_EL = {"harrier": 48.0, "mine": 42.0, "hive": 34.0, "ballista": 34.0, "bombard": 32.0, "golem": 16.0, "turret": 30.0,
               "golemling": 26.0, "mite": 38.0, "queen": 38.0, "lancer": 18.0}
BUGS = {"mite", "queen"}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--tiers", default="")
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--worker", type=int, default=-1)
    ap.add_argument("--nworkers", type=int, default=1)
    ap.add_argument("--no-post", action="store_true")
    ap.add_argument("--portraits", action="store_true", help="render card portraits instead of battle frames")
    ap.add_argument("--samples", type=int, default=16)
    return ap.parse_args(argv)


def kinds_list(a):
    from muster_art.units import REG
    ks = list(REG.keys())
    if a.only:
        want = [x.strip() for x in a.only.split(",") if x.strip()]
        ks = [x for x in ks if x in want]
    return ks


def tiers_for(spec, a):
    ts = [1] if spec["spawned"] else [1, 2, 3, 4]
    if a.tiers:
        want = {int(x) for x in a.tiers.split(",")}
        ts = [t for t in ts if t in want]
    return ts


def jobs_list(a):
    """(kind, tier) work units, biggest first so the pool balances."""
    from muster_art.units import REG
    out = []
    for kind in kinds_list(a):
        for t in tiers_for(REG[kind], a):
            out.append((kind, t))
    out.sort(key=lambda kt: -REG[kt[0]]["radius"] * (1.2 if kt[1] == 4 else 1.0))
    return out


# ------------------------------------------------------------------ animation plan
def frame_plan(kind, radius):
    """[(anim, index, pose, gait, root Matrix)] for one body. Root transforms are baked under the model."""
    from mathutils import Matrix, Vector
    from muster_art import style as S

    def about(pivot, m):
        p = Vector(pivot)
        return Matrix.Translation(p) @ m @ Matrix.Translation(-p)

    def rot(axis, deg):
        return Matrix.Rotation(math.radians(deg), 4, axis)

    def scl(x, y, z):
        return Matrix.Diagonal((x, y, z, 1.0))

    static = kind in S.STATIC
    flying = kind in S.FLYING
    bug = kind in BUGS
    r = radius
    plan = []
    # idle: rest + a breath
    plan.append(("idle", 0, "idle", None, Matrix.Identity(4)))
    plan.append(("idle", 1, "idle", None, scl(1.02, 1.02, 0.965) if not flying else Matrix.Translation((0, 0, 0.03 * r / 0.3))))
    # walk: a 4-step cycle (legs/wings read ANIM gait), bob + forward lean
    if not static:
        for i in range(S.ANIMS["walk"]):
            g = i / S.ANIMS["walk"]
            bob = abs(math.cos(2 * math.pi * g)) * r * 0.06
            if flying:
                m = Matrix.Translation((0, 0, math.cos(2 * math.pi * g) * -0.04 * r / 0.3))
            else:
                m = Matrix.Translation((0, 0, bob)) @ rot("Y", 5.0)
            plan.append(("walk", i, "idle", g, m))
    # attack: wind-up, strike, follow-through
    if static:
        plan.append(("attack", 0, "idle", None, scl(1.03, 1.03, 0.95)))
        plan.append(("attack", 1, "attack", None, scl(0.98, 0.98, 1.04)))
        plan.append(("attack", 2, "attack", None, Matrix.Identity(4)))
    else:
        plan.append(("attack", 0, "idle", None, about((-r * 0.3, 0, 0), rot("Y", -8.0)) @ scl(1.0, 1.0, 0.97)))
        plan.append(("attack", 1, "attack", None, about((r * 0.3, 0, 0), rot("Y", 8.0)) @ scl(1.0, 1.0, 1.02)))
        plan.append(("attack", 2, "attack", None, about((r * 0.3, 0, 0), rot("Y", 3.0))))
    # death
    if static:
        for i, (sx, sz, tilt) in enumerate(((1.05, 0.82, 4.0), (1.12, 0.58, 8.0), (1.18, 0.34, 10.0))):
            plan.append(("death", i, "idle", None, rot("X", tilt) @ scl(sx, sx, sz)))
    elif flying:
        z = 0.45 * r / 0.3
        for i, (roll, drop) in enumerate(((35.0, 0.12), (95.0, 0.28), (160.0, 0.4))):
            plan.append(("death", i, "idle", None, Matrix.Translation((0, 0, -drop * z)) @ about((0, 0, z), rot("X", roll))))
    elif bug:
        z = 0.1 * (2.0 if kind == "queen" else 1.15)
        for i, roll in enumerate((70.0, 140.0, 180.0)):
            plan.append(("death", i, "idle", None, Matrix.Translation((0, 0, z * 0.6 * i / 2)) @ about((0, 0, z), rot("X", roll))))
    else:
        pv = (-r * 0.55, 0, 0)
        for i, (ang, sz, sink) in enumerate(((-24.0, 1.0, 0.0), (-58.0, 0.95, -0.01), (-84.0, 0.86, -0.02))):
            plan.append(("death", i, "idle", None, Matrix.Translation((0, 0, sink * r / 0.3)) @ about(pv, rot("Y", ang)) @ scl(1, 1, sz)))
    return plan


# ------------------------------------------------------------------ v3 battle frames
def render_unit(st, k, P, kind, tier, a):
    import numpy as np
    from mathutils import Matrix
    from muster_art import kit as K
    from muster_art import parts as H
    from muster_art import style as S
    from muster_art.units import REG

    spec = REG[kind]
    out = os.path.join(RAW3, kind, f"t{tier}")
    os.makedirs(out, exist_ok=True)
    e = math.radians(S.CAMERA_EL)
    up = np.array([0.0, math.sin(e), math.cos(e)])
    margin = 0.045 + (0.07 if tier == 4 else 0.0)
    frames = []
    n = 0
    for anim, idx, pose, g, root in frame_plan(kind, spec["radius"]):
        k.clear()
        H.ANIM["gait"] = g
        k.stack = [root]
        spec["build"](k, P, tier, pose)
        k.stack = [Matrix.Identity(4)]
        H.ANIM["gait"] = None
        v = k.verts_world().astype(np.float64)
        for di, deg in enumerate(S.DIRS):
            yaw = math.radians(-deg)
            c, s_ = math.cos(yaw), math.sin(yaw)
            rx = v[:, 0] * c - v[:, 1] * s_
            ry = v[:, 0] * s_ + v[:, 1] * c
            px = rx
            py = ry * up[1] + v[:, 2] * up[2]
            ppu = S.PPU
            x0 = math.floor((px.min() - margin) * ppu) / ppu
            x1 = math.ceil((px.max() + margin) * ppu) / ppu
            y0 = math.floor((py.min() - margin) * ppu) / ppu
            y1 = math.ceil((py.max() + margin) * ppu) / ppu
            w, h = int(round((x1 - x0) * ppu)), int(round((y1 - y0) * ppu))
            span = max(x1 - x0, y1 - y0)
            shift = (((x0 + x1) / 2) / span, ((y0 + y1) / 2) / span)
            rz = Matrix.Rotation(yaw, 4, "Z")
            for ob in k.objs:
                ob.matrix_world = rz
            base = os.path.join(out, f"{anim}{idx}_d{di}")
            K.set_team("neutral")
            K.set_glowpass(False)
            K.set_maskpass(False)
            st.render(base + ".png", (w * S.SS, h * S.SS), span, shift=shift)
            K.set_maskpass(True)
            st.sc.eevee.taa_render_samples = max(4, a.samples // 2)  # flat colours: fewer samples are enough
            st.render(base + "_m.png", (w * S.SS, h * S.SS), span, shift=shift)
            st.sc.eevee.taa_render_samples = a.samples
            K.set_maskpass(False)
            n += 2
            if tier == 4:
                K.set_glowpass(True)
                st.render(base + "_g.png", (w * S.SS, h * S.SS), span, shift=shift)
                K.set_glowpass(False)
                n += 1
            frames.append({"anim": anim, "i": idx, "dir": di, "w": w, "h": h,
                           "ax": int(round(-x0 * ppu)), "ay": int(round(y1 * ppu)), "file": f"{anim}{idx}_d{di}"})
    with open(os.path.join(out, "meta.json"), "w") as f:
        json.dump({"kind": kind, "tier": tier, "radius": spec["radius"], "ppu": S.PPU, "ss": S.SS, "frames": frames}, f)
    return n


def worker(a):
    from muster_art import kit as K
    from muster_art.parts import Pal

    st = K.Stage(samples=a.samples)
    P = Pal()
    k = K.Kit()
    t0 = time.time()
    if a.portraits:
        return portraits(a, st, P, k, t0)
    jobs = jobs_list(a)
    if a.worker >= 0:
        jobs = [x for i, x in enumerate(jobs) if i % a.nworkers == a.worker]
    st.diorama_view()
    n = 0
    failed = []
    for kind, tier in jobs:
        try:
            n += render_unit(st, k, P, kind, tier, a)
        except Exception:
            import traceback
            traceback.print_exc()
            failed.append(f"{kind}_t{tier}")
            print(f"UNIT_FAILED {kind} t{tier}", flush=True)
            continue
        print(f"UNIT_OK {kind} t{tier} renders={n} t={time.time() - t0:.1f}s", flush=True)
    print(f"WORKER_DONE renders={n} t={time.time() - t0:.1f}s", flush=True)
    if failed:
        sys.exit(1)


# ------------------------------------------------------------------ card portraits (v2 framing)
def portraits(a, st, P, k, t0):
    import numpy as np
    from muster_art import kit as K
    from muster_art.units import REG

    ks = kinds_list(a)
    if a.worker >= 0:
        ks = [x for i, x in enumerate(ks) if i % a.nworkers == a.worker]
    n = 0
    for kind in ks:
        spec = REG[kind]
        tiers = [1] if spec["spawned"] else [1, 2, 3, 4]
        el = PORTRAIT_EL.get(kind, 24.0)
        st.portrait_view(el=el)
        pbox, tbox = None, {}
        for t in tiers:
            k.clear()
            spec["build"](k, P, t, "idle")
            xy = st.project(k.verts_world())
            if kind in BODY_FRAME:
                q = BODY_FRAME[kind]
                lo, hi = np.percentile(xy, q, axis=0), np.percentile(xy, 100 - q, axis=0)
            else:
                lo, hi = xy.min(0), xy.max(0)
            tbox[t] = (lo, hi)
            pbox = (lo, hi) if pbox is None else (np.minimum(pbox[0], lo), np.maximum(pbox[1], hi))
        pd = os.path.join(RAW, "portraits")
        os.makedirs(pd, exist_ok=True)
        for t in tiers:
            k.clear()
            spec["build"](k, P, t, "idle")
            K.set_team("tide")
            lo, hi = tbox[t]
            c = (lo + hi) / 2
            span = max(float(max(hi - lo)), 0.84 * float(max(pbox[1] - pbox[0]))) * 1.08 + 0.06
            sh = (float(c[0]) / span, float(c[1]) / span)
            st.render(os.path.join(pd, f"{kind}_t{t}.png"), PORTRAIT * 2, span, shift=sh)
            n += 1
            if t == 4:
                K.set_glowpass(True)
                st.render(os.path.join(pd, f"{kind}_t{t}_glow.png"), PORTRAIT * 2, span, shift=sh)
                K.set_glowpass(False)
                n += 1
        print(f"PORTRAIT_OK {kind} renders={n} t={time.time() - t0:.1f}s", flush=True)
    print(f"WORKER_DONE renders={n} t={time.time() - t0:.1f}s", flush=True)


def main():
    a = args()
    t0 = time.time()
    if a.worker >= 0 or a.jobs <= 1:
        worker(a)
    else:
        import bpy
        blender = bpy.app.binary_path or "/opt/homebrew/bin/blender"
        extra = []
        for flag in ("only", "tiers"):
            v = getattr(a, flag)
            if v:
                extra += [f"--{flag}", v]
        if a.portraits:
            extra.append("--portraits")
        extra += ["--samples", str(a.samples)]
        procs = []
        for i in range(a.jobs):
            cmd = [blender, "-b", "--factory-startup", "-P", os.path.abspath(__file__), "--", "--worker", str(i), "--nworkers", str(a.jobs)] + extra
            log = open(os.path.join(HERE, "build", f"worker{i}.log"), "w")
            procs.append((subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT), log))
        bad = 0
        for p, log in procs:
            p.wait()
            log.close()
            bad += p.returncode != 0
        if bad:
            print(f"RENDER_FAILED {bad} workers; see art/build/worker*.log")
            sys.exit(1)
    print(f"RENDER_DONE {time.time() - t0:.1f}s", flush=True)
    if a.worker < 0 and not a.no_post:
        cmd = ["python3", os.path.join(HERE, "post.py")]
        if a.portraits:
            cmd += ["--portraits"]
        if a.only:
            cmd += ["--only", a.only]
        r = subprocess.run(cmd)
        if r.returncode != 0:
            sys.exit(r.returncode)
    print(f"ART_DONE {time.time() - t0:.1f}s", flush=True)


if __name__ == "__main__":
    os.makedirs(os.path.join(HERE, "build"), exist_ok=True)
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
