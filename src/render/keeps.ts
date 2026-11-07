// Commander keeps: one Blender-rendered keep per side (art/keeps/render_keeps.py -> public/keeps), sitting behind
// its deploy zone. The damage state follows the commander's shown hp over max hp, so the keep breaks up as the
// health bar drains. Geometry here is pure (used by the assault and tests); images load lazily like the sprites.
import { H, W, type Side } from "../core/defs";

export type KeepState = "intact" | "cracked" | "burning" | "ruined";
export const KEEP_STATES: KeepState[] = ["intact", "cracked", "burning", "ruined"];
/** Every rendered image: the four damage states plus the rubble left once a commander is defeated. */
export type KeepArt = KeepState | "fallen";
export const KEEP_ARTS: KeepArt[] = [...KEEP_STATES, "fallen"];

export interface KeepManifest {
  ppu: number; w: number; h: number;
  anchors: { ground: [number, number]; gate: [number, number]; top: [number, number]; pole?: [number, number]; fires: [number, number][]; smoke: [number, number][] };
}

/** What the renderer ships with (public/keeps/manifest.json); used for geometry before the fetch lands. */
const DEFAULT: KeepManifest = {
  ppu: 128, w: 372, h: 380,
  anchors: {
    ground: [188.5, 246.1], gate: [188.5, 293.8], top: [188.5, 125.0], pole: [188.5, 33.9],
    fires: [[194.9, 136.0], [134.7, 228.8], [299.8, 169.5], [233.3, 258.2]],
    smoke: [[188.5, 194.7], [124.5, 251.3], [265.3, 226.7]],
  },
};

/** Drawn at true scale: big enough to own the end of the board, still clear of the lanes either side (it has no
 *  collision, and it goes see-through when a body walks behind it). */
export const KEEP_SCALE = 1.08;
/** Half-extents of the keep's plinth on the board, world units (for attacker slots and the see-through test). */
export const KEEP_RX = 1.22;
export const KEEP_RY = 0.74;
/** How far the keep rises above its ground anchor, world units (the flag tip). */
export const KEEP_TALL = 2.0;

/** The keep's ground anchor (centre of its footprint) on the board. */
export function keepAnchor(side: Side): { x: number; y: number } {
  return side === 0 ? { x: W / 2, y: H - 0.6 } : { x: W / 2, y: 1.55 };
}

/** The damage state for a commander at hp / max hp. Intact above 70%; cracked (stones out, banners torn) to 45%;
 *  burning (roof caved in, smoking) to 20%; then ruined. */
export function keepState(frac: number): KeepState {
  return frac > 0.7 ? "intact" : frac > 0.45 ? "cracked" : frac > 0.2 ? "burning" : "ruined";
}

/** Where a blow from (fx, fy) lands on the keep's wall: on the side facing the attacker, partway up the tower. */
export function keepHitPoint(side: Side, fx: number, fy: number): { x: number; y: number } {
  const k = keepAnchor(side);
  const g = KEEP_SCALE / 0.8; // the offsets were set for the keep at 0.8 scale
  const cx = k.x, cy = k.y - 0.55 * g;
  const dx = fx - cx, dy = fy - cy, d = Math.hypot(dx, dy) || 1;
  return { x: cx + (dx / d) * 0.6 * g, y: cy + (dy / d) * 0.38 * g };
}

/** A manifest anchor (image pixels) as a board position. */
export function keepPoint(side: Side, px: [number, number], m: KeepManifest = manifest ?? DEFAULT): { x: number; y: number } {
  const k = keepAnchor(side), g = m.anchors.ground, u = KEEP_SCALE / m.ppu;
  return { x: k.x + (px[0] - g[0]) * u, y: k.y + (px[1] - g[1]) * u };
}

/** True when a body at (x, y) stands behind the keep's solid tower (not just its flag or the plinth's flanks),
 *  so the keep should go see-through. Kept tight so the keep only fades when it would really hide someone. */
