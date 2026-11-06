// World, units and economy. World units: the board is 9 wide and 14 deep; "1 unit" of distance is 1.0.
// Side 0 is the player at the bottom (forward = -y), side 1 the opponent at the top (forward = +y).

export const W = 9;
export const H = 14;
export const DT = 1 / 30;
export const BATTLE_LIMIT = 45; // seconds of battle before it is called on what is left
export const ZONE_DEPTH = 5.9; // how far from its back edge a side may deploy
export const EDGE = 0.5; // gap kept from the board edges

export type Side = 0 | 1;
export type UnitKind =
  | "mine" | "blades" | "ranger" | "bulwark" | "medic" | "grenadier"
  | "shade" | "lancer" | "ballista" | "hive" | "storm" | "golem";
/** Bodies that exist only in battle. */
export type BodyKind = UnitKind | "mite" | "golemling";
export type Role = "trap" | "melee" | "ranged" | "tank" | "support" | "artillery" | "assassin" | "cavalry" | "structure" | "caster" | "spawner" | "siege";

export interface UnitDef {
  kind: UnitKind;
  name: string;
  short: string; // one line for the shop card
  role: Role;
  cost: number;
  hp: number;
  dmg: number;
  range: number; // attack reach (edge to edge for melee, centre to centre for ranged)
  speed: number; // units per second
  radius: number;
  cooldown: number;
  bodies?: number;
  structure?: boolean;
  /** Damage it does to the opposing commander when it survives a won round, per body. */
  threat: number;
}

export const UNITS: Record<UnitKind, UnitDef> = {
  mine: { kind: "mine", name: "Mine", short: "Hidden. Blows up in a 1-unit radius.", role: "trap", cost: 2, hp: 1, dmg: 130, range: 1.0, speed: 0, radius: 0.22, cooldown: 0, threat: 0 },
  blades: { kind: "blades", name: "Blade Trio", short: "Three swords that hunt as a pack.", role: "melee", cost: 3, hp: 95, dmg: 17, range: 0.5, speed: 1.7, radius: 0.24, cooldown: 0.85, bodies: 3, threat: 1 },
  ranger: { kind: "ranger", name: "Ranger", short: "Long bow. Backs off when rushed.", role: "ranged", cost: 3, hp: 75, dmg: 24, range: 4.2, speed: 1.6, radius: 0.25, cooldown: 1.1, threat: 2 },
  bulwark: { kind: "bulwark", name: "Bulwark", short: "Shield wall. Guards whoever is in danger.", role: "tank", cost: 4, hp: 430, dmg: 22, range: 0.45, speed: 1.0, radius: 0.4, cooldown: 1.2, threat: 3 },
  medic: { kind: "medic", name: "Medic", short: "Heals the most hurt. Hides behind the line.", role: "support", cost: 3, hp: 85, dmg: 0, range: 2.2, speed: 1.6, radius: 0.25, cooldown: 1.0, threat: 1 },
  grenadier: { kind: "grenadier", name: "Grenadier", short: "Lobs bombs where enemies bunch up.", role: "artillery", cost: 4, hp: 85, dmg: 46, range: 5.0, speed: 1.3, radius: 0.27, cooldown: 2.6, threat: 2 },
  shade: { kind: "shade", name: "Shade", short: "Cloaked flanker. Blinks behind the weakest.", role: "assassin", cost: 4, hp: 110, dmg: 21, range: 0.45, speed: 2.3, radius: 0.24, cooldown: 0.8, threat: 3 },
  lancer: { kind: "lancer", name: "Lancer", short: "Charges through lines, wheels round, again.", role: "cavalry", cost: 4, hp: 210, dmg: 56, range: 0.3, speed: 4.6, radius: 0.36, cooldown: 0, threat: 3 },
  ballista: { kind: "ballista", name: "Ballista", short: "Fixed bolt thrower. Pierces a whole line.", role: "structure", cost: 3, hp: 230, dmg: 50, range: 6.5, speed: 0, radius: 0.42, cooldown: 2.4, structure: true, threat: 2 },
  hive: { kind: "hive", name: "Hive", short: "Breeds mites that swarm the nearest foe.", role: "spawner", cost: 4, hp: 270, dmg: 0, range: 0, speed: 0, radius: 0.45, cooldown: 2.2, structure: true, threat: 3 },
  storm: { kind: "storm", name: "Stormcaller", short: "Lightning that jumps between enemies.", role: "caster", cost: 5, hp: 115, dmg: 42, range: 3.6, speed: 1.4, radius: 0.27, cooldown: 2.0, threat: 4 },
  golem: { kind: "golem", name: "Golem", short: "Slow giant. Breaks into two when it falls.", role: "siege", cost: 5, hp: 620, dmg: 52, range: 0.95, speed: 0.75, radius: 0.55, cooldown: 1.8, threat: 5 },
};

