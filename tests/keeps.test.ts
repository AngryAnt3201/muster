import { describe, expect, it } from "vitest";
import { H, W, type Side } from "../src/core/defs";
import { Match } from "../src/core/match";
import { Assault, detour, styleOf } from "../src/render/assault";
import { KEEP_STATES, keepAnchor, keepState } from "../src/render/keeps";

/** Plays one round headless with events off and returns the finished battle and its report. */
function round(start: ConstructorParameters<typeof Match>[0]["start"], seed = 7) {
  const m = new Match({ seed, start });
  const b = m.makeBattle(false);
  const rep = m.resolve(b.run());
  return { b, rep };
}

describe("keeps", () => {
  it("break up through four states as the commander's hp falls", () => {
    expect(KEEP_STATES).toEqual(["intact", "cracked", "burning", "ruined"]);
    const seen = [1, 0.8, 0.6, 0.4, 0.2, 0.05, 0].map(keepState);
    expect(seen[0]).toBe("intact");
    expect(seen[seen.length - 1]).toBe("ruined");
    expect(new Set(seen)).toEqual(new Set(KEEP_STATES));
    // Never heals back to an earlier state as hp drops.
    const idx = seen.map((s) => KEEP_STATES.indexOf(s));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it("sit on the board behind each side's deploy zone", () => {
    const [you, foe] = [keepAnchor(0), keepAnchor(1)];
    expect(you.x).toBe(W / 2);
    expect(foe.x).toBe(W / 2);
    expect(you.y).toBeGreaterThan(H - 1.5);
    expect(foe.y).toBeLessThan(2);
  });
});

describe("round-end assault", () => {
  it("the winners march on the losing keep and the first blow lands before the bar drains", () => {
    const { b, rep } = round([[{ kind: "bulwark", lx: 4.5, depth: 3, rank: 3 }, { kind: "ranger", lx: 3, depth: 1 }], [{ kind: "medic", lx: 4.5, depth: 1 }]]);
    expect(rep.winner).toBe(0);
    const loser: Side = 1;
    const a = new Assault(b.bodies, { damage: rep.damage });
    const survivors = b.bodies.filter((x) => x.alive && x.side === 0 && x.kind !== "mine");
    expect(a.strikers.length).toBe(survivors.length);
    expect(a.strikers.every((s) => s.target === loser)).toBe(true);
    expect(Number.isFinite(a.hitAt[loser])).toBe(true);
    expect(a.hitAt[0]).toBe(Infinity);

    const k = keepAnchor(loser);
    const startDist = Math.min(...a.strikers.filter((s) => s.style === "melee").map((s) => Math.hypot(s.x - k.x, s.y - k.y)));
    const events: string[] = [];
    let impactAt = Infinity, drainAtImpact = -1;
    while (!a.over) {
      a.update(1 / 60, (e) => {
        events.push(e.t);
        if (e.t === "impact" && e.first) { impactAt = a.t; drainAtImpact = a.drain(loser); }
      });
      if (a.t < a.hitAt[loser]) expect(a.drain(loser)).toBe(0);
      expect(a.t).toBeLessThan(10);
    }
    const endDist = Math.min(...a.strikers.filter((s) => s.style === "melee").map((s) => Math.hypot(s.x - k.x, s.y - k.y)));
    expect(endDist).toBeLessThan(startDist);
    expect(endDist).toBeLessThan(2.2);
    // The ranger shoots, the bulwark swings, then the keep is hit and only after that does the bar move.
    expect(events).toContain("launch");
    expect(events.indexOf("swing")).toBeLessThan(events.indexOf("impact"));
    expect(impactAt).toBeGreaterThanOrEqual(a.hitAt[loser]);
    expect(drainAtImpact).toBeLessThan(0.1);
    expect(a.drain(loser)).toBe(1);
    expect(a.drain(0)).toBe(1); // an undamaged side is never held back
  });

  it("still lands a blow when nobody is left standing to deliver it (a draw)", () => {
    const { b } = round([[{ kind: "ranger", lx: 4.5, depth: 1 }], [{ kind: "ranger", lx: 4.5, depth: 1 }]]);
    const a = new Assault(b.bodies.map((x) => ({ ...x, alive: false })), { damage: [10, 10] });
    expect(a.strikers.length).toBe(0);
    expect(Number.isFinite(a.hitAt[0]) && Number.isFinite(a.hitAt[1])).toBe(true);
    let impacts = 0;
    while (!a.over) a.update(0.05, (e) => { if (e.t === "impact") impacts++; });
    expect(impacts).toBe(2);
  });

  it("every unit kind has a way to strike or stands by", () => {
    for (const k of ["blades", "ranger", "bombard", "storm", "golem", "harrier", "keg", "medic"] as const) expect(styleOf(k)).toBeTruthy();
  });

  it("marches round a rock in the way", () => {
    const p = detour([0, 0], [0, 6], 0.3, [{ x: 0, y: 3, r: 0.8 }]);
    expect(p.length).toBe(3);
    expect(Math.abs(p[1][0])).toBeGreaterThan(0.8 + 0.3);
    expect(detour([0, 0], [0, 6], 0.3, [{ x: 3, y: 3, r: 0.5 }]).length).toBe(2);
  });
});
