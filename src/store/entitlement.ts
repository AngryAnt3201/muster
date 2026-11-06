// Who gets what: the free game (Acts 1-2, Skirmish, the first Breakpoint puzzles, Daily Challenge) and the
// Full Army unlock (every act, Gauntlet, every puzzle). Pure functions over the save so tests can check them.
import { LEVELS } from "../core/campaign";
import { FULL_ARMY } from "./types";

/** Acts 1..FREE_ACTS are free. */
export const FREE_ACTS = 2;
/** Breakpoint puzzles with id 1..FREE_PUZZLES are free. */
export const FREE_PUZZLES = 5;

/** The cached entitlement, kept in the save so the game opens offline. */
export interface Entitlement {
  fullArmy: boolean;
  /** Where it came from: a buy, Restore Purchases, the store's own list, or progress made before the unlock existed. */
  source?: "purchase" | "restore" | "store" | "legacy";
  /** When it was granted (ms since epoch). */
  at?: number;
}

/** The parts of the save these rules read and write. */
export interface EntitlementSave {
  campaign: Record<number, number>;
  puzzles: Record<number, number>;
  store?: Entitlement;
}

export const hasFullArmy = (s: EntitlementSave) => !!s.store?.fullArmy;

const FREE_LAST_LEVEL = Math.max(0, ...LEVELS.filter((l) => l.act <= FREE_ACTS).map((l) => l.id));

/** True when a level needs the Full Army (its act is past the free acts). */
export const levelGated = (s: EntitlementSave, level: { act: number }) => level.act > FREE_ACTS && !hasFullArmy(s);
/** True when an act (1-based) needs the Full Army. */
export const actGated = (s: EntitlementSave, act: number) => act > FREE_ACTS && !hasFullArmy(s);
/** True when a Breakpoint puzzle needs the Full Army. */
export const puzzleGated = (s: EntitlementSave, puzzleId: number) => puzzleId > FREE_PUZZLES && !hasFullArmy(s);
/** Gauntlet is part of the Full Army. */
export const gauntletGated = (s: EntitlementSave) => !hasFullArmy(s);

/** Progress from before the unlock existed: a cleared level past the free acts (13+), or a solved paid puzzle. */
export function legacyProgress(s: EntitlementSave): boolean {
  const camp = Object.entries(s.campaign ?? {}).some(([id, n]) => Number(id) > FREE_LAST_LEVEL && n > 0);
  const puz = Object.entries(s.puzzles ?? {}).some(([id, n]) => Number(id) > FREE_PUZZLES && n > 0);
  return camp || puz;
}

/** Players who already got past Act 2 keep everything. Returns true when it changed the save. */
export function migrateLegacy(s: EntitlementSave, now = Date.now()): boolean {
  if (hasFullArmy(s) || !legacyProgress(s)) return false;
  s.store = { fullArmy: true, source: "legacy", at: now };
  return true;
}

/** Grants the Full Army after a buy or restore. Returns true when it changed the save. */
export function grant(s: EntitlementSave, source: NonNullable<Entitlement["source"]>, now = Date.now()): boolean {
  if (hasFullArmy(s)) return false;
  s.store = { fullArmy: true, source, at: now };
  return true;
}

/**
 * Brings the cache in line with the store's owned list. A Full Army the store no longer lists (a refund) is
 * taken back, except one granted for legacy progress, which the store never knew about.
 */
export function syncOwned(s: EntitlementSave, owned: string[], now = Date.now()): boolean {
  const has = owned.includes(FULL_ARMY);
  if (has) return grant(s, "store", now);
  if (hasFullArmy(s) && s.store?.source !== "legacy") { s.store = { fullArmy: false }; return true; }
  return false;
}
