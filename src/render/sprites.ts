// Blender-rendered character atlases (public/atlas, see docs/ART-V3-ATLAS.md). One atlas per body and tier holds
// 5 rendered facings (the other 3 are mirrors) x idle/walk/attack/death frames, with team parts in white and a
// team mask beside it. Each atlas is tinted once per team into a canvas when first needed. Until a sheet is
// ready the renderer falls back to the drawn tokens in units.ts.
import type { Side } from "../core/defs";

export type Anim = "idle" | "walk" | "attack" | "death";
type Rect = [x: number, y: number, w: number, h: number, ax: number, ay: number];
interface Sheet { w: number; h: number; anims: Record<string, Rect[][] | string>; }
interface TeamCols { main: string; dark: string; light: string; }
export interface Manifest {
  version: number;
  /** Atlas pixels per world unit, horizontally. */
  ppu: number;
  /** Camera pitch in degrees below the horizon: a ground circle of radius r draws r * sin(el) tall. */
  el: number;
  dirs: number[];
  dir8: [number, boolean][];
  anims: Record<Anim, number>;
  teams: Record<"tide" | "ember", TeamCols>;
  units: Record<string, { tiers: number[]; radius: number }>;
  sheets: Record<string, Sheet>;
}

let manifest: Manifest | null = null;
let loading: Promise<void> | null = null;
const portraits = new Map<string, HTMLImageElement | null>();
/** sheet key -> per-team tinted canvases, "loading", or null when the files failed. */
const tinted = new Map<string, [HTMLCanvasElement, HTMLCanvasElement] | "loading" | null>();

const base = () => (import.meta as any).env?.BASE_URL ?? "./";

