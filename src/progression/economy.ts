// Troop progression rules: coin costs per level, the level cap, coin rewards per mode and the level curves foes follow.
// Pure functions over plain data (no storage, no DOM), so tests and tools/balance.ts use them directly.
// Shared economy anchors (keep in step with the gem store): a free player earns ~1,000 coins a day of active play,
// maxing one unit costs ~12,000 coins, and 1 gem is worth ~10 coins. See outputs/economy/coins.md.
import { ACTS, rosterAt } from "../core/campaign";
import { UNIT_KINDS, type UnitKind } from "../core/defs";
import { MAX_LEVEL, clampLevel, uniformLevels, type Levels } from "../core/levels";

// ---------------------------------------------------------------- costs and cap
/** Coins to go from level L to L+1 (index L-1). Sums to 12,000 from level 1 to 10. */
export const UPGRADE_COINS = [100, 200, 400, 700, 1000, 1400, 2000, 2700, 3500] as const;
export const upgradeCoins = (level: number): number => (clampLevel(level) >= MAX_LEVEL ? Infinity : UPGRADE_COINS[clampLevel(level) - 1]);
/** Coins from `from` up to `to` (a whole climb). */
export function coinsBetween(from: number, to: number): number {
  let n = 0;
  for (let l = clampLevel(from); l < clampLevel(to); l++) n += UPGRADE_COINS[l - 1];
  return n;
}
export const COINS_TO_MAX = coinsBetween(1, MAX_LEVEL);

/** The cap before any act is cleared; each act boss beaten adds one (2 + acts cleared, so 10 after Act 8). */
export const BASE_CAP = 2;
export const levelCap = (actsCleared: number) => Math.max(1, Math.min(MAX_LEVEL, BASE_CAP + Math.max(0, Math.floor(actsCleared))));

/** Campaign progress as the save keeps it: level id -> best stars (a win is at least one star). */
export type CampaignStars = Record<number, number>;
const LEVELS_PER_ACT = 6;
/** Acts whose boss (the act's last level) has been beaten. */
export const actsCleared = (c: CampaignStars) => ACTS.filter((_, i) => (c[(i + 1) * LEVELS_PER_ACT] ?? 0) > 0).length;
/** The furthest level the player can play: one past the highest cleared. */
export function reachedLevel(c: CampaignStars): number {
  const ids = Object.keys(c).map(Number).filter((id) => (c[id] ?? 0) > 0);
  return Math.min(ACTS.length * LEVELS_PER_ACT, (ids.length ? Math.max(...ids) : 0) + 1);
}
/** Units the player has met in the campaign; only these can be levelled. */
export const unlockedKinds = (c: CampaignStars): UnitKind[] => rosterAt(reachedLevel(c));

export interface UpgradeState {
  kind: UnitKind;
  level: number;
  cap: number;
  /** Coins for the next level (Infinity at the cap or max). */
  cost: number;
  locked: boolean;
  /** Why the Upgrade button is off, or null when it can be pressed. */
  why: null | "locked" | "max" | "cap" | "coins";
}
export function upgradeState(kind: UnitKind, levels: Levels, campaign: CampaignStars, coins: number): UpgradeState {
  const level = clampLevel(levels[kind]);
  const cap = levelCap(actsCleared(campaign));
  const locked = !unlockedKinds(campaign).includes(kind);
  const cost = level >= cap ? Infinity : upgradeCoins(level);
  const why = locked ? "locked" : level >= MAX_LEVEL ? "max" : level >= cap ? "cap" : coins < cost ? "coins" : null;
  return { kind, level, cap, cost, locked, why };
}

// ---------------------------------------------------------------- foe levels
/** The level a free player's core units are expected to reach while playing each act (see coins.md); campaign foes
 * field their whole army at this level, so an upgrading player keeps pace and a maxed one is a little ahead. */
export const EXPECTED_LEVEL_BY_ACT = [1, 1, 2, 3, 3, 4, 4, 5] as const;
export const foeLevelForAct = (act: number) => EXPECTED_LEVEL_BY_ACT[Math.max(0, Math.min(EXPECTED_LEVEL_BY_ACT.length - 1, act - 1))];
/** Gauntlet rivals start at level 1 and gain one every 4 rivals, never above the player's cap. */
export const gauntletFoeLevel = (stage: number, cap: number) => Math.max(1, Math.min(cap, 1 + Math.floor((Math.max(1, stage) - 1) / 4)));