export const BODY_EXTRA = {
  mite: { name: "Mite", hp: 22, dmg: 6, range: 0.15, speed: 2.9, radius: 0.15, cooldown: 0.5, threat: 0 },
  golemling: { name: "Golemling", hp: 230, dmg: 25, range: 0.6, speed: 1.05, radius: 0.36, cooldown: 1.4, threat: 1 },
};

export const UNIT_KINDS = Object.keys(UNITS) as UnitKind[];

/** Rank multipliers: rank 2 and 3 are bought as upgrades. */
export const rankHp = (rank: number) => 1 + 0.65 * (rank - 1);
export const rankDmg = (rank: number) => 1 + 0.5 * (rank - 1);
export const upgradeCost = (kind: UnitKind, rank: number) => (rank >= 3 ? Infinity : UNITS[kind].cost * rank);

// ---------------------------------------------------------------- economy
export const START_HP = 400;
export const SHOP_SIZE = 4;
export const REROLL_COST = 1;
export const GOLD_CAP = 30;
export const incomeFor = (round: number) => Math.min(3 + round, 10);
export const supplyFor = (round: number) => Math.min(2 + round, 12);
/** Commander damage when a round is lost: a base that grows, plus each surviving enemy's threat. */
export const roundBase = (round: number) => 3 + 2 * round + (round > 12 ? 4 * (round - 12) : 0);

/** Side-local coordinates: lx across, depth forward from the back edge of the side's zone. */
export function toWorld(side: Side, lx: number, depth: number): { x: number; y: number } {
  return { x: lx, y: side === 0 ? H - EDGE - depth : EDGE + depth };
}
export function toLocal(side: Side, x: number, y: number): { lx: number; depth: number } {
  return { lx: x, depth: side === 0 ? H - EDGE - y : y - EDGE };
}
export function clampToZone(side: Side, x: number, y: number, r = 0.3): { x: number; y: number } {
  const cx = Math.max(EDGE - 0.2 + r, Math.min(W - EDGE + 0.2 - r, x));
  const { depth } = toLocal(side, cx, y);
  const d = Math.max(r * 0.5, Math.min(ZONE_DEPTH, depth));
  return toWorld(side, cx, d);
}
export function inZone(side: Side, x: number, y: number): boolean {
  const { depth } = toLocal(side, x, y);
  return x >= EDGE - 0.2 && x <= W - EDGE + 0.2 && depth >= -0.3 && depth <= ZONE_DEPTH + 0.05;
}

/** A unit bought and placed on the board; it stays between rounds. */
export interface Piece {
  id: number;
  kind: UnitKind;
  side: Side;
  x: number;
  y: number;
  rank: number;
  spent: number;
}

export interface Obstacle { x: number; y: number; r: number; }

/** Per-side modifiers (Gauntlet boons, campaign handicaps). */
export interface Mods {
  hpMul?: number;
  dmgMul?: number;
  speedMul?: number;
  kindHp?: Partial<Record<UnitKind, number>>;
  kindDmg?: Partial<Record<UnitKind, number>>;
  income?: number;
  freeRerolls?: number;
  supply?: number;
  healMul?: number;
  cooldownMul?: number;
  /** Mines also stun for longer and hit 25% wider. */
  bigMines?: boolean;
  /** Hives start with two mites. */
  broodStart?: boolean;
}
