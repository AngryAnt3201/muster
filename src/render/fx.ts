// Short-lived effects in world coordinates: particles, rings, arcs, bolts of lightning, floating numbers.

export interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; color: string;
  drag: number; gravity: number;
  kind: "dot" | "spark" | "smoke" | "plus" | "chunk";
  spin?: number; a?: number;
}
export interface Ring { x: number; y: number; r0: number; r1: number; life: number; max: number; color: string; width: number; fill?: string; }
export interface Arc { x: number; y: number; a: number; r: number; life: number; max: number; color: string; spread: number; }
export interface Bolt { pts: [number, number][]; life: number; max: number; color: string; seed: number; }
export interface Beam { x0: number; y0: number; x1: number; y1: number; life: number; max: number; color: string; width: number; }
export interface Float { x: number; y: number; text: string; life: number; max: number; color: string; size: number; }

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export const frand = (a: number, b: number) => a + (b - a) * rnd();

export class Fx {
  parts: Particle[] = [];
  rings: Ring[] = [];
  arcs: Arc[] = [];
  bolts: Bolt[] = [];
  beams: Beam[] = [];
  floats: Float[] = [];
  shake = 0;
  flash = 0;
  flashColor = "#fff";

  clear() {
    this.parts = []; this.rings = []; this.arcs = []; this.bolts = []; this.beams = []; this.floats = [];
    this.shake = 0; this.flash = 0;
  }

  update(dt: number) {
    for (const p of this.parts) {
      p.life -= dt;
      p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vz -= p.gravity * dt; p.z = Math.max(0, p.z + p.vz * dt);
      if (p.z === 0 && p.gravity > 0) { p.vz *= -0.35; p.vx *= 0.7; p.vy *= 0.7; }
      if (p.spin) p.a = (p.a ?? 0) + p.spin * dt;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const list of [this.rings, this.arcs, this.bolts, this.beams, this.floats] as { life: number }[][]) for (const r of list) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    this.arcs = this.arcs.filter((r) => r.life > 0);
    this.bolts = this.bolts.filter((r) => r.life > 0);
    this.beams = this.beams.filter((r) => r.life > 0);
    this.floats = this.floats.filter((r) => r.life > 0);
    for (const f of this.floats) f.y -= dt * 0.9;
    this.shake = Math.max(0, this.shake - dt * 2.8);
    this.flash = Math.max(0, this.flash - dt * 3);
    if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
  }

  burst(x: number, y: number, n: number, o: Partial<Particle> & { speed?: number; spread?: number; dir?: number } = {}) {
    const speed = o.speed ?? 2, spread = o.spread ?? Math.PI * 2, dir = o.dir ?? 0;
    for (let i = 0; i < n; i++) {
      const a = dir + (rnd() - 0.5) * spread;
      const s = speed * (0.35 + rnd() * 0.9);
      const max = (o.max ?? 0.6) * (0.6 + rnd() * 0.7);
      this.parts.push({
        x, y, z: o.z ?? 0.1, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: o.vz ?? frand(0.5, 2.5),
        life: max, max, size: (o.size ?? 0.06) * (0.6 + rnd() * 0.8), color: o.color ?? "#fff",
        drag: o.drag ?? 2.5, gravity: o.gravity ?? 6, kind: o.kind ?? "dot", spin: o.spin, a: rnd() * 6.28,
      });
    }
  }
  ring(x: number, y: number, r0: number, r1: number, max: number, color: string, width = 0.06, fill?: string) {
    this.rings.push({ x, y, r0, r1, life: max, max, color, width, fill });
  }
  arc(x: number, y: number, a: number, r: number, color: string, spread = 2.0, max = 0.16) {
    this.arcs.push({ x, y, a, r, life: max, max, color, spread });
  }
  bolt(pts: [number, number][], color: string, max = 0.24) {
    this.bolts.push({ pts, life: max, max, color, seed: Math.floor(rnd() * 1e6) });
  }
  beam(x0: number, y0: number, x1: number, y1: number, color: string, width = 0.07, max = 0.3) {
    this.beams.push({ x0, y0, x1, y1, life: max, max, color, width });
  }
  float(x: number, y: number, text: string, color = "#fff", size = 0.32, max = 0.8) {
    this.floats.push({ x: x + frand(-0.15, 0.15), y, text, life: max, max, color, size });
  }
}
