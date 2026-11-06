"""Muster unit art: build every unit procedurally in Blender and render sprites + portraits.

    blender -b -P art/render_all.py -- [--only ranger,golem] [--jobs 4] [--no-post] [--no-portraits]
    npm run art

Writes raw supersampled renders to art/build/raw, then runs art/post.py (system python3 with
Pillow + numpy) which adds the ink silhouette, Ascended bloom, downsamples, quantises and writes
public/sprites/<kind>/t<tier>_<team>_<pose>.png, public/sprites/manifest.json,
public/portraits/<kind>_t<tier>.png and the contact sheets in art/contact/.
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

RAW = os.path.join(HERE, "build", "raw")
SS = 2  # supersample factor for sprites
PORTRAIT = 256
TEAMS = ("tide", "ember")
POSES = ("idle", "attack")
# portraits framed on the body (dense geometry) rather than the long pole/pike
BODY_FRAME = {"banner": 7.0, "pikeman": 2.0, "duelist": 2.0, "lancer": 2.0}
# portrait camera elevation per kind (flat things look better from higher up)
PORTRAIT_EL = {"harrier": 48.0, "mine": 42.0, "hive": 34.0, "ballista": 34.0, "bombard": 32.0, "golem": 16.0, "turret": 30.0,
               "golemling": 26.0, "mite": 38.0, "queen": 38.0, "lancer": 18.0}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--tiers", default="")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--worker", type=int, default=-1)
    ap.add_argument("--nworkers", type=int, default=1)
    ap.add_argument("--no-post", action="store_true")
    ap.add_argument("--no-portraits", action="store_true")
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
        ts = [t for t in ts if t in want] or ts[:1]
    return ts


def worker(a):
    import numpy as np
    from muster_art import kit as K
    from muster_art.parts import Pal
    from muster_art.units import REG

    st = K.Stage(samples=a.samples)
    P = Pal()
    k = K.Kit()
    ks = kinds_list(a)
    if a.worker >= 0:
        ks = [x for i, x in enumerate(ks) if i % a.nworkers == a.worker]
    t0 = time.time()
    n = 0
    for kind in ks:
        spec = REG[kind]
        tiers = tiers_for(spec, a)
        out = os.path.join(RAW, kind)
        os.makedirs(out, exist_ok=True)
        # phase 1: measure every variant so one canvas size fits all tiers and poses
        ext = 0.0
        pbox = None
        tbox = {}
        el = PORTRAIT_EL.get(kind, 24.0)
        st.portrait_view(el=el)
        for t in [1, 2, 3, 4] if not spec["spawned"] else [1]:
            for pose in POSES:
                k.clear()
                spec["build"](k, P, t, pose)
                v = k.verts_world()
                ext = max(ext, float(np.abs(v[:, :2]).max()))
                if pose == "idle":
                    xy = st.project(v)
                    if kind in BODY_FRAME:
                        q = BODY_FRAME[kind]
                        lo, hi = np.percentile(xy, q, axis=0), np.percentile(xy, 100 - q, axis=0)
                    else:
                        lo, hi = xy.min(0), xy.max(0)
                    tbox[t] = (lo, hi)
                    pbox = (lo, hi) if pbox is None else (np.minimum(pbox[0], lo), np.maximum(pbox[1], hi))
        margin = 0.035 + 0.05  # outline + bloom room
        size = int(math.ceil((ext + margin) * 2 * K.PPU / 4.0) * 4)
        with open(os.path.join(out, "meta.json"), "w") as f:
            json.dump({"size": size, "tiers": tiers, "spawned": spec["spawned"], "ext": ext, "radius": spec["radius"]}, f)
        # phase 2: render
        for t in tiers:
            for pose in POSES:
                k.clear()
                spec["build"](k, P, t, pose)
                st.top_view()
                for team in TEAMS:
                    K.set_team(team)
                    K.set_glowpass(False)
                    st.render(os.path.join(out, f"t{t}_{team}_{pose}.png"), size * SS, size / K.PPU)
                    n += 1
                    if t == 4:
                        K.set_glowpass(True)
                        st.render(os.path.join(out, f"t{t}_{team}_{pose}_glow.png"), size * SS, size / K.PPU)
                        K.set_glowpass(False)
                        n += 1
                if pose == "idle" and not a.no_portraits:
                    st.portrait_view(el=el)
                    K.set_team("tide")
                    lo, hi = tbox[t]
                    c = (lo + hi) / 2
                    span = max(float(max(hi - lo)), 0.84 * float(max(pbox[1] - pbox[0]))) * 1.08 + 0.06
                    pd = os.path.join(RAW, "portraits")
                    os.makedirs(pd, exist_ok=True)
                    sh = (float(c[0]) / span, float(c[1]) / span)
                    st.render(os.path.join(pd, f"{kind}_t{t}.png"), PORTRAIT * 2, span, shift=sh)
                    n += 1
                    if t == 4:
                        K.set_glowpass(True)
                        st.render(os.path.join(pd, f"{kind}_t{t}_glow.png"), PORTRAIT * 2, span, shift=sh)
                        K.set_glowpass(False)
                        n += 1
                    st.top_view()
        print(f"KIND_OK {kind} size={size}px ext={ext:.3f} renders={n} t={time.time() - t0:.1f}s", flush=True)
    print(f"WORKER_DONE renders={n} t={time.time() - t0:.1f}s", flush=True)


def main():
    a = args()
    t0 = time.time()
    if a.worker >= 0 or a.jobs <= 1:
        worker(a)
    else:
        blender = sys.argv[0] if sys.argv and sys.argv[0].endswith("blender") else "/opt/homebrew/bin/blender"
        import bpy  # noqa: F401
        blender = bpy.app.binary_path or blender
        extra = []
        for flag in ("only", "tiers"):
            v = getattr(a, flag)
            if v:
                extra += [f"--{flag}", v]
        if a.no_portraits:
            extra.append("--no-portraits")
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
