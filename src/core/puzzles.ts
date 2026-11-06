// Breakpoint: one-battle puzzles against a fixed board. (Placeholder: being written in full.)
import type { PuzzleDef } from "./content";

export const PUZZLES: PuzzleDef[] = [
  { id: 1, name: "Doorway", gold: 8, shop: ["blades", "ranger", "mine"], supply: 4,
    foe: [{ kind: "blades", lx: 4.5, depth: 4.5 }, { kind: "ranger", lx: 4.5, depth: 2 }], silver: 1, par: 2 },
];
