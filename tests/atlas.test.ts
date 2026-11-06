import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BODY_EXTRA, UNITS } from "../src/core/defs";
import { TILT, mirror8 } from "../src/render/camera";
import { tintPixels, type Manifest } from "../src/render/sprites";

const DIR = join(__dirname, "..", "public", "atlas");
const man = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as Manifest;
const ANIMS = ["idle", "walk", "attack", "death"] as const;

/** PNG width and height from the IHDR chunk. */
function pngSize(file: string) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe("character atlases", () => {
  it("cover every unit at tiers 1 to 4 and every spawned body at tier 1", () => {
    for (const k of Object.keys(UNITS)) expect(man.units[k]?.tiers, k).toEqual([1, 2, 3, 4]);
    for (const k of Object.keys(BODY_EXTRA)) expect(man.units[k]?.tiers, k).toEqual([1]);
  });

  it("match the diorama camera: same pitch, same mirrored facings", () => {
    expect(Math.abs(man.el - (90 - (TILT * 180) / Math.PI))).toBeLessThan(0.1);
    // Rendered facings, in screen 8-way terms (0 right, 1 down-right, 2 down, 7 up-right, 6 up).
    const rendered = man.dirs.map((deg) => ((Math.round(deg / 45) % 8) + 8) % 8);
    for (let d = 0; d < 8; d++) {
      const [di, flip] = man.dir8[d];
      const m = mirror8(d);
      expect(rendered[di], `facing ${d}`).toBe(m.frame);
      expect(flip, `facing ${d}`).toBe(m.flip);
    }
  });

  it("hold every facing and animation frame inside its sheet, with the anchor inside the frame", () => {
    for (const [key, sh] of Object.entries(man.sheets)) {
      const png = pngSize(join(DIR, `${key}.png`)), mask = pngSize(join(DIR, `${key}_m.png`));
      expect(png, key).toEqual({ w: sh.w, h: sh.h });
      expect(mask, key).toEqual({ w: sh.w, h: sh.h });
      for (const a of ANIMS) {
        // Bodies that never move alias walk to idle, so they hold the target animation's frame count.
        let list = sh.anims[a], src: string = a;
        if (typeof list === "string") list = sh.anims[(src = list)];
        expect(Array.isArray(list), `${key} ${a}`).toBe(true);
        const dirs = list as number[][][];
        expect(dirs.length, `${key} ${a}`).toBe(man.dirs.length);
        for (const frames of dirs) {
          expect(frames.length, `${key} ${a}`).toBe(man.anims[src as (typeof ANIMS)[number]]);
          for (const [x, y, w, h, ax, ay] of frames) {
            expect(x >= 0 && y >= 0 && x + w <= sh.w && y + h <= sh.h, `${key} ${a} rect`).toBe(true);
            expect(ax >= -w && ax <= 2 * w && ay >= 0 && ay <= h * 1.5, `${key} ${a} anchor`).toBe(true);
          }
        }
      }
    }
  });

  it("evolve visibly: each unit's Ascended figure stands out from its Recruit", () => {
    const size = (key: string) => {
      const f = (man.sheets[key].anims.idle as number[][][])[1][0];
      return f[2] * f[3];
    };
    for (const k of Object.keys(UNITS)) expect(size(`${k}_t4`), k).toBeGreaterThan(size(`${k}_t1`) * 1.15);
  });

  it("stay small enough for the app budget", () => {
    let total = 0;
    for (const key of Object.keys(man.sheets)) for (const f of [`${key}.png`, `${key}_m.png`]) total += statSync(join(DIR, f)).size;
    expect(total).toBeLessThan(40 * 1024 * 1024);
    expect(existsSync(join(DIR, "manifest.json"))).toBe(true);
  });
});

describe("team tint", () => {
  it("multiplies white team parts to the team colour and leaves unmasked pixels alone", () => {
    const col = new Uint8ClampedArray([255, 255, 255, 255, 100, 50, 25, 200, 0, 0, 0, 0]);
    const mask = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const out = [new Uint8ClampedArray(12), new Uint8ClampedArray(12)];
    tintPixels(col, mask, [man.teams.tide, { main: "#ff0000", dark: "#000000", light: "#ffffff" }], out);
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    expect([...out[0].slice(0, 3)]).toEqual(hex(man.teams.tide.main));
    expect([...out[1].slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...out[0].slice(4, 8)]).toEqual([100, 50, 25, 200]);
    expect([...out[0].slice(8, 12)]).toEqual([0, 0, 0, 0]);
  });
});
