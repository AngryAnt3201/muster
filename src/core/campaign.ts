// The 30-level campaign in five acts. (Placeholder: being written in full.)
import { DEFAULT_AI } from "./ai";
import type { LevelDef } from "./content";

export const LEVELS: LevelDef[] = [
  { id: 1, act: 1, name: "First Muster", foe: "Sergeant Pell", line: "Hold the field.", ai: { ...DEFAULT_AI, difficulty: 0.1, aggression: 0.4 }, hp: [400, 120],
    roster: ["blades", "ranger", "mine"], unlock: "blades", stars: [{ kind: "win" }, { kind: "hpAtLeast", value: 350 }, { kind: "roundsAtMost", value: 6 }] },
  { id: 2, act: 1, name: "Tripwire", foe: "Sergeant Pell", ai: { ...DEFAULT_AI, difficulty: 0.15 }, hp: [400, 150],
    roster: ["blades", "ranger", "mine"], unlock: "mine", stars: [{ kind: "win" }, { kind: "hpAtLeast", value: 330 }, { kind: "lossesAtMost", value: 1 }] },
];

export const ACTS = ["The Borderlands", "Ash Fields", "The Hollow Wood", "Iron Pass", "The Last Keep"];
