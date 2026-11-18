import { describe, expect, it } from "vitest";
import { DEFAULT_AI, draftArmy } from "../src/core/ai";
import { Battle } from "../src/core/battle";
import { H, UNITS, UNIT_KINDS, W, inZone } from "../src/core/defs";
import { TurnedBattle } from "../src/net/mirror";
import { NetMatch, type NetLink } from "../src/net/netmatch";
import type { Push, RoundView } from "../src/net/protocol";
import { Hub } from "../server/hub";
import { Store } from "../server/store";

describe("turned battle", () => {
  it("is the same fight seen from the other end, step for step", () => {
    const a = draftArmy(0, 40, UNIT_KINDS, DEFAULT_AI, 11, 12, 4);
    const b = draftArmy(1, 40, UNIT_KINDS, { ...DEFAULT_AI, tactic: "artillery" }, 12, 12, 4).map((p, i) => ({ ...p, id: 900 + i }));
    const pieces = [...a, ...b];
    const real = new Battle(pieces.map((p) => ({ ...p })), { seed: 77, events: true });
    const turned = new TurnedBattle(new Battle(pieces.map((p) => ({ ...p })), { seed: 77, events: true }));
    let events = 0;
    while (!real.done) {
      real.step(); turned.step();
      expect(turned.bodies.length).toBe(real.bodies.length);
      for (let i = 0; i < real.bodies.length; i += 3) {
        const r = real.bodies[i], t = turned.bodies[i];
        expect(t.id).toBe(r.id);
        expect(t.side).toBe(1 - r.side);
        expect(t.x).toBeCloseTo(W - r.x, 9); expect(t.y).toBeCloseTo(H - r.y, 9);
        expect(t.px).toBeCloseTo(W - r.px, 9);
        expect(Math.cos(t.face)).toBeCloseTo(-Math.cos(r.face), 9); expect(Math.sin(t.face)).toBeCloseTo(-Math.sin(r.face), 9);
        expect(t.hp).toBe(r.hp); expect(t.alive).toBe(r.alive);
      }
      expect(turned.events.length).toBe(real.events.length);
      real.events.forEach((e, i) => {
        const t = turned.events[i] as typeof e;
        expect(t.t).toBe(e.t);
        if ("x" in e && "x" in t) expect(t.x).toBeCloseTo(W - e.x, 9);
        if ("side" in e && "side" in t) expect(t.side).toBe(1 - e.side);
      });
      events += real.events.length;
      real.events.length = 0; turned.events.length = 0;
      // The renderer keeps hold of bodies between frames: a body's twin is one object for its whole life.
      if (real.bodies.length) { const first = turned.bodies[0]; turned.step(); real.step(); expect(turned.bodies[0]).toBe(first); real.events.length = 0; turned.events.length = 0; }
    }
    expect(events).toBeGreaterThan(50);
    const rr = real.result(), tr = turned.result();
    expect(tr.winner).toBe(rr.winner < 0 ? -1 : 1 - rr.winner);
    expect(tr.threat).toEqual([rr.threat[1], rr.threat[0]]);
  });
});

