// The board view: draws the deploy scene and the battle, turns battle events into effects.
import type { Battle, BattleEvent, Body } from "../core/battle";
import { BODY_EXTRA, H, UNITS, W, ZONE_DEPTH, toWorld, type BodyKind, type Obstacle, type Piece, type Side, type UnitKind } from "../core/defs";
import { Fx, frand } from "./fx";
import { BOARD, GOLD, HEAL, INK, TEAM, VIOLET, ZAP, team } from "./palette";
import { sprite, whiteOf } from "./sprites";
import { drawRank, drawShadow, drawUnit, type DrawOpts } from "./units";

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
const RADIUS = (k: BodyKind): number => (UNITS as Record<string, { radius: number }>)[k]?.radius ?? (BODY_EXTRA as Record<string, { radius: number }>)[k]?.radius ?? 0.3;

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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

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
    const fx = this.fx;
    switch (e.t) {
      case "slash":
        fx.arc(e.x, e.y, e.a, e.r, e.side === 0 ? "#e9fffd" : "#fff0ea", 2.0, 0.16);
        this.onSound?.("slash", 0.35);
        break;
      case "shot":
        this.onSound?.(e.kind === "grenade" ? "throw" : e.kind === "bolt" ? "bolt" : "arrow", 0.4);
        break;
      case "hit": {
        const col = e.shielded ? "#cfd8e3" : team((1 - e.side) as Side).light;
        fx.burst(e.x, e.y, e.big ? 7 : 3, { color: col, speed: 2.2, size: 0.05, max: 0.3, gravity: 0, kind: "spark" });
        if (e.dmg >= 18 || e.big) fx.float(e.x, e.y - 0.45, String(e.dmg), e.big ? GOLD : e.shielded ? "#9fb0c0" : "#ffffff", e.big ? 0.38 : 0.28);
        this.onSound?.(e.shielded ? "clank" : "hit", e.big ? 0.6 : 0.25);
        break;
      }
      case "boom": {
        const big = e.kind === "mine";
        const col = e.kind === "slam" ? "#c9b79c" : "#ffb347";
        fx.ring(e.x, e.y, 0.1, e.r, big ? 0.45 : 0.32, big ? "#ffd27a" : col, big ? 0.12 : 0.07, big ? "rgba(255,180,80,0.35)" : undefined);
        if (e.kind !== "slam") {
          fx.burst(e.x, e.y, big ? 34 : 20, { color: "#ffcf6b", speed: big ? 5 : 3.5, size: 0.07, max: 0.5, kind: "spark", gravity: 2 });
          fx.burst(e.x, e.y, big ? 16 : 9, { color: "rgba(60,55,60,0.8)", speed: 1.4, size: 0.28, max: 1.0, kind: "smoke", gravity: 0, drag: 1.5 });
          fx.burst(e.x, e.y, big ? 10 : 5, { color: "#3a3a3a", speed: 3, size: 0.07, max: 0.9, kind: "chunk", vz: 4, spin: 9 });
          fx.flash = big ? 0.35 : 0.15; fx.flashColor = "#ffd9a0";
        } else {
          fx.burst(e.x, e.y, 14, { color: "rgba(180,160,130,0.7)", speed: 2.2, size: 0.16, max: 0.6, kind: "smoke", gravity: 0, drag: 2 });
          fx.burst(e.x, e.y, 6, { color: "#6f7782", speed: 2.6, size: 0.06, max: 0.6, kind: "chunk", vz: 3, spin: 6 });
        }
        fx.shake = Math.min(1, fx.shake + (big ? 0.8 : e.kind === "grenade" ? 0.35 : 0.25));
        this.onShake?.(big ? 2 : 1);
        this.onSound?.(big ? "boom" : e.kind === "grenade" ? "pop" : "slam", big ? 1 : 0.6);
        break;
      }
      case "zap":
        fx.bolt(e.pts, ZAP, 0.26);
        for (const [x, y] of e.pts.slice(1)) fx.burst(x, y, 4, { color: "#dff1ff", speed: 2.4, size: 0.04, max: 0.25, kind: "spark", gravity: 0 });
        fx.flash = Math.max(fx.flash, 0.08); fx.flashColor = "#cfe8ff";
        this.onSound?.("zap", 0.6);
        break;
      case "heal": {
        const from = battle.bodies.find((b) => b.id === e.from);
        if (from) fx.beam(from.x, from.y, e.x, e.y, HEAL, 0.06, 0.28);
        fx.burst(e.x, e.y, 4, { color: HEAL, speed: 0.6, size: 0.1, max: 0.7, kind: "plus", gravity: -1.2, drag: 3, z: 0.2 });
        this.onSound?.("heal", 0.25);
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
        if (e.kind === "golem") { fx.shake = Math.min(1, fx.shake + 0.5); this.onSound?.("crumble", 0.9); }
        else this.onSound?.(e.kind === "mite" ? "squish" : "down", 0.4);
        break;
      }
      case "blink":
        fx.burst(e.x0, e.y0, 10, { color: VIOLET, speed: 1.2, size: 0.18, max: 0.5, kind: "smoke", gravity: 0, drag: 2 });
        fx.burst(e.x, e.y, 12, { color: VIOLET, speed: 1.6, size: 0.16, max: 0.5, kind: "smoke", gravity: 0, drag: 2 });
        fx.beam(e.x0, e.y0, e.x, e.y, "rgba(180,140,255,0.5)", 0.05, 0.18);
        this.onSound?.("blink", 0.5);
        break;
      case "charge":
        fx.burst(e.x, e.y, 8, { color: "rgba(180,160,130,0.6)", speed: 1.5, size: 0.14, max: 0.5, kind: "smoke", gravity: 0, dir: e.a + Math.PI, spread: 1.4 });
        this.onSound?.("charge", 0.6);
        break;
      case "fuse":
        fx.ring(e.x, e.y, 0.2, 1.0, 0.32, "#ff4d4d", 0.04);
        this.onSound?.("fuse", 0.6);
        break;
      case "end":
        break;
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
      let pop = revealT !== undefined ? Math.min(1, (this.time - revealT) / 0.25) : 1;
      const evo = this.evolveAt.get(p.id);
      if (evo !== undefined && this.time - evo < 0.45) pop *= 1 + 0.45 * Math.sin(((this.time - evo) / 0.45) * Math.PI);
      if (p.kind === "blades") {
        for (let i = 0; i < 3; i++) {
          const a = -Math.PI / 2 * (p.side === 0 ? -1 : 1) + (i * TAU) / 3;
          this.token("blades", p.side, x + Math.cos(a) * 0.32 * s, y + Math.sin(a) * 0.32 * s, r * pop, face, { t: this.time, id: p.id * 3 + i, rank: p.rank });
        }
      } else {
        this.token(p.kind, p.side, x, y, r * pop, face, { t: this.time, id: p.id, hidden: p.kind === "mine", own: p.side === 0 || !!sc.showEnemyMines, rank: p.rank });
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
    // Ground layer: mines and fading remains.
    for (const bd of b.bodies) {
      if (bd.kind !== "mine" || !bd.alive) continue;
      const [x, y] = lerp(bd);
      this.token("mine", bd.side, x, y, bd.radius * s, 0, { t: this.time, state: bd.state, hidden: bd.hidden, own: bd.side === 0, rank: bd.rank });
    }
    const live = b.bodies.filter((bd) => bd.kind !== "mine" && (bd.alive || b.time - bd.diedAt < 0.45)).sort((p, q) => p.y - q.y);
    for (const bd of live) {
      const [x, y] = lerp(bd);
      const fade = bd.alive ? 1 : 1 - (b.time - bd.diedAt) / 0.45;
      const swing = b.time - bd.swing < 0.35 ? (b.time - bd.swing) / 0.35 : -1;
      const sp = Math.hypot(bd.vx, bd.vy);
      if (bd.kind === "lancer" && bd.state === "charge" && sp > 2.5 && Math.random() < 0.5)
        this.fx.burst(bd.x - Math.cos(bd.face) * 0.3, bd.y - Math.sin(bd.face) * 0.3, 1, { color: "rgba(170,150,120,0.55)", speed: 0.5, size: 0.12, max: 0.45, kind: "smoke", gravity: 0 });
      if (bd.kind === "shade" && bd.hidden && Math.random() < 0.15)
        this.fx.burst(bd.x, bd.y, 1, { color: "rgba(180,140,255,0.35)", speed: 0.3, size: 0.1, max: 0.5, kind: "smoke", gravity: 0 });
      this.token(bd.kind, bd.side, x, y, bd.radius * s * (bd.alive ? 1 : 0.8 + 0.2 * fade), bd.face, {
        t: this.time, alpha: fade, flash: bd.flash / 0.12, swing, swingA: bd.swingA, speed: sp, state: bd.state, id: bd.id,
        hidden: bd.hidden, own: bd.side === 0, rank: bd.rank,
      });
      if (bd.alive && bd.stun > 0.05) this.drawStun(x, y - bd.radius * s * 1.1, bd.radius * s);
    }
    // Projectiles.
    for (const p of b.projs) {
      if (!p.alive) continue;
      const x = this.sx(p.px + (p.x - p.px) * a), y = this.sy(p.py + (p.y - p.py) * a);
      if (p.kind === "grenade") {
        drawShadow(ctx, x, y, 0.1 * s, 0.4);
        const zy = y - p.z * s * 0.55;
        ctx.fillStyle = "#2b2f36"; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, zy, 0.12 * s, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = (this.time * 12) % 1 > 0.5 ? "#ffd166" : "#ff6a3d";
        ctx.beginPath(); ctx.arc(x + 0.06 * s, zy - 0.08 * s, 0.04 * s, 0, TAU); ctx.fill();
      } else {
        const ang = Math.atan2(p.vy, p.vx), len = (p.kind === "bolt" ? 0.75 : 0.42) * s;
        ctx.save();
        ctx.translate(x, y); ctx.rotate(ang);
        const tg = ctx.createLinearGradient(-len * 1.6, 0, 0, 0);
        tg.addColorStop(0, "rgba(255,255,255,0)"); tg.addColorStop(1, p.kind === "bolt" ? "rgba(255,230,190,0.8)" : "rgba(255,255,255,0.6)");
        ctx.strokeStyle = tg; ctx.lineWidth = p.kind === "bolt" ? 0.09 * s : 0.05 * s; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(-len * 1.6, 0); ctx.lineTo(0, 0); ctx.stroke();
        ctx.strokeStyle = p.kind === "bolt" ? "#e9d7b8" : "#f4efe6"; ctx.lineWidth = p.kind === "bolt" ? 0.07 * s : 0.035 * s;
        ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len * 0.1, 0); ctx.stroke();
        ctx.fillStyle = "#cfd8e3";
        ctx.beginPath(); ctx.moveTo(len * 0.25, 0); ctx.lineTo(0, -0.05 * s); ctx.lineTo(0, 0.05 * s); ctx.fill();
        ctx.restore();
      }
    }
    // Health bars on top.
    for (const bd of live) {
      if (!bd.alive || bd.hp >= bd.maxHp || bd.kind === "mite") continue;
      const [x, y] = lerp(bd);
      const w = Math.max(16, bd.radius * s * 1.9), h = 4;
      const top = y - bd.radius * s - 9;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x - w / 2 - 1, top - 1, w + 2, h + 2);
      ctx.fillStyle = TEAM[bd.side].main;
      ctx.fillRect(x - w / 2, top, w * (bd.hp / bd.maxHp), h);
    }
    for (const bd of live) if (bd.alive && bd.rank > 1 && bd.kind !== "mite") { const [x, y] = lerp(bd); drawRank(ctx, x, y - 5, bd.radius * s, bd.rank); }
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

  private drawFx() {
    const ctx = this.ctx, s = this.s, fx = this.fx;
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

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
