import { beforeEach, describe, expect, it } from "vitest";
import { Battle, simulate } from "../src/core/battle";
import { LEVELS } from "../src/core/campaign";
import { levelConfig, puzzleConfig } from "../src/core/content";
import { dailyBoard, dailyConfig } from "../src/core/daily";
import { UNITS, UNIT_KINDS, type Piece, type UnitKind } from "../src/core/defs";
import { MAX_LEVEL, levelDmg, levelHp, uniformLevels } from "../src/core/levels";
import { Match } from "../src/core/match";
import { PUZZLES } from "../src/core/puzzles";
import { wallet, earn } from "../src/economy/wallet";
import {
  BASE_CAP, COINS_TO_MAX, EXPECTED_LEVEL_BY_ACT, SKIRMISH_DAILY_CAP, UPGRADE_COINS, actsCleared, campaignReward, coinsBetween,
  dailyReward, foeLevelForAct, gauntletFoeLevel, gauntletRivalReward, levelCap, levelsFor, skirmishReward, unlockedKinds, upgradeCoins, upgradeState,
} from "../src/progression/economy";
import { awardCampaign, awardSkirmish, troopLevel, troopState, upgradeTroop, withLevels } from "../src/progression/troops";
import { load, resetSave, save } from "../src/save";

const army = (side: 0 | 1, kinds: UnitKind[], idBase: number): Piece[] =>
  kinds.map((kind, i) => ({ id: idBase + i, kind, side, x: 1.5 + i * 1.6, y: side === 0 ? 11 : 3, rank: 1 + (i % 3), spent: 0 }));
const fight = (): Piece[] => [...army(0, ["bulwark", "ranger", "medic", "hive", "lamp"], 1), ...army(1, ["golem", "storm", "blades", "tinker", "grave"], 100)];
const fingerprint = (b: Battle) => b.bodies.map((x) => `${x.kind}:${x.hp.toFixed(3)}:${x.x.toFixed(3)}:${x.y.toFixed(3)}`).join("|");

describe("troop levels in the sim", () => {
  it("level 1 is exactly the base stats", () => {
    expect(levelHp(1)).toBe(1);
    expect(levelDmg(1)).toBe(1);
    const plain = new Battle(fight(), { seed: 5 });
    const lv1 = new Battle(fight(), { seed: 5, levels: [{}, Object.fromEntries(UNIT_KINDS.map((k) => [k, 1]))] });
    expect(lv1.bodies.map((b) => [b.maxHp, b.dmg, b.healMul])).toEqual(plain.bodies.map((b) => [b.maxHp, b.dmg, b.healMul]));
    // A level-1 battle plays out identically, body for body.
    expect(fingerprint(lv1.run() && lv1)).toBe(fingerprint(plain.run() && plain));
  });

  it("each level adds 5% health and damage, up to +45% at level 10", () => {
    expect(levelHp(2)).toBeCloseTo(1.05);
    expect(levelHp(MAX_LEVEL)).toBeCloseTo(1.45);
    expect(levelDmg(99)).toBeCloseTo(1.45); // clamped
    const b = new Battle(army(0, ["bulwark"], 1), { levels: [{ bulwark: 5 }, undefined] });
    expect(b.bodies[0].maxHp).toBe(Math.round(UNITS.bulwark.hp * 1.2));
    expect(b.bodies[0].dmg).toBeCloseTo(UNITS.bulwark.dmg * 1.2);
  });

  it("levels are per side and spawned bodies share their maker's level", () => {
    const b = new Battle([...army(0, ["hive"], 1), ...army(1, ["hive"], 50)], { mods: [{ broodStart: true }, { broodStart: true }], levels: [{ hive: 10 }, undefined] });
    const mites = b.bodies.filter((x) => x.kind === "mite");
    const mine = mites.filter((x) => x.side === 0), theirs = mites.filter((x) => x.side === 1);
    expect(mine[0].maxHp).toBe(Math.round(22 * 1.45));
    expect(theirs[0].maxHp).toBe(22);
  });

  it("stays deterministic with levels", () => {
    const opts = { seed: 77, levels: [{ bulwark: 4, ranger: 7 }, uniformLevels(3)] as [any, any] };
    const a = simulate(fight(), opts), b = simulate(fight(), opts);
    expect(a).toEqual(b);
    const m1 = new Match({ seed: 3, levels: opts.levels }), m2 = new Match({ seed: 3, levels: opts.levels });
    for (const m of [m1, m2]) { m.buy(0, 0, 4.5, 11); m.buy(1, 0, 4.5, 3); }
    expect(m1.fight()).toEqual(m2.fight());
  });

  it("higher levels win more of a mirror match", () => {
    let lead = 0;
    for (let s = 1; s <= 12; s++) {
      const r = simulate(fight().map((p) => ({ ...p, kind: p.side === 0 ? p.kind : (["bulwark", "ranger", "medic", "hive", "lamp"] as UnitKind[])[p.id - 100] })), { seed: s, levels: [uniformLevels(6), undefined] });
      lead += r.winner === 0 ? 1 : r.winner === 1 ? -1 : 0;
    }
    expect(lead).toBeGreaterThan(4);
  });
});

