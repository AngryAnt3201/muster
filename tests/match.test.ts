import { describe, expect, it } from "vitest";
import { applyPlan, DEFAULT_AI, planTurn, type AIProfile } from "../src/core/ai";
import { UNITS, ZONE_DEPTH, incomeFor, inZone, roundBase, supplyFor, toLocal } from "../src/core/defs";
import { Match, interestFor } from "../src/core/match";

describe("match", () => {
  it("pays income plus interest and rolls a shop of four", () => {
    const m = new Match({ seed: 1, startGold: [7, 0] });
    expect(m.round).toBe(1);
    expect(m.sides[0].gold).toBe(7 + incomeFor(1) + interestFor(7));
    expect(m.sides[0].shop).toHaveLength(4);
    expect(m.sides[1].gold).toBe(incomeFor(1));
  });

  it("buys inside the zone, charges gold and respects the board size", () => {
    const m = new Match({ seed: 2, startGold: [30, 0] });
    const st = m.sides[0];
    const slot = st.shop.findIndex(Boolean);
    const kind = st.shop[slot]!;
    const g = st.gold;
    const p = m.buy(0, slot, 4.5, 3); // asked for enemy ground: clamped into our zone
    expect(st.gold).toBe(g - UNITS[kind].cost);
    expect(inZone(0, p.x, p.y)).toBe(true);
    expect(toLocal(0, p.x, p.y).depth).toBeLessThanOrEqual(ZONE_DEPTH);
    expect(st.shop[slot]).toBeNull();
    while (m.supplyUsed(0) < m.supplyCap(0)) {
      const s = st.shop.findIndex(Boolean);
      if (s < 0) m.reroll(0);
      else m.buy(0, s, 4.5, 12);
    }
    const s = st.shop.findIndex(Boolean) >= 0 ? st.shop.findIndex(Boolean) : (m.reroll(0), 0);
    expect(m.canBuy(0, s)).toBe("Board full");
    expect(m.supplyCap(0)).toBe(supplyFor(1));
  });

  it("upgrades to rank 3 and sells for half of what was spent", () => {
    const m = new Match({ seed: 3, startGold: [30, 0] });
    const slot = m.sides[0].shop.findIndex(Boolean);
    const p = m.buy(0, slot, 4, 12);
    m.upgrade(0, p.id);
    m.upgrade(0, p.id);
    expect(p.rank).toBe(3);
    expect(m.canUpgrade(0, p.id)).toBe("Max rank");
    const g = m.sides[0].gold;
    m.sell(0, p.id);
    expect(m.sides[0].gold).toBe(Math.min(30, g + Math.floor(p.spent / 2)));
    expect(m.sides[0].pieces).toHaveLength(0);
  });

  it("the loser takes the base plus twice the winners' threat; pieces persist", () => {
    const m = new Match({ seed: 4, start: [[{ kind: "golem", lx: 4.5, depth: 3 }], [{ kind: "ranger", lx: 4.5, depth: 1 }]] });
    const rep = m.fight();
    expect(rep.winner).toBe(0);
    expect(rep.damage[1]).toBe(roundBase(1) + 2 * rep.result.threat[0]);
    expect(m.sides[1].hp).toBe(400 - rep.damage[1]);
    m.next();
    expect(m.sides[1].pieces).toHaveLength(1); // the ranger comes back next round
    expect(m.round).toBe(2);
  });

  it("ends when a commander falls", () => {
    const m = new Match({ seed: 5, hp: [400, 30], start: [[{ kind: "golem", lx: 4.5, depth: 3, rank: 3 }], [{ kind: "ranger", lx: 4.5, depth: 1 }]] });
    m.fight();
    expect(m.phase).toBe("over");
    expect(m.winner).toBe(0);
  });
});

describe("ai", () => {
  it("plays legal turns: within gold, board size and its own zone", () => {
    const m = new Match({ seed: 6 });
    for (let r = 0; r < 8 && m.phase !== "over"; r++) {
      for (const s of [0, 1] as const) {
        applyPlan(m, s, planTurn(m, s, { ...DEFAULT_AI, difficulty: s ? 0.9 : 0.2 }));
        expect(m.sides[s].gold).toBeGreaterThanOrEqual(0);
        expect(m.supplyUsed(s)).toBeLessThanOrEqual(m.supplyCap(s));
        for (const p of m.sides[s].pieces) expect(inZone(s, p.x, p.y)).toBe(true);
      }
      m.fight();
      m.next();
    }
  });

  it("tactics change what it drafts", () => {
    const count = (ai: AIProfile, kinds: string[]) => {
      let n = 0, total = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const m = new Match({ seed, startGold: [0, 0] });
        for (let r = 0; r < 6; r++) { applyPlan(m, 1, planTurn(m, 1, ai)); m.fight(); m.next(); }
        for (const p of m.sides[1].pieces) { total++; if (kinds.includes(p.kind)) n++; }
      }
      return n / Math.max(1, total);
    };
    const fort = { ...DEFAULT_AI, tactic: "fortress" as const, difficulty: 0.1 };
    const blitz = { ...DEFAULT_AI, tactic: "blitz" as const, difficulty: 0.1 };
    expect(count(fort, ["bulwark", "ballista", "medic", "mine"])).toBeGreaterThan(count(blitz, ["bulwark", "ballista", "medic", "mine"]));
    expect(count(blitz, ["lancer", "shade", "blades"])).toBeGreaterThan(count(fort, ["lancer", "shade", "blades"]));
  });

  it("aggression moves its formation forward", () => {
    const depthOf = (aggression: number) => {
      const m = new Match({ seed: 9, startGold: [0, 20] });
      applyPlan(m, 1, planTurn(m, 1, { ...DEFAULT_AI, aggression, difficulty: 0.1, spread: 0.5 }));
      const ps = m.sides[1].pieces.filter((p) => p.kind !== "mine");
      return ps.reduce((a, p) => a + toLocal(1, p.x, p.y).depth, 0) / Math.max(1, ps.length);
    };
    expect(depthOf(0.95)).toBeGreaterThan(depthOf(0.05));
  });
});