/** Two players on one Hub, each with a NetMatch wired straight to it. */
function table() {
  const hub = new Hub(new Store());
  const mk = (name: string) => {
    const { me } = hub.register(name, "web");
    const row = hub.store.player(me.id)!;
    const pushes: Push[] = [];
    let match: NetMatch | undefined;
    hub.connect(row, { send: (d) => {
      const p = JSON.parse(d) as Push; pushes.push(p);
      if (!match) return;
      if (p.t === "foe_ready") match.onFoeReady();
      else if (p.t === "deploy") match.onDeploy(p.round, p.deadline, p.now);
      else if (p.t === "battle") match.onBattle(p.battle);
      else if (p.t === "match_over") match.onMatchOver(p.winner, p.reason, p.rating);
    } });
    const link: NetLink = {
      act: async (action) => hub.act(me.id, action),
      ready: async (pl) => hub.ready(me.id, pl),
      watched: async (r) => hub.watched(me.id, r),
      forfeit: async () => hub.forfeit(me.id),
    };
    return { id: me.id, pushes, link, start: (v: RoundView) => (match = new NetMatch(v, link)), get match() { return match!; } };
  };
  return { hub, a: mk("Ada"), b: mk("Bo") };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("online match (client and server together)", () => {
  it("both seats play from the bottom of their own board and stay in step with the server to the end", async () => {
    const { hub, a, b } = table();
    hub.joinQueue(a.id); hub.joinQueue(b.id);
    for (const c of [a, b]) c.start((c.pushes.find((p) => p.t === "match_found") as Extract<Push, { t: "match_found" }>).view);
    expect([a.match.seat, b.match.seat]).toEqual([0, 1]);
    const room = [...hub.rooms.values()][0];
    let rounds = 0;
    while (a.match.phase !== "over" && rounds < 60) {
      rounds++;
      for (const c of [a, b]) {
        const m = c.match, st = m.sides[0];
        expect(m.round).toBe(room.match.round);
        if (rounds % 3 === 0 && m.canReroll(0) && st.gold > 6) expect(await m.rerollNet()).toBe(true);
        // Buy locally, always into the bottom half (side 0), whatever the seat.
        for (let slot = 0; slot < st.shop.length; slot++) {
          if (m.canBuy(0, slot)) continue;
          const p = m.buy(0, slot, 1 + slot * 2.2, 9.5 + (rounds % 4));
          expect(p.side).toBe(0);
          expect(inZone(0, p.x, p.y)).toBe(true);
        }
        const up = st.pieces.find((p) => !m.canUpgrade(0, p.id));
        if (up && rounds % 2 === 0) m.upgrade(0, up.id);
        if (st.pieces.length > 6 && rounds % 5 === 0) m.sell(0, st.pieces[0].id);
        if (st.pieces[0]) m.move(0, st.pieces[0].id, 7.5, 12.5);
        await settle();
        // What the player sees is what the server holds: gold, shop and pieces (ids included).
        const sv = room.match.sides[m.seat];
        expect(st.gold).toBe(sv.gold);
        expect(st.shop).toEqual(sv.shop);
        expect(st.pieces.map((p) => `${p.id}:${p.kind}:${p.rank}`).sort()).toEqual(sv.pieces.map((p) => `${p.id}:${p.kind}:${p.rank}`).sort());
      }
      const before = [room.match.sides[0].hp, room.match.sides[1].hp];
      await Promise.all([a.match.ready(), b.match.ready()]);
      for (const c of [a, b]) {
        const m = c.match;
        // The rival's fresh pieces are now known, standing in the top half of this player's board.
        for (const p of m.sides[1].pieces) { expect(p.side).toBe(1); expect(inZone(1, p.x, p.y)).toBe(true); }
        for (const p of m.sides[0].pieces) expect(inZone(0, p.x, p.y)).toBe(true);
        const battle = m.makeBattle(false);
        while (!battle.done) battle.step();
        const rep = m.resolve(battle.result());
        // The local replay comes to the server's result, from either end of the board.
        expect(battle.result().winner).toBe(rep.winner);
        expect(m.sides[0].hp).toBe(room.match.sides[m.seat].hp);
        expect(m.sides[1].hp).toBe(room.match.sides[1 - m.seat].hp);
        expect(m.sides[0].hp).toBe(Math.max(0, before[m.seat] - rep.damage[0]));
      }
      expect(a.match.history.at(-1)!.winner).toBe([-1, 1, 0][b.match.history.at(-1)!.winner + 1]);
      for (const c of [a, b]) c.match.next();
      await settle();
      if ((a.match.phase as string) !== "over") {
        // Both screens reported the battle watched: the deploy clock is running on both.
        expect(a.match.secondsLeft()).toBeGreaterThan(40);
        expect(b.match.secondsLeft()).toBeGreaterThan(40);
      }
    }
    expect(a.match.phase).toBe("over");
    expect(b.match.phase).toBe("over");
    expect(a.match.winner).toBe(1 - b.match.winner!);
    expect(a.match.over?.reason).toBe("hp");
    expect(a.match.over!.rating!.after + b.match.over!.rating!.after).toBe(30);
    expect(hub.rooms.size).toBe(0);
  }, 120_000);

  it("the server corrects a client that shows something it never agreed to", async () => {
    const { hub, a, b } = table();
    hub.joinQueue(a.id); hub.joinQueue(b.id);
    for (const c of [a, b]) c.start((c.pushes.find((p) => p.t === "match_found") as Extract<Push, { t: "match_found" }>).view);
    const m = a.match, st = m.sides[0];
    let changed = 0;
    m.onChange = () => changed++;
    st.gold = 30; // a tampered client: gold it does not have
    const slots = st.shop.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
    for (const s of slots) if (!m.canBuy(0, s)) m.buy(0, s, 4.5, 11);
    await settle();
    const sv = [...hub.rooms.values()][0].match.sides[0];
    expect(st.gold).toBe(sv.gold);
    expect(st.pieces.length).toBe(sv.pieces.length);
    expect(sv.pieces.reduce((n, p) => n + UNITS[p.kind].cost, 0)).toBeLessThanOrEqual(4);
    expect(changed).toBeGreaterThan(0);
  });

  it("a rival who quits ends the match at once", async () => {
    const { hub, a, b } = table();
    hub.joinQueue(a.id); hub.joinQueue(b.id);
    for (const c of [a, b]) c.start((c.pushes.find((p) => p.t === "match_found") as Extract<Push, { t: "match_found" }>).view);
    let told: unknown;
    a.match.onOver = (o) => { told = o; };
    await b.match.forfeit();
    expect(told).toMatchObject({ winner: 0, reason: "forfeit" });
    expect(a.match.phase).toBe("over");
    expect(b.match.over).toMatchObject({ winner: 1, reason: "forfeit" });
  });
});
