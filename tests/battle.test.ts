import { describe, expect, it } from "vitest";
import { Battle, simulate, type BattleEvent } from "../src/core/battle";
import { UNITS, type Piece, type Side, type UnitKind } from "../src/core/defs";

let nid = 1;
const P = (kind: UnitKind, side: Side, x: number, y: number, rank = 1): Piece => ({ id: nid++, kind, side, x, y, rank, spent: UNITS[kind].cost });
const run = (b: Battle, seconds: number) => { for (let t = 0; t < seconds * 30 && !b.done; t++) b.step(); };
const events = <T extends BattleEvent["t"]>(b: Battle, t: T) => b.events.filter((e) => e.t === t) as Extract<BattleEvent, { t: T }>[];

describe("battle", () => {
  it("is deterministic for the same board and seed", () => {
    const board = () => [P("blades", 0, 3, 11), P("ranger", 0, 5, 12), P("golem", 1, 4, 3), P("storm", 1, 6, 2), P("mine", 0, 4, 8)];
    const a = new Battle(board(), { seed: 7 }); a.run();
    const b = new Battle(board(), { seed: 7 }); b.run();
    expect(a.result()).toEqual(b.result());
    expect(a.bodies.map((x) => [x.x, x.y, x.hp])).toEqual(b.bodies.map((x) => [x.x, x.y, x.hp]));
  });

  it("mine stays hidden, then blows up in a 1-unit radius", () => {
    const mine = P("mine", 0, 4.5, 8);
    const b = new Battle([
      P("medic", 0, 0.5, 13.5),
      mine,
      P("bulwark", 1, 4.5, 7.4), // walks onto it
      P("ballista", 1, 5.2, 8), // 0.7 away: inside the blast
      P("ballista", 1, 6.4, 8), // 1.9 away: outside
    ], { seed: 1, events: true });
    const m = b.bodies.find((x) => x.kind === "mine")!;
    expect(m.hidden).toBe(true);
    expect(b.nearestEnemy(b.bodies.find((x) => x.kind === "bulwark")!)?.kind).not.toBe("mine");
    run(b, 1.5);
    const boom = events(b, "boom").find((e) => e.kind === "mine")!;
    expect(boom).toBeTruthy();
    expect(boom.r).toBeCloseTo(1.0);
    const [near, far] = b.bodies.filter((x) => x.kind === "ballista");
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(far.hp).toBe(far.maxHp);
    expect(m.alive).toBe(false);
  });

  it("blade trio is three bodies that move as one pack and share a target", () => {
    const b = new Battle([P("blades", 0, 4.5, 12), P("ballista", 1, 4.5, 2)], { seed: 2 });
    const pack = b.bodies.filter((x) => x.kind === "blades");
    expect(pack).toHaveLength(3);
    let maxSpread = 0;
    for (let i = 0; i < 60; i++) {
      b.step();
      for (const a of pack) for (const c of pack) maxSpread = Math.max(maxSpread, Math.hypot(a.x - c.x, a.y - c.y));
    }
    expect(maxSpread).toBeLessThan(1.5);
    // They moved toward the enemy.
    expect(pack.every((x) => x.y < 11.6)).toBe(true);
  });

  it("movement is free-angle, not on a grid", () => {
    const b = new Battle([P("shade", 0, 2, 12), P("ranger", 0, 7, 12), P("ranger", 1, 4.5, 2), P("blades", 1, 6, 3)], { seed: 3 });
    const headings = new Set<number>();
    for (let i = 0; i < 300 && !b.done; i++) {
      b.step();
      for (const x of b.bodies) if (x.alive && Math.hypot(x.vx, x.vy) > 0.3) headings.add(Math.round(Math.atan2(x.vy, x.vx) * 20));
    }
    expect(headings.size).toBeGreaterThan(20);
  });

  it("lancer charges through several units in one run", () => {
    const b = new Battle([
      P("lancer", 0, 4.5, 11),
      P("ranger", 1, 4.5, 5.5), P("ranger", 1, 4.5, 4.6), P("ranger", 1, 4.5, 3.7),
    ], { seed: 4, events: true });
    run(b, 3);
    const charges = events(b, "charge");
    expect(charges.length).toBeGreaterThan(0);
    const lancer = b.bodies.find((x) => x.kind === "lancer")!;
    const hitByFirst = new Set(events(b, "hit").filter((e) => e.side === 0).map((e) => e.id));
    expect(hitByFirst.size).toBeGreaterThanOrEqual(2);
    expect(lancer.alive).toBe(true);
  });

  it("golem breaks into two golemlings when it falls", () => {
    const b = new Battle([P("golem", 0, 4.5, 10), P("ranger", 1, 4.5, 2)], { seed: 5, events: true });
    const g = b.bodies.find((x) => x.kind === "golem")!;
    b.damage(g, 99999, null, 1);
    const lings = b.bodies.filter((x) => x.kind === "golemling" && x.alive);
    expect(lings).toHaveLength(2);
    expect(b.sideAlive(0)).toBe(true);
  });

  it("hive breeds mites up to its cap", () => {
    const b = new Battle([P("hive", 0, 4.5, 12), P("bulwark", 1, 4.5, 1)], { seed: 6 });
    run(b, 14);
    const mites = b.bodies.filter((x) => x.kind === "mite");
    expect(mites.length).toBeGreaterThanOrEqual(3);
  });

  it("medic heals the most hurt ally", () => {
    const b = new Battle([P("medic", 0, 4.5, 12.5), P("bulwark", 0, 4.5, 11), P("ballista", 1, 4.5, 1)], { seed: 7, events: true });
    const bw = b.bodies.find((x) => x.kind === "bulwark")!;
    bw.hp = 100;
    run(b, 3);
    expect(events(b, "heal").length).toBeGreaterThan(0);
    expect(bw.hp).toBeGreaterThan(100);
  });

  it("shade blinks behind its target and backstabs", () => {
    const b = new Battle([P("shade", 0, 1, 12), P("ranger", 1, 6, 3), P("bulwark", 1, 4.5, 5.5)], { seed: 8, events: true });
    run(b, 8);
    const blink = events(b, "blink")[0];
    expect(blink).toBeTruthy();
    // Landed on the far side (top) of a side-1 unit: smaller y than where it started, close to the target.
    expect(blink.y).toBeLessThan(blink.y0);
  });

  it("stormcaller's lightning jumps between bunched enemies", () => {
    const b = new Battle([P("storm", 0, 4.5, 10), P("blades", 1, 4.5, 6.5)], { seed: 9, events: true });
    run(b, 5);
    const zap = events(b, "zap")[0];
    expect(zap).toBeTruthy();
    expect(zap.pts.length).toBeGreaterThanOrEqual(3);
  });

  it("grenadier lobs at clusters and bulwark shields hits from the front", () => {
    const b = new Battle([P("grenadier", 0, 4.5, 11), P("blades", 1, 4.5, 6)], { seed: 10, events: true });
    run(b, 6);
    expect(events(b, "boom").some((e) => e.kind === "grenade")).toBe(true);
    const s = new Battle([P("bulwark", 0, 4.5, 8), P("ranger", 1, 4.5, 2)], { seed: 1, events: true });
    const bw = s.bodies[0];
    bw.face = -Math.PI / 2; // facing up, toward the enemy
    s.damage(bw, 100, { x: 4.5, y: 5 }, 1);
    expect(bw.maxHp - bw.hp).toBeCloseTo(40);
    s.damage(bw, 100, { x: 4.5, y: 11 }, 1);
    expect(bw.maxHp - bw.hp).toBeCloseTo(140);
  });

  it("ballista bolts pierce a line of enemies", () => {
    const b = new Battle([P("ballista", 0, 4.5, 12), P("blades", 1, 4.5, 7)], { seed: 11, events: true });
    run(b, 4);
    const hits = events(b, "hit").filter((e) => e.side === 0);
    expect(new Set(hits.map((h) => h.id)).size).toBeGreaterThanOrEqual(2);
  });

  it("a mixed 12 v 12 battle finishes quickly", () => {
    const kinds = Object.keys(UNITS) as UnitKind[];
    const pieces: Piece[] = [];
    kinds.forEach((k, i) => {
      pieces.push(P(k, 0, 0.8 + (i % 6) * 1.5, 12.5 - Math.floor(i / 6) * 1.6));
      pieces.push(P(k, 1, 0.8 + (i % 6) * 1.5, 1.5 + Math.floor(i / 6) * 1.6));
    });
    const t = performance.now();
    const r = simulate(pieces, { seed: 12 });
    expect(performance.now() - t).toBeLessThan(400);
    expect(r.time).toBeGreaterThan(1);
  });
});
