import { describe, expect, it } from "vitest";
import { UNITS } from "../src/core/defs";
import { LEAGUES, SCRIPTED_CAP, SCRIPTED_FLAGS, applyTrophies, leagueOf, trophyChange } from "../src/net/ladder";
import type { Push, RoundView } from "../src/net/protocol";
import { Hub } from "../server/hub";
import { Store, scripted } from "../server/store";

describe("ladder rules", () => {
  it("leagues open by trophies, and scripted players stop below the third", () => {
    expect(leagueOf(0).name).toBe("Mustering Field");
    expect(leagueOf(299).id).toBe(0);
    expect(leagueOf(300).id).toBe(1);
    expect(leagueOf(99999).id).toBe(LEAGUES.length - 1);
    expect(leagueOf(SCRIPTED_CAP).id).toBe(1);
    expect(leagueOf(SCRIPTED_CAP + 1).id).toBe(2);
  });
  it("a win pays more against a stronger rival; losses are gentle in the first leagues", () => {
    expect(trophyChange(500, 500, true)).toBe(30);
    expect(trophyChange(500, 740, true)).toBe(40);
    expect(trophyChange(500, 100, true)).toBe(20);
    expect(trophyChange(100, 100, false)).toBe(-9);
    expect(trophyChange(400, 400, false)).toBe(-18);
    expect(trophyChange(1500, 1500, false)).toBe(-30);
    expect(trophyChange(1500, 1700, false)).toBe(-20);
  });
  it("a league once reached is kept, and the cap holds a scripted player", () => {
    expect(applyTrophies(610, 610, -30, false)).toEqual({ trophies: 600, peak: 610 });
    expect(applyTrophies(600, 640, -30, false)).toEqual({ trophies: 600, peak: 640 });
    expect(applyTrophies(5, 5, -9, false)).toEqual({ trophies: 0, peak: 5 });
    expect(applyTrophies(590, 590, 30, true)).toEqual({ trophies: SCRIPTED_CAP, peak: SCRIPTED_CAP });
    expect(applyTrophies(590, 590, 30, false)).toEqual({ trophies: 620, peak: 620 });
  });
});

const setTrophies = (store: Store, id: string, n: number) => store.db.prepare("UPDATE players SET rating = ?, peak = ? WHERE id = ?").run(n, n, id);

describe("scripted players on the ladder", () => {
  it("bot tokens and repeatedly flagged accounts count as scripted and never pass the cap", () => {
    const hub = new Hub(new Store());
    const person = hub.register("Person", "web").me, bot = hub.mint("Sam's bot", "token", undefined, true).me;
    expect(bot.bot).toBe(true);
    expect(person.bot).toBeUndefined();
    setTrophies(hub.store, bot.id, 590); setTrophies(hub.store, person.id, 590);
    const finish = (id: string, winner: number) => hub.store.finishMatch({ id, a: bot.id, b: person.id, winner, reason: "hp", rounds: 9, ranked: 1, started: 0, ended: 1, telemetry: [], flagged: [false, winner === 1] });
    expect(finish("m1", 0)[0]).toEqual({ before: 590, after: SCRIPTED_CAP });
    expect(finish("m2", 1)[1].after).toBeGreaterThan(SCRIPTED_CAP); // a person walks straight through
    // Flagged match after flagged match, the person's account is treated as a script too.
    for (let i = 0; i < SCRIPTED_FLAGS; i++) finish(`f${i}`, 1);
    const p = hub.store.player(person.id)!;
    expect(scripted(p)).toBe(true);
    expect(p.rating).toBeLessThanOrEqual(SCRIPTED_CAP + 200); // held from here on
    const before = p.rating;
    expect(finish("m3", 1)[1].after).toBeLessThanOrEqual(Math.max(before, SCRIPTED_CAP));
    hub.clearFlags(person.id);
    expect(scripted(hub.store.player(person.id)!)).toBe(false);
  });

  it("house bots fill the lower leagues: a waiting player there gets one; higher up, only people", async () => {
    const hub = new Hub(new Store(), { houseBots: 6, botWaitMs: 5000, rand: () => 0.3 });
    const bots = hub.store.houseBots();
    expect(bots).toHaveLength(6);
    expect(bots.every((b) => b.rating <= SCRIPTED_CAP)).toBe(true);
    expect(bots.at(-1)!.rating).toBe(SCRIPTED_CAP);
    expect(hub.leaderboard().filter((p) => p.bot)).toHaveLength(6);

    const high = hub.register("High", "web").me;
    setTrophies(hub.store, high.id, 900);
    const t0 = 1_000_000;
    hub.connect(hub.store.player(high.id)!, { send: () => {} });
    hub.joinQueue(high.id, t0);
    hub.tick(t0 + 120_000);
    expect(hub.matchView(high.id)).toBeNull(); // still waiting for a person

    const me = hub.register("Low", "web").me;
    const pushes: Push[] = [];
    hub.connect(hub.store.player(me.id)!, { send: (d) => pushes.push(JSON.parse(d)) });
    hub.joinQueue(me.id, t0);
    hub.tick(t0 + 1000);
    expect(hub.matchView(me.id)).toBeNull();
    hub.tick(t0 + 6000);
    let view: RoundView | null = hub.matchView(me.id)!;
    expect(view.ranked).toBe(true);
    expect(bots.map((b) => b.name)).toContain(view.foe.name);
    expect(view.foe.name).toBe(bots[0].name); // the bot nearest in trophies

    // Play it out: the person buys the cheapest card each round; the bot is ready whenever they are.
    let rounds = 0;
    while (view && rounds++ < 60) {
      const from = pushes.length;
      const slot = view.you.shop.findIndex((k) => k && UNITS[k].cost <= view!.you.gold);
      if (slot >= 0) expect(hub.act(me.id, { t: "buy", slot, x: 2 + (rounds % 5), y: 11 }).ok).toBe(true);
      hub.ready(me.id, undefined);
      const battle = pushes.slice(from).find((p) => p.t === "battle") as Extract<Push, { t: "battle" }>;
      expect(battle).toBeTruthy();
      if (rounds === 2) expect(battle.battle.pieces.some((p) => p.side === 1)).toBe(true); // the bot drafts too
      view = battle.battle.next;
    }
    const over = pushes.find((p) => p.t === "match_over") as Extract<Push, { t: "match_over" }>;
    expect(over.reason).toBe("hp");
    expect(over.rating).toBeTruthy();
    expect(over.reward!.coins).toBeGreaterThan(0);
    expect(hub.account(me.id).coins).toBe(over.reward!.coins);
    const bot = hub.store.player(bots[0].id)!;
    expect(bot.wins + bot.losses).toBe(1);
    expect(bot.rating).toBeLessThanOrEqual(SCRIPTED_CAP);
  }, 120_000);
});

