// Top-down tokens for every unit, drawn with paths (no image assets). r is the body radius in pixels.
import type { BodyKind, Side } from "../core/defs";
import { INK, STEEL, TEAM, WOOD, ZAP } from "./palette";

export interface DrawOpts {
  rank?: number;
  t?: number; // seconds, for idle motion
  alpha?: number;
  flash?: number; // 0..1 white hit flash
  swing?: number; // 0..1 progress of the latest attack, or -1
  swingA?: number; // attack angle
  speed?: number; // movement speed, for gait
  state?: string;
  id?: number;
  ghost?: boolean; // placement preview
  hidden?: boolean; // cloaked / buried
  own?: boolean; // viewer's own side (mines and cloaks show faintly)
  noShadow?: boolean; // the caller draws the contact shadow (the diorama board does)
}

const TAU = Math.PI * 2;

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke = INK, lw = 0) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  if (lw) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
}

function body(ctx: CanvasRenderingContext2D, r: number, side: Side, lw: number) {
  const c = TEAM[side];
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, c.light);
  g.addColorStop(0.45, c.main);
  g.addColorStop(1, c.dark);
  disc(ctx, 0, 0, r, g as unknown as string, INK, lw);
}

/** A seeded wobble for rock shapes. */
function rockPath(ctx: CanvasRenderingContext2D, r: number, id: number, n = 9) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = 0.82 + 0.18 * Math.abs(Math.sin(id * 12.9898 + i * 78.233));
    const x = Math.cos(a) * r * k, y = Math.sin(a) * r * k;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

