// Gauntlet: one commander, one health pool, rivals one after another; the army carries over and a boon follows
// every win. Rivals get tougher with the stage and with the army you bring.
import { DEFAULT_AI, TACTICS, draftArmy, type AIProfile, type Tactic } from "./ai";
import type { Boon, GauntletFoe } from "./content";
import { START_HP, UNITS, UNIT_KINDS, supplyFor, toLocal, type Mods, type Obstacle, type UnitKind } from "./defs";
import type { Match, MatchConfig, StartPiece } from "./match";
import { Rng, hashSeed } from "./rng";

const mul = (m: Mods, key: "hpMul" | "dmgMul" | "healMul" | "cooldownMul" | "speedMul", by: number) => { m[key] = +((m[key] ?? 1) * by).toFixed(4); };
const kindMul = (m: Mods, key: "kindHp" | "kindDmg", kinds: UnitKind[], by: number) => {
  const t = (m[key] ??= {});
  for (const k of kinds) t[k] = +((t[k] ?? 1) * by).toFixed(4);
};

/** Health a Field Hospital gives back. */
export const MEND_HP = 120;

export const BOONS: Boon[] = [
  { id: "tithe", name: "Tithe", text: "+2 gold every round", apply: (m) => { m.income = (m.income ?? 0) + 2; } },
  { id: "iron", name: "Iron Hide", text: "Your units +15% health", apply: (m) => mul(m, "hpMul", 1.15) },
  { id: "edge", name: "Whetstone", text: "Your units +12% damage", apply: (m) => mul(m, "dmgMul", 1.12) },
  { id: "drill", name: "Drill Sergeant", text: "Everyone attacks 10% faster", apply: (m) => mul(m, "cooldownMul", 0.9) },
  { id: "scout", name: "Scouts", text: "First reroll each round is free", apply: (m) => { m.freeRerolls = (m.freeRerolls ?? 0) + 1; } },
  { id: "barracks", name: "Barracks", text: "+1 board space", apply: (m) => { m.supply = (m.supply ?? 0) + 1; } },
  { id: "mend", name: "Field Hospital", text: `Heal ${MEND_HP} health now`, apply: () => {} },
  { id: "powder", name: "Blasting Powder", text: "Mines blast wider and stun longer", apply: (m) => { m.bigMines = true; } },
  { id: "brood", name: "Brood Mother", text: "Hives start with two mites", apply: (m) => { m.broodStart = true; } },
  { id: "salve", name: "Salves", text: "Medics heal 40% more", apply: (m) => mul(m, "healMul", 1.4) },
  { id: "pikes", name: "Long Pikes", text: "Blades and lancers +20% damage", apply: (m) => kindMul(m, "kindDmg", ["blades", "lancer"], 1.2) },
  { id: "yew", name: "Yew Bows", text: "Rangers and ballistas +20% damage", apply: (m) => kindMul(m, "kindDmg", ["ranger", "ballista"], 1.2) },
  { id: "stone", name: "Stoneskin", text: "Bulwarks and golems +25% health", apply: (m) => kindMul(m, "kindHp", ["bulwark", "golem"], 1.25) },
  { id: "static", name: "Static", text: "Stormcallers and grenadiers +20% damage", apply: (m) => kindMul(m, "kindDmg", ["storm", "grenadier"], 1.2) },
];

/** Boons that can be taken again. */
const REPEATABLE = new Set(["tithe", "mend", "scout"]);
/** Boons that only help an army with these kinds in it. */
const NEEDS: Partial<Record<string, UnitKind[]>> = {
  powder: ["mine"], brood: ["hive"], salve: ["medic"], pikes: ["blades", "lancer"], yew: ["ranger", "ballista"],
  stone: ["bulwark", "golem"], static: ["storm", "grenadier"],
};

export interface GauntletRun {
  seed: number;
  stage: number;
  hp: number;
  maxHp: number;
  boons: string[];
  board: StartPiece[];
  gold: number;
  wins: number;
  over: boolean;
}

export function newRun(seed: number): GauntletRun {
  return { seed, stage: 1, hp: START_HP, maxHp: START_HP, boons: [], board: [], gold: 0, wins: 0, over: false };
}

export function runMods(run: GauntletRun): Mods {
  const m: Mods = {};
  for (const id of run.boons) BOONS.find((b) => b.id === id)?.apply(m);
  return m;
}

/** What an army is worth, ranks weighted by the strength they add. */
export function boardValue(board: StartPiece[]) {
  return board.reduce((s, p) => s + UNITS[p.kind].cost * (p.rank ?? 1) * (1 + 0.5 * ((p.rank ?? 1) - 1)), 0);
}

