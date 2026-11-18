// The server fights every battle in one frame: seat 0 at the bottom, seat 1 at the top. The battle is not exactly
// symmetric, so the seat-1 player cannot re-run it the other way up and expect the same fight. Instead they run the
// server's battle as it is and look at it through this: the same battle turned half a turn about the board's centre
// (positions flipped, headings turned by 180 degrees, the two sides swapped), so they too stand at the bottom in blue.
import type { Battle, BattleEvent, BattleResult, Body, Fuse, Proj, Wave, Zone } from "../core/battle";
import { H, W, type Piece, type Side } from "../core/defs";

export const turnPiece = (p: Piece): Piece => ({ ...p, side: (1 - p.side) as Side, x: W - p.x, y: H - p.y });
export const turnPoint = (x: number, y: number) => ({ x: W - x, y: H - y });
export const turnWinner = <T extends number>(w: T): T => (w < 0 ? w : ((1 - w) as T));

const PX = new Set(["x", "px", "x0", "tx"]);
const PY = new Set(["y", "py", "y0", "y1", "ty"]);
const NEG = new Set(["vx", "vy", "dir"]);
const ANGLE = new Set(["face", "a", "swingA"]);
const wrap = (a: number) => (a > Math.PI ? a - 2 * Math.PI : a);

/** Copies `src` into `dst` turned half a turn. Field names carry the meaning: every battle record uses the same ones. */
function turnInto(dst: Record<string, unknown>, src: Record<string, unknown>) {
  for (const k in src) {
    const v = src[k];
    if (typeof v === "number") {
      dst[k] = PX.has(k) ? W - v : PY.has(k) ? H - v : NEG.has(k) ? -v : ANGLE.has(k) ? wrap(v + Math.PI) : k === "side" ? 1 - v : k === "winner" ? turnWinner(v) : v;
    } else if (k === "pts") dst[k] = (v as [number, number][]).map(([x, y]) => [W - x, H - y]);
    else dst[k] = v;
  }
  // A body's ax/ay is a place for a Tinker (where its turret goes up) and a heading for everyone else.
  if ("ax" in src && "pieceId" in src) {
    const place = src.kind === "tinker";
    dst.ax = place ? W - (src.ax as number) : -(src.ax as number);
    dst.ay = place ? H - (src.ay as number) : -(src.ay as number);
  }
  return dst;
}

/** A battle seen from the other end of the board. It has the parts of Battle the screen reads and steps. */
export class TurnedBattle {
  bodies: Body[] = [];
  projs: Proj[] = [];
  events: BattleEvent[] = [];
  zones: Zone[] = [];
  fuses: Fuse[] = [];
  waves: Wave[] = [];
  time = 0;
  done = false;
  winner: -1 | 0 | 1 = -1;
  /** One turned copy per record, kept for the record's life, so the renderer sees stable objects. */
  private twins = new WeakMap<object, Record<string, unknown>>();

  constructor(readonly src: Battle) { this.sync(); }

  private twin<T extends object>(o: T): T {
    let t = this.twins.get(o);
    if (!t) this.twins.set(o, (t = {}));
    return turnInto(t, o as Record<string, unknown>) as T;
  }
  private sync() {
    const s = this.src;
    this.bodies = s.bodies.map((b) => this.twin(b));
    this.projs = s.projs.map((p) => this.twin(p));
    this.zones = s.zones.map((z) => this.twin(z));
    this.fuses = s.fuses.map((f) => this.twin(f));
    this.waves = s.waves.map((w) => this.twin(w));
    for (const e of s.events) this.events.push(turnInto({}, e as unknown as Record<string, unknown>) as unknown as BattleEvent);
    s.events.length = 0;
    this.time = s.time; this.done = s.done; this.winner = turnWinner(s.winner);
  }
  step() { this.src.step(); this.sync(); }
  result(): BattleResult {
    const r = this.src.result();
    return { winner: turnWinner(r.winner), time: r.time, threat: [r.threat[1], r.threat[0]], value: [r.value[1], r.value[0]], alive: [r.alive[1], r.alive[0]] };
  }
  /** For code typed against Battle. */
  asBattle() { return this as unknown as Battle; }
}
