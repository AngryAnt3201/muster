// The 30-level campaign in five acts of six. Each act ends with a boss: a named rival, a set-piece board and a twist.
// New units unlock along the way; the level that introduces one sets the foe up so the new unit matters.
import type { AIProfile, Tactic } from "./ai";
import type { LevelDef, Objective } from "./content";
import type { UnitKind } from "./defs";

export const ACTS = ["The Borderlands", "Ash Fields", "The Hollow Wood", "Iron Pass", "The Last Keep"];

/** The level each unit first appears on (the player's roster is everything unlocked so far). */
const UNLOCKS: [number, UnitKind][] = [
  [1, "blades"], [1, "ranger"], [2, "mine"], [3, "bulwark"], [5, "medic"], [7, "lancer"], [9, "grenadier"],
  [11, "ballista"], [14, "shade"], [16, "hive"], [19, "storm"], [22, "golem"],
];
export const rosterAt = (id: number): UnitKind[] => UNLOCKS.filter(([at]) => at <= id).map(([, k]) => k);

const ai = (difficulty: number, tactic: Tactic, aggression = 0.5, economy = 0.4, spread = 0.6, rerolls = 1): AIProfile =>
  ({ difficulty, tactic, aggression, economy, spread, rerolls });

const WIN: Objective = { kind: "win" };
const hp = (value: number): Objective => ({ kind: "hpAtLeast", value });
const rounds = (value: number): Objective => ({ kind: "roundsAtMost", value });
const losses = (value: number): Objective => ({ kind: "lossesAtMost", value });

/** A level as written: `power` scales the foe's health and damage (a quiet handicap or edge, tuned by tools/balance.ts). */
type Draft = Omit<LevelDef, "id" | "act" | "roster" | "unlock" | "hp"> & { hp?: [number, number]; foeHp: number; power?: number };

