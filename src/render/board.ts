// The board view: draws the deploy scene and the battle as a 3/4 diorama, turns battle events into effects.
// The sim is 2D; Camera (camera.ts) projects it. Draw order every frame: the warped ground texture, ground decals
// (zones, contact shadows, mines, mounds), upright things sorted by ground y, the air layer, then bars and effects.
import type { Battle, BattleEvent, Body, Proj } from "../core/battle";
import { H, UNITS, W, ZONE_DEPTH, bodyDef, toWorld, type BodyKind, type Obstacle, type Piece, type Side, type UnitKind } from "../core/defs";
import { Camera, SLAB, sortDrawables, type Drawable, type Rect, type ScreenPt } from "./camera";
import { Fx, frand } from "./fx";
import { BOARD, GOLD, HEAL, INK, TEAM, VIOLET, ZAP, team } from "./palette";
import { frame, hasAtlas, spriteHeight } from "./sprites";
import { SPRITE_VIS, animFor, drawFrame, drawRank, drawUnit, type DrawOpts } from "./units";
import { Assault, type AssaultEvent, type Shot, type Striker } from "./assault";
import { KEEP_RY, KEEP_SCALE, KEEP_STATES, behindKeep, keepAnchor, keepHitPoint, keepImage, keepManifest, keepState, loadKeeps, type KeepState } from "./keeps";

export type { Rect } from "./camera";

export interface DeployScene {
  mode: "deploy";
  pieces: Piece[];
  /** Pieces to draw faintly (the other side's mines in puzzles). */
  showEnemyMines?: boolean;
  ghost?: { kind: UnitKind; x: number; y: number; ok: boolean };
  selected?: number;
  zone?: Side | null;
}
export interface BattleScene {
  mode: "battle";
  battle: Battle;
  alpha: number;
}
export type Scene = DeployScene | BattleScene;

/** Seconds the leftovers (mid-death bodies, illusions) take to clear once the assault begins. */
const VANISH = 0.4;
/** Height on the keep's wall where blows land, world units. */
const WALL_Z = 0.75;
const TAU = Math.PI * 2;
const RADIUS = (k: BodyKind): number => bodyDef(k)?.radius ?? 0.3;
const ICE = "#bfe9ff";
const DIRT = "rgba(120,92,60,0.9)";
/** How high a body's sprite centre rides above its feet, as a fraction of its radius. */
const LIFT = 0.55;
/** World height of a flyer per unit of the sim's altitude z. */
const AIR = 0.75;

type TokenOpts = DrawOpts & { rank?: number; flat?: boolean };