export function loadSprites(): Promise<void> {
  if (loading) return loading;
  loading = fetch(`${base()}atlas/manifest.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => { manifest = m && m.version >= 3 ? m : null; })
    .catch(() => { manifest = null; });
  return loading;
}

export const spritesReady = () => !!manifest;
export const atlasManifest = () => manifest;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.decoding = "async";
    i.onload = () => res(i);
    i.onerror = () => rej(new Error(url));
    i.src = url;
  });
}

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/** rgb = colour * (1 + R*(main-1) + G*(dark-1) + B*(light-1)), for both teams in one pass. */
export function tintPixels(col: Uint8ClampedArray, mask: Uint8ClampedArray, teams: TeamCols[], out: Uint8ClampedArray[]) {
  const k = teams.map((t) => [hex(t.main), hex(t.dark), hex(t.light)].map((c) => c.map((v) => (v - 1) / 255)));
  for (let i = 0; i < col.length; i += 4) {
    const a = col[i + 3];
    if (!a) continue;
    const r = mask[i], g = mask[i + 1], b = mask[i + 2];
    for (let t = 0; t < teams.length; t++) {
      const o = out[t], [km, kd, kl] = k[t];
      for (let c = 0; c < 3; c++) o[i + c] = col[i + c] * (1 + r * km[c] + g * kd[c] + b * kl[c]);
      o[i + 3] = a;
    }
  }
}

function pixels(img: HTMLImageElement): ImageData {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

function buildSheet(key: string) {
  if (!manifest || tinted.has(key)) return;
  tinted.set(key, "loading");
  const m = manifest;
  Promise.all([loadImage(`${base()}atlas/${key}.png`), loadImage(`${base()}atlas/${key}_m.png`)])
    .then(([ci, mi]) => {
      const col = pixels(ci), mask = pixels(mi);
      const outs = [0, 1].map(() => new ImageData(col.width, col.height));
      tintPixels(col.data, mask.data, [m.teams.tide, m.teams.ember], outs.map((o) => o.data));
      const canv = outs.map((o) => {
        const c = document.createElement("canvas");
        c.width = o.width; c.height = o.height;
        c.getContext("2d")!.putImageData(o, 0, 0);
        return c;
      });
      tinted.set(key, [canv[0], canv[1]]);
    })
    .catch(() => tinted.set(key, null));
}

/** A frame ready to draw: the source rect in `img`, the ground anchor inside it, and whether to mirror it. */
export interface Frame { img: HTMLCanvasElement; x: number; y: number; w: number; h: number; ax: number; ay: number; flip: boolean; ppu: number; }

/** The tier a body actually has art for (the highest rendered tier at or below the asked one). */
function tierFor(kind: string, tier: number): number | null {
  const u = manifest?.units[kind];
  if (!u || !u.tiers.length) return null;
  return u.tiers.includes(tier) ? tier : u.tiers.filter((x) => x <= tier).pop() ?? u.tiers[0];
}

/** 8-way facing index for a game angle (radians, y down, 0 = east). */
export const facing8 = (face: number) => ((Math.round(face / (Math.PI / 4)) % 8) + 8) % 8;

/**
 * The frame of `anim` for a body, or null if its sheet isn't loaded (yet). `phase` is 0..1: the loop position for
 * idle and walk, the progress for attack and death (clamped to the last frame).
 */
export function frame(kind: string, tier: number, side: Side, anim: Anim, phase: number, face: number): Frame | null {
  if (!manifest) return null;
  const t = tierFor(kind, tier);
  if (t == null) return null;
  let key = `${kind}_t${t}`;
  if (!manifest.sheets[key]) return null;
  let tc = tinted.get(key);
  if (tc === undefined) buildSheet(key);
  if (!tc || tc === "loading") {
    // While a newly reached tier tints, keep showing the highest lower tier that is ready.
    tc = undefined;
    for (const lt of manifest.units[kind].tiers.filter((x) => x < t).reverse()) {
      const c = tinted.get(`${kind}_t${lt}`);
      if (c && c !== "loading") { key = `${kind}_t${lt}`; tc = c; break; }
    }
    if (!tc) return null;
  }
  const sheet = manifest.sheets[key];
  let a = sheet.anims[anim] ?? sheet.anims.idle;
  if (typeof a === "string") a = sheet.anims[a] as Rect[][];
  const [di, flip] = manifest.dir8[facing8(face)];
  const list = a[di];
  if (!list?.length) return null;
  const n = list.length;
  const loop = anim === "idle" || anim === "walk";
  const p = loop ? ((phase % 1) + 1) % 1 : Math.max(0, Math.min(0.999, phase));
  const [x, y, w, h, ax, ay] = list[Math.min(n - 1, Math.floor(p * n))];
  return { img: tc[side === 0 ? 0 : 1], x, y, w, h, ax, ay, flip, ppu: manifest.ppu };
}

/** Card and menu portrait (3/4 view), or null. */
export function portrait(kind: string, tier = 1): HTMLImageElement | null {
  if (!manifest?.units[kind]) return null;
  const key = `${kind}_t${tier}`;
  if (portraits.has(key)) {
    const i = portraits.get(key)!;
    return i && i.complete && i.naturalWidth ? i : null;
  }
  const i = new Image();
  i.decoding = "async";
  i.src = `${base()}portraits/${key}.png`;
  i.onerror = () => portraits.set(key, null);
  portraits.set(key, i);
  return null;
}

/** Resolves when a portrait has loaded (or failed). */
export function whenPortrait(kind: string, tier = 1): Promise<HTMLImageElement | null> {
  return loadSprites().then(() => new Promise((res) => {
    const p = portrait(kind, tier);
    if (p) return res(p);
    const i = portraits.get(`${kind}_t${tier}`);
    if (!i) return res(null);
    i.addEventListener("load", () => res(i), { once: true });
    i.addEventListener("error", () => res(null), { once: true });
  }));
}

/** Warm the atlases for a set of kinds at the given tiers (all rendered tiers when omitted). */
export function preload(kinds: string[], tiers?: number[]) {
  if (!manifest) return;
  for (const k of kinds) {
    const u = manifest.units[k];
    if (!u) continue;
    for (const t of tiers ? [...new Set(tiers.map((x) => tierFor(k, x)!))] : u.tiers) buildSheet(`${k}_t${t}`);
  }
}

const heights = new Map<string, number>();
/** How far the idle sprite rises above its ground anchor, in world units at true scale (0 if unknown). */
export function spriteHeight(kind: string, tier: number): number {
  if (!manifest) return 0;
  const t = tierFor(kind, tier);
  if (t == null) return 0;
  const key = `${kind}_t${t}`;
  let h = heights.get(key);
  if (h === undefined) {
    const a = manifest.sheets[key]?.anims.idle;
    h = Array.isArray(a) ? Math.max(0, ...a.flat().map((r) => r[5])) / manifest.ppu : 0;
    heights.set(key, h);
  }
  return h;
}