describe("fairness: Daily and Breakpoint puzzles are always level 1", () => {
  beforeEach(() => resetSave());
  it("their configs carry no levels, even for a levelled player", () => {
    save((s) => { s.progression = { levels: { blades: 9, ranger: 9 } }; });
    const d = dailyConfig(dailyBoard("2026-11-07"));
    const p = puzzleConfig(PUZZLES[0]);
    expect(d.levels).toBeUndefined();
    expect(p.levels).toBeUndefined();
    expect(withLevels(d, "daily")).toBe(d);
    expect(withLevels(p, "puzzle")).toBe(p);
    expect(levelsFor("daily", { blades: 9 })).toBeUndefined();
    expect(levelsFor("puzzle", { blades: 9 })).toBeUndefined();
  });
  it("campaign configs from content.ts stay level 1 until the game adds levels", () => {
    for (const l of LEVELS) expect(levelConfig(l).levels).toBeUndefined();
  });
});

describe("costs and the cap", () => {
  it("costs rise every level and sum to the 12,000 anchor", () => {
    for (let i = 1; i < UPGRADE_COINS.length; i++) expect(UPGRADE_COINS[i]).toBeGreaterThan(UPGRADE_COINS[i - 1]);
    expect(COINS_TO_MAX).toBe(12000);
    expect(coinsBetween(1, 3)).toBe(300);
    expect(upgradeCoins(1)).toBe(100);
    expect(upgradeCoins(MAX_LEVEL)).toBe(Infinity);
  });
  it("the cap is 2 + acts cleared, up to 10", () => {
    expect(levelCap(0)).toBe(BASE_CAP);
    expect(levelCap(3)).toBe(5);
    expect(levelCap(8)).toBe(MAX_LEVEL);
    const c: Record<number, number> = {};
    expect(actsCleared(c)).toBe(0);
    for (let id = 1; id <= 6; id++) c[id] = 1;
    expect(actsCleared(c)).toBe(1);
    c[12] = 2; // Act 2's boss
    expect(actsCleared(c)).toBe(2);
  });
  it("the expected curve never asks for more than the cap allows", () => {
    for (let act = 1; act <= 8; act++) expect(foeLevelForAct(act)).toBeLessThanOrEqual(levelCap(act - 1));
    expect(EXPECTED_LEVEL_BY_ACT[0]).toBe(1);
    expect(gauntletFoeLevel(1, 10)).toBe(1);
    expect(gauntletFoeLevel(9, 10)).toBe(3);
    expect(gauntletFoeLevel(40, 4)).toBe(4);
  });
  it("upgrade state: locked, cap, coins", () => {
    const c = { 1: 3, 2: 3 };
    expect(unlockedKinds(c)).toContain("bulwark"); // level 3 is reachable
    expect(upgradeState("golem", {}, c, 1e6).why).toBe("locked");
    expect(upgradeState("blades", {}, c, 50).why).toBe("coins");
    expect(upgradeState("blades", {}, c, 100).why).toBeNull();
    expect(upgradeState("blades", { blades: 2 }, c, 1e6)).toMatchObject({ why: "cap", cost: Infinity, cap: 2 });
  });
});

