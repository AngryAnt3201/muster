import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEVELS } from "../src/core/campaign";
import { H, W } from "../src/core/defs";
import { ARENA_COUNT, arenaAct, flatStretch, propRect, propVariant, type ArenaManifest } from "../src/render/arena";

const DIR = join(__dirname, "..", "public", "arenas");
const man = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as ArenaManifest;
const NAMES = ["Borderlands", "Ash Fields", "Hollow Wood", "Iron Pass", "High Keep", "Frozen Reach", "Sky Throne"];

describe("arenas", () => {
  it("has a rendered backdrop and three obstacle props for each of the 7 acts", () => {
    expect(Object.keys(man.acts).sort()).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    for (let a = 1; a <= ARENA_COUNT; a++) {
      const info = man.acts[String(a)];
      expect(info.name).toBe(NAMES[a - 1]);
      expect(existsSync(join(DIR, info.ground))).toBe(true);
      expect(info.props).toHaveLength(3);
      for (const p of info.props) expect(statSync(join(DIR, p.file)).size).toBeGreaterThan(5000);
      // The backdrop covers the board with the shared camera's foreshortening.
      const [w, h] = info.size;
      expect(w / man.ppu).toBeCloseTo(man.world.w, 1);
      expect(h / man.ppu / Math.sin((man.elev * Math.PI) / 180)).toBeCloseTo(man.world.h, 0);
    }
    expect(man.world.x).toBeLessThan(0);
    expect(man.world.y).toBeLessThan(0);
    expect(man.world.x + man.world.w).toBeGreaterThan(W);
    expect(man.world.y + man.world.h).toBeGreaterThan(H);
  });

  it("keeps every prop's measured silhouette within 8% of its collision circle", () => {
    for (const info of Object.values(man.acts))
      for (const p of info.props) {
        expect(p.footprint, `${info.name} ${p.file}`).toBeGreaterThan(0.92);
        expect(p.footprint, `${info.name} ${p.file}`).toBeLessThan(1.08);
      }
  });

  it("draws a prop so its silhouette spans the obstacle's diameter, centred on it", () => {
    const info = man.acts["1"];
    const s = 40, r = 0.75, cx = 200, cy = 300;
    const rect = propRect(man, info, cx, cy, r, s, flatStretch(man));
    const p = info.props[0];
    // silhouette half-width in screen px = footprint (in prop radii) x (frame px per prop radius)
    const half = p.footprint * (rect.w / man.propFrame);
    expect(Math.abs(half / (r * s) - 1)).toBeLessThan(0.08);
    // the footprint centre lands on the obstacle centre
    expect(rect.x + rect.w * info.anchor[0]).toBeCloseTo(cx, 6);
    expect(rect.y + rect.h * info.anchor[1]).toBeCloseTo(cy, 6);
    // on the flat board the ground is un-foreshortened
    expect(rect.h / rect.w).toBeCloseTo(1 / Math.sin((man.elev * Math.PI) / 180), 6);
  });

  it("picks the arena by act and falls back to act 1", () => {
    for (let a = 1; a <= 7; a++) expect(arenaAct(a, man)).toBe(a);
    expect(arenaAct(undefined, man)).toBe(1);
    expect(arenaAct(0, man)).toBe(1);
    expect(arenaAct(9, man)).toBe(1);
    expect(arenaAct(3, null)).toBe(3);
    expect(arenaAct(12, null)).toBe(1);
    for (const l of LEVELS) expect(man.acts[String(arenaAct(l.act, man))]).toBeDefined();
  });

  it("gives an obstacle the same prop variant every time", () => {
    const o = { x: 2.2, y: 7, r: 0.6 };
    expect(propVariant(o, 3)).toBe(propVariant({ ...o }, 3));
    for (const l of LEVELS) for (const ob of l.obstacles ?? []) {
      const v = propVariant(ob, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
    }
  });
});
