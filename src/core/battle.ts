// The battle: a deterministic fixed-step simulation with free 360-degree steering (no grid).
// Every unit kind has its own behaviour; the renderer only reads bodies, projectiles and events.
import {
  BATTLE_LIMIT, BODY_EXTRA, DT, H, UNITS, W,
  rankDmg, rankHp,
  type BodyKind, type Mods, type Obstacle, type Piece, type Side, type UnitKind,
} from "./defs";
import { Rng } from "./rng";

export interface Body {
  id: number;
  pieceId: number;
  kind: BodyKind;
  side: Side;
  rank: number;
  x: number; y: number; px: number; py: number;
  vx: number; vy: number;
  face: number;
  hp: number; maxHp: number;
  dmg: number; range: number; speed: number; radius: number; cooldown: number;
  cd: number;
  alive: boolean;
  structure: boolean;
  hidden: boolean;
  taunt: boolean;
  stun: number;
  flash: number;
  state: string;
  t: number;
  target: number;
  pack: number;
  slot: number;
  owner: number;
  ax: number; ay: number;
  budget: number;
  hits: number[];
  cloak: number;
  blinkCd: number;
  healMul: number;
  diedAt: number;
  /** Render-only: last swing time and angle. */
  swing: number;
  swingA: number;
}

export type ProjKind = "arrow" | "bolt" | "grenade";
export interface Proj {
  id: number;
  kind: ProjKind;
  side: Side;
  x: number; y: number; px: number; py: number;
  vx: number; vy: number;
  x0: number; y0: number; tx: number; ty: number;
  target: number;
  dmg: number;
  t: number;
  life: number;
  z: number;
  hits: number[];
  owner: number;
  rank: number;
  alive: boolean;
}

export type BattleEvent =
  | { t: "slash"; id: number; x: number; y: number; a: number; r: number; side: Side }
  | { t: "shot"; id: number; kind: ProjKind; x: number; y: number }
  | { t: "hit"; id: number; x: number; y: number; dmg: number; side: Side; shielded?: boolean; big?: boolean }
  | { t: "boom"; x: number; y: number; r: number; kind: "mine" | "grenade" | "slam"; side: Side }
  | { t: "zap"; pts: [number, number][]; side: Side }
  | { t: "heal"; from: number; to: number; x: number; y: number; amt: number }
  | { t: "spawn"; id: number; x: number; y: number; side: Side }
  | { t: "death"; id: number; x: number; y: number; kind: BodyKind; side: Side }
  | { t: "blink"; id: number; x0: number; y0: number; x: number; y: number; side: Side }
  | { t: "charge"; id: number; x: number; y: number; a: number }
  | { t: "fuse"; id: number; x: number; y: number }
  | { t: "end"; winner: -1 | 0 | 1 };

export interface BattleOptions {
  seed?: number;
  obstacles?: Obstacle[];
  mods?: [Mods | undefined, Mods | undefined];
  limit?: number;
  /** Keep the event log (the renderer drains it; headless sims leave it off). */
  events?: boolean;
}

export interface BattleResult {
  winner: -1 | 0 | 1;
  time: number;
  /** Threat each side's survivors carry: what they deal to the other commander. */
  threat: [number, number];
  /** Value (cost-weighted health) left on each side, for AI scoring. */
  value: [number, number];
  /** Survivors per side (living bodies, mines excluded). */
  alive: [number, number];
}

const TAU = Math.PI * 2;
const hyp = Math.hypot;
const angleDiff = (a: number, b: number) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
const turnToward = (a: number, b: number, max: number) => {
  const d = angleDiff(a, b);
  return a + Math.max(-max, Math.min(max, d));
};
const fwd = (side: Side) => (side === 0 ? -1 : 1);

const ROLE_BACKLINE = new Set<BodyKind>(["ranger", "medic", "grenadier", "storm", "ballista", "hive"]);

export class Battle {
  bodies: Body[] = [];
  projs: Proj[] = [];
  events: BattleEvent[] = [];
  time = 0;
  done = false;
  winner: -1 | 0 | 1 = -1;
  readonly rng: Rng;
  readonly obstacles: Obstacle[];
  readonly limit: number;
  private nextId = 1;
  private log: boolean;
  private packTarget = new Map<number, number>();
  private packRetarget = new Map<number, number>();
  private mods: [Mods, Mods];

  constructor(pieces: Piece[], opts: BattleOptions = {}) {
    this.rng = new Rng(opts.seed ?? 1);
    this.obstacles = opts.obstacles ?? [];
    this.limit = opts.limit ?? BATTLE_LIMIT;
    this.log = opts.events ?? false;
    this.mods = [opts.mods?.[0] ?? {}, opts.mods?.[1] ?? {}];
    for (const p of pieces) this.addPiece(p);
    for (const b of this.bodies) if (b.kind === "hive" && this.mods[b.side].broodStart) { this.spawnMite(b); this.spawnMite(b); }
    if (!this.sideAlive(0) || !this.sideAlive(1)) this.finish();
  }

  // ------------------------------------------------------------ setup
  private addPiece(p: Piece) {
    const def = UNITS[p.kind];
    const n = def.bodies ?? 1;
    for (let i = 0; i < n; i++) {
      let x = p.x, y = p.y;
      if (n > 1) {
        // Three swords in a small triangle around the placement point.
        const a = -Math.PI / 2 * fwd(p.side) + (i * TAU) / n;
        x += Math.cos(a) * 0.32;
        y += Math.sin(a) * 0.32;
      }
      const b = this.makeBody(p.kind, p.side, p.rank, x, y, p.id);
      if (n > 1) { b.pack = p.id; b.slot = i; }
    }
  }

