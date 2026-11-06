// Blender-rendered arenas (public/arenas, see docs/ARENAS.md and art/arenas/render_arenas.py): one backdrop per
// campaign act plus obstacle props. Loaded lazily; until the images are ready the board paints its drawn terrain.
import type { Obstacle } from "../core/defs";

export interface ArenaProp { file: string; footprint: number; cx: number; }
export interface ArenaAct {
  name: string;
  edge: string;
  obstacle: string;
  ground: string;
  size: [number, number];
  anchor: [number, number];
  props: ArenaProp[];
}
export interface ArenaManifest {
  version: number;
  /** Camera elevation in degrees: the ground is foreshortened by sin(elev) in the images. */
  elev: number;
  ppu: number;
  /** The board-space rectangle the backdrop covers. */
  world: { x: number; y: number; w: number; h: number };
  /** Prop sprite frame width in prop radii, and its pixel size. */
  propFrame: number;
  propRes: number;
  acts: Record<string, ArenaAct>;
}

export const ARENA_COUNT = 7;

let manifest: ArenaManifest | null = null;
let loading: Promise<ArenaManifest | null> | null = null;
const images = new Map<string, HTMLImageElement | null>();

const base = () => (import.meta as any).env?.BASE_URL ?? "./";

export function loadArenas(): Promise<ArenaManifest | null> {
  if (loading) return loading;
  loading = fetch(`${base()}arenas/manifest.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => (manifest = m))
    .catch(() => (manifest = null));
  return loading;
}

/** The act whose arena to use: the level's act if there is an arena for it, else act 1. */
export function arenaAct(act: number | undefined, m: Pick<ArenaManifest, "acts"> | null = manifest): number {
  const a = Math.floor(act ?? 1);
  if (!m) return a >= 1 && a <= ARENA_COUNT ? a : 1;
  return m.acts[String(a)] ? a : 1;
}

/** Loads an image once; resolves when decoded (null on error). */
function load(url: string): Promise<HTMLImageElement | null> {
  const have = images.get(url);
  if (have !== undefined && have?.complete) return Promise.resolve(have);
  return new Promise((res) => {
    const i = new Image();
    i.decoding = "async";
    i.onload = () => { images.set(url, i); res(i); };
    i.onerror = () => { images.set(url, null); res(null); };
    i.src = url;
  });
}

export interface Arena {
  act: number;
  info: ArenaAct;
  m: ArenaManifest;
  ground: HTMLImageElement;
  props: HTMLImageElement[];
}

/** Loads the arena for an act (falling back to act 1). Null if the art isn't there. */
export async function arenaFor(act: number | undefined): Promise<Arena | null> {
  const m = await loadArenas();
  if (!m) return null;
  const a = arenaAct(act, m);
  const info = m.acts[String(a)];
  if (!info) return null;
  const [ground, ...props] = await Promise.all([info.ground, ...info.props.map((p) => p.file)].map((f) => load(`${base()}arenas/${f}`)));
  if (!ground) return null;
  return { act: a, info, m, ground, props: props.filter((p): p is HTMLImageElement => !!p) };
}

/** Which prop variant an obstacle gets: stable for its position so it doesn't change between rounds. */
export function propVariant(o: Obstacle, n: number): number {
  if (n <= 1) return 0;
  const h = Math.abs(Math.sin(o.x * 12.9898 + o.y * 78.233) * 43758.5453) % 1;
  return Math.min(n - 1, Math.floor(h * n));
}

/**
 * Where a prop sprite goes on screen for an obstacle with radius r whose centre is at screen (sx, sy), with `s`
 * screen px per board unit. Props are modelled with their silhouette exactly on the unit circle, so prop radius 1
 * maps to r. `stretch` is the vertical scale from the render camera to the board's: 1 / sin(elev) on the flat board
 * (the ground then lines up exactly and upright parts lean up the screen), 1 on a camera tilted like the render.
 */
export function propRect(m: Pick<ArenaManifest, "propFrame">, info: Pick<ArenaAct, "anchor">, sx: number, sy: number, r: number, s: number, stretch: number) {
  const w = m.propFrame * r * s;
  const h = w * stretch;
  return { x: sx - w * info.anchor[0], y: sy - h * info.anchor[1], w, h };
}

/** The vertical stretch that maps the render camera onto the flat board. */
export const flatStretch = (m: Pick<ArenaManifest, "elev">) => 1 / Math.sin((m.elev * Math.PI) / 180);