// ---------------------------------------------------------------- rivals
const TITLES = ["Captain", "Warlord", "Sister", "Old", "Baron", "Dame", "Brother", "Marshal", "Lady", "Sergeant"];
const NAMES = ["Harrow", "Vex", "Morrow", "Kestrel", "Thane", "Brine", "Ivo", "Sorrel", "Grimm", "Lark", "Quell", "Ruck", "Tamsin", "Ysolde", "Corvin", "Wick", "Anselm", "Petra"];
/** Field shapes a rival may bring (world coordinates, kept in the no-man's-land band). */
const FIELDS: Obstacle[][] = [
  [{ x: 4.5, y: 7, r: 0.75 }],
  [{ x: 2.6, y: 7, r: 0.6 }, { x: 6.4, y: 7, r: 0.6 }],
  [{ x: 0.9, y: 6.5, r: 0.8 }, { x: 0.9, y: 7.6, r: 0.8 }, { x: 8.1, y: 6.5, r: 0.8 }, { x: 8.1, y: 7.6, r: 0.8 }],
  [{ x: 1.8, y: 6.4, r: 0.5 }, { x: 4.5, y: 7.4, r: 0.55 }, { x: 7.2, y: 6.6, r: 0.5 }],
  [{ x: 3.4, y: 6.6, r: 0.55 }, { x: 5.6, y: 7.4, r: 0.55 }],
];
/** How each style likes to stand. */
const STYLE: Record<Tactic, Partial<AIProfile>> = {
  balanced: { aggression: 0.5, spread: 0.6, economy: 0.4 },
  swarm: { aggression: 0.7, spread: 0.55, economy: 0.25 },
  fortress: { aggression: 0.25, spread: 0.5, economy: 0.55 },
  artillery: { aggression: 0.3, spread: 0.75, economy: 0.45 },
  ambush: { aggression: 0.55, spread: 0.8, economy: 0.4 },
  blitz: { aggression: 0.85, spread: 0.7, economy: 0.2 },
  siege: { aggression: 0.5, spread: 0.45, economy: 0.45 },
};

/** The rival for this stage: a named commander with a style (rotating through all seven), an army sized to yours. */
export function gauntletFoe(stage: number, playerValue: number, seed: number): GauntletFoe {
  const rng = new Rng(hashSeed(seed, "foe", stage));
  const tactic = TACTICS[(stage - 1 + (seed % TACTICS.length)) % TACTICS.length];
  const style = STYLE[tactic];
  const ai: AIProfile = {
    ...DEFAULT_AI,
    tactic,
    difficulty: Math.min(0.92, 0.3 + stage * 0.06),
    aggression: Math.max(0, Math.min(1, (style.aggression ?? 0.5) + rng.range(-0.1, 0.1))),
    spread: Math.max(0, Math.min(1, (style.spread ?? 0.6) + rng.range(-0.15, 0.15))),
    economy: style.economy ?? 0.4,
    rerolls: stage >= 4 ? 2 : 1,
  };
  // Its army: what you bring, give or take, and a little more every stage.
  const budget = Math.round(playerValue * Math.min(1.05, 0.62 + stage * 0.045) + 3 + stage * 1.6);
  const pieces = Math.min(12, Math.max(2 + stage, Math.round(playerValue / 6)));
  const army = draftArmy(1, budget, UNIT_KINDS, ai, hashSeed(seed, "army", stage), pieces);
  const name = `${TITLES[rng.int(0, TITLES.length - 1)]} ${NAMES[(hashSeed(seed, "name", stage) >>> 3) % NAMES.length]}`;
  const foe: GauntletFoe = {
    name,
    ai,
    hp: 90 + stage * 22,
    start: army.map((p) => ({ kind: p.kind, rank: p.rank, ...toLocal(1, p.x, p.y) })),
  };
  // Every third rival picks its ground; the rest now and then.
  if (stage % 3 === 0 || rng.chance(0.25)) foe.obstacles = FIELDS[rng.int(0, FIELDS.length - 1)];
  return foe;
}

/** Round the duel's economy starts on: later rivals start further in. */
export const duelFirstRound = (stage: number) => Math.min(8, 1 + (stage - 1) * 2);

export function duelConfig(run: GauntletRun, foe: GauntletFoe): MatchConfig {
  const first = duelFirstRound(run.stage);
  // Room for the army you carry plus one more piece (up to a full board); it grows a piece a round as usual, so a
  // carried army settles at about 14.
  const room = (n: number, extra: number) => Math.max(0, Math.min(n + extra, 12) - supplyFor(first));
  return {
    seed: hashSeed(run.seed, "duel", run.stage),
    hp: [run.hp, foe.hp],
    start: [run.board, foe.start],
    mods: [runMods(run), undefined],
    firstRound: first,
    carryGold: run.gold,
    supply: [room(run.board.length, 1), room(foe.start.length, 0)],
    obstacles: foe.obstacles,
    names: ["You", foe.name],
  };
}

/** Folds a finished duel back into the run. */
export function endDuel(run: GauntletRun, m: Match): boolean {
  run.hp = m.sides[0].hp;
  const won = m.winner === 0;
  if (!won) { run.over = true; return false; }
  run.wins++;
  run.stage++;
  run.gold = Math.min(10, m.sides[0].gold);
  run.board = m.sides[0].pieces.map((p) => ({ kind: p.kind, rank: p.rank, ...toLocal(0, p.x, p.y) }));
  return true;
}

/** Three boons to pick from; ones that suit the army you have come up more often. */
export function boonChoices(run: GauntletRun): Boon[] {
  const rng = new Rng(hashSeed(run.seed, "boons", run.stage));
  const kinds = new Set(run.board.map((p) => p.kind));
  const pool = BOONS.filter((b) => !run.boons.includes(b.id) || REPEATABLE.has(b.id));
  const weight = (b: Boon) => {
    const needs = NEEDS[b.id];
    if (needs && !needs.some((k) => kinds.has(k))) return 0.15;
    if (b.id === "mend") return run.hp < run.maxHp * 0.6 ? 1.6 : run.hp < run.maxHp ? 0.6 : 0;
    return 1;
  };
  const out: Boon[] = [];
  const left = [...pool];
  while (out.length < 3 && left.length) {
    const ws = left.map(weight);
    if (ws.every((w) => w <= 0)) break;
    const i = rng.weighted(ws);
    out.push(left[i]);
    left.splice(i, 1);
  }
  return out;
}

export function takeBoon(run: GauntletRun, id: string) {
  run.boons.push(id);
  if (id === "mend") run.hp = Math.min(run.maxHp, run.hp + MEND_HP);
}