export function behindKeep(side: Side, x: number, y: number, r = 0.3): boolean {
  const k = keepAnchor(side);
  return Math.abs(x - k.x) < KEEP_RX * 0.72 + r * 0.5 && y < k.y - 0.2 && y > k.y - KEEP_TALL * 0.82;
}

// ------------------------------------------------------------ art
let manifest: KeepManifest | null = null;
let loading: Promise<void> | null = null;
const images = new Map<string, HTMLImageElement>();
const base = () => (import.meta as any).env?.BASE_URL ?? "./";
const teamName = (s: Side) => (s === 0 ? "tide" : "ember");

export function keepManifest(): KeepManifest { return manifest ?? DEFAULT; }

/** Fetches the manifest and starts every state image loading (two teams, five images each; the boss variant loads
 *  on first use). */
export function loadKeeps(): Promise<void> {
  if (loading) return loading;
  loading = fetch(`${base()}keeps/manifest.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => { manifest = m ?? DEFAULT; })
    .catch(() => { manifest = DEFAULT; })
    .then(() => {
      for (const s of [0, 1] as Side[]) for (const st of KEEP_ARTS) keepImage(s, st);
    });
  return loading;
}

/** The image file for a side's keep in a state; the rival's keep on a boss level is the crowned variant. */
export function keepFile(side: Side, state: KeepArt, boss = false): string {
  return `${teamName(side)}${boss && side === 1 ? "_boss" : ""}_${state}.webp`;
}

/** The image for a keep state once loaded, else null (the board then draws nothing for the keep). A boss keep
 *  falls back to the plain one until its own image has loaded. */
export function keepImage(side: Side, state: KeepArt, boss = false): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  if (boss && side === 1) return loadImage(keepFile(side, state, true)) ?? loadImage(keepFile(side, state));
  return loadImage(keepFile(side, state));
}

function loadImage(file: string): HTMLImageElement | null {
  const key = file;
  let i = images.get(key);
  if (!i) {
    i = new Image();
    i.decoding = "async";
    i.src = `${base()}keeps/${file}`;
    images.set(key, i);
  }
  return i.complete && i.naturalWidth ? i : null;
}

// ------------------------------------------------------------ hit, collapse and victory beats (pure timing)
/** The keep's own squash on a blow, t seconds after it, with strength k (0.5 a light hit .. 1.4 a big one):
 *  it squashes down and spreads, springs up past rest, and settles in about half a second. Scale about the ground. */
export function keepSquash(t: number, k = 1): { sx: number; sy: number } {
  if (!(t >= 0) || t > 0.6 || k <= 0) return { sx: 1, sy: 1 };
  const a = Math.min(1.4, k) * 0.075 * Math.exp(-t * 7.5) * Math.cos(t * 26);
  return { sx: 1 + a * 0.6, sy: 1 - a };
}

/** Seconds from a commander's defeat until the rubble has settled. */
export const COLLAPSE_TIME = 1.7;
/** When the winner's banner starts up its pole, seconds after the rival keep starts to fall, and how long it takes. */
export const RAISE_FROM = 0.75;
export const RAISE_TIME = 0.85;
/** How long the round-end assault holds for the collapse and the banner before the result screen. */
export const VICTORY_HOLD = RAISE_FROM + RAISE_TIME + 0.55;

export interface CollapsePose {
  /** 0..1 rumble on the standing keep before it goes. */
  shake: number;
  /** How far the standing keep has sunk, as a fraction of its image height. */
  sink: number;
  /** Lean of the falling keep, radians (signed by `dir`). */
  tilt: number;
  /** Opacity of the standing keep (it crumbles away as it sinks). */
  alpha: number;
  /** Opacity of the rubble image underneath. */
  rubble: number;
  /** True in the slice where the tower hits the ground (the big dust burst). */
  phase: "rumble" | "fall" | "settled";
}

/** The collapse, t seconds after the commander's hp reached zero: a short rumble, then the tower drops into its
 *  plinth with a lean, leaving the rubble. */
export function collapsePose(t: number, dir = 1): CollapsePose {
  const RUMBLE = 0.32, FALL = 0.85;
  if (t < RUMBLE) return { shake: Math.max(0, t / RUMBLE), sink: 0, tilt: 0, alpha: 1, rubble: 0, phase: "rumble" };
  const u = Math.min(1, (t - RUMBLE) / FALL);
  if (u < 1) {
    const e = u * u; // accelerates down
    return { shake: 1 - u * 0.5, sink: e * 0.55, tilt: dir * e * 0.09, alpha: 1 - Math.max(0, (u - 0.55) / 0.45), rubble: Math.min(1, u * 2.5), phase: "fall" };
  }
  return { shake: 0, sink: 0.55, tilt: 0, alpha: 0, rubble: 1, phase: "settled" };
}

/** How far up its pole the winner's banner is, 0..1 (with a little overshoot), t seconds after the rival fell. */
export function bannerRaise(t: number): number {
  const u = (t - RAISE_FROM) / RAISE_TIME;
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  // ease out with a small overshoot (back-out)
  const c = 1.6, v = u - 1;
  return 1 + (c + 1) * v * v * v + c * v * v;
}

/** The winner's banner run up a pole over its keep: a gold-tipped pole and a big swallowtail in team colour that
 *  waves as it climbs. (x, y) is the pole's foot on screen, `len` its height in pixels, `raise` 0..1. */
export function drawVictoryBanner(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, raise: number, t: number, col: { main: string; dark: string; light: string }, gold: string, ink: string) {
  if (raise <= 0) return;
  const lw = Math.max(1.5, len * 0.045);
  const grow = Math.min(1, raise * 3); // the pole shoots up first, then the cloth climbs it
  const top = y - len * grow;
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = ink; ctx.lineWidth = lw + 3;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, top); ctx.stroke();
  ctx.strokeStyle = "#7a4b2a"; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, top); ctx.stroke();
  ctx.fillStyle = gold; ctx.strokeStyle = ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, top, lw * 1.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // the cloth: climbs from the foot to the top of the pole
  const fh = len * 0.42, fw = len * 0.62;
  const fy = y - fh - (len - fh - lw * 1.5) * Math.max(0, Math.min(1.08, raise));
  const wave = (k: number) => Math.sin(t * 7 - k * 3.2) * fh * 0.09 * k;
  const pts: [number, number][] = [];
  const N = 6;
  for (let i = 0; i <= N; i++) { const k = i / N; pts.push([x + fw * k, fy + wave(k)]); }
  pts.push([x + fw * 0.74, fy + fh * 0.5 + wave(0.74)]);
  for (let i = N; i >= 0; i--) { const k = i / N; pts.push([x + fw * k, fy + fh + wave(k)]); }
  const path = () => { ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); };
  ctx.lineJoin = "round";
  path(); ctx.fillStyle = col.main; ctx.fill();
  ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.stroke();
  // a darker lower band, a gold stripe and a gold diamond emblem
  ctx.save(); path(); ctx.clip();
  ctx.fillStyle = col.dark; ctx.globalAlpha = 0.55;
  ctx.fillRect(x, fy + fh * 0.72, fw, fh);
  ctx.globalAlpha = 1;
  ctx.fillStyle = col.light; ctx.globalAlpha = 0.35;
  ctx.fillRect(x, fy, fw, fh * 0.16);
  ctx.restore();
  ctx.fillStyle = gold; ctx.strokeStyle = ink; ctx.lineWidth = 2;
  const ex = x + fw * 0.34, ey = fy + fh * 0.5 + wave(0.34), er = fh * 0.24;
  ctx.beginPath(); ctx.moveTo(ex, ey - er); ctx.lineTo(ex + er * 0.75, ey); ctx.lineTo(ex, ey + er); ctx.lineTo(ex - er * 0.75, ey); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}