/** Which modes count troop levels. Daily and Breakpoint puzzles never do: everyone plays them at level 1. */
export type Mode = "campaign" | "gauntlet" | "skirmish" | "watch" | "daily" | "puzzle";
export function levelsFor(mode: Mode, mine: Levels, o: { act?: number; stage?: number; cap?: number } = {}): [Levels | undefined, Levels | undefined] | undefined {
  const own = hasLevels(mine) ? { ...mine } : undefined;
  switch (mode) {
    case "campaign": {
      const foe = uniformLevels(foeLevelForAct(o.act ?? 1));
      return own || foe ? [own, foe] : undefined;
    }
    case "gauntlet": {
      const foe = uniformLevels(gauntletFoeLevel(o.stage ?? 1, o.cap ?? BASE_CAP));
      return own || foe ? [own, foe] : undefined;
    }
    // Skirmish is an AI lab: both sides field your levels, so a test stays a like-for-like fight.
    case "skirmish":
    case "watch":
      return own ? [own, { ...own }] : undefined;
    case "daily":
    case "puzzle":
      return undefined;
  }
}
const hasLevels = (l: Levels) => UNIT_KINDS.some((k) => clampLevel(l[k]) > 1);

// ---------------------------------------------------------------- coin rewards
export interface Reward {
  coins: number;
  /** Line items for the result screen, in order. */
  parts: [string, number][];
  /** Set when this result raised the level cap. */
  capTo?: number;
}
const reward = (parts: [string, number][], capTo?: number): Reward => {
  const kept = parts.filter(([, n]) => n > 0);
  return { coins: kept.reduce((s, [, n]) => s + n, 0), parts: kept, ...(capTo ? { capTo } : {}) };
};

export const CAMPAIGN_WIN = (act: number) => 30 + 8 * act;
export const STAR_COINS = 15;
export const FIRST_CLEAR = (act: number) => 100 + 25 * act;
/** A campaign result. `prevStars` is the best before this match (0 = never won). Losses pay nothing. */
export function campaignReward(o: { act: number; won: boolean; stars: number; prevStars: number; boss?: boolean; actsClearedBefore?: number }): Reward {
  if (!o.won) return reward([]);
  const first = o.prevStars <= 0;
  const capTo = first && o.boss && o.actsClearedBefore !== undefined && levelCap(o.actsClearedBefore + 1) > levelCap(o.actsClearedBefore)
    ? levelCap(o.actsClearedBefore + 1) : undefined;
  return reward([["Victory", CAMPAIGN_WIN(o.act)], [`${o.stars} star${o.stars === 1 ? "" : "s"}`, STAR_COINS * o.stars], ["First clear", first ? FIRST_CLEAR(o.act) : 0]], capTo);
}

/** A Gauntlet rival beaten (stage = the rival's number, 1-based). */
export const gauntletRivalReward = (stage: number): Reward => reward([[`Rival ${stage} beaten`, Math.min(150, 30 + 10 * Math.max(1, stage))]]);

/** The scored Daily attempt; practice pays nothing. */
export function dailyReward(o: { won: boolean; scored: boolean; streak: number }): Reward {
  if (!o.scored) return reward([]);
  return reward([[o.won ? "Daily victory" : "Daily played", o.won ? 200 : 60], [`Streak ${o.streak}`, Math.min(100, 10 * Math.max(0, o.streak))]]);
}

/** Skirmish pays for a win over the rival AI, more the sharper it is and the fairer the health; at most this a day. */
export const SKIRMISH_DAILY_CAP = 300;
export function skirmishReward(o: { won: boolean; watch: boolean; difficulty: number; hp: [number, number]; earnedToday: number }): Reward {
  if (!o.won || o.watch) return reward([]);
  const fair = Math.max(0.25, Math.min(1, o.hp[1] / Math.max(1, o.hp[0])));
  const raw = Math.round((20 + 60 * Math.max(0, Math.min(1, o.difficulty))) * fair);
  return reward([["Skirmish win", Math.max(0, Math.min(raw, SKIRMISH_DAILY_CAP - o.earnedToday))]]);
}
