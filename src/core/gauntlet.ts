// Gauntlet: one commander, one health pool, rivals one after another; the army carries over and a boon follows
// every win. (Mechanics final; foes and boons being tuned.)
import { DEFAULT_AI, draftArmy } from "./ai";
import type { Boon, GauntletFoe } from "./content";
import { START_HP, UNITS, UNIT_KINDS, toLocal, type Mods } from "./defs";
import type { Match, MatchConfig, StartPiece } from "./match";
import { Rng, hashSeed } from "./rng";

export const BOONS: Boon[] = [
  { id: "tithe", name: "Tithe", text: "+2 gold every round", apply: (m) => { m.income = (m.income ?? 0) + 2; } },
  { id: "iron", name: "Iron Hide", text: "Your units +15% health", apply: (m) => { m.hpMul = (m.hpMul ?? 1) * 1.15; } },
];

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

export function boardValue(board: StartPiece[]) {
  return board.reduce((s, p) => s + UNITS[p.kind].cost * (p.rank ?? 1) * (1 + 0.5 * ((p.rank ?? 1) - 1)), 0);
}

export function gauntletFoe(stage: number, playerValue: number, seed: number): GauntletFoe {
  const rng = new Rng(hashSeed(seed, "foe", stage));
  const ai = { ...DEFAULT_AI, difficulty: Math.min(0.95, 0.3 + stage * 0.07), aggression: rng.range(0.2, 0.9) };
  const budget = Math.round(playerValue * (0.75 + stage * 0.06) + stage * 2);
  const army = draftArmy(1, budget, UNIT_KINDS, ai, hashSeed(seed, "army", stage), 3 + stage);
  return {
    name: `Rival ${stage}`,
    ai,
    hp: 80 + stage * 20,
    start: army.map((p) => ({ kind: p.kind, rank: p.rank, ...toLocal(1, p.x, p.y) })),
  };
}

export function duelConfig(run: GauntletRun, foe: GauntletFoe): MatchConfig {
  return {
    seed: hashSeed(run.seed, "duel", run.stage),
    hp: [run.hp, foe.hp],
    start: [run.board, foe.start],
    mods: [runMods(run), undefined],
    firstRound: Math.min(8, 1 + (run.stage - 1) * 2),
    carryGold: run.gold,
    supply: [Math.max(0, run.board.length - 2), Math.max(0, foe.start.length - 2)],
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

export function boonChoices(run: GauntletRun): Boon[] {
  const rng = new Rng(hashSeed(run.seed, "boons", run.stage));
  const pool = BOONS.filter((b) => !run.boons.includes(b.id) || b.id === "tithe");
  const out: Boon[] = [];
  while (out.length < Math.min(3, pool.length)) {
    const b = pool[rng.int(0, pool.length - 1)];
    if (!out.includes(b)) out.push(b);
  }
  return out;
}

export function takeBoon(run: GauntletRun, id: string) {
  run.boons.push(id);
}