export function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha = 0.35) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(x + r * 0.12, y + r * 0.28, r * 1.02, r * 0.78, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Tokens draw a little larger than their collision body so they read on a phone. */
export const VISUAL = 1.22;

export function drawUnit(ctx: CanvasRenderingContext2D, kind: BodyKind, side: Side, x: number, y: number, r: number, face: number, o: DrawOpts = {}) {
  const t = o.t ?? 0;
  r *= kind === "blades" || kind === "mite" ? 1.12 : VISUAL;
  const lw = Math.max(1.2, r * 0.13);
  const c = TEAM[side];
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha *= o.alpha ?? 1;
  if (o.hidden) ctx.globalAlpha *= o.own ? 0.42 : 0.14;
  if (kind !== "mine" && !o.noShadow) drawShadow(ctx, 0, 0, kind === "lancer" ? r * 1.15 : r, o.ghost ? 0.2 : 0.35);
  // A small bob while walking.
  const gait = o.speed && o.speed > 0.2 ? Math.sin(t * 14 + (o.id ?? 0)) * r * 0.06 : 0;
  ctx.translate(0, gait);
  const sw = o.swing ?? -1;
  switch (kind) {
    case "mine": drawMine(ctx, r, side, t, o); break;
    case "blades": {
      ctx.rotate(face);
      body(ctx, r, side, lw);
      // Sword sweeps across the front during a slash.
      const sweep = sw >= 0 ? -1.2 + 2.4 * easeOut(sw) : 0.5;
      ctx.save();
      ctx.rotate(sweep);
      ctx.strokeStyle = STEEL; ctx.lineCap = "round"; ctx.lineWidth = r * 0.22;
      ctx.beginPath(); ctx.moveTo(r * 0.45, r * 0.3); ctx.lineTo(r * 1.65, r * 0.42); ctx.stroke();
      ctx.strokeStyle = WOOD; ctx.lineWidth = r * 0.3;
      ctx.beginPath(); ctx.moveTo(r * 0.35, r * 0.18); ctx.lineTo(r * 0.38, r * 0.48); ctx.stroke();
      ctx.restore();
      disc(ctx, r * 0.15, 0, r * 0.42, c.dark);
      break;
    }
    case "ranger": {
      ctx.rotate(face);
      body(ctx, r, side, lw);
      // Hood at the back, bow at the front.
      ctx.fillStyle = c.dark;
      ctx.beginPath(); ctx.moveTo(-r * 1.05, 0); ctx.lineTo(-r * 0.2, -r * 0.55); ctx.lineTo(-r * 0.2, r * 0.55); ctx.closePath(); ctx.fill();
      const draw = sw >= 0 ? 1 - sw : 0;
      ctx.strokeStyle = WOOD; ctx.lineWidth = r * 0.2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(r * 0.35, 0, r * 0.95, -1.0, 1.0); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = r * 0.06;
      const sx = r * 0.35 + Math.cos(1.0) * r * 0.95, sy = Math.sin(1.0) * r * 0.95;
      ctx.beginPath(); ctx.moveTo(sx, -sy); ctx.lineTo(r * 0.3 - draw * r * 0.4, 0); ctx.lineTo(sx, sy); ctx.stroke();
      break;
    }
    case "bulwark": {
      ctx.rotate(face);
      body(ctx, r, side, lw);
      disc(ctx, -r * 0.1, 0, r * 0.45, c.dark);
      ctx.strokeStyle = INK; ctx.lineWidth = r * 0.42; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(0, 0, r * 0.98, -1.15, 1.15); ctx.stroke();
      ctx.strokeStyle = "#c9d3de"; ctx.lineWidth = r * 0.28;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.98, -1.1, 1.1); ctx.stroke();
      ctx.strokeStyle = c.main; ctx.lineWidth = r * 0.08;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.98, -0.5, 0.5); ctx.stroke();
      break;
    }
    case "medic": {
      ctx.rotate(face);
      body(ctx, r, side, lw);
      ctx.rotate(-face);
      ctx.fillStyle = "#ffffff";
      const a = r * 0.55, b = r * 0.2;
      ctx.fillRect(-a, -b, a * 2, b * 2);
      ctx.fillRect(-b, -a, b * 2, a * 2);
      if (sw >= 0 && sw < 1) {
        ctx.strokeStyle = `rgba(125,255,166,${0.8 * (1 - sw)})`; ctx.lineWidth = r * 0.12;
        ctx.beginPath(); ctx.arc(0, 0, r * (1.1 + sw * 0.6), 0, TAU); ctx.stroke();
      }
      break;
    }
    case "grenadier": {
      ctx.rotate(face);
      body(ctx, r, side, lw);
      disc(ctx, -r * 0.2, 0, r * 0.5, c.dark);
      const lift = sw >= 0 ? Math.sin(Math.min(1, sw) * Math.PI) * r * 0.5 : 0;
      disc(ctx, r * 0.55 + lift, r * 0.55, r * 0.38, "#2b2f36", INK, lw * 0.7);
      ctx.fillStyle = (t * 6) % 1 > 0.5 ? "#ffd166" : "#ff8a3d";
      ctx.beginPath(); ctx.arc(r * 0.72 + lift, r * 0.3, r * 0.12, 0, TAU); ctx.fill();
      break;
    }
    case "shade": {
      ctx.rotate(face);
      const g = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
      g.addColorStop(0, "#5b3a8a"); g.addColorStop(1, c.dark);
      disc(ctx, 0, 0, r, g as unknown as string, INK, lw);
      ctx.fillStyle = "#1a1024";
      ctx.beginPath(); ctx.moveTo(r * 1.0, 0); ctx.lineTo(-r * 0.5, -r * 0.7); ctx.lineTo(-r * 0.25, 0); ctx.lineTo(-r * 0.5, r * 0.7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = c.light;
      disc(ctx, r * 0.42, -r * 0.18, r * 0.09, c.light);
      disc(ctx, r * 0.42, r * 0.18, r * 0.09, c.light);
      const stab = sw >= 0 ? Math.sin(Math.min(1, sw) * Math.PI) * r * 0.5 : 0;
      ctx.strokeStyle = STEEL; ctx.lineWidth = r * 0.14; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(r * 0.3, -r * 0.75); ctx.lineTo(r * 1.0 + stab, -r * 0.55); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.3, r * 0.75); ctx.lineTo(r * 1.0 + stab, r * 0.55); ctx.stroke();
      break;
    }
    case "lancer": {
      ctx.rotate(face);
      // Mount: an elongated body along the facing, rider on top, lance forward.
      const gl = ctx.createLinearGradient(-r, 0, r, 0);
      gl.addColorStop(0, "#5a3b22"); gl.addColorStop(1, "#8a5a35");
      ctx.fillStyle = gl; ctx.strokeStyle = INK; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.35, r * 0.72, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#3a2616";
      ctx.beginPath(); ctx.ellipse(r * 1.2, 0, r * 0.42, r * 0.3, 0, 0, TAU); ctx.fill();
      ctx.save(); ctx.scale(0.72, 0.72); body(ctx, r * 0.95, side, lw); ctx.restore();
      ctx.strokeStyle = STEEL; ctx.lineWidth = r * 0.16; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-r * 0.2, r * 0.35); ctx.lineTo(r * 2.4, r * 0.28); ctx.stroke();
      ctx.fillStyle = c.main;
      ctx.beginPath(); ctx.moveTo(r * 1.6, r * 0.3); ctx.lineTo(r * 1.25, r * 0.75 + Math.sin(t * 12) * r * 0.08); ctx.lineTo(r * 1.15, r * 0.3); ctx.fill();
      break;
    }
    case "ballista": {
      // Square timber base (fixed), crossbow turret rotating.
      ctx.fillStyle = "#4a3324"; ctx.strokeStyle = INK; ctx.lineWidth = lw;
      roundRect(ctx, -r * 0.9, -r * 0.9, r * 1.8, r * 1.8, r * 0.25); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = c.main; ctx.lineWidth = r * 0.14;
      roundRect(ctx, -r * 0.7, -r * 0.7, r * 1.4, r * 1.4, r * 0.18); ctx.stroke();
      ctx.rotate(face);
      const recoil = sw >= 0 && sw < 1 ? (1 - sw) * r * 0.25 : 0;
      ctx.translate(-recoil, 0);
      ctx.fillStyle = WOOD;
      roundRect(ctx, -r * 0.55, -r * 0.18, r * 1.6, r * 0.36, r * 0.1); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#cfd8e3"; ctx.lineWidth = r * 0.16; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(r * 0.55, -r * 0.95); ctx.quadraticCurveTo(r * 0.95, 0, r * 0.55, r * 0.95); ctx.stroke();
      if (sw < 0 || sw > 0.6) {
        ctx.strokeStyle = STEEL; ctx.lineWidth = r * 0.09;
        ctx.beginPath(); ctx.moveTo(-r * 0.3, 0); ctx.lineTo(r * 1.25, 0); ctx.stroke();
      }
      break;
    }
    case "hive": {
      const pulse = 1 + Math.sin(t * 3 + (o.id ?? 0)) * 0.04;
      ctx.scale(pulse, pulse);
      const cells: [number, number][] = [[0, 0], [0.62, 0.36], [-0.62, 0.36], [0, -0.72], [0.62, -0.36], [-0.62, -0.36], [0, 0.72]];
      for (const [cx, cy] of cells) {
        hex(ctx, cx * r * 0.62, cy * r * 0.62, r * 0.36);
        ctx.fillStyle = c.dark; ctx.fill();
        ctx.lineWidth = lw * 0.8; ctx.strokeStyle = INK; ctx.stroke();
      }
      hex(ctx, 0, 0, r * 0.3);
      ctx.fillStyle = c.light; ctx.globalAlpha *= 0.6 + 0.4 * Math.sin(t * 5); ctx.fill();
      break;
    }
    case "storm": {
      ctx.rotate(face);
      body(ctx, r, side, lw);
      ctx.rotate(-face);
      // Orb overhead with sparks circling it.
      const g = ctx.createRadialGradient(0, -r * 0.1, 0, 0, -r * 0.1, r * 0.65);
      g.addColorStop(0, "#ffffff"); g.addColorStop(0.4, ZAP); g.addColorStop(1, "rgba(120,170,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.65, 0, TAU); ctx.fill();
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 3; i++) {
        const a = t * 4 + (i * TAU) / 3;
        ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95 - r * 0.1, r * 0.1, 0, TAU); ctx.fill();
      }
      break;
    }
    case "golem": case "golemling": {
      ctx.rotate(face);
      const fist = sw >= 0 && sw < 1 ? Math.sin(sw * Math.PI) * r * 0.45 : 0;
      for (const s of [-1, 1]) {
        ctx.save(); ctx.translate(r * 0.55 + fist, s * r * 0.78);
        rockPath(ctx, r * 0.36, (o.id ?? 1) + s * 3, 7);
        ctx.fillStyle = "#6f7782"; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.stroke();
        ctx.restore();
      }
      rockPath(ctx, r, o.id ?? 1);
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      g.addColorStop(0, "#a3abb5"); g.addColorStop(1, "#4d545e");
      ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.stroke();
      // Runes in team colour.
      ctx.strokeStyle = c.main; ctx.lineWidth = r * 0.09; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-r * 0.35, -r * 0.2); ctx.lineTo(-r * 0.05, 0); ctx.lineTo(-r * 0.35, r * 0.2); ctx.stroke();
      disc(ctx, r * 0.45, -r * 0.2, r * 0.1, c.light);
      disc(ctx, r * 0.45, r * 0.2, r * 0.1, c.light);
      break;
    }
    case "mite": {
      ctx.rotate(face);
      const leg = Math.sin(t * 30 + (o.id ?? 0)) * r * 0.35;
      ctx.strokeStyle = INK; ctx.lineWidth = r * 0.25;
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 0.3 + leg * s, s * r * 1.1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-r * 0.4 - leg * s, s * r * 1.05); ctx.stroke();
      }
      ctx.fillStyle = c.main; ctx.strokeStyle = INK; ctx.lineWidth = lw * 0.8;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.2, r * 0.75, 0, 0, TAU); ctx.fill(); ctx.stroke();
      disc(ctx, r * 0.75, 0, r * 0.38, c.dark);
      break;
    }
    default: {
      // Any unit without a drawn token yet: a team disc with its initial.
      ctx.rotate(face);
      body(ctx, r, side, lw);
      ctx.rotate(-face);
      ctx.fillStyle = INK;
      ctx.font = `900 ${r * 1.1}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(kind)[0].toUpperCase(), 0, r * 0.05);
    }
  }
  if (o.flash && o.flash > 0) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = Math.min(1, o.flash) * 0.85;
    disc(ctx, 0, 0, r * 1.05, "#ffffff");
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
}

function drawMine(ctx: CanvasRenderingContext2D, r: number, side: Side, t: number, o: DrawOpts) {
  const c = TEAM[side];
  const fuse = o.state === "fuse";
  ctx.fillStyle = "#23272e"; ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, r * 0.15);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    ctx.lineTo(Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25);
    ctx.lineTo(Math.cos(a + TAU / 16) * r * 0.85, Math.sin(a + TAU / 16) * r * 0.85);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  const blink = fuse ? (t * 16) % 1 > 0.5 : (t * 1.5) % 1 > 0.7;
  disc(ctx, 0, 0, r * 0.4, blink ? (fuse ? "#ff3b3b" : c.light) : c.dark);
}

function hex(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + Math.PI / 6;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const easeOut = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

/** Rank chevrons above a token. */
export function drawRank(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rank: number) {
  if (rank <= 1) return;
  if (rank >= 4) {
    // Ascended: a small gold star.
    ctx.save();
    ctx.translate(x, y - r - r * 0.45);
    const k = Math.max(5, r * 0.42);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? k * 0.45 : k;
      i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = "#ffd166"; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = INK; ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, y - r - r * 0.35);
  ctx.strokeStyle = "#ffd166"; ctx.lineWidth = Math.max(1.5, r * 0.16); ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (let i = 0; i < rank - 1; i++) {
    const yy = -i * r * 0.3;
    ctx.beginPath(); ctx.moveTo(-r * 0.32, yy + r * 0.12); ctx.lineTo(0, yy - r * 0.1); ctx.lineTo(r * 0.32, yy + r * 0.12); ctx.stroke();
  }
  ctx.restore();
}

/** Mini portrait for shop cards and menus. */
export function drawIcon(canvas: HTMLCanvasElement, kind: BodyKind, side: Side = 0, t = 0.3) {
  const ctx = canvas.getContext("2d")!;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const r = Math.min(w, h) * (kind === "lancer" ? 0.24 : kind === "golem" ? 0.32 : kind === "mine" ? 0.22 : 0.28);
  if (kind === "blades") {
    for (const [dx, dy] of [[-0.55, 0.35], [0.55, 0.35], [0, -0.45]]) drawUnit(ctx, "blades", side, w / 2 + dx * r * 1.2, h / 2 + dy * r * 1.2, r * 0.62, -Math.PI / 2, { t });
  } else {
    drawUnit(ctx, kind, side, w / 2 + (kind === "lancer" ? -r * 0.4 : 0), h / 2 + (kind === "lancer" ? r * 0.15 : 0), r, kind === "lancer" ? -0.5 : -Math.PI / 2, { t, own: true });
  }
}