const DRAFTS: Draft[] = [
  // ---------------------------------------------------------------- Act 1: The Borderlands
  { name: "First Muster", foe: "Sergeant Pell", line: "Raw recruits on both sides of the fence.", foeHp: 120, power: 0.8,
    ai: ai(0.1, "balanced", 0.4, 0.2, 0.6, 0), stars: [WIN, hp(340), rounds(6)] },
  { name: "Tripwire", foe: "Corporal Dunn", line: "Dunn's swords never stop running.", foeHp: 130, power: 0.8, foeRoster: ["blades", "ranger"],
    ai: ai(0.13, "swarm", 0.7, 0.2, 0.5, 0), stars: [WIN, hp(330), losses(1)] },
  { name: "Arrow Rain", foe: "Captain Ilse", line: "Ilse would rather shoot than talk.", foeHp: 140, power: 1.1, foeRoster: ["ranger", "blades"],
    ai: ai(0.16, "artillery", 0.3, 0.3, 0.8, 0), stars: [WIN, hp(320), rounds(7)] },
  { name: "Fence Line", foe: "Old Tobin", line: "He dug in years ago and never left.", foeHp: 150, power: 0.9,
    obstacles: [{ x: 2.2, y: 7, r: 0.6 }, { x: 6.8, y: 7, r: 0.6 }],
    ai: ai(0.19, "fortress", 0.2, 0.5, 0.5, 1), stars: [WIN, hp(300), losses(2)] },
  { name: "Field Dressing", foe: "Sister Wren", line: "She wins the long fights.", foeHp: 170, power: 0.8,
    ai: ai(0.22, "blitz", 0.8, 0.2, 0.7, 1), stars: [WIN, hp(300), rounds(8)] },
  { name: "The Old Bridge", foe: "Warden Hask", line: "None cross while the Warden stands.", foeHp: 220, power: 0.85, boss: true, startGold: [6, 0], supply: [1, 0],
    obstacles: [{ x: 0.9, y: 7, r: 0.75 }, { x: 2.3, y: 7, r: 0.75 }, { x: 6.7, y: 7, r: 0.75 }, { x: 8.1, y: 7, r: 0.75 }],
    start: [undefined, [{ kind: "bulwark", lx: 4.5, depth: 5 }, { kind: "ranger", lx: 3.6, depth: 2.4 }, { kind: "ranger", lx: 5.4, depth: 2.4 }, { kind: "mine", lx: 4.5, depth: 5.7 }]],
    ai: ai(0.3, "fortress", 0.35, 0.4, 0.4, 1), stars: [WIN, hp(260), losses(2)] },

  // ---------------------------------------------------------------- Act 2: Ash Fields
  { name: "Cavalry", foe: "Rook", line: "A long line of bows and nothing behind it.", foeHp: 190, power: 0.75, foeRoster: ["ranger", "medic", "blades", "bulwark"],
    ai: ai(0.32, "artillery", 0.3, 0.4, 0.9, 1), stars: [WIN, hp(300), rounds(8)] },
  { name: "Dust Devils", foe: "Dame Cassia", line: "Cassia rides first and asks later.", foeHp: 200, power: 1.0,
    ai: ai(0.35, "blitz", 0.85, 0.2, 0.7, 1), stars: [WIN, hp(280), losses(2)] },
  { name: "Bombard", foe: "Kettle", line: "Kettle brings more swords than sense.", foeHp: 210, power: 1.1, foeRoster: ["blades", "medic", "ranger", "lancer"],
    ai: ai(0.38, "swarm", 0.7, 0.2, 0.5, 2), stars: [WIN, hp(280), rounds(9)] },
  { name: "Cinder Road", foe: "Brother Ash", line: "The road is quiet. Too quiet.", foeHp: 220, power: 1.02,
    obstacles: [{ x: 3, y: 6.6, r: 0.55 }, { x: 6, y: 7.4, r: 0.55 }],
    ai: ai(0.41, "ambush", 0.6, 0.4, 0.8, 1), stars: [WIN, hp(260), losses(2)] },
  { name: "Long Shot", foe: "Lady Ferrow", line: "Her column marches in perfect file.", foeHp: 230, power: 1.2, foeRoster: ["blades", "bulwark", "lancer", "medic", "grenadier"],
    ai: ai(0.44, "siege", 0.55, 0.4, 0.05, 1), stars: [WIN, hp(250), rounds(10)] },
  { name: "Ashen Crown", foe: "Marshal Vey", line: "The Marshal does not reroll his fate.", foeHp: 260, power: 0.95, boss: true, noReroll: true, startGold: [8, 0], supply: [2, 0],
    start: [undefined, [{ kind: "lancer", lx: 2, depth: 4.4 }, { kind: "lancer", lx: 7, depth: 4.4 }, { kind: "grenadier", lx: 4.5, depth: 1.6 }, { kind: "bulwark", lx: 4.5, depth: 5 }]],
    income: [0, 1], ai: ai(0.5, "blitz", 0.75, 0.3, 0.7, 0), stars: [WIN, hp(220), losses(3)] },

  // ---------------------------------------------------------------- Act 3: The Hollow Wood
  { name: "Hidden Paths", foe: "Quill", line: "Every step in the wood is a guess.", foeHp: 260, power: 1.1,
    obstacles: [{ x: 1.8, y: 6.2, r: 0.5 }, { x: 4.5, y: 7.2, r: 0.6 }, { x: 7.2, y: 6.4, r: 0.5 }, { x: 3, y: 8.4, r: 0.45 }, { x: 6.2, y: 8.2, r: 0.45 }],
    ai: ai(0.52, "ambush", 0.5, 0.4, 0.7, 1), stars: [WIN, hp(240), rounds(10)] },
  { name: "Shadows", foe: "The Moth", line: "Her healers never seem to tire.", foeHp: 270, power: 1.1, foeRoster: ["bulwark", "medic", "ranger", "blades"],
    ai: ai(0.54, "fortress", 0.3, 0.5, 0.5, 1), stars: [WIN, hp(240), losses(3)] },
  { name: "Thicket", foe: "Hollow Jack", line: "Jack fills the trees with blades.", foeHp: 280, power: 1.05,
    obstacles: [{ x: 2.5, y: 7, r: 0.7 }, { x: 6.5, y: 7, r: 0.7 }],
    ai: ai(0.56, "swarm", 0.65, 0.3, 0.6, 2), stars: [WIN, hp(230), rounds(11)] },
  { name: "The Brood", foe: "Briar", line: "Briar seeds the ground before you come.", foeHp: 290, power: 1.1, foeRoster: ["mine", "shade", "lancer", "ranger", "bulwark", "grenadier"],
    ai: ai(0.58, "ambush", 0.45, 0.4, 0.8, 1), stars: [WIN, hp(220), losses(3)] },
  { name: "Woodcutters", foe: "Fennick", line: "Fennick fells whatever stands still.", foeHp: 300, power: 0.78,
    ai: ai(0.6, "artillery", 0.4, 0.5, 0.6, 1), stars: [WIN, hp(220), rounds(11)] },
  { name: "Heart of the Wood", foe: "Mother Brask", line: "The wood itself fights for her.", foeHp: 320, power: 1.17, boss: true, maxRounds: 12, startGold: [8, 0], supply: [2, 0],
    obstacles: [{ x: 1.5, y: 6.5, r: 0.55 }, { x: 3.4, y: 7.4, r: 0.6 }, { x: 5.6, y: 6.6, r: 0.6 }, { x: 7.5, y: 7.5, r: 0.55 }],
    start: [undefined, [{ kind: "hive", lx: 2.5, depth: 1.2 }, { kind: "hive", lx: 6.5, depth: 1.2 }, { kind: "mine", lx: 3, depth: 5.5 }, { kind: "mine", lx: 6, depth: 5.5 }, { kind: "bulwark", lx: 4.5, depth: 4.6 }]],
    mods: [undefined, { broodStart: true }], ai: ai(0.66, "swarm", 0.5, 0.4, 0.6, 1), stars: [WIN, hp(200), losses(3)] },

  // ---------------------------------------------------------------- Act 4: Iron Pass
  { name: "Thunderhead", foe: "Sledge", line: "Sledge sends the swarm and waits.", foeHp: 310, power: 1.3, foeRoster: ["blades", "hive", "medic", "lancer", "shade", "mine"],
    ai: ai(0.68, "swarm", 0.6, 0.4, 0.5, 2), stars: [WIN, hp(220), rounds(11)] },
  { name: "The Narrows", foe: "Anvil Mara", line: "Room for one army in the pass.", foeHp: 320, power: 1.05,
    obstacles: [{ x: 0.9, y: 6.4, r: 0.8 }, { x: 0.9, y: 7.8, r: 0.8 }, { x: 8.1, y: 6.4, r: 0.8 }, { x: 8.1, y: 7.8, r: 0.8 }],
    ai: ai(0.7, "blitz", 0.8, 0.3, 0.4, 1), stars: [WIN, hp(200), losses(3)] },
  { name: "Rockfall", foe: "Corran", line: "Corran has the high ground and the bombs.", foeHp: 330, power: 0.78,
    ai: ai(0.72, "artillery", 0.35, 0.5, 0.7, 2), stars: [WIN, hp(200), rounds(12)] },
  { name: "Stonewake", foe: "Grist", line: "Grist hides behind a wall of bolts.", foeHp: 340, power: 0.92, foeRoster: ["ballista", "bulwark", "medic", "ranger", "grenadier", "mine", "storm"],
    ai: ai(0.74, "fortress", 0.25, 0.5, 0.6, 1), stars: [WIN, hp(200), losses(3)] },
  { name: "Iron Gate", foe: "Iron Dov", line: "The gate holds. So does Dov.", foeHp: 350, power: 0.84, noReroll: true,
    obstacles: [{ x: 3, y: 7, r: 0.5 }, { x: 6, y: 7, r: 0.5 }],
    ai: ai(0.76, "siege", 0.45, 0.5, 0.6, 0), stars: [WIN, hp(190), rounds(12)] },
  { name: "The Iron Pass", foe: "General Okar", line: "Okar has never lost the pass.", foeHp: 360, power: 0.82, boss: true, startGold: [9, 0],
    obstacles: [{ x: 0.8, y: 6.3, r: 0.85 }, { x: 0.8, y: 7.7, r: 0.85 }, { x: 8.2, y: 6.3, r: 0.85 }, { x: 8.2, y: 7.7, r: 0.85 }],
    start: [undefined, [{ kind: "golem", lx: 4.5, depth: 4.8 }, { kind: "ballista", lx: 3, depth: 0.9 }, { kind: "ballista", lx: 6, depth: 0.9 }, { kind: "bulwark", lx: 4.5, depth: 3.6 }]],
    supply: [2, 1], ai: ai(0.82, "siege", 0.5, 0.4, 0.5, 1), stars: [WIN, hp(180), losses(4)] },

  // ---------------------------------------------------------------- Act 5: The Last Keep
  { name: "Outer Wall", foe: "Captain Rhee", line: "The keep's first wall, and its best captain.", foeHp: 360, power: 1.0,
    ai: ai(0.8, "balanced", 0.5, 0.45, 0.6, 2), stars: [WIN, hp(200), rounds(12)] },
  { name: "Killing Ground", foe: "Sable", line: "Sable mines the yard every night.", foeHp: 370, power: 1.22,
    ai: ai(0.82, "ambush", 0.55, 0.4, 0.8, 2), stars: [WIN, hp(190), losses(4)] },
  { name: "Courtyard", foe: "Lord Varrin", line: "Varrin watches from the walls.", foeHp: 380, power: 0.88,
    ai: ai(0.84, "artillery", 0.3, 0.5, 0.7, 2), stars: [WIN, hp(180), rounds(13)] },
  { name: "The Breach", foe: "The Mason", line: "Stone answers stone.", foeHp: 390, power: 0.92,
    obstacles: [{ x: 4.5, y: 7, r: 0.7 }],
    ai: ai(0.86, "siege", 0.6, 0.4, 0.5, 2), stars: [WIN, hp(180), losses(4)] },
  { name: "Night Watch", foe: "Vigil", line: "The watch never sleeps.", foeHp: 400, power: 1.0, income: [0, 1],
    ai: ai(0.88, "swarm", 0.65, 0.4, 0.6, 2), stars: [WIN, hp(170), rounds(13)] },
  { name: "The Last Keep", foe: "Regent Maelis", line: "The Regent holds the last keep.", foeHp: 400, power: 0.9, boss: true, startGold: [12, 0],
    start: [undefined, [{ kind: "golem", lx: 4.5, depth: 4.8, rank: 2 }, { kind: "bulwark", lx: 3, depth: 4.4 }, { kind: "bulwark", lx: 6, depth: 4.4 }, { kind: "medic", lx: 4.5, depth: 2.6 }]],
    obstacles: [{ x: 3.1, y: 7, r: 0.65 }, { x: 5.9, y: 7, r: 0.65 }],
    supply: [2, 1], ai: ai(0.9, "balanced", 0.55, 0.45, 0.6, 2), stars: [WIN, hp(160), losses(4)] },
];

/** Builds a level from its draft; `power` overrides the tuned foe strength (for the balance tool). */
export function buildLevel(index: number, power?: number): LevelDef {
  const { foeHp, hp: hpPair, power: tuned = 1, mods, ...d } = DRAFTS[index];
  const id = index + 1;
  const unlock = UNLOCKS.find(([at]) => at === id)?.[1];
  const p = power ?? tuned;
  const foeMods = mods?.[1] ?? {};
  const scaled = p === 1 ? mods?.[1] : { ...foeMods, hpMul: +((foeMods.hpMul ?? 1) * p).toFixed(3), dmgMul: +((foeMods.dmgMul ?? 1) * p).toFixed(3) };
  const out: LevelDef = { id, act: Math.floor(index / 6) + 1, roster: rosterAt(id), unlock, hp: hpPair ?? [400, foeHp], ...d };
  if (mods?.[0] || scaled) out.mods = [mods?.[0], scaled];
  return out;
}

export const LEVELS: LevelDef[] = DRAFTS.map((_, i) => buildLevel(i));
export const levelPower = (id: number) => DRAFTS[id - 1].power ?? 1;
