// Blender-rendered sprites (public/sprites, see docs/V2-SPEC.md). Loaded lazily; until an image is ready the
// renderer falls back to the drawn tokens in units.ts.
import type { Side } from "../core/defs";

interface Manifest { ppu: number; units: Record<string, { size: number; tiers: number[]; poses: string[] }>; }

let manifest: Manifest | null = null;
let loading: Promise<void> | null = null;
const images = new Map<string, HTMLImageElement | null>();
const white = new Map<string, HTMLCanvasElement>();
const portraits = new Map<string, HTMLImageElement | null>();

const base = () => (import.meta as any).env?.BASE_URL ?? "./";

export function loadSprites(): Promise<void> {
  if (loading) return loading;
  loading = fetch(`${base()}sprites/manifest.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => { manifest = m; })
    .catch(() => { manifest = null; });
  return loading;
}

export const spritesReady = () => !!manifest;

const team = (s: Side) => (s === 0 ? "tide" : "ember");

function img(key: string, url: string, cache = images): HTMLImageElement | null {
  if (cache.has(key)) {
    const i = cache.get(key)!;
    return i && i.complete && i.naturalWidth ? i : null;
  }
  const i = new Image();
  i.decoding = "async";
  i.src = url;
  i.onerror = () => cache.set(key, null);
  cache.set(key, i);
  return null;
}

export interface Sprite { img: HTMLImageElement; size: number; }

/** The sprite for a body at its tier, or null if there isn't one (yet). `size` is in world units. */
export function sprite(kind: string, tier: number, side: Side, pose: "idle" | "attack"): Sprite | null {
  if (!manifest) return null;
  const u = manifest.units[kind];
  if (!u) return null;
  const t = u.tiers.includes(tier) ? tier : u.tiers.filter((x) => x <= tier).pop() ?? u.tiers[0];
  const p = u.poses.includes(pose) ? pose : "idle";
  const key = `${kind}/t${t}_${team(side)}_${p}`;
  const i = img(key, `${base()}sprites/${key}.png`);
  if (!i && p === "attack") return sprite(kind, tier, side, "idle");
  return i ? { img: i, size: u.size / manifest.ppu } : null;
}

/** A white silhouette of a sprite, for hit flashes. */
export function whiteOf(s: Sprite): HTMLCanvasElement {
  const key = s.img.src;
  let c = white.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = s.img.naturalWidth; c.height = s.img.naturalHeight;
    const g = c.getContext("2d")!;
    g.drawImage(s.img, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    white.set(key, c);
  }
  return c;
}

/** Card and menu portrait (3/4 view), or null. */
export function portrait(kind: string, tier = 1): HTMLImageElement | null {
  if (!manifest?.units[kind]) return null;
  const key = `${kind}_t${tier}`;
  return img(key, `${base()}portraits/${key}.png`, portraits);
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

/** Warm the cache for a set of kinds (all tiers, both teams). */
export function preload(kinds: string[]) {
  if (!manifest) return;
  for (const k of kinds) {
    const u = manifest.units[k];
    if (!u) continue;
    for (const t of u.tiers) for (const s of [0, 1] as Side[]) for (const p of u.poses) sprite(k, t, s, p as "idle" | "attack");
  }
}