  private makeBody(kind: BodyKind, side: Side, rank: number, x: number, y: number, pieceId: number): Body {
    const base = kind === "mite" || kind === "golemling" ? BODY_EXTRA[kind] : UNITS[kind as UnitKind];
    const m = this.mods[side];
    const unitKind = (kind === "mite" ? "hive" : kind === "golemling" ? "golem" : kind) as UnitKind;
    const hpMul = (m.hpMul ?? 1) * (m.kindHp?.[unitKind] ?? 1);
    const dmgMul = (m.dmgMul ?? 1) * (m.kindDmg?.[unitKind] ?? 1);
    const hp = Math.round(base.hp * rankHp(rank) * hpMul);
    const b: Body = {
      id: this.nextId++, pieceId, kind, side, rank,
      x, y, px: x, py: y, vx: 0, vy: 0,
      face: side === 0 ? -Math.PI / 2 : Math.PI / 2,
      hp, maxHp: hp,
      dmg: base.dmg * rankDmg(rank) * dmgMul,
      range: base.range * (kind === "mine" && m.bigMines ? 1.25 : 1),
      speed: base.speed * (m.speedMul ?? 1),
      radius: base.radius,
      cooldown: base.cooldown * (m.cooldownMul ?? 1),
      cd: 0.25 + this.rng.next() * 0.35,
      alive: true,
      structure: kind === "ballista" || kind === "hive" || kind === "mine",
      hidden: kind === "mine" || kind === "shade",
      taunt: kind === "bulwark",
      stun: 0, flash: 0,
      state: kind === "mine" ? "armed" : kind === "lancer" ? "aim" : kind === "shade" ? "flank" : "idle",
      t: 0, target: -1, pack: -1, slot: 0, owner: -1,
      ax: 0, ay: 0, budget: 0, hits: [],
      cloak: kind === "shade" ? 3.2 : 0,
      blinkCd: 0,
      healMul: m.healMul ?? 1,
      diedAt: -1,
      swing: -9, swingA: 0,
    };
    this.bodies.push(b);
    return b;
  }

  // ------------------------------------------------------------ queries
  private byId(id: number): Body | undefined {
    if (id < 0) return undefined;
    // Ids are dense and pushed in order, so the index is id-1.
    const b = this.bodies[id - 1];
    return b && b.id === id ? b : this.bodies.find((x) => x.id === id);
  }
  private targetable(b: Body, e: Body) {
    return e.alive && e.side !== b.side && !e.hidden;
  }
  private dist(a: { x: number; y: number }, b: { x: number; y: number }) {
    return hyp(a.x - b.x, a.y - b.y);
  }
  /** Gap between two bodies' edges. */
  private gap(a: Body, b: Body) {
    return this.dist(a, b) - a.radius - b.radius;
  }
  nearestEnemy(b: Body, opts: { max?: number; filter?: (e: Body) => boolean; taunt?: boolean } = {}): Body | undefined {
    let best: Body | undefined, bd = opts.max ?? Infinity;
    for (const e of this.bodies) {
      if (!this.targetable(b, e) || (opts.filter && !opts.filter(e))) continue;
      const d = this.dist(b, e) - e.radius;
      if (d < bd) { bd = d; best = e; }
    }
    if (opts.taunt !== false && best) {
      // A shield bearer close by draws melee attackers to itself.
      for (const e of this.bodies) {
        if (!e.taunt || !this.targetable(b, e)) continue;
        if (this.gap(b, e) < 1.3 && e !== best) return e;
      }
    }
    return best;
  }
  private enemiesNear(side: Side, x: number, y: number, r: number): Body[] {
    const out: Body[] = [];
    for (const e of this.bodies) if (e.alive && e.side !== side && e.kind !== "mine" && hyp(e.x - x, e.y - y) <= r + e.radius) out.push(e);
    return out;
  }
  private allies(b: Body): Body[] {
    return this.bodies.filter((a) => a.alive && a.side === b.side && a !== b && a.kind !== "mine");
  }
  private enemyCentroid(b: Body): { x: number; y: number } | undefined {
    let sx = 0, sy = 0, n = 0;
    for (const e of this.bodies) if (this.targetable(b, e)) { sx += e.x; sy += e.y; n++; }
    return n ? { x: sx / n, y: sy / n } : undefined;
  }
  sideAlive(side: Side): boolean {
    return this.bodies.some((b) => b.alive && b.side === side && b.kind !== "mine");
  }

