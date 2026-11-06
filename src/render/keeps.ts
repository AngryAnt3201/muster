// Commander keeps: one Blender-rendered keep per side (art/keeps/render_keeps.py -> public/keeps), sitting behind
// its deploy zone. The damage state follows the commander's shown hp over max hp, so the keep breaks up as the
// health bar drains. Geometry here is pure (used by the assault and tests); images load lazily like the sprites.
import { H, W, type Side } from "../core/defs";

export type KeepState = "intact" | "cracked" | "burning" | "ruined";
export const KEEP_STATES: KeepState[] = ["intact", "cracked", "burning", "ruined"];

export interface KeepManifest {
  ppu: number; w: number; h: number;
  anchors: { ground: [number, number]; gate: [number, number]; top: [number, number]; fires: [number, number][]; smoke: [number, number][] };
}

/** What the renderer ships with (public/keeps/manifest.json); used for geometry before the fetch lands. */
const DEFAULT: KeepManifest = {
  ppu: 120, w: 340, h: 336,
  anchors: {
    ground: [166.8, 216.6], gate: [166.8, 255.4], top: [166.8, 94.7],
    fires: [[172.8, 105.7], [116.4, 193.7], [271.2, 140.6], [208.8, 222.0]],
    smoke: [[166.8, 164.8], [106.8, 217.4], [238.8, 194.8]],
  },
};

/** Drawn a little under true scale so the keep leaves room to deploy round it (it has no collision). */
export const KEEP_SCALE = 0.8;
/** Half-extents of the keep's plinth on the board, world units (for attacker slots and the see-through test). */
export const KEEP_RX = 0.95;
export const KEEP_RY = 0.58;
/** How far the keep rises above its ground anchor, world units (the flag tip). */
export const KEEP_TALL = 1.42;

/** The keep's ground anchor (centre of its footprint) on the board. */
export function keepAnchor(side: Side): { x: number; y: number } {
  return side === 0 ? { x: W / 2, y: H - 0.6 } : { x: W / 2, y: 1.55 };
}

/** The damage state for a commander at hp / max hp. */
export function keepState(frac: number): KeepState {
  return frac > 0.7 ? "intact" : frac > 0.45 ? "cracked" : frac > 0.2 ? "burning" : "ruined";
}

/** Where a blow from (fx, fy) lands on the keep's wall: on the side facing the attacker, partway up the tower. */
export function keepHitPoint(side: Side, fx: number, fy: number): { x: number; y: number } {
  const k = keepAnchor(side);
  const cx = k.x, cy = k.y - 0.55;
  const dx = fx - cx, dy = fy - cy, d = Math.hypot(dx, dy) || 1;
  return { x: cx + (dx / d) * 0.6, y: cy + (dy / d) * 0.38 };
}

/** A manifest anchor (image pixels) as a board position. */
export function keepPoint(side: Side, px: [number, number], m: KeepManifest = manifest ?? DEFAULT): { x: number; y: number } {
  const k = keepAnchor(side), g = m.anchors.ground, u = KEEP_SCALE / m.ppu;
  return { x: k.x + (px[0] - g[0]) * u, y: k.y + (px[1] - g[1]) * u };
}

/** True when a body at (x, y) stands behind the keep, so the keep should go see-through. */
export function behindKeep(side: Side, x: number, y: number, r = 0.3): boolean {
  const k = keepAnchor(side);
  return Math.abs(x - k.x) < KEEP_RX * 0.85 + r * 0.5 && y < k.y - 0.15 && y > k.y - KEEP_TALL + 0.1;
}

// ------------------------------------------------------------ art
let manifest: KeepManifest | null = null;
let loading: Promise<void> | null = null;
const images = new Map<string, HTMLImageElement>();
const base = () => (import.meta as any).env?.BASE_URL ?? "./";
const teamName = (s: Side) => (s === 0 ? "tide" : "ember");

export function keepManifest(): KeepManifest { return manifest ?? DEFAULT; }

/** Fetches the manifest and starts every state image loading (8 small PNGs). */
export function loadKeeps(): Promise<void> {
  if (loading) return loading;
  loading = fetch(`${base()}keeps/manifest.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => { manifest = m ?? DEFAULT; })
    .catch(() => { manifest = DEFAULT; })
    .then(() => {
      for (const s of [0, 1] as Side[]) for (const st of KEEP_STATES) keepImage(s, st);
    });
  return loading;
}

/** The image for a keep state once loaded, else null (the board then draws nothing for the keep). */
export function keepImage(side: Side, state: KeepState): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  const key = `${teamName(side)}_${state}`;
  let i = images.get(key);
  if (!i) {
    i = new Image();
    i.decoding = "async";
    i.src = `${base()}keeps/${key}.png`;
    images.set(key, i);
  }
  return i.complete && i.naturalWidth ? i : null;
}