describe("upgrading on the device", () => {
  beforeEach(() => resetSave());
  it("spends coins from the wallet and saves the level", () => {
    save((s) => { s.campaign = { 1: 3 }; });
    expect(upgradeTroop("blades")).toBeNull(); // no coins
    earn("coins", 250, "test");
    expect(upgradeTroop("blades")).toBe(2);
    expect(wallet().coins).toBe(150);
    expect(troopLevel("blades")).toBe(2);
    expect(troopState("blades").why).toBe("cap"); // cap 2 before Act 1 is cleared
    expect(upgradeTroop("blades")).toBeNull();
    expect(wallet().coins).toBe(150);
    expect(upgradeTroop("golem")).toBeNull(); // locked
    expect(load().progression?.levels).toEqual({ blades: 2 });
  });
  it("feeds levels into campaign, gauntlet and skirmish configs", () => {
    save((s) => { s.progression = { levels: { blades: 3 } }; });
    const l = LEVELS[20]; // Act 4
    const cfg = withLevels(levelConfig(l), "campaign", { act: l.act });
    expect(cfg.levels?.[0]).toEqual({ blades: 3 });
    expect(cfg.levels?.[1]?.golem).toBe(foeLevelForAct(4));
    expect(withLevels({ seed: 1 }, "skirmish").levels).toEqual([{ blades: 3 }, { blades: 3 }]);
    expect(withLevels({ seed: 1 }, "gauntlet", { stage: 1 }).levels).toEqual([{ blades: 3 }, undefined]);
    // Act 1-2 foes are level 1, so a level-1 player's campaign config is the old one.
    resetSave();
    const a1 = levelConfig(LEVELS[0]);
    expect(withLevels(a1, "campaign", { act: 1 })).toBe(a1);
  });
});

describe("coin rewards", () => {
  beforeEach(() => resetSave());
  it("campaign pays for wins, stars and a first clear; nothing for a loss", () => {
    expect(campaignReward({ act: 1, won: false, stars: 0, prevStars: 0 }).coins).toBe(0);
    const first = campaignReward({ act: 1, won: true, stars: 3, prevStars: 0 });
    const again = campaignReward({ act: 1, won: true, stars: 3, prevStars: 3 });
    expect(first.coins).toBe(38 + 45 + 125);
    expect(again.coins).toBe(38 + 45);
    expect(campaignReward({ act: 5, won: true, stars: 1, prevStars: 1 }).coins).toBeGreaterThan(campaignReward({ act: 1, won: true, stars: 1, prevStars: 1 }).coins);
    expect(campaignReward({ act: 2, won: true, stars: 1, prevStars: 0, boss: true, actsClearedBefore: 1 }).capTo).toBe(4);
  });
  it("first clear is read before the stars are saved, then paid once", () => {
    const l = LEVELS[0];
    expect(awardCampaign(l, true, 2).parts.map(([t]) => t)).toContain("First clear");
    save((s) => { s.campaign[l.id] = 2; });
    expect(awardCampaign(l, true, 3).parts.map(([t]) => t)).not.toContain("First clear");
    expect(wallet().coins).toBe(38 + 30 + 125 + 38 + 45);
  });
  it("gauntlet, daily and skirmish", () => {
    expect(gauntletRivalReward(1).coins).toBe(40);
    expect(gauntletRivalReward(50).coins).toBe(150);
    expect(dailyReward({ won: true, scored: false, streak: 3 }).coins).toBe(0);
    expect(dailyReward({ won: true, scored: true, streak: 3 }).coins).toBe(230);
    expect(dailyReward({ won: false, scored: true, streak: 20 }).coins).toBe(160);
    expect(skirmishReward({ won: true, watch: true, difficulty: 1, hp: [400, 400], earnedToday: 0 }).coins).toBe(0);
    expect(skirmishReward({ won: true, watch: false, difficulty: 1, hp: [400, 400], earnedToday: 0 }).coins).toBe(80);
    expect(skirmishReward({ won: true, watch: false, difficulty: 1, hp: [800, 50], earnedToday: 0 }).coins).toBe(20);
    const day = new Date(2026, 10, 7, 12);
    let total = 0;
    for (let i = 0; i < 10; i++) total += awardSkirmish(true, false, 1, [400, 400], day).coins;
    expect(total).toBe(SKIRMISH_DAILY_CAP);
    expect(awardSkirmish(true, false, 1, [400, 400], new Date(2026, 10, 8, 12)).coins).toBe(80);
  });
});
