// The board view: draws the deploy scene and the battle, turns battle events into effects.
import type { Battle, BattleEvent, Body } from "../core/battle";
import { H, UNITS, W, ZONE_DEPTH, bodyDef, toWorld, type BodyKind, type Obstacle, type Piece, type Side, type UnitKind } from "../core/defs";
import { Fx, animAlpha, animFrame, frand, type Anim } from "./fx";
import { BOARD, GOLD, INK, TEAM, team } from "./palette";
import { sprite, whiteOf } from "./sprites";
import { drawRank, drawShadow, drawUnit, type DrawOpts } from "./units";
import { BOMBLET_FLIGHT, DROP_TIME, PROJ_VFX, loadVfx, playDrop, playEvent, vfxFrame, vfxReady, vfxSheet } from "./vfx";

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

export interface Rect { x: number; y: number; w: number; h: number; }

const TAU = Math.PI * 2;
const RADIUS = (k: BodyKind): number => bodyDef(k)?.radius ?? 0.3;
const ICE = "#bfe9ff";

export class BoardView {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly fx = new Fx();
  dpr = 1;
  cssW = 0; cssH = 0;
  ox = 0; oy = 0; s = 40;
  rect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  time = 0;
  obstacles: Obstacle[] = [];
  onShake?: (amount: number) => void;
  onSound?: (name: string, gain?: number) => void;
  private bg?: HTMLCanvasElement;
  private reveal = new Map<number, number>(); // piece id -> time revealed
  private drop = new Map<number, number>(); // piece id -> time it started falling
  private frozenAt = new Map<number, number>(); // body id -> board time it froze (ice grows in, shatters on thaw)
  private fuseSeen = new WeakMap<object, number>(); // fuse -> board time first drawn
  /** Vertical squash for things lying on the ground (1 = straight down; the camera can flatten it). */
  groundSquash = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    void loadVfx();
  }

  /** Screen lift in px for a world altitude z. */
  lift(z: number) { return z * this.s * 0.55; }

  layout(cssW: number, cssH: number, area: Rect) {
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.cssW = cssW; this.cssH = cssH;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = cssW + "px";
    this.canvas.style.height = cssH + "px";
    this.s = Math.min(area.w / W, area.h / H);
    this.ox = area.x + (area.w - W * this.s) / 2;
    this.oy = area.y + (area.h - H * this.s) / 2;
    this.rect = { x: this.ox, y: this.oy, w: W * this.s, h: H * this.s };
    this.bg = undefined;
  }

  setObstacles(o: Obstacle[] | undefined) {
    this.obstacles = o ?? [];
    this.bg = undefined;
  }

  sx(x: number) { return this.ox + x * this.s; }
  sy(y: number) { return this.oy + y * this.s; }
  toWorld(px: number, py: number) { return { x: (px - this.ox) / this.s, y: (py - this.oy) / this.s }; }

  // ------------------------------------------------------------ background
  private paintBackground(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = this.canvas.width; c.height = this.canvas.height;
    const g = c.getContext("2d")!;
    g.scale(this.dpr, this.dpr);
    const { x, y, w, h } = this.rect;
    // Outer frame.
    g.fillStyle = "#070a10";
    g.fillRect(0, 0, this.cssW, this.cssH);
    g.save();
    g.shadowColor = "rgba(0,0,0,0.6)"; g.shadowBlur = 24;
    roundRectPath(g, x - 4, y - 4, w + 8, h + 8, 14);
    g.fillStyle = "#1c2534"; g.fill();
    g.restore();
    g.save();
    roundRectPath(g, x, y, w, h, 11);
    g.clip();
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, "#1d1714");
    grad.addColorStop(0.5, BOARD.base0);
    grad.addColorStop(1, "#0f1c22");
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    // Contour lines: a terrain map, not a grid.
    g.strokeStyle = BOARD.line; g.lineWidth = 1;
    for (let k = 0; k < 14; k++) {
      g.beginPath();
      for (let i = 0; i <= 60; i++) {
        const u = i / 60;
        const yy = y + (k / 13) * h + Math.sin(u * 7 + k * 1.3) * this.s * 0.35 + Math.sin(u * 17 + k) * this.s * 0.1;
        i ? g.lineTo(x + u * w, yy) : g.moveTo(x + u * w, yy);
      }
      g.stroke();
    }
    // Speckle.
    for (let i = 0; i < 900; i++) {
      const px = x + Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1) * w;
      const py = y + Math.abs(Math.sin(i * 78.233) * 12543.123 % 1) * h;
      g.fillStyle = i % 3 ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.18)";
      g.fillRect(px, py, 1.5, 1.5);
    }
    // Terrain: soft patches of moss, dirt and shade, then tufts and pebbles.
    const hash = (i: number, k: number) => Math.abs((Math.sin(i * 127.1 + k * 311.7) * 43758.5453) % 1);
    for (let i = 0; i < 46; i++) {
      const px = x + hash(i, 1) * w, py = y + hash(i, 2) * h, pr = (0.8 + hash(i, 3) * 2.2) * this.s;
      const col = i % 3 === 0 ? "rgba(70,110,80,0.13)" : i % 3 === 1 ? "rgba(110,85,60,0.10)" : "rgba(0,0,0,0.14)";
      const rg = g.createRadialGradient(px, py, 0, px, py, pr);
      rg.addColorStop(0, col); rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg;
      g.beginPath(); g.ellipse(px, py, pr * 1.4, pr, hash(i, 4) * 3, 0, Math.PI * 2); g.fill();
    }
    g.lineCap = "round";
    for (let i = 0; i < 110; i++) {
      const px = x + hash(i, 5) * w, py = y + hash(i, 6) * h, k = this.s * (0.07 + hash(i, 7) * 0.08);
      g.strokeStyle = `rgba(${110 + hash(i, 8) * 40},${150 + hash(i, 9) * 40},${110},${0.07 + hash(i, 10) * 0.08})`;
      g.lineWidth = 1.2;
      for (const a of [-0.5, 0, 0.5]) { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.sin(a) * k, py - Math.cos(a) * k * 1.4); g.stroke(); }
    }
    for (let i = 0; i < 70; i++) {
      const px = x + hash(i, 11) * w, py = y + hash(i, 12) * h, pr = this.s * (0.03 + hash(i, 13) * 0.05);
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.beginPath(); g.ellipse(px + pr * 0.3, py + pr * 0.4, pr, pr * 0.75, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = `rgba(${140 + hash(i, 14) * 50},${140 + hash(i, 14) * 50},${150},0.45)`;
      g.beginPath(); g.ellipse(px, py, pr, pr * 0.75, 0, 0, Math.PI * 2); g.fill();
    }
    // Zones and the no-man's band.
    for (const s of [0, 1] as Side[]) {
      const a = toWorld(s, 0, 0), b = toWorld(s, 0, ZONE_DEPTH);
      const y0 = this.sy(Math.min(a.y, b.y)), y1 = this.sy(Math.max(a.y, b.y));
      const zg = g.createLinearGradient(0, s === 0 ? y1 : y0, 0, s === 0 ? y0 : y1);
      zg.addColorStop(0, team(s).glow + "0.16)");
      zg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = zg;
      g.fillRect(x, y0, w, y1 - y0);
    }
    for (const s of [0, 1] as Side[]) {
      const ey = this.sy(s === 0 ? H - 0.12 : 0.12);
      const lg = g.createLinearGradient(x, 0, x + w, 0);
      lg.addColorStop(0, team(s).glow + "0)"); lg.addColorStop(0.5, team(s).glow + "0.7)"); lg.addColorStop(1, team(s).glow + "0)");
      g.strokeStyle = lg; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x, ey); g.lineTo(x + w, ey); g.stroke();
    }
    const top = this.sy(toWorld(1, 0, ZONE_DEPTH).y), bot = this.sy(toWorld(0, 0, ZONE_DEPTH).y);
    g.fillStyle = BOARD.band;
    g.fillRect(x, top, w, bot - top);
    g.setLineDash([this.s * 0.25, this.s * 0.2]);
    g.strokeStyle = "rgba(255,255,255,0.08)"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, (top + bot) / 2); g.lineTo(x + w, (top + bot) / 2); g.stroke();
    g.setLineDash([]);
    // Obstacles: rocks with a lit top.
    for (const o of this.obstacles) {
      const ox = this.sx(o.x), oy = this.sy(o.y), r = o.r * this.s;
      g.fillStyle = "rgba(0,0,0,0.45)";
      g.beginPath(); g.ellipse(ox + r * 0.15, oy + r * 0.25, r * 1.05, r * 0.85, 0, 0, TAU); g.fill();
      const rg = g.createRadialGradient(ox - r * 0.35, oy - r * 0.4, r * 0.1, ox, oy, r);
      rg.addColorStop(0, "#58606b"); rg.addColorStop(1, "#262b33");
      g.fillStyle = rg;
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU, k = 0.85 + 0.15 * Math.abs(Math.sin(o.x * 7 + o.y * 3 + i * 1.7));
        const px = ox + Math.cos(a) * r * k, py = oy + Math.sin(a) * r * k;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath(); g.fill();
      g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
    }
    // Vignette.
    const vg = g.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.3, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.45)");
    g.fillStyle = vg; g.fillRect(x, y, w, h);
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
    playEvent(this.fx, e, {
      find: (id) => battle.bodies.find((b) => b.id === id),
      bodies: battle.bodies,
      time: battle.time,
      textured: vfxReady(),
      sound: (n, g) => this.onSound?.(n, g),
      kick: (k) => this.onShake?.(k),
    });
  }

  /** Deploy drop-in: pieces (by piece id) fall onto the board and land in a puff of dust. */
  dropIn(pieces: { id: number; x: number; y: number; radius: number; side: Side }[]) {
    for (const p of pieces) {
      this.reveal.set(p.id, this.time);
      this.drop.set(p.id, this.time);
      playDrop(this.fx, p.x, p.y, p.radius, p.side);
    }
  }

  /** Drop-in state for a piece id: px to lift it by while it falls, and a landing squash scale. */
  private dropping(id: number): { lift: number; scale: number } {
    const t0 = this.drop.get(id);
    if (t0 === undefined) return { lift: 0, scale: 1 };
    const u = (this.time - t0) / DROP_TIME;
    if (u < 1) return { lift: this.lift(DROP_HEIGHT * (1 - u * u)), scale: 1 };
    if (u < 2.2) return { lift: 0, scale: 1 + 0.16 * Math.sin(((u - 1) / 1.2) * Math.PI) * (2.2 - u) };
    this.drop.delete(id);
    return { lift: 0, scale: 1 };
  }

  // ------------------------------------------------------------ sprite sheets
  /** Draws frame f of a VFX sheet at screen (x, y), h px tall (w px wide, default by aspect). False if not loaded. */
  private sheet(name: string, f: number, x: number, y: number, h: number,
    o: { a?: number; alpha?: number; tint?: string; w?: number; squash?: number; blend?: "add" | "normal" } = {}): boolean {
    const src = vfxFrame(name, f, o.tint);
    if (!src) return false;
    const { sh } = src;
    const w = o.w ?? (h * sh.w) / sh.h;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    if (o.squash !== undefined && o.squash !== 1) ctx.scale(1, o.squash);
    if (o.a) ctx.rotate(o.a);
    ctx.globalAlpha *= o.alpha ?? 1;
    if ((o.blend ?? sh.blend) === "add") ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(src.img, src.sx, src.sy, sh.w, sh.h, -w * sh.anchor[0], -h * sh.anchor[1], w, h);
    ctx.restore();
    return true;
  }

  /** The frame of a looping sheet now, at fps, offset by a seed so neighbours don't flicker in step. */
  private loopFrame(name: string, fps: number, seed = 0) {
    const n = vfxSheet(name)?.frames ?? 1;
    return Math.floor(this.time * fps + seed * 1.37) % n;
  }

  /** Every playing sheet on one layer: "ground" under the bodies, "air" over them. */
  private drawAnims(layer: Anim["layer"]) {
    if (!vfxReady()) return;
    const s = this.s;
    for (const an of this.fx.anims) {
      if (an.delay > 0 || an.layer !== layer) continue;
      const sh = vfxSheet(an.sheet);
      if (!sh) continue;
      const u = 1 - an.life / an.max;
      const k = an.grow ? an.grow[0] + (an.grow[1] - an.grow[0]) * easeOut(u) : 1;
      this.sheet(an.sheet, animFrame(an, sh.frames), this.sx(an.x), this.sy(an.y) - this.lift(an.z), an.size * s * k, {
        a: an.a, alpha: animAlpha(an), tint: an.tint, blend: an.blend,
        w: an.w !== undefined ? an.w * s * k : undefined,
        squash: layer === "ground" ? an.squash * this.groundSquash : an.squash,
      });
    }
  }

  // ------------------------------------------------------------ frame
  update(dt: number) {
    this.time += dt;
    this.fx.update(dt);
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
    roundRectPath(ctx, this.rect.x, this.rect.y, this.rect.w, this.rect.h, 11);
    ctx.clip();
    this.drawAnims("ground");
    if (scene.mode === "deploy") this.drawDeploy(scene);
    else this.drawBattle(scene);
    this.drawFx();
    ctx.restore();
    if (this.fx.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = this.fx.flash * 0.5;
      ctx.fillStyle = this.fx.flashColor;
      ctx.fillRect(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
      ctx.restore();
    }
  }

  /** Draws a body: its Blender sprite for the rank when loaded, else the drawn token. r is the radius in px. */
  private token(kind: BodyKind, side: Side, x: number, y: number, r: number, face: number, o: DrawOpts & { rank?: number }) {
    const ctx = this.ctx;
    const swing = o.swing ?? -1;
    const pose = swing >= 0 && swing < 0.7 ? "attack" : "idle";
    const sp = sprite(kind, Math.max(1, Math.min(4, o.rank ?? 1)), side, pose);
    if (!sp) { drawUnit(ctx, kind, side, x, y, r, face, o); return; }
    const k = r / (RADIUS(kind) * this.s);
    // Drawn a bit larger than true scale so they read on a phone (collision is unchanged).
    const px = sp.size * this.s * k * 1.3;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha *= o.alpha ?? 1;
    if (o.hidden) ctx.globalAlpha *= o.own ? 0.42 : 0.14;
    if (kind !== "mine") drawShadow(ctx, 0, 0, r * 1.3, o.ghost ? 0.2 : 0.38);
    if ((o.rank ?? 1) >= 4 && !o.hidden) {
      // Ascended: a slow pulse of team light on the ground.
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 3 + (o.id ?? 0));
      const g = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2.1);
      g.addColorStop(0, team(side).glow + (0.35 * pulse) + ")");
      g.addColorStop(1, team(side).glow + "0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r * 2.1, 0, TAU); ctx.fill();
    }
    const moving = (o.speed ?? 0) > 0.2;
    if (moving) ctx.translate(0, Math.sin(this.time * 14 + (o.id ?? 0)) * r * 0.07);
    ctx.rotate(face);
    if (swing >= 0 && swing < 0.5) ctx.translate(Math.sin((swing / 0.5) * Math.PI) * r * 0.22, 0);
    if (moving) ctx.scale(1 + Math.sin(this.time * 28 + (o.id ?? 0)) * 0.025, 1);
    ctx.drawImage(sp.img, -px / 2, -px / 2, px, px);
    if (o.flash && o.flash > 0) {
      ctx.globalAlpha *= Math.min(1, o.flash) * 0.8;
      ctx.drawImage(whiteOf(sp), -px / 2, -px / 2, px, px);
    }
    ctx.restore();
  }

  private evolveAt = new Map<number, number>();
  /** A rank-up pop on a placed piece. */
  markEvolve(id: number) { this.evolveAt.set(id, this.time); }

  private drawZone(side: Side) {
    const ctx = this.ctx;
    const a = toWorld(side, 0, -0.05), b = toWorld(side, 0, ZONE_DEPTH);
    const y0 = this.sy(Math.min(a.y, b.y)), y1 = this.sy(Math.max(a.y, b.y));
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
    ctx.save();
    ctx.fillStyle = team(side).glow + (0.07 + 0.05 * pulse) + ")";
    ctx.fillRect(this.rect.x, y0, this.rect.w, y1 - y0);
    ctx.strokeStyle = team(side).glow + (0.5 + 0.3 * pulse) + ")";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    const edge = side === 0 ? y0 : y1;
    ctx.beginPath(); ctx.moveTo(this.rect.x, edge); ctx.lineTo(this.rect.x + this.rect.w, edge); ctx.stroke();
    ctx.restore();
  }

  private drawDeploy(sc: DeployScene) {
    const ctx = this.ctx, s = this.s;
    if (sc.zone !== undefined && sc.zone !== null) this.drawZone(sc.zone);
    const list = [...sc.pieces].sort((a, b) => (a.kind === "mine" ? -1 : 0) - (b.kind === "mine" ? -1 : 0) || a.y - b.y);
    for (const p of list) {
      const def = UNITS[p.kind];
      const x = this.sx(p.x), y = this.sy(p.y), r = def.radius * s;
      if (p.kind === "mine" && p.side === 1 && !sc.showEnemyMines) continue;
      const face = p.side === 0 ? -Math.PI / 2 : Math.PI / 2;
      const sel = sc.selected === p.id;
      if (sel) this.drawSelection(p);
      const revealT = this.reveal.get(p.id);
      const fall = this.dropping(p.id);
      let pop = this.drop.has(p.id) ? fall.scale : revealT !== undefined ? Math.min(1, (this.time - revealT) / 0.25) : 1;
      const evo = this.evolveAt.get(p.id);
      if (evo !== undefined && this.time - evo < 0.45) pop *= 1 + 0.45 * Math.sin(((this.time - evo) / 0.45) * Math.PI);
      const fy = y - fall.lift;
      if (p.kind === "blades") {
        for (let i = 0; i < 3; i++) {
          const a = -Math.PI / 2 * (p.side === 0 ? -1 : 1) + (i * TAU) / 3;
          this.token("blades", p.side, x + Math.cos(a) * 0.32 * s, fy + Math.sin(a) * 0.32 * s, r * pop, face, { t: this.time, id: p.id * 3 + i, rank: p.rank });
        }
      } else {
        this.token(p.kind, p.side, x, fy, r * pop, face, { t: this.time, id: p.id, hidden: p.kind === "mine", own: p.side === 0 || !!sc.showEnemyMines, rank: p.rank });
      }
      drawRank(ctx, x, y, Math.max(r, 0.3 * s), p.rank);
    }
    if (sc.ghost) {
      const g = sc.ghost, def = UNITS[g.kind];
      const x = this.sx(g.x), y = this.sy(g.y), r = def.radius * s;
      ctx.save();
      ctx.globalAlpha = 0.75;
      this.drawRangeHint(g.kind, x, y, g.ok);
      if (g.kind === "blades") {
        for (let i = 0; i < 3; i++) {
          const a = Math.PI / 2 + (i * TAU) / 3;
          this.token("blades", 0, x + Math.cos(a) * 0.32 * s, y + Math.sin(a) * 0.32 * s, r, -Math.PI / 2, { t: this.time, ghost: true });
        }
      } else this.token(g.kind, 0, x, y, r, -Math.PI / 2, { t: this.time, ghost: true, own: true });
      if (!g.ok) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = "#ff4d4d"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
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
    ctx.beginPath(); ctx.arc(x, y, r * this.s, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  private drawSelection(p: Piece) {
    const ctx = this.ctx, def = UNITS[p.kind];
    const x = this.sx(p.x), y = this.sy(p.y), r = (p.kind === "blades" ? 0.62 : def.radius) * this.s;
    this.drawRangeHint(p.kind, x, y, true);
    ctx.save();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -this.time * 20;
    ctx.beginPath(); ctx.arc(x, y, r + 7, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  private drawBattle(sc: BattleScene) {
    const ctx = this.ctx, s = this.s, b = sc.battle, a = sc.alpha;
    const lerp = (bd: Body) => [this.sx(bd.px + (bd.x - bd.px) * a), this.sy(bd.py + (bd.y - bd.py) * a)] as const;
    const tex = vfxReady();
    const sq = this.groundSquash;
    // Burning ground: a scorch decal, a glow and a ring of licking flames.
    for (const z of b.zones ?? []) {
      if (b.time >= z.until) continue;
      const x = this.sx(z.x), y = this.sy(z.y), r = z.r * s;
      const left = Math.min(1, (z.until - b.time) / 0.6);
      if (tex) {
        this.sheet("scorch", 0, x, y, r * 2.1, { alpha: 0.85 * left, squash: sq, a: z.id });
        const n = Math.max(4, Math.round(z.r * 7));
        const flames: [number, number, number][] = [];
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * TAU + z.id * 0.7, d = (i % 2 ? 0.35 : 0.68) * r;
          flames.push([x + Math.cos(ang) * d, y + Math.sin(ang) * d * sq, i]);
        }
        flames.push([x, y, n]);
        flames.sort((p, q) => p[1] - q[1]);
        for (const [fx, fy, i] of flames) this.sheet("flame", this.loopFrame("flame", 14, i + z.id), fx, fy, s * (0.42 + 0.12 * (i % 3)) * (0.4 + 0.6 * left), { alpha: left });
      }
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const fl = 0.75 + 0.25 * Math.sin(this.time * 17 + z.id);
      g.addColorStop(0, `rgba(255,170,60,${0.45 * fl * left})`);
      g.addColorStop(0.6, `rgba(255,90,30,${0.28 * fl * left})`);
      g.addColorStop(1, "rgba(255,60,20,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      if (Math.random() < 0.35) this.fx.burst(z.x + frand(-z.r, z.r) * 0.7, z.y + frand(-z.r, z.r) * 0.7, 1, { color: "#ffb347", speed: 0.4, size: 0.05, max: 0.6, kind: "spark", gravity: -1.5, vz: 1 });
    }
    // Ground layer: mines, fuses waiting to blow.
    for (const bd of b.bodies) {
      if (bd.kind !== "mine" || !bd.alive) continue;
      const [x, y] = lerp(bd);
      this.token("mine", bd.side, x, y, bd.radius * s, 0, { t: this.time, state: bd.state, hidden: bd.hidden, own: bd.side === 0, rank: bd.rank });
    }
    for (const f of b.fuses ?? []) {
      if (b.time >= f.at) continue;
      // Thrown bomblets and dropped kegs are still in the air (an anim) for their first moments.
      let seen = this.fuseSeen.get(f);
      if (seen === undefined) this.fuseSeen.set(f, (seen = this.time));
      if (tex && this.time - seen < BOMBLET_FLIGHT) continue;
      const x = this.sx(f.x), y = this.sy(f.y), r = 0.11 * s;
      if (tex) {
        const keg = f.kind === "keg";
        this.sheet("shadow", 0, x, y, (keg ? 0.42 : 0.3) * s, { alpha: 0.6, squash: sq });
        const urgent = f.at - b.time < 0.4;
        this.sheet(keg ? "keg" : "bomb", this.loopFrame(keg ? "keg" : "bomb", urgent ? 28 : 14, f.x * 7), x, y - 0.04 * s, (keg ? 0.42 : 0.3) * s * (urgent ? 1 + 0.08 * Math.sin(this.time * 40) : 1));
        continue;
      }
      drawShadow(ctx, x, y, r, 0.4);
      ctx.fillStyle = f.kind === "keg" ? "#7a4a24" : "#2b2f36"; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, f.kind === "keg" ? r * 1.6 : r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = (this.time * 14) % 1 > 0.5 ? "#ffd166" : "#ff6a3d";
      ctx.beginPath(); ctx.arc(x + r * 0.5, y - r * 0.7, r * 0.4, 0, TAU); ctx.fill();
    }
    // Tinkers' turrets going up.
    for (const bd of b.bodies) {
      if (!bd.alive || bd.kind !== "tinker" || bd.state !== "build") continue;
      const x = this.sx(bd.ax), y = this.sy(bd.ay), u = Math.min(1, bd.t / 1.2);
      ctx.save();
      ctx.strokeStyle = "rgba(255,209,102,0.85)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 0.3 * s, -Math.PI / 2, -Math.PI / 2 + TAU * u); ctx.stroke();
      ctx.restore();
    }
    const live = b.bodies.filter((bd) => bd.kind !== "mine" && (bd.alive || b.time - bd.diedAt < 0.45)).sort((p, q) => (p.flying ? 1 : 0) - (q.flying ? 1 : 0) || p.y - q.y);
    for (const bd of live) {
      const [x, y] = lerp(bd);
      const fade = bd.alive ? 1 : 1 - (b.time - bd.diedAt) / 0.45;
      if (bd.burrowed) {
        // Underground: a moving mound of earth, no body.
        if (tex) { this.sheet("mound", 0, x, y, 0.62 * s, { a: Math.atan2(bd.vy, bd.vx), squash: sq }); continue; }
        ctx.save();
        ctx.fillStyle = "rgba(95,72,48,0.9)"; ctx.strokeStyle = "rgba(40,28,18,0.9)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(x, y, 0.26 * s, 0.18 * s, Math.atan2(bd.vy, bd.vx), 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(160,125,85,0.8)";
        ctx.beginPath(); ctx.ellipse(x - 0.04 * s, y - 0.04 * s, 0.12 * s, 0.07 * s, 0, 0, TAU); ctx.fill();
        ctx.restore();
        continue;
      }
      const swing = b.time - bd.swing < 0.35 ? (b.time - bd.swing) / 0.35 : -1;
      const sp = Math.hypot(bd.vx, bd.vy);
      if (bd.kind === "lancer" && bd.state === "charge" && sp > 2.5 && Math.random() < 0.5)
        this.fx.burst(bd.x - Math.cos(bd.face) * 0.3, bd.y - Math.sin(bd.face) * 0.3, 1, { color: "rgba(170,150,120,0.55)", speed: 0.5, size: 0.12, max: 0.45, kind: "smoke", gravity: 0 });
      if (bd.kind === "shade" && bd.hidden && Math.random() < 0.15)
        this.fx.burst(bd.x, bd.y, 1, { color: "rgba(180,140,255,0.35)", speed: 0.3, size: 0.1, max: 0.5, kind: "smoke", gravity: 0 });
      if (bd.kind === "keg" && bd.state === "run" && Math.random() < 0.6)
        this.fx.burst(bd.x, bd.y, 1, { color: "#ffd166", speed: 0.8, size: 0.035, max: 0.3, kind: "spark", gravity: 0 });
      // Auras under the unit.
      const auraOn = bd.alive && ((bd.buff ?? 0) > 0 || (bd.rally ?? 0) > 0);
      if (auraOn && tex) {
        const rally = (bd.rally ?? 0) > 0;
        this.sheet("aura", 0, x, y, bd.radius * s * 3.3, { a: this.time * 0.8 + bd.id, tint: rally ? GOLD : TEAM[bd.side].main, alpha: 0.6, squash: sq });
        if (rally) this.sheet("rally", this.loopFrame("rally", 12, bd.id), x, y, bd.radius * s * 2.4, { tint: GOLD, alpha: 0.55 });
      } else if (auraOn) {
        ctx.save();
        ctx.strokeStyle = (bd.rally ?? 0) > 0 ? "rgba(255,209,102,0.55)" : team(bd.side).glow + "0.45)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]); ctx.lineDashOffset = -this.time * 12;
        ctx.beginPath(); ctx.arc(x, y, bd.radius * s * 1.5, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      // Ravager fury: a red heat haze that thickens as it nears death.
      const fury = bd.kind === "ravager" && bd.alive ? 1 - bd.hp / bd.maxHp : 0;
      if (tex && fury > 0.25) this.sheet("rage", this.loopFrame("rage", 10 + fury * 14, bd.id), x, y, bd.radius * s * (2.4 + fury), { tint: "#ff3b3b", alpha: Math.min(0.85, fury) });
      let dy = 0, scale = 1;
      if (bd.flying) {
        // Altitude: the body rides above its shadow.
        const z = bd.z ?? 1.2;
        if (!tex || !this.sheet("shadow", 0, x, y, bd.radius * s * 2.2 * (1.1 - z * 0.2), { alpha: 0.8 - z * 0.3, squash: sq }))
          drawShadow(ctx, x, y, bd.radius * s * (1.1 - z * 0.2), 0.32 - z * 0.12);
        dy = -this.lift(z);
        scale = 1 + z * 0.12;
      }
      const fall = bd.owner === -1 ? this.dropping(bd.pieceId) : { lift: 0, scale: 1 };
      dy -= fall.lift; scale *= fall.scale;
      const decoy = bd.kind === "decoy";
      const owner = decoy ? b.bodies.find((o) => o.id === bd.owner) : undefined;
      const kind = decoy ? "trickster" : bd.kind;
      this.token(kind, bd.side, x, y + dy, bd.radius * s * scale * (bd.alive ? 1 : 0.8 + 0.2 * fade) * (decoy ? RADIUS("trickster") / RADIUS("decoy") : 1), bd.face, {
        t: this.time, alpha: fade * (decoy ? 0.85 + 0.1 * Math.sin(this.time * 9 + bd.id) : 1), flash: bd.flash / 0.12, swing, swingA: bd.swingA, speed: sp,
        state: bd.state, id: bd.id, hidden: bd.hidden, own: bd.side === 0, rank: decoy ? owner?.rank ?? bd.rank : bd.rank,
      });
      const frozen = bd.alive && (bd.frozen ?? 0) > 0;
      if (frozen && !this.frozenAt.has(bd.id)) this.frozenAt.set(bd.id, this.time);
      else if (!frozen && this.frozenAt.has(bd.id)) {
        this.frozenAt.delete(bd.id);
        if (tex) this.fx.anim("icebreak", bd.x, bd.y, { size: Math.max(0.8, bd.radius * 3.4), max: 0.4, z: bd.flying ? bd.z ?? 0 : 0 });
        this.onSound?.("clank", 0.3);
      }
      if (tex && frozen) {
        const n = vfxSheet("ice")?.frames ?? 1;
        const f = Math.min(n - 1, Math.floor((this.time - this.frozenAt.get(bd.id)!) * 24));
        this.sheet("ice", f, x, y + dy, Math.max(0.8, bd.radius * 3.3) * s);
      } else if (tex && bd.alive && (bd.slow ?? 0) > 0) {
        this.sheet("chill", this.loopFrame("chill", 12, bd.id), x, y + dy, bd.radius * s * 3, { tint: ICE, alpha: Math.min(1, (bd.slow ?? 0) * 2) * 0.8 });
      } else if (frozen) this.drawIce(x, y + dy, bd.radius * s * 1.25);
      else if (bd.alive && (bd.slow ?? 0) > 0) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = ICE; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y + dy, bd.radius * s * 1.15, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      if (tex && bd.alive && bd.kind === "duelist" && (bd.parryCd ?? 1) <= 0) {
        this.sheet("glint", this.loopFrame("glint", 9, bd.id), x + bd.radius * s * 0.8, y + dy - bd.radius * s * 0.8, 0.42 * s, { tint: "#fff6d6" });
      } else if (bd.alive && bd.kind === "duelist" && (bd.parryCd ?? 1) <= 0) {
        const gl = 0.5 + 0.5 * Math.sin(this.time * 10);
        ctx.save(); ctx.globalAlpha = gl; ctx.fillStyle = "#fff6d6";
        ctx.beginPath(); ctx.arc(x + bd.radius * s * 0.8, y - bd.radius * s * 0.8, 2.5, 0, TAU); ctx.fill(); ctx.restore();
      }
      if (tex && bd.alive && bd.kind === "pikeman" && bd.braced) {
        for (const [i, da] of [[0, -0.35], [1, 0.35]] as const)
          this.sheet("glint", this.loopFrame("glint", 7, bd.id + i * 3), x + Math.cos(bd.face + da) * bd.radius * s * 1.7, y + dy + Math.sin(bd.face + da) * bd.radius * s * 1.7, 0.34 * s, { tint: "#e8eef5", alpha: 0.85 });
      } else if (bd.alive && bd.kind === "pikeman" && bd.braced) {
        ctx.save();
        ctx.strokeStyle = "rgba(232,238,245,0.7)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, bd.radius * s * 1.6, bd.face - 0.6, bd.face + 0.6); ctx.stroke();
        ctx.restore();
      }
      if (bd.alive && bd.stun > 0.05) this.drawStun(x, y + dy - bd.radius * s * 1.1, bd.radius * s, tex);
    }
    // Projectiles.
    for (const p of b.projs) {
      if (!p.alive) continue;
      const x = this.sx(p.px + (p.x - p.px) * a), y = this.sy(p.py + (p.y - p.py) * a);
      const pv = PROJ_VFX[p.kind];
      if (tex && pv) {
        const lobbed = p.kind === "grenade" || p.kind === "shell";
        const pfx = p.fx ?? "";
        if (lobbed) {
          this.sheet("shadow", 0, x, y, pv.size * s * 1.1, { alpha: 0.65, squash: sq });
          const zy = y - this.lift(p.z);
          if (pfx === "fire" && Math.random() < 0.7) this.fx.burst(p.x, p.y - p.z * 0.55, 1, { color: "#ff9a3d", speed: 0.3, size: 0.05, max: 0.3, kind: "spark", gravity: 0 });
          if (Math.random() < 0.35) this.fx.anim("smoke", p.x, p.y, { size: 0.28, max: 0.45, z: p.z, tint: pfx === "fire" ? "#4a3a34" : "#c9c2b8", alpha: 0.6 });
          this.sheet(pv.sheet, this.loopFrame(pv.sheet, 16, p.id), x, zy, pv.size * s, { a: lobbed && p.kind === "grenade" ? this.time * 9 : Math.atan2(p.vy, p.vx) });
        } else {
          const ang = Math.atan2(p.vy, p.vx);
          const tint = p.kind === "shard" || pfx === "freeze" ? ICE : p.kind === "pellet" ? GOLD : p.kind === "bolt" ? "#ffe6be" : "#ffffff";
          if (pv.trail) this.sheet("streak", 0, x - Math.cos(ang) * pv.size * s * 2, y - Math.sin(ang) * pv.size * s * 2, pv.size * s * 0.9, { a: ang, w: pv.size * s * 4.4, tint, alpha: 0.75 });
          this.sheet(pv.sheet, 0, x, y, pv.size * s, { a: ang });
        }
        continue;
      }
      if (p.kind === "grenade" || p.kind === "shell") {
        const shell = p.kind === "shell";
        drawShadow(ctx, x, y, (shell ? 0.14 : 0.1) * s, 0.4);
        const zy = y - p.z * s * 0.55;
        if ((p as any).fx === "fire" && Math.random() < 0.7) this.fx.burst(p.x, p.y - p.z * 0.55, 1, { color: "#ff9a3d", speed: 0.3, size: 0.05, max: 0.3, kind: "spark", gravity: 0 });
        ctx.fillStyle = shell ? "#3b4048" : "#2b2f36"; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, zy, (shell ? 0.17 : 0.12) * s, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = (this.time * 12) % 1 > 0.5 ? "#ffd166" : "#ff6a3d";
        ctx.beginPath(); ctx.arc(x + 0.06 * s, zy - 0.08 * s, 0.04 * s, 0, TAU); ctx.fill();
      } else if (p.kind === "pellet") {
        ctx.fillStyle = "#ffe08a";
        ctx.beginPath(); ctx.arc(x, y, Math.max(2, 0.05 * s), 0, TAU); ctx.fill();
      } else {
        const ice = p.kind === "shard";
        const ang = Math.atan2(p.vy, p.vx), len = (p.kind === "bolt" ? 0.75 : ice ? 0.32 : 0.42) * s;
        ctx.save();
        ctx.translate(x, y); ctx.rotate(ang);
        const tg = ctx.createLinearGradient(-len * 1.6, 0, 0, 0);
        tg.addColorStop(0, "rgba(255,255,255,0)"); tg.addColorStop(1, p.kind === "bolt" ? "rgba(255,230,190,0.8)" : ice ? "rgba(190,235,255,0.9)" : "rgba(255,255,255,0.6)");
        ctx.strokeStyle = tg; ctx.lineWidth = p.kind === "bolt" ? 0.09 * s : ice ? 0.08 * s : 0.05 * s; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(-len * 1.6, 0); ctx.lineTo(0, 0); ctx.stroke();
        if (ice) {
          ctx.fillStyle = "#e9f9ff";
          ctx.beginPath(); ctx.moveTo(len * 0.35, 0); ctx.lineTo(0, -0.06 * s); ctx.lineTo(-len * 0.3, 0); ctx.lineTo(0, 0.06 * s); ctx.closePath(); ctx.fill();
        } else {
          ctx.strokeStyle = p.kind === "bolt" ? "#e9d7b8" : "#f4efe6"; ctx.lineWidth = p.kind === "bolt" ? 0.07 * s : 0.035 * s;
          ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len * 0.1, 0); ctx.stroke();
          ctx.fillStyle = "#cfd8e3";
          ctx.beginPath(); ctx.moveTo(len * 0.25, 0); ctx.lineTo(0, -0.05 * s); ctx.lineTo(0, 0.05 * s); ctx.fill();
        }
        ctx.restore();
      }
    }
    // Health bars on top (not for illusions or bodies underground).
    for (const bd of live) {
      if (!bd.alive || bd.hp >= bd.maxHp || bd.kind === "mite" || bd.kind === "decoy" || bd.burrowed) continue;
      const [x, y0] = lerp(bd);
      const y = y0 - (bd.flying ? (bd.z ?? 1.2) * s * 0.55 : 0);
      const w = Math.max(16, bd.radius * s * 1.9), h = 4;
      const top = y - bd.radius * s * 1.3 - 9;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x - w / 2 - 1, top - 1, w + 2, h + 2);
      ctx.fillStyle = TEAM[bd.side].main;
      ctx.fillRect(x - w / 2, top, w * (bd.hp / bd.maxHp), h);
    }
    for (const bd of live) {
      if (!bd.alive || bd.rank <= 1 || bd.kind === "mite" || bd.burrowed || bd.kind === "decoy") continue;
      const [x, y] = lerp(bd);
      drawRank(ctx, x, y - (bd.hp < bd.maxHp ? 14 : 5) - (bd.flying ? (bd.z ?? 1.2) * s * 0.55 : 0), bd.radius * s * 1.3, bd.rank);
    }
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

  private drawStun(x: number, y: number, r: number, tex = false) {
    const ctx = this.ctx;
    if (tex) {
      for (let i = 0; i < 3; i++) {
        const a = this.time * 8 + (i * TAU) / 3;
        this.sheet("glint", this.loopFrame("glint", 12, i), x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.25, Math.max(8, r * 0.7), { tint: "#ffe08a" });
      }
      return;
    }
    ctx.save();
    ctx.fillStyle = "#ffe08a";
    for (let i = 0; i < 3; i++) {
      const a = this.time * 8 + (i * TAU) / 3;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.25, Math.max(1.5, r * 0.12), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  private drawFx() {
    const ctx = this.ctx, s = this.s, fx = this.fx;
    this.drawAnims("air");
    for (const r of fx.rings) {
      const u = 1 - r.life / r.max;
      const rad = (r.r0 + (r.r1 - r.r0) * easeOut(u)) * s;
      ctx.save();
      ctx.globalAlpha = 1 - u;
      if (r.fill) { ctx.fillStyle = r.fill; ctx.beginPath(); ctx.arc(this.sx(r.x), this.sy(r.y), rad, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = r.color; ctx.lineWidth = Math.max(1, r.width * s * (1 - u * 0.6));
      ctx.beginPath(); ctx.arc(this.sx(r.x), this.sy(r.y), rad, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    for (const a of fx.arcs) {
      const u = 1 - a.life / a.max;
      ctx.save();
      ctx.globalAlpha = 1 - u;
      ctx.translate(this.sx(a.x), this.sy(a.y));
      ctx.rotate(a.a);
      const rr = a.r * s;
      ctx.fillStyle = a.color;
      ctx.beginPath();
      const sp = a.spread / 2, start = -sp + u * 0.4;
      ctx.arc(0, 0, rr, start, sp);
      ctx.arc(0, 0, rr * 0.72, sp, start, true);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    for (const bm of fx.beams) {
      const u = 1 - bm.life / bm.max;
      ctx.save();
      ctx.globalAlpha = 1 - u;
      ctx.strokeStyle = bm.color; ctx.lineWidth = bm.width * s; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(this.sx(bm.x0), this.sy(bm.y0)); ctx.lineTo(this.sx(bm.x1), this.sy(bm.y1)); ctx.stroke();
      ctx.restore();
    }
    for (const bl of fx.bolts) {
      const u = 1 - bl.life / bl.max;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const [width, alpha, color] of [[0.22, 0.25, "#6aa8ff"], [0.09, 0.9, bl.color], [0.035, 1, "#ffffff"]] as [number, number, string][]) {
        ctx.globalAlpha = alpha * (1 - u);
        ctx.strokeStyle = color; ctx.lineWidth = width * s; ctx.lineJoin = "round"; ctx.lineCap = "round";
        ctx.beginPath();
        let k = bl.seed + Math.floor(this.time * 30);
        const jit = () => { k = (k * 16807) % 2147483647; return (k / 2147483647 - 0.5) * 0.35; };
        bl.pts.forEach(([x, y], i) => {
          if (i === 0) { ctx.moveTo(this.sx(x), this.sy(y)); return; }
          const [px, py] = bl.pts[i - 1];
          for (let j = 1; j <= 4; j++) {
            const t = j / 4;
            const jx = j < 4 ? jit() : 0, jy = j < 4 ? jit() : 0;
            ctx.lineTo(this.sx(px + (x - px) * t + jx), this.sy(py + (y - py) * t + jy));
          }
        });
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const p of fx.parts) {
      const u = p.life / p.max;
      const x = this.sx(p.x), y = this.sy(p.y) - p.z * s * 0.5;
      ctx.save();
      ctx.globalAlpha = Math.min(1, u * 1.6);
      ctx.fillStyle = p.color;
      const size = p.size * s * (p.kind === "smoke" ? 1 + (1 - u) * 1.5 : 1);
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
      ctx.save();
      ctx.globalAlpha = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      const size = f.size * s * (u < 0.15 ? 0.7 + u * 2 : 1);
      ctx.font = `800 ${size}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.strokeText(f.text, this.sx(f.x), this.sy(f.y));
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, this.sx(f.x), this.sy(f.y));
      ctx.restore();
    }
  }
}

const easeOut = (x: number) => 1 - (1 - x) ** 3;
/** How high (world units) a deployed piece falls from. */
const DROP_HEIGHT = 3;

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
