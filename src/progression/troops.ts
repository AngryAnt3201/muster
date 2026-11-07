// Troop levels on the device: the save binding for src/progression/economy.ts, plus the coin hooks the result screens
// call. Coins move only through the shared wallet (src/economy/wallet.ts).
import type { LevelDef } from "../core/content";
import type { UnitKind } from "../core/defs";
import { dateKey } from "../core/daily";
import { MAX_LEVEL, clampLevel, type Levels } from "../core/levels";
import type { MatchConfig } from "../core/match";
import { earn, spend, wallet } from "../economy/wallet";
import { load, save } from "../save";
import { LEVELS } from "../core/campaign";
import {
  FIRST_CLEAR, actsCleared, campaignReward, dailyReward, gauntletRivalReward, levelCap, levelsFor, skirmishReward, upgradeState,
  type Mode, type Reward, type UpgradeState,
} from "./economy";

export interface ProgressionSave {
  levels: Levels;
  /** Skirmish coins paid today (for the daily cap). */
  skirmish?: { day: string; coins: number };
  /** The one-off coins for campaign clears made before troop levels existed have been paid. */
  legacyPaid?: boolean;
}
export const normalizeProgression = (p: Partial<ProgressionSave> | undefined): ProgressionSave => {
  const levels: Levels = {};
  for (const [k, v] of Object.entries(p?.levels ?? {})) if (clampLevel(v) > 1) levels[k as UnitKind] = clampLevel(v);
  return { levels, ...(p?.skirmish ? { skirmish: p.skirmish } : {}), ...(p?.legacyPaid ? { legacyPaid: true } : {}) };
};
const prog = (): ProgressionSave => {
  const s = load();
  s.progression = normalizeProgression(s.progression);
  return s.progression;
};

export const troopLevels = (): Levels => ({ ...prog().levels });
export const troopLevel = (k: UnitKind) => clampLevel(prog().levels[k]);
export const currentCap = () => levelCap(actsCleared(load().campaign));
export const troopState = (k: UnitKind): UpgradeState => upgradeState(k, prog().levels, load().campaign, wallet().coins);

/** Buys the next level of a unit. Returns the new level, or null when it isn't allowed or affordable. */
export function upgradeTroop(k: UnitKind): number | null {
  const st = troopState(k);
  if (st.why) return null;
  if (!spend("coins", st.cost, `level ${k} ${st.level + 1}`)) return null;
  const next = Math.min(MAX_LEVEL, st.level + 1);
  save((s) => { s.progression = normalizeProgression(s.progression); s.progression.levels[k] = next; });
  return next;
}

/** Adds the troop levels a mode uses to a match config (Daily and puzzles come back untouched). */
export function withLevels(cfg: MatchConfig, mode: Mode, o: { act?: number; stage?: number } = {}): MatchConfig {
  const levels = levelsFor(mode, prog().levels, { ...o, cap: currentCap() });
  return levels ? { ...cfg, levels } : cfg;
}

// ---------------------------------------------------------------- coin hooks (result screens)
const pay = (r: Reward, why: string) => { if (r.coins > 0) earn("coins", r.coins, why); return r; };

/** Coins a save would have earned as first clears before troop levels existed (campaign: level id -> best stars). */
export function legacyCoins(campaign: Record<number, number>): number {
  let coins = 0;
  for (const l of LEVELS) if ((campaign[l.id] ?? 0) > 0) coins += FIRST_CLEAR(l.act);
  return coins;
}
/** Once per save: pay those coins, so a returning player opens the Barracks with something to spend. */
export function settleLegacyCoins(): number {
  if (prog().legacyPaid) return 0;
  const coins = legacyCoins(load().campaign);
  save((s) => { s.progression = normalizeProgression(s.progression); s.progression.legacyPaid = true; });
  if (coins > 0) earn("coins", coins, "campaign clears before troop levels");
  return coins;
}

/** Call before the campaign's own star save, so a first clear is still known. */
export function awardCampaign(l: LevelDef, won: boolean, stars: number): Reward {
  const c = load().campaign;
  return pay(campaignReward({ act: l.act, won, stars, prevStars: c[l.id] ?? 0, boss: l.boss, actsClearedBefore: actsCleared(c) }), `campaign ${l.id}`);
}
export const awardGauntletRival = (stage: number) => pay(gauntletRivalReward(stage), `gauntlet ${stage}`);
export const awardDaily = (won: boolean, scored: boolean, streak: number) => pay(dailyReward({ won, scored, streak }), "daily");
export function awardSkirmish(won: boolean, watch: boolean, difficulty: number, hp: [number, number], now = new Date()): Reward {
  const day = dateKey(now);
  const p = prog();
  const earnedToday = p.skirmish?.day === day ? p.skirmish.coins : 0;
  const r = pay(skirmishReward({ won, watch, difficulty, hp, earnedToday }), "skirmish");
  if (r.coins > 0) save((s) => { s.progression = normalizeProgression(s.progression); s.progression.skirmish = { day, coins: earnedToday + r.coins }; });
  return r;
}