export class BoardView {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly fx = new Fx();
  readonly cam = new Camera(W, H);
  dpr = 1;
  cssW = 0; cssH = 0;
  /** The screen box of the board's ground (for UI placement). */
  rect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  /** The layout area the board was fitted into (heads and flyers may use all of it). */
  area: Rect = { x: 0, y: 0, w: 0, h: 0 };
  time = 0;
  obstacles: Obstacle[] = [];
  onShake?: (amount: number) => void;
  onSound?: (name: string, gain?: number) => void;
  private bg?: HTMLCanvasElement;
  private reveal = new Map<number, number>(); // piece id -> time revealed
  /** Each commander's shown hp over max hp: drives the keep's damage state (the game keeps it in step with the bar). */
  keepHp: [number, number] = [1, 1];
  /** Draw the commander keeps (off for boards with no commanders to show). */
  showKeeps = true;
  /** The round-end march on the losing keep, while it plays. */
  assault?: Assault;
  private keeps = [0, 1].map(() => ({ state: "" as KeepState | "", flash: 0, shake: 0, alpha: 1, see: false, ember: 0, smoke: 0 }));

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    void loadKeeps();
  }

  /** Pixels per world unit at the middle of the board (for effects that don't care about depth). */
  get s() { return this.cam.scaleAt(H / 2); }

  layout(cssW: number, cssH: number, area: Rect) {
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.cssW = cssW; this.cssH = cssH;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = cssW + "px";
    this.canvas.style.height = cssH + "px";
    this.area = { ...area };
    this.cam.fit(area);
    this.rect = this.cam.groundRect();
    this.bg = undefined;
  }

  setObstacles(o: Obstacle[] | undefined) {
    this.obstacles = o ?? [];
    this.bg = undefined;
  }

  /** World (on the ground, or at height z) to screen. */
  toScreen(x: number, y: number, z = 0): ScreenPt { return this.cam.project(x, y, z); }
  /** Screen to the ground point under it. */
  toWorld(px: number, py: number) { return this.cam.unproject(px, py); }
  /** Screen to the point at height z under it (for picking standing figures). */
  toWorldAt(px: number, py: number, z: number) { return this.cam.unprojectAt(px, py, z); }

  /** Run fn with the context mapped to the ground plane around (x, y): units are world units, origin at (x, y, z). */
  private ground(x: number, y: number, fn: (ctx: CanvasRenderingContext2D) => void, z = 0) {
    const ctx = this.ctx, p = this.cam.project(x, y, z), k = this.cam.squashAt(y);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(p.s, p.s * k);
    fn(ctx);
    ctx.restore();
  }

  /** A soft contact shadow on the ground (r in world units). */
  private shadow(x: number, y: number, r: number, alpha: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    this.cam.groundPath(ctx, x + r * 0.08, y + r * 0.1, r);
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------ background
  /** The board as a flat top-down texture, ppu pixels per world unit. */
  private paintGround(ppu: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    const w = Math.round(W * ppu), h = Math.round(H * ppu);
    c.width = w; c.height = h;
    const g = c.getContext("2d")!;
    const s = ppu, X = (x: number) => x * s, Y = (y: number) => y * s;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#1d1714");
    grad.addColorStop(0.5, BOARD.base0);
    grad.addColorStop(1, "#0f1c22");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // Contour lines: a terrain map, not a grid.
    g.strokeStyle = BOARD.line; g.lineWidth = s * 0.03;
    for (let k = 0; k < 14; k++) {
      g.beginPath();
      for (let i = 0; i <= 60; i++) {
        const u = i / 60;
        const yy = (k / 13) * h + Math.sin(u * 7 + k * 1.3) * s * 0.35 + Math.sin(u * 17 + k) * s * 0.1;
        i ? g.lineTo(u * w, yy) : g.moveTo(u * w, yy);
      }
      g.stroke();
    }
    const hash = (i: number, k: number) => Math.abs((Math.sin(i * 127.1 + k * 311.7) * 43758.5453) % 1);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = i % 3 ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.18)";
      g.fillRect(hash(i, 21) * w, hash(i, 22) * h, s * 0.04, s * 0.04);
    }
    // Terrain: soft patches of moss, dirt and shade, then tufts and pebbles.
    for (let i = 0; i < 46; i++) {
      const px = hash(i, 1) * w, py = hash(i, 2) * h, pr = (0.8 + hash(i, 3) * 2.2) * s;
      const col = i % 3 === 0 ? "rgba(70,110,80,0.13)" : i % 3 === 1 ? "rgba(110,85,60,0.10)" : "rgba(0,0,0,0.14)";
      const rg = g.createRadialGradient(px, py, 0, px, py, pr);
      rg.addColorStop(0, col); rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg;
      g.beginPath(); g.ellipse(px, py, pr * 1.4, pr, hash(i, 4) * 3, 0, TAU); g.fill();
    }
    g.lineCap = "round";
    for (let i = 0; i < 110; i++) {
      const px = hash(i, 5) * w, py = hash(i, 6) * h, k = s * (0.07 + hash(i, 7) * 0.08);
      g.strokeStyle = `rgba(${110 + hash(i, 8) * 40},${150 + hash(i, 9) * 40},${110},${0.07 + hash(i, 10) * 0.08})`;
      g.lineWidth = s * 0.03;
      for (const a of [-0.5, 0, 0.5]) { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.sin(a) * k, py - Math.cos(a) * k * 1.4); g.stroke(); }
    }
    for (let i = 0; i < 70; i++) {
      const px = hash(i, 11) * w, py = hash(i, 12) * h, pr = s * (0.03 + hash(i, 13) * 0.05);
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.beginPath(); g.ellipse(px + pr * 0.3, py + pr * 0.4, pr, pr * 0.75, 0, 0, TAU); g.fill();
      g.fillStyle = `rgba(${140 + hash(i, 14) * 50},${140 + hash(i, 14) * 50},${150},0.45)`;
      g.beginPath(); g.ellipse(px, py, pr, pr * 0.75, 0, 0, TAU); g.fill();
    }
    // Zones and the no-man's band.
    for (const sd of [0, 1] as Side[]) {
      const a = toWorld(sd, 0, 0), b = toWorld(sd, 0, ZONE_DEPTH);
      const y0 = Y(Math.min(a.y, b.y)), y1 = Y(Math.max(a.y, b.y));
      const zg = g.createLinearGradient(0, sd === 0 ? y1 : y0, 0, sd === 0 ? y0 : y1);
      zg.addColorStop(0, team(sd).glow + "0.16)");
      zg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = zg;
      g.fillRect(0, y0, w, y1 - y0);
    }
    for (const sd of [0, 1] as Side[]) {
      const ey = Y(sd === 0 ? H - 0.12 : 0.12);
      const lg = g.createLinearGradient(0, 0, w, 0);
      lg.addColorStop(0, team(sd).glow + "0)"); lg.addColorStop(0.5, team(sd).glow + "0.7)"); lg.addColorStop(1, team(sd).glow + "0)");
      g.strokeStyle = lg; g.lineWidth = s * 0.08;
      g.beginPath(); g.moveTo(0, ey); g.lineTo(w, ey); g.stroke();
    }
    const top = Y(toWorld(1, 0, ZONE_DEPTH).y), bot = Y(toWorld(0, 0, ZONE_DEPTH).y);
    g.fillStyle = BOARD.band;
    g.fillRect(0, top, w, bot - top);
    g.setLineDash([s * 0.25, s * 0.2]);
    g.strokeStyle = "rgba(255,255,255,0.08)"; g.lineWidth = s * 0.05;
    g.beginPath(); g.moveTo(0, (top + bot) / 2); g.lineTo(w, (top + bot) / 2); g.stroke();
    g.setLineDash([]);
    // Ambient occlusion where the rocks sit (the rocks themselves stand up in the sorted pass).
    for (const o of this.obstacles) {
      const rg = g.createRadialGradient(X(o.x), Y(o.y), o.r * s * 0.6, X(o.x), Y(o.y), o.r * s * 1.5);
      rg.addColorStop(0, "rgba(0,0,0,0.45)"); rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg;
      g.beginPath(); g.arc(X(o.x), Y(o.y), o.r * s * 1.5, 0, TAU); g.fill();
    }
    return c;
  }

  /** The screen backdrop: surround, the board's front face, and the ground texture warped into perspective. */
  private paintBackground(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = this.canvas.width; c.height = this.canvas.height;
    const g = c.getContext("2d")!;
    const dpr = this.dpr, cam = this.cam;
    g.scale(dpr, dpr);
    const bgr = g.createLinearGradient(0, 0, 0, this.cssH);
    bgr.addColorStop(0, "#05070c"); bgr.addColorStop(1, "#0b1018");
    g.fillStyle = bgr;
    g.fillRect(0, 0, this.cssW, this.cssH);
    const c00 = cam.project(0, 0), c10 = cam.project(W, 0), c01 = cam.project(0, H), c11 = cam.project(W, H);
    const d01 = cam.project(0, H, -SLAB), d11 = cam.project(W, H, -SLAB);
    // A soft drop shadow under the whole diorama.
    g.save();
    g.shadowColor = "rgba(0,0,0,0.7)"; g.shadowBlur = 28; g.shadowOffsetY = 10;
    g.fillStyle = "#10151d";
    g.beginPath(); g.moveTo(c00.x, c00.y); g.lineTo(c10.x, c10.y); g.lineTo(d11.x, d11.y); g.lineTo(d01.x, d01.y); g.closePath(); g.fill();
    g.restore();
    // The front face of the board: a slab of earth.
    const fg = g.createLinearGradient(0, c01.y, 0, d01.y);
    fg.addColorStop(0, "#3a2c20"); fg.addColorStop(0.35, "#2a1f17"); fg.addColorStop(1, "#140f0b");
    g.fillStyle = fg;
    g.beginPath(); g.moveTo(c01.x, c01.y); g.lineTo(c11.x, c11.y); g.lineTo(d11.x, d11.y); g.lineTo(d01.x, d01.y); g.closePath(); g.fill();
    g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const u = i / 4, l = cam.project(0, H, -SLAB * u), r = cam.project(W, H, -SLAB * u);
      g.beginPath(); g.moveTo(l.x, l.y + Math.sin(i * 3.1) * 1.5); g.lineTo(r.x, r.y - Math.sin(i * 2.3) * 1.5); g.stroke();
    }
    // The ground: each screen row is one world row scaled across, so a row-by-row copy is an exact warp.
    const ppu = Math.max(16, Math.min(2048 / W, Math.ceil(cam.scaleAt(H) * dpr)));
    const tex = this.paintGround(ppu);
    const top = Math.floor(c00.y * dpr), bot = Math.ceil(c01.y * dpr);
    g.imageSmoothingEnabled = true;
    for (let row = top; row < bot; row++) {
      const ya = Math.max(0, cam.unproject(c00.x, row / dpr).y), yb = Math.min(H, cam.unproject(c00.x, (row + 1) / dpr).y);
      if (!(yb > ya)) continue;
      const ym = (ya + yb) / 2, l = cam.project(0, ym).x, r = cam.project(W, ym).x;
      g.drawImage(tex, 0, ya * ppu, tex.width, Math.max(0.5, (yb - ya) * ppu), l, row / dpr, r - l, 1 / dpr + 0.02);
    }
    // A lit lip along the near edge, and a vignette that darkens toward the far edge.
    g.strokeStyle = "rgba(255,240,210,0.16)"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(c01.x, c01.y); g.lineTo(c11.x, c11.y); g.stroke();
    g.save();
    g.beginPath(); g.moveTo(c00.x, c00.y); g.lineTo(c10.x, c10.y); g.lineTo(c11.x, c11.y); g.lineTo(c01.x, c01.y); g.closePath(); g.clip();
    const rr = this.rect;
    const vg = g.createRadialGradient(rr.x + rr.w / 2, rr.y + rr.h * 0.6, Math.min(rr.w, rr.h) * 0.3, rr.x + rr.w / 2, rr.y + rr.h * 0.6, Math.max(rr.w, rr.h) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.45)");
    g.fillStyle = vg; g.fillRect(rr.x, rr.y, rr.w, rr.h);
    const hz = g.createLinearGradient(0, rr.y, 0, rr.y + rr.h * 0.35);
    hz.addColorStop(0, "rgba(4,6,10,0.35)"); hz.addColorStop(1, "rgba(4,6,10,0)");
    g.fillStyle = hz; g.fillRect(rr.x, rr.y, rr.w, rr.h * 0.35);
    g.restore();
    return c;
  }

  // ------------------------------------------------------------ events -> effects
  consume(battle: Battle) {
    const ev = battle.events;
    for (const e of ev) this.onEvent(e, battle);
    ev.length = 0;
  }

  markReveal(ids: number[]) {
    for (const id of ids) this.reveal.set(id, this.time);
  }

  private onEvent(e: BattleEvent, battle: Battle) {
    const fx = this.fx;
    const snd = (n: string, g = 0.5) => this.onSound?.(n, g);
    switch (e.t) {
      case "slash":
        if (e.spin) { fx.ring(e.x, e.y, e.r * 0.4, e.r, 0.22, e.side === 0 ? "#e9fffd" : "#fff0ea", 0.1); snd("slash", 0.6); }
        else fx.arc(e.x, e.y, e.a, e.r, e.side === 0 ? "#e9fffd" : "#fff0ea", 2.0, 0.16);
        snd("slash", 0.35);
        break;
      case "shot":
        snd(e.kind === "grenade" || e.kind === "shell" ? "throw" : e.kind === "bolt" ? "bolt" : e.kind === "shard" ? "zap" : "arrow", e.kind === "shard" ? 0.2 : 0.4);
        break;
      case "hit": {
        const col = e.shielded ? "#cfd8e3" : team((1 - e.side) as Side).light;
        fx.burst(e.x, e.y, e.big ? 7 : 3, { color: col, speed: 2.2, size: 0.05, max: 0.3, gravity: 0, kind: "spark" });
        if (e.dmg >= 18 || e.big) fx.float(e.x, e.y - 0.45, String(e.dmg), e.big ? GOLD : e.shielded ? "#9fb0c0" : "#ffffff", e.big ? 0.38 : 0.28);
        snd(e.shielded ? "clank" : "hit", e.big ? 0.6 : 0.25);
        break;
      }
      case "boom": this.boom(e.x, e.y, e.r, e.kind, e.side); break;
      case "zap":
        fx.bolt(e.pts, ZAP, 0.26);
        for (const [x, y] of e.pts.slice(1)) fx.burst(x, y, 4, { color: "#dff1ff", speed: 2.4, size: 0.04, max: 0.25, kind: "spark", gravity: 0 });
        fx.flash = Math.max(fx.flash, 0.08); fx.flashColor = "#cfe8ff";
        snd("zap", 0.6);
        break;
      case "heal": {
        const from = battle.bodies.find((b) => b.id === e.from);
        if (from && e.from !== e.to) fx.beam(from.x, from.y, e.x, e.y, HEAL, 0.06, 0.28);
        fx.burst(e.x, e.y, e.from === e.to ? 2 : 4, { color: e.from === e.to ? "#ff8a8a" : HEAL, speed: 0.6, size: 0.1, max: 0.7, kind: "plus", gravity: -1.2, drag: 3, z: 0.2 });
        snd("heal", 0.2);
        break;
      }
      case "spawn":
        fx.ring(e.x, e.y, 0.05, 0.35, 0.25, team(e.side).light, 0.04);
        break;
      case "death": {
        const col = team(e.side).main;
        const r = RADIUS(e.kind);
        fx.ring(e.x, e.y, r * 0.6, r * 1.8, 0.35, col, 0.05);
        fx.burst(e.x, e.y, e.kind === "mite" ? 4 : 12, { color: col, speed: 2.2, size: 0.07, max: 0.6, kind: "chunk", vz: 3, spin: 8 });
        if (e.kind === "golem") { fx.shake = Math.min(1, fx.shake + 0.5); snd("crumble", 0.9); }
        else if (e.kind === "keg") { fx.burst(e.x, e.y, 10, { color: "rgba(80,80,80,0.7)", speed: 1, size: 0.2, max: 0.9, kind: "smoke", gravity: 0 }); snd("squish", 0.5); }
        else snd(e.kind === "mite" ? "squish" : "down", 0.4);
        break;
      }
      case "blink":
        fx.burst(e.x0, e.y0, 10, { color: VIOLET, speed: 1.2, size: 0.18, max: 0.5, kind: "smoke", gravity: 0, drag: 2 });
        fx.burst(e.x, e.y, 12, { color: VIOLET, speed: 1.6, size: 0.16, max: 0.5, kind: "smoke", gravity: 0, drag: 2 });
        fx.beam(e.x0, e.y0, e.x, e.y, "rgba(180,140,255,0.5)", 0.05, 0.18);
        snd("blink", 0.5);
        break;
      case "charge":
        fx.burst(e.x, e.y, 8, { color: "rgba(180,160,130,0.6)", speed: 1.5, size: 0.14, max: 0.5, kind: "smoke", gravity: 0, dir: e.a + Math.PI, spread: 1.4 });
        snd("charge", 0.6);
        break;
      case "fuse":
        fx.ring(e.x, e.y, 0.2, 1.0, 0.32, "#ff4d4d", 0.04);
        snd("fuse", 0.6);
        break;
      // ---- v2
      case "burrow":
        fx.burst(e.x, e.y, 14, { color: DIRT, speed: 1.8, size: 0.08, max: 0.6, kind: "chunk", vz: 3, spin: 6 });
        snd("slam", 0.3);
        break;
      case "dig":
        fx.burst(e.x, e.y, 2, { color: DIRT, speed: 0.6, size: 0.07, max: 0.9, kind: "chunk", vz: 1.5, drag: 4 });
        if (Math.random() < 0.5) fx.burst(e.x, e.y, 1, { color: "rgba(110,85,55,0.5)", speed: 0.2, size: 0.18, max: 1.2, kind: "smoke", gravity: 0 });
        break;
      case "emerge":
        fx.ring(e.x, e.y, 0.2, e.r, 0.4, "#c9a26b", e.big ? 0.12 : 0.08, "rgba(150,110,60,0.25)");
        fx.burst(e.x, e.y, e.big ? 30 : 18, { color: DIRT, speed: e.big ? 4.5 : 3, size: 0.09, max: 0.7, kind: "chunk", vz: 4, spin: 8 });
        fx.burst(e.x, e.y, 8, { color: "rgba(110,85,55,0.6)", speed: 1.4, size: 0.25, max: 1, kind: "smoke", gravity: 0 });
        fx.shake = Math.min(1, fx.shake + (e.big ? 0.6 : 0.35));
        snd("slam", e.big ? 0.9 : 0.6);
        break;
      case "dive":
        fx.burst(e.x, e.y, 5, { color: "rgba(255,255,255,0.6)", speed: 1.2, size: 0.05, max: 0.3, kind: "spark", gravity: 0 });
        snd("blink", 0.35);
        break;
      case "chill":
        fx.burst(e.x, e.y, 6, { color: ICE, speed: 1.4, size: 0.05, max: 0.45, kind: "spark", gravity: 0 });
        break;
      case "freeze":
        fx.ring(e.x, e.y, 0.1, 0.7, 0.35, ICE, 0.08, "rgba(190,235,255,0.25)");
        fx.burst(e.x, e.y, 14, { color: "#e9f9ff", speed: 2.2, size: 0.06, max: 0.5, kind: "chunk", vz: 2, spin: 6 });
        snd("clank", 0.6);
        break;
      case "aura":
        fx.ring(e.x, e.y, 0.3, e.r, 0.6, e.rally ? "rgba(255,209,102,0.55)" : team(e.side).glow + "0.4)", 0.03);
        break;
      case "parry":
        fx.burst(e.x, e.y, 10, { color: "#fff6d6", speed: 3, size: 0.04, max: 0.25, kind: "spark", gravity: 0 });
        fx.float(e.x, e.y - 0.5, e.riposte ? "RIPOSTE" : "PARRY", "#fff2b8", 0.24, 0.6);
        snd("clank", 0.8);
        break;
      case "brace":
        fx.burst(e.x, e.y, 4, { color: "#e8eef5", speed: 1, size: 0.04, max: 0.25, kind: "spark", gravity: 0, dir: e.a, spread: 0.8 });
        snd("clank", 0.3);
        break;
      case "impale":
        fx.burst(e.x, e.y, 18, { color: "#ffe2a0", speed: 3.5, size: 0.06, max: 0.4, kind: "spark", gravity: 1 });
        fx.float(e.x, e.y - 0.55, "IMPALED", GOLD, 0.3, 0.8);
        fx.shake = Math.min(1, fx.shake + 0.4);
        snd("clank", 1); snd("hit", 1);
        break;
      case "raise":
        fx.ring(e.x, e.y, 0.1, 0.6, 0.45, "rgba(170,255,190,0.7)", 0.05, "rgba(120,255,170,0.15)");
        fx.burst(e.x, e.y, 10, { color: "rgba(150,255,190,0.55)", speed: 0.6, size: 0.14, max: 0.9, kind: "smoke", gravity: -0.6, drag: 1.5 });
        snd("blink", 0.4);
        break;
      case "build":
        fx.ring(e.x, e.y, 0.1, 0.45, 0.3, "#ffd166", 0.04);
        snd("clank", 0.35);
        break;
      case "repair": {
        const from = battle.bodies.find((b) => b.id === e.from);
        if (from) fx.beam(from.x, from.y, e.x, e.y, "rgba(255,200,90,0.8)", 0.05, 0.25);
        fx.burst(e.x, e.y, 5, { color: "#ffd166", speed: 1.2, size: 0.04, max: 0.35, kind: "spark", gravity: 0 });
        snd("clank", 0.25);
        break;
      }
      case "decoy":
        fx.burst(e.x, e.y, 10, { color: "rgba(200,170,255,0.6)", speed: 1.2, size: 0.16, max: 0.5, kind: "smoke", gravity: 0, drag: 2 });
        snd("blink", 0.4);
        break;
      case "pop":
        fx.burst(e.x, e.y, 12, { color: "rgba(200,170,255,0.7)", speed: 1.8, size: 0.12, max: 0.45, kind: "smoke", gravity: 0, drag: 2 });
        fx.ring(e.x, e.y, 0.1, 0.5, 0.25, VIOLET, 0.04);
        snd("squish", 0.5);
        break;
      case "light":
        fx.burst(e.x, e.y, 6, { color: "#ffd166", speed: 1.5, size: 0.04, max: 0.3, kind: "spark", gravity: 0 });
        snd("fuse", 0.5);
        break;
      case "kegdrop": case "bomblets":
        snd("throw", 0.4);
        break;
      case "zone":
        snd("pop", 0.3);
        break;
      case "revive":
        fx.ring(e.x, e.y, 0.1, 1.0, 0.6, "#fff2b8", 0.08, "rgba(255,230,150,0.25)");
        fx.burst(e.x, e.y, 18, { color: "#fff2b8", speed: 1, size: 0.08, max: 1, kind: "plus", gravity: -1.5, drag: 2 });
        fx.float(e.x, e.y - 0.6, "REVIVED", "#fff2b8", 0.3, 1);
        snd("upgrade", 0.6);
        break;
      case "volley":
        snd("arrow", 0.7);
        break;
      case "twin":
        snd("bolt", 0.7);
        break;
      case "reset":
        fx.burst(e.x, e.y, 8, { color: VIOLET, speed: 1.5, size: 0.05, max: 0.4, kind: "spark", gravity: 0 });
        break;
      default:
        break;
    }
  }

  private boom(x: number, y: number, r: number, kind: string, side: Side) {
    const fx = this.fx, snd = (n: string, g = 0.5) => this.onSound?.(n, g);
    const fiery = ["mine", "grenade", "shell", "keg", "bomblet", "shrapnel"].includes(kind);
    const big = kind === "mine" || kind === "keg" || kind === "shell" || kind === "quake";
    if (kind === "quake" || kind === "slam" || kind === "talon" || kind === "erupt") {
      const q = kind === "quake";
      fx.ring(x, y, 0.1, r, q ? 0.55 : 0.32, q ? "#e8d3a8" : "#c9b79c", q ? 0.14 : 0.07, q ? "rgba(200,170,120,0.22)" : undefined);
      if (q) fx.ring(x, y, 0.1, r * 0.6, 0.4, "#fff2d6", 0.06);
      fx.burst(x, y, q ? 26 : 14, { color: "rgba(180,160,130,0.7)", speed: q ? 3.5 : 2.2, size: 0.16, max: 0.7, kind: "smoke", gravity: 0, drag: 2 });
      fx.burst(x, y, q ? 14 : 6, { color: "#6f7782", speed: 2.6, size: 0.06, max: 0.6, kind: "chunk", vz: 3, spin: 6 });
      fx.shake = Math.min(1, fx.shake + (q ? 0.9 : 0.25));
      if (q) this.onShake?.(2);
      snd(q ? "boom" : "slam", q ? 0.9 : 0.6);
      return;
    }
    if (kind === "pop" || kind === "mirror") {
      const col = kind === "pop" ? "rgba(170,255,140,0.8)" : VIOLET;
      fx.ring(x, y, 0.05, r, 0.3, col, 0.05);
      fx.burst(x, y, 12, { color: col, speed: 2.4, size: 0.06, max: 0.4, kind: "spark", gravity: 0 });
      snd("pop", 0.35);
      return;
    }
    if (fiery) {
      fx.ring(x, y, 0.1, r, big ? 0.45 : 0.3, big ? "#ffd27a" : "#ffb347", big ? 0.12 : 0.06, big ? "rgba(255,180,80,0.35)" : undefined);
      fx.burst(x, y, big ? 34 : kind === "bomblet" || kind === "shrapnel" ? 10 : 20, { color: "#ffcf6b", speed: big ? 5 : 3.5, size: 0.07, max: 0.5, kind: "spark", gravity: 2 });
      fx.burst(x, y, big ? 16 : 7, { color: "rgba(60,55,60,0.8)", speed: 1.4, size: 0.28, max: 1.0, kind: "smoke", gravity: 0, drag: 1.5 });
      fx.burst(x, y, big ? 10 : 4, { color: "#3a3a3a", speed: 3, size: 0.07, max: 0.9, kind: "chunk", vz: 4, spin: 9 });
      fx.flash = Math.max(fx.flash, big ? 0.35 : 0.12); fx.flashColor = "#ffd9a0";
      fx.shake = Math.min(1, fx.shake + (big ? 0.8 : 0.25));
      this.onShake?.(big ? 2 : 1);
      snd(big ? "boom" : "pop", big ? 1 : 0.5);
      return;
    }
    fx.ring(x, y, 0.1, r, 0.3, team(side).light, 0.05);
    snd("pop", 0.4);
  }

  // ------------------------------------------------------------ frame
  update(dt: number) {
    this.time += dt;
    this.fx.update(dt);
    if (this.showKeeps) this.updateKeeps(dt);
  }

  render(scene: Scene) {
    const ctx = this.ctx;
    if (!this.bg) this.bg = this.paintBackground();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const sh = this.fx.shake * this.s * 0.14;
    const dx = sh ? frand(-sh, sh) : 0, dy = sh ? frand(-sh, sh) : 0;
    ctx.setTransform(1, 0, 0, 1, dx * this.dpr, dy * this.dpr);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, dx * this.dpr, dy * this.dpr);
    ctx.save();
    // Heads and flyers over the far edge may use the whole layout area.
    ctx.beginPath(); ctx.rect(this.area.x, this.area.y, this.area.w, this.area.h); ctx.clip();
    if (scene.mode === "deploy") this.drawDeploy(scene);
    else this.drawBattle(scene);
    this.drawFx();
    ctx.restore();
    if (this.fx.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = this.fx.flash * 0.5;
      ctx.fillStyle = this.fx.flashColor;
      ctx.fillRect(this.area.x, this.area.y, this.area.w, this.area.h);
      ctx.restore();
    }
  }

  /** Where a body's sprite centre sits on screen (feet at (x, y), z above ground), and its radius in px. */
  private bodyAt(x: number, y: number, z: number, radius: number, flat = false) {
    const p = this.cam.project(x, y, z + (flat ? 0 : radius * LIFT));
    return { x: p.x, y: p.y, r: radius * p.s };
  }

  /** Screen top of a body's figure (for bars and rank pips): the atlas sprite's head when its art is loaded, else
   *  the drawn token's top. radius in world units. */
  private headAt(kind: BodyKind, rank: number, x: number, y: number, z: number, radius: number) {
    const at = this.bodyAt(x, y, z, radius);
    const h = spriteHeight(kind, rank);
    if (!h) return { x: at.x, y: at.y - at.r * 1.3, r: at.r };
    const feet = this.cam.project(x, y, z);
    return { x: at.x, y: Math.min(at.y - at.r * 1.3, feet.y - h * feet.s * (radius / RADIUS(kind)) * SPRITE_VIS), r: at.r };
  }

  /** Draws a body standing at world (x, y), z above the ground. radius in world units. Upright Blender atlas frames
   *  (sprites.ts) anchored at the feet, facing one of 8 screen directions and playing idle/walk/attack/death; the
   *  drawn top-down token on a tilted card stands in until a body's atlas has loaded. */
  private token(kind: BodyKind, side: Side, x: number, y: number, z: number, radius: number, face: number, o: TokenOpts) {
    const ctx = this.ctx;
    const swing = o.swing ?? -1;
    if ((o.rank ?? 1) >= 4 && !o.hidden && !o.flat && o.dying === undefined) {
      // Ascended: a slow pulse of team light on the ground.
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 3 + (o.id ?? 0));
      this.ground(x, y, (g) => {
        const gr = g.createRadialGradient(0, 0, radius * 0.3, 0, 0, radius * 2.1);
        gr.addColorStop(0, team(side).glow + (0.35 * pulse) + ")");
        gr.addColorStop(1, team(side).glow + "0)");
        g.fillStyle = gr;
        g.beginPath(); g.arc(0, 0, radius * 2.1, 0, TAU); g.fill();
      });
    }
    const { anim, phase } = animFor({ ...o, t: o.t ?? this.time });
    const fr = frame(kind, Math.max(1, Math.min(4, o.rank ?? 1)), side, anim, phase, this.cam.facing8(face, y));
    const alive = o.dying === undefined ? 1 : 1 - o.dying;
    if (!fr) {
      // Fallback token: shrinks and fades as it dies.
      const at = this.bodyAt(x, y, z, radius * (0.8 + 0.2 * alive), o.flat);
      ctx.save();
      ctx.translate(at.x, at.y);
      if ((o.speed ?? 0) > 0.2 && !o.flat) ctx.translate(0, Math.sin(this.time * 14 + (o.id ?? 0)) * at.r * 0.07);
      ctx.scale(1, this.cam.squashAt(y));
      drawUnit(ctx, kind, side, 0, 0, at.r, face, { ...o, alpha: (o.alpha ?? 1) * alive, noShadow: true });
      ctx.restore();
      return;
    }
    // A short lunge towards the target on the strike, along the ground.
    let fx = x, fy = y;
    if (swing >= 0 && swing < 0.5) {
      const l = Math.sin((swing / 0.5) * Math.PI) * radius * 0.16;
      fx += Math.cos(face) * l; fy += Math.sin(face) * l;
    }
    const feet = this.cam.project(fx, fy, z);
    ctx.save();
    ctx.translate(feet.x, feet.y);
    // Death frames play out first, then the body fades over the last part of the window.
    ctx.globalAlpha *= (o.alpha ?? 1) * Math.min(1, alive * 2.5);
    if (o.hidden) ctx.globalAlpha *= o.own ? 0.42 : 0.14;
    // Drawn a bit larger than true scale so they read on a phone (collision is unchanged).
    drawFrame(ctx, fr, (feet.s * (radius / RADIUS(kind)) * SPRITE_VIS) / fr.ppu, o.flash ?? 0);
    ctx.restore();
  }

  /** A rock that stands on its collision circle: the base ring is the circle, projected exactly. */
  private drawRock(o: Obstacle) {
    const ctx = this.ctx, cam = this.cam, n = 14, h = o.r * 0.95;
    const jag = (i: number) => 0.86 + 0.14 * Math.abs(Math.sin(o.x * 7 + o.y * 3 + i * 1.7));
    const at = (i: number, k: number, z: number) => {
      const a = (i / n) * TAU;
      return cam.project(o.x + Math.cos(a) * o.r * k * jag(i), o.y + Math.sin(a) * o.r * k * jag(i), z);
    };
    ctx.save();
    // Silhouette: the near half of the base, then the far half of the top.
    ctx.beginPath();
    for (let i = 0; i <= n / 2; i++) { const p = at(i, 1, 0); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
    for (let i = n / 2; i <= n; i++) { const p = at(i % n, 0.62, h); ctx.lineTo(p.x, p.y); }
    ctx.closePath();
    const top = cam.project(o.x, o.y, h), base = cam.project(o.x, o.y + o.r, 0);
    const sg = ctx.createLinearGradient(0, top.y, 0, base.y);
    sg.addColorStop(0, "#4d555f"); sg.addColorStop(1, "#1d2128");
    ctx.fillStyle = sg; ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke();
    // The lit top.
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const p = at(i % n, 0.62, h); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
    ctx.closePath();
    const tg = ctx.createRadialGradient(top.x - o.r * top.s * 0.25, top.y - o.r * top.s * 0.15, 0, top.x, top.y, o.r * top.s * 0.7);
    tg.addColorStop(0, "#7a838e"); tg.addColorStop(1, "#555d68");
    ctx.fillStyle = tg; ctx.fill();
    ctx.strokeStyle = "rgba(10,14,22,0.6)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }

  private evolveAt = new Map<number, number>();
  /** A rank-up pop on a placed piece. */
  markEvolve(id: number) { this.evolveAt.set(id, this.time); }

  /** A ground quad between two board rows, full width. */
  private rowsPath(y0: number, y1: number) {
    const ctx = this.ctx, cam = this.cam;
    const a = cam.project(0, y0), b = cam.project(W, y0), c = cam.project(W, y1), d = cam.project(0, y1);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
  }

  private drawZone(side: Side) {
    const ctx = this.ctx;
    const a = toWorld(side, 0, -0.05), b = toWorld(side, 0, ZONE_DEPTH);
    const y0 = Math.max(0, Math.min(a.y, b.y)), y1 = Math.min(H, Math.max(a.y, b.y));
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
    ctx.save();
    ctx.fillStyle = team(side).glow + (0.07 + 0.05 * pulse) + ")";
    this.rowsPath(y0, y1); ctx.fill();
    ctx.strokeStyle = team(side).glow + (0.5 + 0.3 * pulse) + ")";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    // The edge sits exactly on the sim's zone depth.
    const ey = b.y, l = this.cam.project(0, ey), r = this.cam.project(W, ey);
    ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y); ctx.stroke();
    ctx.restore();
  }

  private drawDeploy(sc: DeployScene) {
    if (sc.zone !== undefined && sc.zone !== null) this.drawZone(sc.zone);
    for (const o of this.obstacles) this.shadow(o.x, o.y, o.r * 1.05, 0.3);
    const shown = sc.pieces.filter((p) => !(p.kind === "mine" && p.side === 1 && !sc.showEnemyMines));
    // Ground layer: selection and range under everything, then contact shadows, then buried mines.
    const sel = shown.find((p) => p.id === sc.selected);
    if (sel) this.drawSelection(sel);
    for (const p of shown) {
      if (p.kind === "mine") continue;
      for (const [x, y] of this.footprints(p.kind, p.x, p.y, p.side === 0 ? -1 : 1)) this.shadow(x, y, RADIUS(p.kind) * 1.1, 0.38);
    }
    const list: Drawable[] = [];
    for (const p of shown) {
      const def = UNITS[p.kind];
      const face = p.side === 0 ? -Math.PI / 2 : Math.PI / 2;
      const revealT = this.reveal.get(p.id);
      let pop = revealT !== undefined ? Math.min(1, (this.time - revealT) / 0.25) : 1;
      const evo = this.evolveAt.get(p.id);
      if (evo !== undefined && this.time - evo < 0.45) pop *= 1 + 0.45 * Math.sin(((this.time - evo) / 0.45) * Math.PI);
      const mine = p.kind === "mine";
      list.push({
        y: p.y, layer: mine ? 0 : 1, draw: () => {
          if (p.kind === "blades") {
            this.footprints("blades", p.x, p.y, p.side === 0 ? -1 : 1).forEach(([x, y], i) =>
              this.token("blades", p.side, x, y, 0, def.radius * pop, face, { t: this.time, id: p.id * 3 + i, rank: p.rank }));
          } else {
            this.token(p.kind, p.side, p.x, p.y, 0, def.radius * pop, face, { t: this.time, id: p.id, hidden: mine, flat: mine, own: p.side === 0 || !!sc.showEnemyMines, rank: p.rank });
          }
          const at = mine ? this.bodyAt(p.x, p.y, 0, def.radius, true) : this.headAt(p.kind, p.rank, p.x, p.y, 0, def.radius);
          drawRank(this.ctx, at.x, mine ? at.y : at.y + at.r * 1.1, Math.max(at.r, 0.3 * this.cam.scaleAt(p.y)), p.rank);
        },
      });
    }
    for (const o of this.obstacles) list.push({ y: o.y, layer: 1, draw: () => this.drawRock(o) });
    this.pushKeeps(list, [...shown.filter((p) => p.kind !== "mine"), ...(sc.ghost ? [sc.ghost] : [])]);
    for (const d of sortDrawables(list)) d.draw();
    if (sc.ghost) {
      const ctx = this.ctx, g = sc.ghost, def = UNITS[g.kind];
      ctx.save();
      ctx.globalAlpha = 0.75;
      this.drawRangeHint(g.kind, g.x, g.y, g.ok);
      for (const [x, y] of this.footprints(g.kind, g.x, g.y, -1)) this.shadow(x, y, def.radius * 1.1, 0.2);
      if (g.kind === "blades") {
        for (const [x, y] of this.footprints("blades", g.x, g.y, -1)) this.token("blades", 0, x, y, 0, def.radius, -Math.PI / 2, { t: this.time, ghost: true });
      } else this.token(g.kind, 0, g.x, g.y, 0, def.radius, -Math.PI / 2, { t: this.time, ghost: true, own: true, flat: g.kind === "mine" });
      if (!g.ok) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = "#ff4d4d"; ctx.lineWidth = 3;
        ctx.beginPath(); this.cam.groundPath(ctx, g.x, g.y, def.radius * 1.5); ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** Where the bodies of a piece stand: one, or Blades' trio around the placed point. */
  private footprints(kind: BodyKind, x: number, y: number, facing: number): [number, number][] {
    if (kind !== "blades") return [[x, y]];
    const out: [number, number][] = [];
    for (let i = 0; i < 3; i++) {
      const a = (Math.PI / 2) * facing + (i * TAU) / 3;
      out.push([x + Math.cos(a) * 0.32, y + Math.sin(a) * 0.32]);
    }
    return out;
  }

  private drawRangeHint(kind: UnitKind, x: number, y: number, ok: boolean) {
    const ctx = this.ctx, def = UNITS[kind];
    const r = kind === "mine" ? def.range : def.role === "ranged" || def.role === "artillery" || def.role === "caster" || kind === "ballista" ? def.range : kind === "medic" ? def.range : 0;
    if (!r) return;
    ctx.save();
    ctx.strokeStyle = ok ? (kind === "mine" ? "rgba(255,120,80,0.7)" : "rgba(166,255,246,0.45)") : "rgba(255,77,77,0.5)";
    ctx.fillStyle = kind === "mine" ? "rgba(255,120,80,0.12)" : "rgba(166,255,246,0.05)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); this.cam.groundPath(ctx, x, y, r); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  private drawSelection(p: Piece) {
    const ctx = this.ctx, def = UNITS[p.kind];
    const r = (p.kind === "blades" ? 0.62 : def.radius) + 7 / this.cam.scaleAt(p.y);
    this.drawRangeHint(p.kind, p.x, p.y, true);
    ctx.save();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -this.time * 20;
    ctx.beginPath(); this.cam.groundPath(ctx, p.x, p.y, r); ctx.stroke();
    ctx.restore();
  }

  private drawBattle(sc: BattleScene) {
    const ctx = this.ctx, b = sc.battle, a = sc.alpha, as = this.assault;
    // During the round-end assault the survivors move on the assault's clock, not the battle's.
    const pos = (bd: Body) => {
      const st = as?.pose(bd.id);
      return st ? [st.x, st.y] as const : [bd.px + (bd.x - bd.px) * a, bd.py + (bd.y - bd.py) * a] as const;
    };
    const height = (bd: Body) => (bd.flying ? (as?.pose(bd.id)?.z ?? bd.z ?? 1.2) * AIR : 0);
    // ---- ground decals
    for (const z of b.zones ?? []) {
      if (b.time >= z.until) continue;
      const left = Math.min(1, (z.until - b.time) / 0.6);
      const fl = 0.75 + 0.25 * Math.sin(this.time * 17 + z.id);
      this.ground(z.x, z.y, (g) => {
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, z.r);
        gr.addColorStop(0, `rgba(255,170,60,${0.45 * fl * left})`);
        gr.addColorStop(0.6, `rgba(255,90,30,${0.28 * fl * left})`);
        gr.addColorStop(1, "rgba(255,60,20,0)");
        g.fillStyle = gr;
        g.beginPath(); g.arc(0, 0, z.r, 0, TAU); g.fill();
      });
      if (Math.random() < 0.35) this.fx.burst(z.x + frand(-z.r, z.r) * 0.7, z.y + frand(-z.r, z.r) * 0.7, 1, { color: "#ffb347", speed: 0.4, size: 0.05, max: 0.6, kind: "spark", gravity: -1.5, vz: 1 });
    }
    for (const o of this.obstacles) this.shadow(o.x, o.y, o.r * 1.05, 0.3);
    for (const bd of b.bodies) {
      if (bd.kind !== "mine" || !bd.alive) continue;
      const [x, y] = pos(bd);
      this.token("mine", bd.side, x, y, 0, bd.radius, 0, { t: this.time, state: bd.state, hidden: bd.hidden, own: bd.side === 0, rank: bd.rank, flat: true });
    }
    // Tinkers' turrets going up.
    for (const bd of b.bodies) {
      if (!bd.alive || bd.kind !== "tinker" || bd.state !== "build") continue;
      const u = Math.min(1, bd.t / 1.2);
      this.ground(bd.ax, bd.ay, (g) => {
        g.strokeStyle = "rgba(255,209,102,0.85)"; g.lineWidth = 0.08;
        g.beginPath(); g.arc(0, 0, 0.3, -Math.PI / 2, -Math.PI / 2 + TAU * u); g.stroke();
      });
    }
    // Once the assault starts the battle clock has stopped: bodies caught mid-death and the trickster's
    // illusions fade out on the assault's clock instead of hanging on the field.
    const vanish = as ? Math.max(0, 1 - as.t / VANISH) : 1;
    const fading = (bd: Body) => !!as && (!bd.alive || bd.kind === "decoy");
    const live = b.bodies.filter((bd) => bd.kind !== "mine" && (bd.alive || b.time - bd.diedAt < 0.45) && !(fading(bd) && vanish <= 0));
    const fadeOf = (bd: Body) => (bd.alive ? 1 : 1 - (b.time - bd.diedAt) / 0.45) * (fading(bd) ? vanish : 1);
    for (const bd of live) {
      const [x, y] = pos(bd);
      const st = as?.pose(bd.id);
      if (st) {
        // A striker: its shadow follows the march (a burrower surfaces for it).
        if (!st.gone) this.shadow(x, y, bd.radius * (1.1 - height(bd) * 0.15), 0.38 - height(bd) * 0.08);
        continue;
      }
      if (bd.burrowed) {
        // Underground: a moving mound of earth, no body.
        const ang = Math.atan2(bd.vy, bd.vx);
        this.ground(x, y, (g) => {
          g.fillStyle = "rgba(95,72,48,0.9)"; g.strokeStyle = "rgba(40,28,18,0.9)"; g.lineWidth = 0.04;
          g.beginPath(); g.ellipse(0, 0, 0.26, 0.18, ang, 0, TAU); g.fill(); g.stroke();
          g.fillStyle = "rgba(160,125,85,0.8)";
          g.beginPath(); g.ellipse(-0.04, -0.04, 0.12, 0.07, 0, 0, TAU); g.fill();
        });
        continue;
      }
      const fade = fadeOf(bd);
      const z = height(bd);
      // Contact shadow: smaller and fainter the higher the body flies.
      this.shadow(x, y, bd.radius * (1.1 - z * 0.15), (0.38 - z * 0.08) * fade);
      // Auras on the ground under the unit.
      if (bd.alive && ((bd.buff ?? 0) > 0 || (bd.rally ?? 0) > 0)) {
        ctx.save();
        ctx.strokeStyle = (bd.rally ?? 0) > 0 ? "rgba(255,209,102,0.55)" : team(bd.side).glow + "0.45)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]); ctx.lineDashOffset = -this.time * 12;
        ctx.beginPath(); this.cam.groundPath(ctx, x, y, bd.radius * 1.5); ctx.stroke();
        ctx.restore();
      }
      if (bd.alive && bd.kind === "pikeman" && bd.braced) {
        const face = bd.face;
        this.ground(x, y, (g) => {
          g.strokeStyle = "rgba(232,238,245,0.7)"; g.lineWidth = 0.06;
          g.beginPath(); g.arc(0, 0, bd.radius * 1.6, face - 0.6, face + 0.6); g.stroke();
        });
      }
    }
    // ---- upright and air layers, painter-sorted by ground y
    const list: Drawable[] = [];
    for (const o of this.obstacles) list.push({ y: o.y, layer: 1, draw: () => this.drawRock(o) });
    for (const f of b.fuses ?? []) {
      if (b.time >= f.at) continue;
      list.push({ y: f.y, layer: 1, draw: () => this.drawFuse(f.x, f.y, f.kind === "keg") });
    }
    for (const bd of live) {
      const st = as?.pose(bd.id);
      if (st) {
        if (!st.gone) list.push({ y: st.y, layer: bd.flying ? 2 : 1, draw: () => this.drawStriker(bd, st, height(bd)) });
        continue;
      }
      if (bd.burrowed) continue;
      list.push({ y: pos(bd)[1], layer: bd.flying ? 2 : 1, draw: () => this.drawBody(b, bd, pos(bd), height(bd), fadeOf(bd)) });
    }
    // The battle's own projectiles stopped mid-air when it ended: they fade out with the leftovers.
    for (const p of b.projs) {
      if (!p.alive || vanish <= 0) continue;
      const lob = p.kind === "grenade" || p.kind === "shell";
      list.push({ y: p.py + (p.y - p.py) * a, layer: lob ? 2 : 1, draw: () => { ctx.save(); ctx.globalAlpha *= vanish; this.drawProj(p, a); ctx.restore(); } });
    }
    if (as) this.pushShots(list, as);
    this.pushKeeps(list, live.filter((bd) => bd.alive && !bd.flying && !as?.pose(bd.id)?.gone).map((bd) => ({ x: pos(bd)[0], y: pos(bd)[1], kind: bd.kind })));
    for (const d of sortDrawables(list)) d.draw();
    // ---- bars and ranks on top (not for illusions, bodies underground or the assault's strikers)
    for (const bd of live) {
      if (!bd.alive || bd.hp >= bd.maxHp || bd.kind === "mite" || bd.kind === "decoy" || bd.burrowed || as?.pose(bd.id)) continue;
      const [x, y] = pos(bd);
      const at = this.headAt(bd.kind, bd.rank, x, y, height(bd), bd.radius);
      const w = Math.max(16, at.r * 1.9), h = 4;
      const top = at.y - 9;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(at.x - w / 2 - 1, top - 1, w + 2, h + 2);
      ctx.fillStyle = TEAM[bd.side].main;
      ctx.fillRect(at.x - w / 2, top, w * (bd.hp / bd.maxHp), h);
    }
    for (const bd of live) {
      const st = as?.pose(bd.id);
      if (!bd.alive || bd.rank <= 1 || bd.kind === "mite" || (bd.burrowed && !st) || bd.kind === "decoy" || st?.gone) continue;
      const [x, y] = pos(bd);
      const at = this.headAt(bd.kind, bd.rank, x, y, height(bd), bd.radius);
      drawRank(ctx, at.x, at.y + at.r * 1.3 - (bd.hp < bd.maxHp && !st ? 14 : 5), at.r * 1.3, bd.rank);
    }
  }

  private drawBody(b: Battle, bd: Body, [x, y]: readonly [number, number], z: number, fade: number) {
    const ctx = this.ctx;
    const swing = b.time - bd.swing < 0.35 ? (b.time - bd.swing) / 0.35 : -1;
    const sp = Math.hypot(bd.vx, bd.vy);
    if (bd.kind === "lancer" && bd.state === "charge" && sp > 2.5 && Math.random() < 0.5)
      this.fx.burst(bd.x - Math.cos(bd.face) * 0.3, bd.y - Math.sin(bd.face) * 0.3, 1, { color: "rgba(170,150,120,0.55)", speed: 0.5, size: 0.12, max: 0.45, kind: "smoke", gravity: 0 });
    if (bd.kind === "shade" && bd.hidden && Math.random() < 0.15)
      this.fx.burst(bd.x, bd.y, 1, { color: "rgba(180,140,255,0.35)", speed: 0.3, size: 0.1, max: 0.5, kind: "smoke", gravity: 0 });
    if (bd.kind === "keg" && bd.state === "run" && Math.random() < 0.6)
      this.fx.burst(bd.x, bd.y, 1, { color: "#ffd166", speed: 0.8, size: 0.035, max: 0.3, kind: "spark", gravity: 0 });
    const scale = bd.flying ? 1 + (bd.z ?? 1.2) * 0.08 : 1;
    const decoy = bd.kind === "decoy";
    const owner = decoy ? b.bodies.find((o) => o.id === bd.owner) : undefined;
    // A decoy has its own ghostly atlas; the drawn fallback borrows the trickster's token.
    const art = decoy && hasAtlas("decoy");
    const kind = decoy && !art ? "trickster" : bd.kind;
    const radius = bd.radius * scale * (decoy && !art ? RADIUS("trickster") / RADIUS("decoy") : 1);
    this.token(kind, bd.side, x, y, z, radius, bd.face, {
      t: this.time, alpha: (decoy ? 0.85 + 0.1 * Math.sin(this.time * 9 + bd.id) : 1) * (bd.alive ? fade : 1), dying: bd.alive ? undefined : 1 - fade,
      flash: bd.flash / 0.12, swing, swingA: bd.swingA, speed: sp,
      state: bd.state, id: bd.id, hidden: bd.hidden, own: bd.side === 0, rank: decoy ? owner?.rank ?? bd.rank : bd.rank,
    });
    const at = this.bodyAt(x, y, z, bd.radius);
    if (bd.alive && (bd.frozen ?? 0) > 0) this.drawIce(at.x, at.y, at.r * 1.25);
    else if (bd.alive && (bd.slow ?? 0) > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = ICE; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(at.x, at.y, at.r * 1.15, at.r * 1.15 * this.cam.squashAt(y), 0, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    if (bd.alive && bd.kind === "duelist" && (bd.parryCd ?? 1) <= 0) {
      const gl = 0.5 + 0.5 * Math.sin(this.time * 10);
      ctx.save(); ctx.globalAlpha = gl; ctx.fillStyle = "#fff6d6";
      ctx.beginPath(); ctx.arc(at.x + at.r * 0.8, at.y - at.r * 0.8, 2.5, 0, TAU); ctx.fill(); ctx.restore();
    }
    if (bd.alive && bd.stun > 0.05) this.drawStun(at.x, at.y - at.r * 1.1, at.r);
  }

  private drawFuse(x: number, y: number, keg: boolean) {
    const ctx = this.ctx, rw = keg ? 0.18 : 0.11;
    this.shadow(x, y, rw, 0.4);
    const p = this.cam.project(x, y, rw), r = rw * p.s;
    ctx.fillStyle = keg ? "#7a4a24" : "#2b2f36"; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = (this.time * 14) % 1 > 0.5 ? "#ffd166" : "#ff6a3d";
    ctx.beginPath(); ctx.arc(p.x + r * 0.4, p.y - r * 0.8, Math.max(1.5, r * 0.3), 0, TAU); ctx.fill();
  }

  /** Projectiles fly on arcs: lobs use the sim's height, shots rise and fall over their path from launcher to target. */
  private drawProj(p: Proj, a: number) {
    const ctx = this.ctx, cam = this.cam;
    const wx = p.px + (p.x - p.px) * a, wy = p.py + (p.y - p.py) * a;
    if (p.kind === "grenade" || p.kind === "shell") {
      const shell = p.kind === "shell";
      this.shadow(wx, wy, shell ? 0.14 : 0.1, 0.4);
      const q = cam.project(wx, wy, 0.25 + p.z * 0.6), r = (shell ? 0.17 : 0.12) * q.s;
      if (p.fx === "fire" && Math.random() < 0.7) this.fx.burst(p.x, p.y, 1, { color: "#ff9a3d", speed: 0.3, size: 0.05, max: 0.3, kind: "spark", gravity: 0, z: (0.25 + p.z * 0.6) * 2 - 0.6 });
      ctx.fillStyle = shell ? "#3b4048" : "#2b2f36"; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = (this.time * 12) % 1 > 0.5 ? "#ffd166" : "#ff6a3d";
      ctx.beginPath(); ctx.arc(q.x + r * 0.5, q.y - r * 0.6, Math.max(1.2, r * 0.3), 0, TAU); ctx.fill();
      return;
    }
    const arc = shotArc(p);
    const hAt = (x: number, y: number) => arc.base + arc.peak * bump(progress(p, x, y));
    const h = hAt(wx, wy);
    const head = cam.project(wx, wy, h);
    if (p.kind === "pellet") {
      ctx.fillStyle = "#ffe08a";
      ctx.beginPath(); ctx.arc(head.x, head.y, Math.max(2, 0.05 * head.s), 0, TAU); ctx.fill();
      return;
    }
    const ice = p.kind === "shard";
    const sp = Math.hypot(p.vx, p.vy) || 1, ux = p.vx / sp, uy = p.vy / sp;
    const len = p.kind === "bolt" ? 0.75 : ice ? 0.32 : 0.42;
    const tx = wx - ux * len * 1.6, ty = wy - uy * len * 1.6;
    const tail = cam.project(tx, ty, hAt(tx, ty));
    const ang = Math.atan2(head.y - tail.y, head.x - tail.x);
    const pxLen = Math.hypot(head.x - tail.x, head.y - tail.y) / 1.6, s = head.s;
    this.shadow(wx, wy, 0.06, 0.25);
    ctx.save();
    ctx.translate(head.x, head.y); ctx.rotate(ang);
    const tg = ctx.createLinearGradient(-pxLen * 1.6, 0, 0, 0);
    tg.addColorStop(0, "rgba(255,255,255,0)"); tg.addColorStop(1, p.kind === "bolt" ? "rgba(255,230,190,0.8)" : ice ? "rgba(190,235,255,0.9)" : "rgba(255,255,255,0.6)");
    ctx.strokeStyle = tg; ctx.lineWidth = (p.kind === "bolt" ? 0.09 : ice ? 0.08 : 0.05) * s; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-pxLen * 1.6, 0); ctx.lineTo(0, 0); ctx.stroke();
    if (ice) {
      ctx.fillStyle = "#e9f9ff";
      ctx.beginPath(); ctx.moveTo(pxLen * 0.35, 0); ctx.lineTo(0, -0.06 * s); ctx.lineTo(-pxLen * 0.3, 0); ctx.lineTo(0, 0.06 * s); ctx.closePath(); ctx.fill();
    } else {
      ctx.strokeStyle = p.kind === "bolt" ? "#e9d7b8" : "#f4efe6"; ctx.lineWidth = (p.kind === "bolt" ? 0.07 : 0.035) * s;
      ctx.beginPath(); ctx.moveTo(-pxLen, 0); ctx.lineTo(pxLen * 0.1, 0); ctx.stroke();
      ctx.fillStyle = "#cfd8e3";
      ctx.beginPath(); ctx.moveTo(pxLen * 0.25, 0); ctx.lineTo(0, -0.05 * s); ctx.lineTo(0, 0.05 * s); ctx.fill();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ keeps and the round-end assault
  /** Adds the two keeps to the depth-sorted list, and fades a keep that stands in front of a body behind it. */
  private pushKeeps(list: Drawable[], bodies: { x: number; y: number; kind: BodyKind }[]) {
    if (!this.showKeeps) return;
    for (const side of [0, 1] as Side[]) {
      this.keeps[side].see = bodies.some((p) => behindKeep(side, p.x, p.y, RADIUS(p.kind)));
      list.push({ y: keepAnchor(side).y, layer: 1, draw: () => this.drawKeep(side) });
    }
  }

  /** A point on the keep image (manifest pixels) as a world point standing on the keep: x across, z up. */
  private keepPt(side: Side, px: [number, number]): { x: number; y: number; z: number } {
    const m = keepManifest(), a = keepAnchor(side), g = m.anchors.ground, u = KEEP_SCALE / m.ppu;
    // The keep art is rendered at the board camera's elevation, so image height reads as height on the board.
    return { x: a.x + (px[0] - g[0]) * u, y: a.y + 0.05, z: Math.max(0, ((g[1] - px[1]) * u) / this.cam.sin) };
  }

  /** Where a blow aimed at keepHitPoint lands: on the wall facing the attacker, partway up. */
  private wallPt(side: Side, x: number, y: number): { x: number; y: number; z: number } {
    const k = keepAnchor(side), front = y > k.y - 0.55;
    return { x, y: k.y + (front ? 1 : -1) * KEEP_RY * 0.8, z: WALL_Z };
  }

  private drawKeep(side: Side) {
    const k = this.keeps[side];
    const state = keepState(this.keepHp[side]);
    const img = keepImage(side, state);
    if (!img) return;
    const ctx = this.ctx, m = keepManifest(), a = keepAnchor(side);
    const base = this.cam.project(a.x, a.y), u = (KEEP_SCALE / m.ppu) * base.s;
    const jig = k.shake * 0.07 * base.s;
    const ox = jig ? frand(-jig, jig) : 0, oy = jig ? frand(-jig * 0.5, jig * 0.5) : 0;
    ctx.save();
    // Contact shadow on the ground under the plinth.
    ctx.globalAlpha *= 0.38;
    ctx.fillStyle = "#000";
    ctx.beginPath(); this.cam.groundPath(ctx, a.x + 0.06, a.y + 0.08, KEEP_SCALE * 1.2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= k.alpha;
    const dx = base.x + ox - m.anchors.ground[0] * u, dy = base.y + oy - m.anchors.ground[1] * u, w = m.w * u, h = m.h * u;
    ctx.drawImage(img, dx, dy, w, h);
    if (k.flash > 0) {
      // The hit flash: the keep's own pixels added over themselves.
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = k.alpha * Math.min(1, k.flash) * 0.55;
      ctx.drawImage(img, dx, dy, w, h);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = k.alpha;
    if (state === "burning" || state === "ruined") {
      const fires = state === "burning" ? m.anchors.fires : m.anchors.fires.slice(1, 3);
      fires.forEach((f, i) => {
        this.drawFlame(dx + f[0] * u, dy + f[1] * u, base.s * (state === "burning" ? 0.3 : 0.2), i + side * 7);
      });
    }
    ctx.restore();
  }

  private drawFlame(x: number, y: number, size: number, seed: number) {
    const ctx = this.ctx, t = this.time * 9 + seed * 1.7;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(x, y - size * 0.3, 0, x, y - size * 0.3, size * 1.6);
    g.addColorStop(0, "rgba(255,170,60,0.45)"); g.addColorStop(1, "rgba(255,90,20,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y - size * 0.3, size * 1.6, 0, TAU); ctx.fill();
    for (const [k, col, w] of [[1, "rgba(255,110,40,0.85)", 1], [0.68, "rgba(255,200,80,0.9)", 0.7], [0.38, "rgba(255,250,210,0.95)", 0.45]] as [number, string, number][]) {
      const hgt = size * k * (1.7 + 0.35 * Math.sin(t + k * 3) + 0.2 * Math.sin(t * 2.3 + seed));
      const half = size * w * 0.55, lean = Math.sin(t * 0.7 + seed) * size * 0.18;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x - half, y);
      ctx.quadraticCurveTo(x - half * 1.1, y - hgt * 0.55, x + lean, y - hgt);
      ctx.quadraticCurveTo(x + half * 1.1, y - hgt * 0.55, x + half, y);
      ctx.quadraticCurveTo(x, y + half * 0.5, x - half, y);
      ctx.fill();
    }
    ctx.restore();
  }

  private updateKeeps(dt: number) {
    const m = keepManifest(), snd = (n: string, g = 0.5) => this.onSound?.(n, g);
    // Particles are drawn at half their z (drawFx), so heights on the keep are doubled going in.
    const puff = (side: Side, px: [number, number], n: number, o: Parameters<Fx["burst"]>[3]) => {
      const p = this.keepPt(side, px);
      this.fx.burst(p.x, p.y, n, { ...o, z: p.z * 2 + (o?.z ?? 0) });
    };
    for (const side of [0, 1] as Side[]) {
      const k = this.keeps[side];
      k.flash = Math.max(0, k.flash - dt * 6);
      k.shake = Math.max(0, k.shake - dt * 3.5);
      k.alpha += ((k.see ? 0.42 : 1) - k.alpha) * Math.min(1, dt * 10);
      const state = keepState(this.keepHp[side]);
      if (k.state && state !== k.state && KEEP_STATES.indexOf(state) > KEEP_STATES.indexOf(k.state)) {
        // A stage of damage: masonry comes down.
        const mid: [number, number] = [m.anchors.ground[0], (m.anchors.ground[1] + m.anchors.top[1]) / 2];
        puff(side, mid, 22, { color: "#8d929b", speed: 2.4, size: 0.08, max: 0.9, kind: "chunk", vz: 3.5, spin: 8 });
        puff(side, m.anchors.ground, 8, { color: "rgba(140,130,120,0.32)", speed: 1.3, size: 0.17, max: 0.9, kind: "smoke", gravity: -0.3, drag: 1.5 });
        k.shake = 1;
        this.fx.shake = Math.min(1, this.fx.shake + 0.4);
        snd("crumble", 0.8);
      }
      k.state = state;
      // Embers off the flames, smoke from the broken stone.
      if (state === "burning" || state === "ruined") {
        k.ember += dt * (state === "burning" ? 7 : 3);
        while (k.ember >= 1) {
          k.ember -= 1;
          puff(side, m.anchors.fires[Math.floor(Math.random() * m.anchors.fires.length)], 1, { color: "#ffb347", speed: 0.35, size: 0.035, max: 0.9, kind: "spark", gravity: -1.6, vz: 1.2, drag: 1 });
        }
      }
      if (state !== "intact") {
        k.smoke += dt * (state === "ruined" ? 2.4 : state === "burning" ? 1.6 : 0.4);
        while (k.smoke >= 1) {
          k.smoke -= 1;
          puff(side, m.anchors.smoke[Math.floor(Math.random() * m.anchors.smoke.length)], 1, { color: state === "cracked" ? "rgba(150,145,140,0.18)" : "rgba(50,46,52,0.3)", speed: 0.15, size: 0.1, max: 1.6, kind: "smoke", gravity: -0.55, vz: 0.6, drag: 0.5 });
        }
      }
    }
  }

  /** Starts the round-end assault from where the battle left off. */
  startAssault(battle: Battle, damage: [number, number], linger?: number): Assault {
    this.assault = new Assault(battle.bodies, { damage, obstacles: this.obstacles, linger });
    // The illusions break as the round ends.
    for (const bd of battle.bodies) {
      if (!bd.alive || bd.kind !== "decoy") continue;
      this.fx.burst(bd.x, bd.y, 10, { color: "rgba(200,170,255,0.7)", speed: 1.4, size: 0.12, max: 0.45, kind: "smoke", gravity: 0, drag: 2, z: 0.6 });
      this.fx.ring(bd.x, bd.y, 0.1, 0.45, 0.25, VIOLET, 0.04);
    }
    return this.assault;
  }

  /** Advances the assault and turns what happens into effects. */
  updateAssault(dt: number) {
    this.assault?.update(dt, (e) => this.onAssault(e));
  }

  private onAssault(e: AssaultEvent) {
    const fx = this.fx, snd = (n: string, g = 0.5) => this.onSound?.(n, g);
    if (e.t === "swing") {
      const st = e.s;
      if (st.style === "melee") {
        const k = keepHitPoint(st.target, st.x, st.y);
        fx.arc(st.x, st.y, Math.atan2(k.y - st.y, k.x - st.x), st.radius + 0.35, st.side === 0 ? "#e9fffd" : "#fff0ea", 2.0, 0.18);
        snd("slash", 0.3);
      } else if (st.style === "keg") snd("fuse", 0.5);
      else if (st.style === "dive") snd("blink", 0.35);
      return;
    }
    if (e.t === "launch") {
      const sh = e.shot;
      if (sh.style === "zap") {
        const w = this.wallPt(e.s.target, sh.x1, sh.y1);
        fx.bolt([[sh.x0, sh.y0], [(sh.x0 + w.x) / 2 + frand(-0.3, 0.3), (sh.y0 + w.y) / 2], [w.x, w.y]], ZAP, 0.3);
        fx.flash = Math.max(fx.flash, 0.06); fx.flashColor = "#cfe8ff";
        snd("zap", 0.5);
      } else snd(sh.style === "lob" || sh.style === "shell" ? "throw" : sh.style === "bolt" ? "bolt" : sh.style === "shard" ? "zap" : "arrow", 0.35);
      return;
    }
    // Impact on the keep: blasts on the ground at its foot, sparks and stone off the wall.
    const k = this.keeps[e.target], w = this.wallPt(e.target, e.x, e.y), z = w.z * 2;
    const big = e.style === "shell" || e.style === "keg" || e.style === "slam";
    k.flash = 1;
    k.shake = Math.min(1.4, k.shake + (big ? 1 : 0.45));
    const stone = { color: "#8d929b", speed: big ? 2.6 : 1.6, size: 0.06, max: 0.7, kind: "chunk" as const, vz: 2.5, spin: 8, z };
    switch (e.style) {
      case "lob": this.boom(w.x, w.y, 0.8, "grenade", (1 - e.target) as Side); break;
      case "shell": this.boom(w.x, w.y, 1.1, "shell", (1 - e.target) as Side); break;
      case "keg": this.boom(w.x, w.y, 1.2, "keg", (1 - e.target) as Side); break;
      case "slam": this.boom(w.x, w.y, 1.0, "slam", (1 - e.target) as Side); break;
      case "shard":
        fx.ring(w.x, w.y, 0.05, 0.45, 0.3, ICE, 0.05);
        fx.burst(w.x, w.y, 10, { color: "#e9f9ff", speed: 2, size: 0.05, max: 0.4, kind: "chunk", vz: 2, spin: 6, z });
        snd("clank", 0.4);
        break;
      case "zap":
        fx.burst(w.x, w.y, 10, { color: "#dff1ff", speed: 2.6, size: 0.04, max: 0.3, kind: "spark", gravity: 0, z });
        break;
      default:
        fx.burst(w.x, w.y, e.style === "bolt" ? 10 : 6, { color: "#fff2d6", speed: 2.6, size: 0.045, max: 0.28, kind: "spark", gravity: 0, z });
        snd(e.style === "melee" || e.style === "dive" ? "hit" : "clank", 0.35);
    }
    fx.burst(w.x, w.y, big ? 10 : 4, stone);
    fx.burst(w.x, w.y, big ? 5 : 2, { color: "rgba(150,140,130,0.45)", speed: 0.8, size: 0.2, max: 0.8, kind: "smoke", gravity: 0, drag: 2, z });
    if (e.first && this.assault) {
      const dmg = this.assault.damage[e.target];
      // Over the keep's flag; the rival's number sits in front of its keep, which stands against the far edge.
      const a = keepAnchor(e.target);
      let at = { x: a.x, y: a.y + 1.0 };
      if (e.target === 0) {
        const top = this.keepPt(0, keepManifest().anchors.top), q = this.cam.project(top.x, top.y, top.z);
        at = this.cam.unprojectAt(q.x, q.y - 0.3 * q.s, 0.6);
      }
      fx.float(at.x, at.y, `-${dmg}`, e.target === 0 ? "#ff6b5a" : GOLD, 0.62, 1.5);
      fx.shake = Math.min(1, fx.shake + 0.35);
      this.onShake?.(e.target === 0 ? 2 : 1);
      snd("crumble", 0.7);
    }
  }

  /** A survivor on the march or striking the keep, from the assault's pose rather than the battle's. */
  private drawStriker(bd: Body, st: Striker, z: number) {
    if (st.gone || !this.assault) return;
    const scale = bd.flying ? 1 + st.z * 0.08 : 1;
    this.token(bd.kind, bd.side, st.x, st.y, z, bd.radius * scale, st.face, {
      t: this.time, swing: this.assault.swing(st), swingA: st.face, speed: this.assault.speed(st), state: "run", id: bd.id, own: bd.side === 0, rank: bd.rank,
    });
  }

  /** Arrows, bolts and bombs in flight to a keep, depth-sorted with everything else. */
  private pushShots(list: Drawable[], as: Assault) {
    for (const sh of as.shots) {
      if (as.t < sh.t0) continue;
      const u = Math.min(1, (as.t - sh.t0) / Math.max(0.01, sh.t1 - sh.t0));
      const end = this.wallPt(sh.side === 0 ? 1 : 0, sh.x1, sh.y1);
      const at = (v: number) => ({ x: sh.x0 + (end.x - sh.x0) * v, y: sh.y0 + (end.y - sh.y0) * v });
      const lob = sh.style === "lob" || sh.style === "shell";
      const peak = lob ? (sh.style === "shell" ? 1.4 : 0.9) : Math.min(1.2, Math.hypot(end.x - sh.x0, end.y - sh.y0) * 0.1);
      const hAt = (v: number) => 0.45 + (end.z - 0.45) * v + peak * bump(v);
      const p = at(u);
      list.push({ y: p.y, layer: lob ? 2 : 1, draw: () => this.drawShot(sh, at, hAt, u) });
    }
  }

  private drawShot(sh: Shot, at: (v: number) => { x: number; y: number }, hAt: (v: number) => number, u: number) {
    const ctx = this.ctx, cam = this.cam, p = at(u);
    const head = cam.project(p.x, p.y, hAt(u)), s = head.s;
    this.shadow(p.x, p.y, sh.style === "shell" ? 0.14 : 0.08, 0.3);
    if (sh.style === "lob" || sh.style === "shell") {
      const r = (sh.style === "shell" ? 0.17 : 0.12) * s;
      ctx.fillStyle = sh.style === "shell" ? "#3b4048" : "#2b2f36"; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(head.x, head.y, r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = (this.time * 12) % 1 > 0.5 ? "#ffd166" : "#ff6a3d";
      ctx.beginPath(); ctx.arc(head.x + r * 0.5, head.y - r * 0.6, Math.max(1.2, r * 0.3), 0, TAU); ctx.fill();
      return;
    }
    if (sh.style === "pellet") {
      ctx.fillStyle = "#ffe08a";
      ctx.beginPath(); ctx.arc(head.x, head.y, Math.max(2, 0.05 * s), 0, TAU); ctx.fill();
      return;
    }
    const ice = sh.style === "shard", bolt = sh.style === "bolt";
    const back = Math.max(0, u - 0.12), t = at(back), tail = cam.project(t.x, t.y, hAt(back));
    const ang = Math.atan2(head.y - tail.y, head.x - tail.x), len = (bolt ? 0.75 : ice ? 0.32 : 0.42) * s;
    ctx.save();
    ctx.translate(head.x, head.y); ctx.rotate(ang);
    const tg = ctx.createLinearGradient(-len * 1.6, 0, 0, 0);
    tg.addColorStop(0, "rgba(255,255,255,0)"); tg.addColorStop(1, bolt ? "rgba(255,230,190,0.8)" : ice ? "rgba(190,235,255,0.9)" : "rgba(255,255,255,0.6)");
    ctx.strokeStyle = tg; ctx.lineWidth = (bolt ? 0.09 : ice ? 0.08 : 0.05) * s; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-len * 1.6, 0); ctx.lineTo(0, 0); ctx.stroke();
    if (ice) {
      ctx.fillStyle = "#e9f9ff";
      ctx.beginPath(); ctx.moveTo(len * 0.35, 0); ctx.lineTo(0, -0.06 * s); ctx.lineTo(-len * 0.3, 0); ctx.lineTo(0, 0.06 * s); ctx.closePath(); ctx.fill();
    } else {
      ctx.strokeStyle = bolt ? "#e9d7b8" : "#f4efe6"; ctx.lineWidth = (bolt ? 0.07 : 0.035) * s;
      ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len * 0.1, 0); ctx.stroke();
      ctx.fillStyle = "#cfd8e3";
      ctx.beginPath(); ctx.moveTo(len * 0.25, 0); ctx.lineTo(0, -0.05 * s); ctx.lineTo(0, 0.05 * s); ctx.fill();
    }
    ctx.restore();
  }

  private drawIce(x: number, y: number, r: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(190,235,255,0.42)"; ctx.strokeStyle = "rgba(233,249,255,0.9)"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3, k = i % 2 ? 0.85 : 1.05;
      i ? ctx.lineTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k) : ctx.moveTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath(); ctx.moveTo(x - r * 0.4, y - r * 0.2); ctx.lineTo(x - r * 0.1, y - r * 0.55); ctx.stroke();
    ctx.restore();
  }

  private drawStun(x: number, y: number, r: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "#ffe08a";
    for (let i = 0; i < 3; i++) {
      const a = this.time * 8 + (i * TAU) / 3;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.25, Math.max(1.5, r * 0.12), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /** Effects live in world space: rings lie on the ground, slashes at waist height, sparks and floats above. */
  private drawFx() {
    const ctx = this.ctx, fx = this.fx, cam = this.cam;
    for (const r of fx.rings) {
      const u = 1 - r.life / r.max;
      const rad = r.r0 + (r.r1 - r.r0) * easeOut(u);
      ctx.save();
      ctx.globalAlpha = 1 - u;
      ctx.beginPath(); cam.groundPath(ctx, r.x, r.y, rad);
      if (r.fill) { ctx.fillStyle = r.fill; ctx.fill(); }
      ctx.strokeStyle = r.color; ctx.lineWidth = Math.max(1, r.width * cam.scaleAt(r.y) * (1 - u * 0.6));
      ctx.stroke();
      ctx.restore();
    }
    for (const a of fx.arcs) {
      const u = 1 - a.life / a.max;
      this.ground(a.x, a.y, (g) => {
        g.globalAlpha = 1 - u;
        g.rotate(a.a);
        g.fillStyle = a.color;
        g.beginPath();
        const sp = a.spread / 2, start = -sp + u * 0.4;
        g.arc(0, 0, a.r, start, sp);
        g.arc(0, 0, a.r * 0.72, sp, start, true);
        g.closePath(); g.fill();
      }, 0.3);
    }
    for (const bm of fx.beams) {
      const u = 1 - bm.life / bm.max;
      const p0 = cam.project(bm.x0, bm.y0, 0.4), p1 = cam.project(bm.x1, bm.y1, 0.4);
      ctx.save();
      ctx.globalAlpha = 1 - u;
      ctx.strokeStyle = bm.color; ctx.lineWidth = bm.width * (p0.s + p1.s) / 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      ctx.restore();
    }
    for (const bl of fx.bolts) {
      const u = 1 - bl.life / bl.max;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const s = this.s;
      for (const [width, alpha, color] of [[0.22, 0.25, "#6aa8ff"], [0.09, 0.9, bl.color], [0.035, 1, "#ffffff"]] as [number, number, string][]) {
        ctx.globalAlpha = alpha * (1 - u);
        ctx.strokeStyle = color; ctx.lineWidth = width * s; ctx.lineJoin = "round"; ctx.lineCap = "round";
        ctx.beginPath();
        let k = bl.seed + Math.floor(this.time * 30);
        const jit = () => { k = (k * 16807) % 2147483647; return (k / 2147483647 - 0.5) * 0.35; };
        bl.pts.forEach(([x, y], i) => {
          if (i === 0) { const q = cam.project(x, y, 0.45); ctx.moveTo(q.x, q.y); return; }
          const [px, py] = bl.pts[i - 1];
          for (let j = 1; j <= 4; j++) {
            const t = j / 4;
            const jx = j < 4 ? jit() : 0, jy = j < 4 ? jit() : 0;
            const q = cam.project(px + (x - px) * t + jx, py + (y - py) * t + jy, 0.45);
            ctx.lineTo(q.x, q.y);
          }
        });
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const p of fx.parts) {
      const u = p.life / p.max;
      const q = cam.project(p.x, p.y, p.z * 0.5 + (p.kind === "spark" || p.kind === "plus" ? 0.3 : 0));
      const x = q.x, y = q.y;
      ctx.save();
      ctx.globalAlpha = Math.min(1, u * 1.6);
      ctx.fillStyle = p.color;
      const size = p.size * q.s * (p.kind === "smoke" ? 1 + (1 - u) * 1.5 : 1);
      if (p.kind === "plus") {
        const w = size * 0.35;
        ctx.fillRect(x - size, y - w, size * 2, w * 2);
        ctx.fillRect(x - w, y - size, w * 2, size * 2);
      } else if (p.kind === "chunk") {
        ctx.translate(x, y); ctx.rotate(p.a ?? 0);
        ctx.fillRect(-size, -size * 0.7, size * 2, size * 1.4);
      } else if (p.kind === "spark") {
        ctx.globalCompositeOperation = "lighter";
        ctx.beginPath(); ctx.arc(x, y, size, 0, TAU); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(x, y, size, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    for (const f of fx.floats) {
      const u = 1 - f.life / f.max;
      const q = cam.project(f.x, f.y, 0.6);
      ctx.save();
      ctx.globalAlpha = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      const size = f.size * q.s * (u < 0.15 ? 0.7 + u * 2 : 1);
      ctx.font = `800 ${size}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.strokeText(f.text, q.x, q.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, q.x, q.y);
      ctx.restore();
    }
  }
}

const easeOut = (x: number) => 1 - (1 - x) ** 3;
/** 0 at both ends, 1 in the middle. */
const bump = (u: number) => 4 * u * (1 - u);
/** How far a shot is along its launcher-to-target line, 0..1. */
function progress(p: Proj, x: number, y: number): number {
  const dx = p.tx - p.x0, dy = p.ty - p.y0, L2 = dx * dx + dy * dy;
  if (L2 < 1e-6) return 0;
  return Math.max(0, Math.min(1, ((x - p.x0) * dx + (y - p.y0) * dy) / L2));
}
/** Launch height and arc peak (world units) for a straight shot: arrows loop, bolts and shards fly flatter. */
export function shotArc(p: Pick<Proj, "kind" | "x0" | "y0" | "tx" | "ty">): { base: number; peak: number } {
  const len = Math.hypot(p.tx - p.x0, p.ty - p.y0);
  const k = p.kind === "arrow" ? 0.16 : p.kind === "bolt" ? 0.06 : 0.08;
  return { base: 0.45, peak: Math.min(1.4, len * k) };
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