  // ------------------------------------------------------------ effects
  private emit(e: BattleEvent) {
    if (this.log) this.events.push(e);
  }
  damage(target: Body, amount: number, src: { x: number; y: number } | null, side: Side, big = false) {
    if (!target.alive || amount <= 0) return;
    let shielded = false;
    if (target.kind === "bulwark" && src) {
      const a = Math.atan2(src.y - target.y, src.x - target.x);
      if (Math.abs(angleDiff(target.face, a)) < 1.15) { amount *= 0.4; shielded = true; }
    }
    target.hp -= amount;
    target.flash = 0.12;
    if (target.kind === "shade" && target.cloak > 0) { target.cloak = 0; target.hidden = false; }
    this.emit({ t: "hit", id: target.id, x: target.x, y: target.y, dmg: Math.round(amount), side, shielded, big });
    if (target.hp <= 0) this.kill(target);
  }
  private kill(b: Body) {
    if (!b.alive) return;
    b.alive = false;
    b.hp = 0;
    b.diedAt = this.time;
    this.emit({ t: "death", id: b.id, x: b.x, y: b.y, kind: b.kind, side: b.side });
    if (b.kind === "golem") {
      // The giant breaks into two smaller golems, thrown apart.
      const px = -Math.sin(b.face), py = Math.cos(b.face);
      for (const s of [-1, 1]) {
        const g = this.makeBody("golemling", b.side, b.rank, b.x + px * s * 0.42, b.y + py * s * 0.42, b.pieceId);
        g.vx = px * s * 2; g.vy = py * s * 2; g.face = b.face; g.cd = 0.6;
        this.emit({ t: "spawn", id: g.id, x: g.x, y: g.y, side: g.side });
      }
    }
  }
  private push(target: Body, nx: number, ny: number, force: number, stun = 0) {
    if (!target.alive || target.structure) return;
    const mass = Math.max(1, (target.radius / 0.25) ** 2);
    target.vx += (nx * force) / mass;
    target.vy += (ny * force) / mass;
    if (stun) target.stun = Math.max(target.stun, stun / Math.sqrt(mass));
  }
  private explode(x: number, y: number, r: number, dmg: number, side: Side, kind: "mine" | "grenade" | "slam", knock: number, stun: number) {
    this.emit({ t: "boom", x, y, r, kind, side });
    for (const e of this.enemiesNear(side, x, y, r)) {
      const d = hyp(e.x - x, e.y - y) || 0.001;
      const fall = kind === "slam" ? 1 : 1 - 0.35 * Math.min(1, d / (r + e.radius));
      this.damage(e, dmg * fall, { x, y }, side, kind !== "slam");
      this.push(e, (e.x - x) / d, (e.y - y) / d, knock, stun);
    }
  }
  private melee(b: Body, t: Body, dmg: number, knock = 0, stun = 0) {
    b.swing = this.time;
    b.swingA = Math.atan2(t.y - b.y, t.x - b.x);
    this.damage(t, dmg, b, b.side);
    if (knock) {
      const d = this.dist(b, t) || 0.001;
      this.push(t, (t.x - b.x) / d, (t.y - b.y) / d, knock, stun);
    }
  }

  // ------------------------------------------------------------ steering
  /** Desired velocity toward a point, slowing within `arrive` of it. */
  private seek(b: Body, tx: number, ty: number, frac = 1, arrive = 0.6): [number, number] {
    const dx = tx - b.x, dy = ty - b.y, d = hyp(dx, dy);
    if (d < 0.02) return [0, 0];
    const s = b.speed * frac * Math.min(1, d / arrive);
    return [(dx / d) * s, (dy / d) * s];
  }
  private flee(b: Body, from: { x: number; y: number }, frac = 1): [number, number] {
    let dx = b.x - from.x, dy = b.y - from.y;
    const d = hyp(dx, dy) || 0.001;
    dx /= d; dy /= d;
    // Steer away from walls so a fleeing unit slides along them rather than pinning itself.
    const m = 1.2;
    if (b.x < m) dx += (m - b.x) * 1.5;
    if (b.x > W - m) dx -= (b.x - (W - m)) * 1.5;
    if (b.y < m) dy += (m - b.y) * 1.5;
    if (b.y > H - m) dy -= (b.y - (H - m)) * 1.5;
    const n = hyp(dx, dy) || 1;
    return [(dx / n) * b.speed * frac, (dy / n) * b.speed * frac];
  }
  private avoid(b: Body, v: [number, number]): [number, number] {
    let [vx, vy] = v;
    const sp = hyp(vx, vy);
    if (sp < 0.01 || !this.obstacles.length) return v;
    const dx = vx / sp, dy = vy / sp;
    for (const o of this.obstacles) {
      const ox = o.x - b.x, oy = o.y - b.y;
      const ahead = ox * dx + oy * dy;
      if (ahead < 0 || ahead > 1.6 + o.r) continue;
      const lat = ox * -dy + oy * dx; // signed lateral offset of the obstacle from the path
      const clear = o.r + b.radius + 0.15;
      if (Math.abs(lat) > clear) continue;
      const side = lat >= 0 ? -1 : 1; // steer to the side away from it
      const k = (1 - ahead / (1.6 + o.r)) * 1.4;
      vx += -dy * side * sp * k;
      vy += dx * side * sp * k;
    }
    const n = hyp(vx, vy) || 1;
    return [(vx / n) * sp, (vy / n) * sp];
  }

  // ------------------------------------------------------------ step
  step(dt = DT) {
    if (this.done) return;
    this.time += dt;
    for (const b of this.bodies) { b.px = b.x; b.py = b.y; }
    for (const p of this.projs) { p.px = p.x; p.py = p.y; }
    const n = this.bodies.length;
    for (let i = 0; i < n; i++) {
      const b = this.bodies[i];
      if (!b.alive) continue;
      b.cd -= dt;
      b.t += dt;
      b.flash = Math.max(0, b.flash - dt);
      b.blinkCd -= dt;
      if (b.cloak > 0) { b.cloak -= dt; if (b.cloak <= 0) b.hidden = false; }
      let want: [number, number] = [0, 0];
      if (b.stun > 0) b.stun -= dt;
      else want = this.act(b, dt);
      if (b.structure) { b.vx = 0; b.vy = 0; continue; }
      want = this.avoid(b, want);
      const accel = b.kind === "lancer" ? 10 : b.kind === "golem" || b.kind === "golemling" ? 3.5 : 9;
      const dvx = want[0] - b.vx, dvy = want[1] - b.vy, dv = hyp(dvx, dvy), lim = accel * b.speed * dt + 0.02;
      if (b.stun > 0) { b.vx *= 0.86; b.vy *= 0.86; }
      else if (dv > lim) { b.vx += (dvx / dv) * lim; b.vy += (dvy / dv) * lim; }
      else { b.vx = want[0]; b.vy = want[1]; }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const sp = hyp(b.vx, b.vy);
      if (sp > 0.15 && b.kind !== "bulwark" && b.kind !== "lancer") b.face = turnToward(b.face, Math.atan2(b.vy, b.vx), 9 * dt);
    }
    this.collide();
    this.stepProjectiles(dt);
    if (!this.sideAlive(0) || !this.sideAlive(1) || this.time >= this.limit) this.finish();
  }

