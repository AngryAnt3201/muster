// Troop levels: a persistent 1-10 level per unit kind, bought with coins between matches (src/progression).
// A level scales the unit's health and damage (and the bodies it spawns) on top of its in-match rank.
// Level 1 is a multiplier of exactly 1, so a level-1 army is the game as it was before levels existed.
import { UNIT_KINDS, type UnitKind } from "./defs";

export const MAX_LEVEL = 10;
/** Each level past 1 adds this much health and damage (level 10 = +45%). */
export const LEVEL_STEP = 0.05;

/** One side's levels. Missing kinds are level 1. */
export type Levels = Partial<Record<UnitKind, number>>;

/** A level clamped to 1..MAX_LEVEL; anything missing or malformed is 1. */
export function clampLevel(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.max(1, Math.min(MAX_LEVEL, Math.floor(n))) : 1;
}
export const levelOf = (levels: Levels | undefined, kind: UnitKind) => clampLevel(levels?.[kind]);
export const levelHp = (level: number) => 1 + LEVEL_STEP * (clampLevel(level) - 1);
export const levelDmg = (level: number) => 1 + LEVEL_STEP * (clampLevel(level) - 1);

/** Every kind at one level (foes, mirrors and tools). */
export function uniformLevels(level: number): Levels | undefined {
  const l = clampLevel(level);
  if (l === 1) return undefined;
  const out: Levels = {};
  for (const k of UNIT_KINDS) out[k] = l;
  return out;
}