  private collide() {
    const bs = this.bodies;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (!a.alive || a.kind === "mine") continue;
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        if (!b.alive || b.kind === "mine") continue;
        const dx = b.x - a.x, dy = b.y - a.y, min = a.radius + b.radius;
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
        const d = hyp(dx, dy);
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0, over = min - d;
        // Inverse mass: structures never move, lighter bodies give way more.
        const ia = a.structure ? 0 : 1 / (a.radius * a.radius), ib = b.structure ? 0 : 1 / (b.radius * b.radius);
        const tot = ia + ib;
        if (tot <= 0) continue;
        a.x -= nx * over * (ia / tot); a.y -= ny * over * (ia / tot);
        b.x += nx * over * (ib / tot); b.y += ny * over * (ib / tot);
      }
    }
    for (const b of bs) {
      if (!b.alive || b.structure) continue;
      for (const o of this.obstacles) {
        const dx = b.x - o.x, dy = b.y - o.y, d = hyp(dx, dy), min = o.r + b.radius;
        if (d < min && d > 1e-6) { b.x = o.x + (dx / d) * min; b.y = o.y + (dy / d) * min; }
      }
      b.x = Math.max(b.radius, Math.min(W - b.radius, b.x));
      b.y = Math.max(b.radius, Math.min(H - b.radius, b.y));
    }
  }

  private finish() {
    if (this.done) return;
    this.done = true;
    const a0 = this.sideAlive(0), a1 = this.sideAlive(1);
    if (a0 && !a1) this.winner = 0;
    else if (a1 && !a0) this.winner = 1;
    else if (!a0 && !a1) this.winner = -1;
    else {
      // Called on time: the side with clearly more strength left takes it.
      const [v0, v1] = this.result().value;
      this.winner = v0 > v1 * 1.08 ? 0 : v1 > v0 * 1.08 ? 1 : -1;
    }
    this.emit({ t: "end", winner: this.winner });
  }

  result(): BattleResult {
    const threat: [number, number] = [0, 0], value: [number, number] = [0, 0], alive: [number, number] = [0, 0];
    for (const b of this.bodies) {
      if (!b.alive || b.kind === "mine") continue;
      alive[b.side]++;
      const unit = b.kind === "mite" || b.kind === "golemling" ? null : UNITS[b.kind];
      const per = b.kind === "golemling" ? 1 : b.kind === "mite" ? 0 : unit!.threat;
      threat[b.side] += per * b.rank;
      const cost = b.kind === "mite" ? 0.3 : b.kind === "golemling" ? 2 : unit!.cost / (unit!.bodies ?? 1);
      value[b.side] += cost * b.rank * (b.hp / b.maxHp);
    }
    return { winner: this.winner, time: this.time, threat, value, alive };
  }

  /** Runs to the end (headless). */
  run(maxSteps = Math.ceil(this.limit / DT) + 2): BattleResult {
    for (let i = 0; i < maxSteps && !this.done; i++) this.step();
    if (!this.done) this.finish();
    return this.result();
  }

  // ------------------------------------------------------------ behaviours
  private act(b: Body, dt: number): [number, number] {
    switch (b.kind) {
      case "mine": return this.actMine(b, dt);
      case "blades": return this.actBlades(b);
      case "ranger": return this.actRanger(b);
      case "bulwark": return this.actBulwark(b, dt);
      case "medic": return this.actMedic(b);
      case "grenadier": return this.actGrenadier(b);
      case "shade": return this.actShade(b);
      case "lancer": return this.actLancer(b, dt);
      case "ballista": return this.actBallista(b, dt);
      case "hive": return this.actHive(b);
      case "storm": return this.actStorm(b);
      case "golem": case "golemling": return this.actGolem(b);
      case "mite": return this.actMite(b);
    }
  }

  /** Hidden until something steps close, then a short fuse and a blast one unit wide. */
  private actMine(b: Body, dt: number): [number, number] {
    if (b.state === "armed") {
      for (const e of this.bodies) {
        if (!e.alive || e.side === b.side || e.structure) continue;
        if (this.dist(b, e) <= 0.62 + e.radius) {
          b.state = "fuse"; b.t = 0; b.hidden = false;
          this.emit({ t: "fuse", id: b.id, x: b.x, y: b.y });
          break;
        }
      }
    } else if (b.state === "fuse") {
      if (b.t >= 0.32 - dt / 2) {
        const big = this.mods[b.side].bigMines;
        this.explode(b.x, b.y, b.range, b.dmg, b.side, "mine", 3.2, big ? 0.9 : 0.55);
        b.alive = false;
        b.diedAt = this.time;
        b.state = "spent";
      }
    }
    return [0, 0];
  }

  /** Three swords share one target and close on it from different angles, slashing in an arc. */
  private actBlades(b: Body): [number, number] {
    const pack = this.bodies.filter((m) => m.alive && m.pack === b.pack && m.side === b.side);
    let cx = 0, cy = 0;
    for (const m of pack) { cx += m.x; cy += m.y; }
    cx /= pack.length; cy /= pack.length;
    const centre = { x: cx, y: cy };
    let target = this.byId(this.packTarget.get(b.pack) ?? -1);
    const due = (this.packRetarget.get(b.pack) ?? 0) <= this.time;
    if (!target || !this.targetable(b, target) || due) {
      const probe = { ...b, x: cx, y: cy } as Body;
      target = this.nearestEnemy(probe);
      this.packTarget.set(b.pack, target ? target.id : -1);
      this.packRetarget.set(b.pack, this.time + 0.6);
    }
    if (!target) return [0, 0];
    const gap = this.gap(b, target);
    if (gap <= b.range && b.cd <= 0) {
      b.cd = b.cooldown;
      const a = Math.atan2(target.y - b.y, target.x - b.x);
      b.face = a;
      b.swing = this.time; b.swingA = a;
      this.emit({ t: "slash", id: b.id, x: b.x, y: b.y, a, r: b.radius + b.range + 0.25, side: b.side });
      for (const e of this.enemiesNear(b.side, b.x, b.y, b.radius + b.range + 0.25)) {
        if (Math.abs(angleDiff(a, Math.atan2(e.y - b.y, e.x - b.x))) <= 1.0 && !e.hidden) this.damage(e, b.dmg, b, b.side);
      }
    }
    // Surround: each sword takes its own angle around the target, relative to where the pack comes from.
    const base = Math.atan2(centre.y - target.y, centre.x - target.x);
    const a = base + (b.slot - (pack.length - 1) / 2) * 1.0;
    const ring = target.radius + b.radius + 0.12;
    let [vx, vy] = this.seek(b, target.x + Math.cos(a) * ring, target.y + Math.sin(a) * ring, 1, 0.35);
    const dc = this.dist(b, centre);
    if (dc > 0.9 && this.dist(centre, target) > 2) {
      // Keep the pack together on the way in.
      vx += ((cx - b.x) / dc) * b.speed * 0.5;
      vy += ((cy - b.y) / dc) * b.speed * 0.5;
    }
    if (gap < b.range * 0.6) { vx *= 0.3; vy *= 0.3; b.face = turnToward(b.face, Math.atan2(target.y - b.y, target.x - b.x), 0.4); }
    return [vx, vy];
  }

  /** Holds at bow range, backs off when rushed, strafes while it shoots. */
  private actRanger(b: Body): [number, number] {
    const near = this.nearestEnemy(b, { taunt: false });
    if (!near) return [0, 0];
    let t = this.byId(b.target);
    if (!t || !this.targetable(b, t) || this.dist(b, t) > b.range * 1.15) { t = near; b.target = near.id; }
    const dn = this.gap(b, near);
    const dt = this.dist(b, t);
    if (dt <= b.range && b.cd <= 0) {
      b.cd = b.cooldown;
      b.face = Math.atan2(t.y - b.y, t.x - b.x);
      this.shoot(b, "arrow", t, 10);
    }
    if (dn < 1.6) return this.flee(b, near, 0.9);
    if (dt > b.range * 0.92) return this.seek(b, t.x, t.y, 1, 0.3);
    // Strafe slowly around the target so it is never a still target.
    const a = Math.atan2(b.y - t.y, b.x - t.x) + (b.id % 2 ? 1 : -1) * 0.35;
    const r = b.range * 0.82;
    return this.seek(b, t.x + Math.cos(a) * r, t.y + Math.sin(a) * r, 0.45, 0.5);
  }

  /** Stands between the ally in most danger and what threatens it, shield toward the threat. */
  private actBulwark(b: Body, dt: number): [number, number] {
    const near = this.nearestEnemy(b, { taunt: false });
    if (!near) return [0, 0];
    b.face = turnToward(b.face, Math.atan2(near.y - b.y, near.x - b.x), 4 * dt);
    const gap = this.gap(b, near);
    if (gap <= b.range && b.cd <= 0) {
      b.cd = b.cooldown;
      this.melee(b, near, b.dmg, 2.4, 0.25);
    }
    if (gap < 0.9) return this.seek(b, near.x, near.y, 0.8, 0.5);
    let ward: Body | undefined, worst = 0;
    for (const a of this.allies(b)) {
      if (a.kind === "bulwark" || a.structure) continue;
      let danger = 0;
      for (const e of this.bodies) {
        if (!this.targetable(b, e)) continue;
        const d = this.dist(a, e);
        if (d < 4) danger += 1 / (d + 0.5);
      }
      if (ROLE_BACKLINE.has(a.kind)) danger *= 1.6;
      if (danger > worst) { worst = danger; ward = a; }
    }
    if (ward && worst > 0.25) {
      const ec = this.enemyCentroid(b)!;
      const dx = ec.x - ward.x, dy = ec.y - ward.y, d = hyp(dx, dy) || 1;
      const off = ward.radius + b.radius + 0.3;
      return this.seek(b, ward.x + (dx / d) * off, ward.y + (dy / d) * off, 1, 0.5);
    }
    return this.seek(b, near.x, near.y, 0.85, 0.6);
  }

  /** Heals the most hurt ally in reach while keeping that ally between itself and the enemy. */
  private actMedic(b: Body): [number, number] {
    const threat = this.nearestEnemy(b, { taunt: false });
    let ward: Body | undefined, low = 0.97;
    for (const a of this.allies(b)) {
      const f = a.hp / a.maxHp;
      if (f < low && this.dist(b, a) < 6) { low = f; ward = a; }
    }
    if (ward && b.cd <= 0 && this.dist(b, ward) <= b.range + ward.radius) {
      b.cd = b.cooldown;
      const amt = 26 * rankDmg(b.rank) * b.healMul;
      this.heal(b, ward, amt);
      for (const a of this.allies(b)) if (a !== ward && this.dist(a, ward) < 0.9) this.heal(b, a, amt * 0.4);
    }
    if (threat && this.gap(b, threat) < 1.5) return this.flee(b, threat, 1);
    const ec = this.enemyCentroid(b);
    const anchor = ward ?? this.alliesCentre(b);
    if (!anchor) return threat ? this.flee(b, threat, 0.6) : [0, 0];
    let dx = 0, dy = -fwd(b.side);
    if (ec) { dx = anchor.x - ec.x; dy = anchor.y - ec.y; const d = hyp(dx, dy) || 1; dx /= d; dy /= d; }
    const off = ward ? 1.3 : 1.1;
    return this.seek(b, anchor.x + dx * off, anchor.y + dy * off, 1, 0.5);
  }
  private alliesCentre(b: Body): { x: number; y: number } | undefined {
    let sx = 0, sy = 0, n = 0;
    for (const a of this.allies(b)) if (!a.structure) { sx += a.x; sy += a.y; n++; }
    return n ? { x: sx / n, y: sy / n } : undefined;
  }
  private heal(b: Body, a: Body, amt: number) {
    if (!a.alive) return;
    const before = a.hp;
    a.hp = Math.min(a.maxHp, a.hp + amt);
    if (a.hp > before) this.emit({ t: "heal", from: b.id, to: a.id, x: a.x, y: a.y, amt: Math.round(a.hp - before) });
  }

  /** Throws where the most enemies will be when the bomb lands; keeps its distance. */
  private actGrenadier(b: Body): [number, number] {
    const near = this.nearestEnemy(b, { taunt: false });
    if (!near) return [0, 0];
    const flight = 0.9;
    if (b.cd <= 0) {
      let best: { x: number; y: number } | undefined, score = 0;
      for (const e of this.bodies) {
        if (!this.targetable(b, e)) continue;
        const d = this.dist(b, e);
        if (d < 1.3 || d > b.range) continue;
        const px = e.x + e.vx * flight * 0.8, py = e.y + e.vy * flight * 0.8;
        let s = 0;
        for (const o of this.bodies) if (this.targetable(b, o) && hyp(o.x - px, o.y - py) < 0.95 + o.radius) s += o.kind === "mite" ? 0.6 : 1;
        if (s > score) { score = s; best = { x: px, y: py }; }
      }
      if (best) {
        b.cd = b.cooldown;
        b.face = Math.atan2(best.y - b.y, best.x - b.x);
        b.swing = this.time; b.swingA = b.face;
        this.lob(b, best.x, best.y, flight);
      }
    }
    const dn = this.gap(b, near);
    if (dn < 1.4) return this.flee(b, near, 0.9);
    if (dn > b.range - 0.6) return this.seek(b, near.x, near.y, 0.9, 0.4);
    return [0, 0];
  }

  /** Cloaked on the way in; curves round the flank, blinks behind the softest target and strikes. */
  private actShade(b: Body): [number, number] {
    let t = this.byId(b.target);
    const pickNew = !t || !t.alive || t.side === b.side || (t.hidden && t.kind === "mine");
    if (pickNew) {
      let best: Body | undefined, bs = -Infinity;
      for (const e of this.bodies) {
        if (!e.alive || e.side === b.side || e.kind === "mine") continue;
        if (e.hidden) continue;
        const s = (ROLE_BACKLINE.has(e.kind) ? 2.2 : 0) + (1 - e.hp / e.maxHp) * 2 + (e.maxHp < 150 ? 1 : 0) - this.dist(b, e) * 0.18;
        if (s > bs) { bs = s; best = e; }
      }
      t = best;
      b.target = t ? t.id : -1;
    }
    if (!t) return [0, 0];
    const d = this.dist(b, t);
    if (d < 2.6 && b.blinkCd <= 0) {
      // Blink to the far side of the target and stab.
      const back = -fwd(t.side);
      const x0 = b.x, y0 = b.y;
      b.x = Math.max(b.radius, Math.min(W - b.radius, t.x + (this.rng.next() - 0.5) * 0.3));
      b.y = Math.max(b.radius, Math.min(H - b.radius, t.y + back * (t.radius + b.radius + 0.12)));
      b.px = b.x; b.py = b.y;
      b.vx = 0; b.vy = 0;
      b.face = Math.atan2(t.y - b.y, t.x - b.x);
      this.emit({ t: "blink", id: b.id, x0, y0, x: b.x, y: b.y, side: b.side });
      b.cloak = 0; b.hidden = false;
      b.blinkCd = 5;
      b.state = "fight";
      b.cd = b.cooldown;
      this.melee(b, t, b.dmg * 3);
      return [0, 0];
    }
    if (b.state === "flank" && d > 2.6) {
      // Curve in from the side: aim at a point beside the target, nearer the wall.
      const side = t.x < W / 2 ? -1 : 1;
      const lateral = Math.min(2.2, d * 0.55);
      return this.seek(b, Math.max(0.4, Math.min(W - 0.4, t.x + side * lateral)), t.y - fwd(b.side) * 0.4, 1, 0.3);
    }
    if (this.gap(b, t) <= b.range && b.cd <= 0) { b.cd = b.cooldown; this.melee(b, t, b.dmg); }
    // Re-pick the softest target now and then once revealed.
    if (b.t > 2) { b.t = 0; b.target = -1; }
    return this.seek(b, t.x, t.y, 1, 0.3);
  }

  /** Aims, charges in a straight line through everything, wheels round in an arc, aims again. */
  private actLancer(b: Body, dt: number): [number, number] {
    if (b.state === "aim") {
      const t = this.nearestEnemy(b, { taunt: false });
      if (!t) return [0, 0];
      const a = Math.atan2(t.y - b.y, t.x - b.x);
      b.face = turnToward(b.face, a, 5 * dt);
      const adj = this.nearestEnemy(b, { max: 0.35, taunt: false });
      if (adj && b.cd <= 0) { b.cd = 0.9; this.melee(b, adj, b.dmg * 0.3); }
      if (b.t > 0.35 && Math.abs(angleDiff(b.face, a)) < 0.2) {
        b.state = "charge"; b.t = 0;
        b.ax = Math.cos(b.face); b.ay = Math.sin(b.face);
        b.budget = Math.min(7.5, this.dist(b, t) + 2.0);
        b.hits = [];
        this.emit({ t: "charge", id: b.id, x: b.x, y: b.y, a: b.face });
      }
      return [Math.cos(b.face) * 0.25, Math.sin(b.face) * 0.25];
    }
    if (b.state === "charge") {
      const sp = hyp(b.vx, b.vy);
      b.budget -= sp * dt;
      for (const e of this.bodies) {
        if (!this.targetable(b, e) && !(e.alive && e.side !== b.side && e.kind === "shade")) continue;
        if (e.kind === "mine" || b.hits.includes(e.id)) continue;
        if (this.dist(b, e) > b.radius + e.radius + 0.12) continue;
        b.hits.push(e.id);
        if (e.structure || e.kind === "golem" || e.kind === "bulwark") {
          // Something it can't go through: big hit and the charge ends.
          this.damage(e, b.dmg * 1.4, b, b.side, true);
          b.state = "wheel"; b.t = 0;
          b.vx *= -0.3; b.vy *= -0.3;
          return [0, 0];
        }
        const side = (e.x - b.x) * -b.ay + (e.y - b.y) * b.ax >= 0 ? 1 : -1;
        this.damage(e, b.dmg * Math.min(1, 0.5 + sp / b.speed / 2), b, b.side, true);
        this.push(e, -b.ay * side * 0.8 + b.ax * 0.5, b.ax * side * 0.8 + b.ay * 0.5, 3.0, 0.4);
      }
      const nearWall = b.x < 0.45 || b.x > W - 0.45 || b.y < 0.45 || b.y > H - 0.45;
      if (b.budget <= 0 || b.t > 2.4 || nearWall) { b.state = "wheel"; b.t = 0; }
      b.face = Math.atan2(b.ay, b.ax);
      return [b.ax * b.speed, b.ay * b.speed];
    }
    // wheel: carry the speed round in an arc toward the next target, then aim again.
    const t = this.nearestEnemy(b, { taunt: false });
    const want = t ? Math.atan2(t.y - b.y, t.x - b.x) : b.face + Math.PI;
    b.face = turnToward(b.face, want, 3.2 * dt);
    const sp = Math.max(0.6, b.speed * 0.45 * (1 - b.t));
    if (b.t > 0.85) { b.state = "aim"; b.t = 0; }
    return [Math.cos(b.face) * sp, Math.sin(b.face) * sp];
  }

  /** Fixed. Turns slowly and looses a bolt that goes through every enemy in its line. */
  private actBallista(b: Body, dt: number): [number, number] {
    const t = this.nearestEnemy(b, { max: b.range, taunt: false });
    if (!t) return [0, 0];
    const lead = 0.25;
    const a = Math.atan2(t.y + t.vy * lead - b.y, t.x + t.vx * lead - b.x);
    b.face = turnToward(b.face, a, 1.8 * dt);
    if (b.cd <= 0 && Math.abs(angleDiff(b.face, a)) < 0.08) {
      b.cd = b.cooldown;
      b.swing = this.time; b.swingA = b.face;
      const p = this.newProj("bolt", b, Math.cos(b.face) * 14, Math.sin(b.face) * 14);
      p.life = b.range / 14;
    }
    return [0, 0];
  }

  /** Breeds mites on a timer, up to a cap; mites swarm whatever is nearest. */
  private actHive(b: Body): [number, number] {
    if (b.cd <= 0 && this.nearestEnemy(b, { taunt: false })) {
      b.cd = b.cooldown;
      const cap = 3 + b.rank;
      const mine = this.bodies.filter((m) => m.alive && m.kind === "mite" && m.owner === b.id).length;
      if (mine < cap) this.spawnMite(b);
    }
    return [0, 0];
  }
  private spawnMite(b: Body) {
    const ec = this.enemyCentroid(b);
    const a = ec ? Math.atan2(ec.y - b.y, ec.x - b.x) + (this.rng.next() - 0.5) * 1.6 : this.rng.next() * TAU;
    const m = this.makeBody("mite", b.side, b.rank, b.x + Math.cos(a) * (b.radius + 0.2), b.y + Math.sin(a) * (b.radius + 0.2), b.pieceId);
    m.owner = b.id;
    m.vx = Math.cos(a) * 2; m.vy = Math.sin(a) * 2;
    m.face = a;
    m.cd = 0.3;
    this.emit({ t: "spawn", id: m.id, x: m.x, y: m.y, side: m.side });
  }
  private actMite(b: Body): [number, number] {
    let t = this.byId(b.target);
    if (!t || !this.targetable(b, t) || b.t > 0.4) { b.t = 0; t = this.nearestEnemy(b); b.target = t ? t.id : -1; }
    if (!t) return [0, 0];
    if (this.gap(b, t) <= b.range && b.cd <= 0) { b.cd = b.cooldown; this.melee(b, t, b.dmg); }
    // A wobble across the path so the swarm streams rather than marching in single file.
    const wob = Math.sin(this.time * 9 + b.id * 1.7) * 0.6;
    const a = Math.atan2(t.y - b.y, t.x - b.x) + wob * Math.min(1, this.dist(b, t) / 2);
    return [Math.cos(a) * b.speed, Math.sin(a) * b.speed];
  }

  /** Keeps casting range; lightning jumps from enemy to enemy. */
  private actStorm(b: Body): [number, number] {
    const near = this.nearestEnemy(b, { taunt: false });
    if (!near) return [0, 0];
    let t = this.byId(b.target);
    if (!t || !this.targetable(b, t) || this.dist(b, t) > b.range * 1.1) { t = near; b.target = near.id; }
    if (this.dist(b, t) <= b.range && b.cd <= 0) {
      b.cd = b.cooldown;
      b.swing = this.time; b.swingA = Math.atan2(t.y - b.y, t.x - b.x);
      const pts: [number, number][] = [[b.x, b.y]];
      const hit: number[] = [];
      let cur: Body | undefined = t, dmg = b.dmg;
      for (let k = 0; k < 5 && cur; k++) {
        pts.push([cur.x, cur.y]);
        hit.push(cur.id);
        const from: Body = cur;
        this.damage(from, dmg, b, b.side);
        from.stun = Math.max(from.stun, 0.22);
        dmg *= 0.8;
        let next: Body | undefined, nd = 2.1;
        for (const e of this.bodies) {
          if (!this.targetable(b, e) || hit.includes(e.id)) continue;
          const d = this.dist(from, e);
          if (d < nd) { nd = d; next = e; }
        }
        cur = next;
      }
      this.emit({ t: "zap", pts, side: b.side });
    }
    const dn = this.gap(b, near);
    if (dn < 1.4) return this.flee(b, near, 0.85);
    if (this.dist(b, t) > b.range * 0.9) return this.seek(b, t.x, t.y, 1, 0.3);
    return [0, 0];
  }

  /** Walks at structures first (they can't run), slams the ground in front of it. */
  private actGolem(b: Body): [number, number] {
    let t = this.byId(b.target);
    if (!t || !this.targetable(b, t) || b.t > 1) {
      b.t = 0;
      t = b.kind === "golem" ? this.nearestEnemy(b, { max: 5, filter: (e) => e.structure, taunt: false }) : undefined;
      t ??= this.nearestEnemy(b);
      b.target = t ? t.id : -1;
    }
    if (!t) return [0, 0];
    const a = Math.atan2(t.y - b.y, t.x - b.x);
    if (this.gap(b, t) <= b.range * 0.75 && b.cd <= 0) {
      b.cd = b.cooldown;
      b.face = a;
      b.swing = this.time; b.swingA = a;
      const reach = b.radius + 0.35;
      const r = b.kind === "golem" ? 0.95 : 0.6;
      this.explode(b.x + Math.cos(a) * reach, b.y + Math.sin(a) * reach, r, b.dmg, b.side, "slam", 1.8, 0.3);
    }
    if (this.gap(b, t) < b.range * 0.5) return [0, 0];
    return this.seek(b, t.x, t.y, 1, 0.4);
  }

  // ------------------------------------------------------------ projectiles
  private newProj(kind: ProjKind, b: Body, vx: number, vy: number): Proj {
    const p: Proj = {
      id: this.nextId++, kind, side: b.side,
      x: b.x + Math.cos(b.face) * b.radius, y: b.y + Math.sin(b.face) * b.radius, px: b.x, py: b.y,
      vx, vy, x0: b.x, y0: b.y, tx: 0, ty: 0, target: -1, dmg: b.dmg, t: 0, life: 2, z: 0, hits: [], owner: b.id, rank: b.rank, alive: true,
    };
    p.px = p.x; p.py = p.y;
    this.projs.push(p);
    this.emit({ t: "shot", id: b.id, kind, x: p.x, y: p.y });
    return p;
  }
  private shoot(b: Body, kind: ProjKind, t: Body, speed: number) {
    const a = Math.atan2(t.y - b.y, t.x - b.x);
    const p = this.newProj(kind, b, Math.cos(a) * speed, Math.sin(a) * speed);
    p.target = t.id;
    p.life = 1.2;
  }
  private lob(b: Body, tx: number, ty: number, flight: number) {
    const p = this.newProj("grenade", b, 0, 0);
    p.x0 = p.x; p.y0 = p.y; p.tx = tx; p.ty = ty; p.life = flight;
  }
  private stepProjectiles(dt: number) {
    for (const p of this.projs) {
      if (!p.alive) continue;
      p.t += dt;
      if (p.kind === "grenade") {
        const u = Math.min(1, p.t / p.life);
        p.x = p.x0 + (p.tx - p.x0) * u;
        p.y = p.y0 + (p.ty - p.y0) * u;
        p.z = 4 * 1.4 * u * (1 - u);
        if (u >= 1) { p.alive = false; this.explode(p.tx, p.ty, 0.95, p.dmg, p.side, "grenade", 1.6, 0.2); }
        continue;
      }
      if (p.kind === "arrow") {
        const t = this.byId(p.target);
        if (t && t.alive) {
          const a = Math.atan2(t.y - p.y, t.x - p.x), s = hyp(p.vx, p.vy);
          p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
        }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (t && t.alive && this.dist(p, t) < t.radius + 0.1) {
          p.alive = false;
          this.damage(t, p.dmg, { x: p.px, y: p.py }, p.side);
        }
        if (p.t > p.life) p.alive = false;
        continue;
      }
      // bolt: straight, pierces; tests the segment covered this step.
      const x0 = p.x, y0 = p.y;
      p.x += p.vx * dt; p.y += p.vy * dt;
      for (const e of this.bodies) {
        if (!this.targetable({ side: p.side } as Body, e) || p.hits.includes(e.id)) continue;
        if (segDist(x0, y0, p.x, p.y, e.x, e.y) < e.radius + 0.1) {
          p.hits.push(e.id);
          this.damage(e, p.dmg, { x: x0, y: y0 }, p.side);
          this.push(e, p.vx / 14, p.vy / 14, 1.0, 0.1);
        }
      }
      if (p.t > p.life || p.x < 0 || p.x > W || p.y < 0 || p.y > H) p.alive = false;
    }
    if (this.projs.length > 64) this.projs = this.projs.filter((p) => p.alive);
  }
}

function segDist(x0: number, y0: number, x1: number, y1: number, px: number, py: number) {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
  const u = l2 > 0 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2)) : 0;
  return hyp(px - (x0 + dx * u), py - (y0 + dy * u));
}

export function simulate(pieces: Piece[], opts: BattleOptions = {}): BattleResult {
  return new Battle(pieces, { ...opts, events: false }).run();
}
