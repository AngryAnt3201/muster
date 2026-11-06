// Breakpoint: one-battle puzzles against a fixed board. Each has a trick; gold left sets the stars.
import type { PuzzleDef } from "./content";
import type { StartPiece } from "./match";

export const PUZZLES: PuzzleDef[] = [
  // The pack walks in step: one mine where it will be catches all three swords.
  { id: 1, name: "Doorway", gold: 9, shop: ["blades", "ranger", "mine"], supply: 3,
    foe: [{ kind: "blades", lx: 4.5, depth: 5.2 }, { kind: "blades", lx: 3.7, depth: 4.6 }, { kind: "blades", lx: 5.3, depth: 4.6 }, { kind: "ranger", lx: 4.5, depth: 2 }], silver: 1, par: 2 },
  // Outgunned at range: a bulwark stood in front of your bows soaks the volleys.
  { id: 2, name: "Shield Wall", gold: 12, shop: ["ranger", "bulwark"], supply: 3,
    foe: [{ kind: "ranger", lx: 2.5, depth: 3 }, { kind: "ranger", lx: 4.5, depth: 3.2 }, { kind: "ranger", lx: 6.5, depth: 3 }, { kind: "ranger", lx: 4.5, depth: 1.5 }, { kind: "blades", lx: 4.5, depth: 5.2 }], silver: 0, par: 1 },
  // Lancers charge the nearest thing and wheel where the charge runs out: mine the lane.
  { id: 3, name: "Lancer Lane", gold: 11, shop: ["ranger", "mine"], supply: 5,
    foe: [{ kind: "lancer", lx: 2, depth: 4.5 }, { kind: "lancer", lx: 7, depth: 4.5 }, { kind: "ranger", lx: 4.5, depth: 2 }], silver: 2, par: 4 },
  // Fifteen swords in a block: bombs where they bunch, a wall to hold them there.
  { id: 4, name: "Pack Hunt", gold: 13, shop: ["grenadier", "ranger", "bulwark"], supply: 3,
    foe: [{ kind: "blades", lx: 3.6, depth: 5 }, { kind: "blades", lx: 5.4, depth: 5 }, { kind: "blades", lx: 4.5, depth: 4 }, { kind: "blades", lx: 3.6, depth: 3 }, { kind: "blades", lx: 5.4, depth: 3 }], silver: 1, par: 2 },
  // One file down one lane: a bolt laid along it goes through every one of them.
  { id: 5, name: "Column", gold: 10, shop: ["ballista", "ranger", "blades"], supply: 2,
    foe: [{ kind: "blades", lx: 6.5, depth: 5.4 }, { kind: "blades", lx: 6.5, depth: 4.2 }, { kind: "ranger", lx: 6.5, depth: 3 }, { kind: "ranger", lx: 6.5, depth: 2 }, { kind: "blades", lx: 6.5, depth: 1 }], silver: 1, par: 4 },
  // Two medics keep the giant standing: cloaks go round it and cut the healers first.
  { id: 6, name: "Soft Centre", gold: 13, shop: ["shade", "blades", "ranger"], supply: 3,
    foe: [{ kind: "golem", lx: 4.5, depth: 5 }, { kind: "medic", lx: 3.5, depth: 2.5 }, { kind: "medic", lx: 5.5, depth: 2.5 }, { kind: "ranger", lx: 4.5, depth: 1 }], silver: 1, par: 2 },
  // Rocks split the field: put everything on one side, win there, then turn.
  { id: 7, name: "Two Camps", gold: 14, shop: ["blades", "ranger", "bulwark"], supply: 4,
    obstacles: [{ x: 4.5, y: 5.6, r: 0.75 }, { x: 4.5, y: 7, r: 0.75 }, { x: 4.5, y: 8.4, r: 0.75 }],
    foe: [{ kind: "blades", lx: 1.5, depth: 4.5 }, { kind: "ranger", lx: 1.5, depth: 2.5 }, { kind: "ranger", lx: 2.3, depth: 3 },
      { kind: "blades", lx: 7.5, depth: 4.5 }, { kind: "ranger", lx: 7.5, depth: 2.5 }, { kind: "ranger", lx: 6.7, depth: 3 }], silver: 1, par: 2 },
  // Shades blink in right behind your bows: that is where the mines go.
  { id: 8, name: "Blink Trap", gold: 13, shop: ["ranger", "mine"], supply: 5,
    foe: [{ kind: "shade", lx: 1, depth: 5 }, { kind: "shade", lx: 8, depth: 5 }, { kind: "shade", lx: 4.5, depth: 4 }, { kind: "ranger", lx: 4.5, depth: 1.5 }], silver: 1, par: 3 },
  // Their front is sown with mines: let mites walk it first.
  { id: 9, name: "Minefield", gold: 13, shop: ["hive", "blades", "lancer"], supply: 4,
    foe: [{ kind: "mine", lx: 2.5, depth: 5.5 }, { kind: "mine", lx: 3.7, depth: 5.6 }, { kind: "mine", lx: 4.9, depth: 5.5 }, { kind: "mine", lx: 6.1, depth: 5.6 }, { kind: "mine", lx: 7.3, depth: 5.5 },
      { kind: "mine", lx: 3.1, depth: 4.6 }, { kind: "mine", lx: 5.5, depth: 4.6 }, { kind: "ranger", lx: 3.5, depth: 2 }, { kind: "ranger", lx: 5.5, depth: 2 }, { kind: "grenadier", lx: 4.5, depth: 1 }, { kind: "ballista", lx: 4.5, depth: 0.5 }], silver: 1, par: 2 },
  // The golem walks at structures first: spread bolt throwers so it chases one while the rest shoot.
  { id: 10, name: "Stone Bait", gold: 14, shop: ["ballista", "ranger", "blades"], supply: 5,
    foe: [{ kind: "golem", lx: 4.5, depth: 5, rank: 2 }, { kind: "storm", lx: 4.5, depth: 2.5 }, { kind: "medic", lx: 4.5, depth: 1.5 }], silver: 1, par: 2 },
  // Swords, a lancer and two hives of mites: lightning jumps through the crowd, a wall keeps it alive.
  { id: 11, name: "Storm Front", gold: 16, shop: ["storm", "bulwark", "ranger"], supply: 4,
    foe: [{ kind: "hive", lx: 3, depth: 1.5 }, { kind: "hive", lx: 6, depth: 1.5 }, { kind: "blades", lx: 4.5, depth: 5 }, { kind: "blades", lx: 3, depth: 4.5 }, { kind: "blades", lx: 6, depth: 4.5 }, { kind: "lancer", lx: 4.5, depth: 3.5 }], silver: 1, par: 2 },
  // Golems go for structures, shades for the soft back line: send each where it wants to go.
  { id: 12, name: "Siege Works", gold: 18, shop: ["golem", "lancer", "shade", "mine"], supply: 4,
    foe: [{ kind: "ballista", lx: 3, depth: 1.2 }, { kind: "ballista", lx: 6, depth: 1.2 }, { kind: "grenadier", lx: 4.5, depth: 2 }, { kind: "bulwark", lx: 4.5, depth: 4.8 }, { kind: "ranger", lx: 2.5, depth: 3 }, { kind: "ranger", lx: 6.5, depth: 3 }], silver: 3, par: 4 },
  // Two places on the board and five packs coming: rank up instead of widening.
  { id: 13, name: "Few but Fierce", gold: 20, shop: ["storm", "grenadier", "bulwark", "blades"], supply: 2,
    foe: [{ kind: "blades", lx: 2, depth: 5 }, { kind: "blades", lx: 4.5, depth: 5 }, { kind: "blades", lx: 7, depth: 5 }, { kind: "blades", lx: 3.2, depth: 3.5 }, { kind: "blades", lx: 5.8, depth: 3.5 }, { kind: "medic", lx: 4.5, depth: 2 }], silver: 2, par: 4 },
  // Bombers and lightning behind one shield: ride through them from wide lanes, never in a bunch.
  { id: 14, name: "Ride Through", gold: 18, shop: ["blades", "lancer", "ranger"], supply: 5,
    foe: [{ kind: "bulwark", lx: 4.5, depth: 5 }, { kind: "grenadier", lx: 3.2, depth: 2.4 }, { kind: "grenadier", lx: 5.8, depth: 2.4 }, { kind: "storm", lx: 4.5, depth: 3 }], silver: 2, par: 3 },
  // Everything at once. Lancers break on stone and shades can't cut it down.
  { id: 15, name: "Last Stand", gold: 22, shop: ["mine", "bulwark", "ranger", "grenadier", "storm", "golem", "lancer", "ballista"], supply: 6,
    foe: [{ kind: "golem", lx: 4.5, depth: 5, rank: 2 }, { kind: "lancer", lx: 1.5, depth: 4.5 }, { kind: "lancer", lx: 7.5, depth: 4.5 }, { kind: "shade", lx: 4.5, depth: 3.5 },
      { kind: "shade", lx: 1, depth: 3 }, { kind: "storm", lx: 3.5, depth: 2 }, { kind: "medic", lx: 5.5, depth: 2 }], silver: 3, par: 4 },
];

/** A known winning buy for each puzzle (solver-found), side-local coordinates. */
export const SOLUTIONS: Record<number, StartPiece[]> = {
  1: [{ kind: "blades", lx: 0.59, depth: 0.71 }, { kind: "mine", lx: 2.94, depth: 5.72 }, { kind: "mine", lx: 3.57, depth: 4.74 }],
  2: [{ kind: "bulwark", lx: 3.13, depth: 3.41 }, { kind: "bulwark", lx: 8.16, depth: 5.88 }, { kind: "ranger", lx: 6.27, depth: 1.64 }],
  3: [{ kind: "ranger", lx: 5.06, depth: 3.82 }, { kind: "mine", lx: 5.19, depth: 4.42 }, { kind: "mine", lx: 5.23, depth: 5.17 }],
  4: [{ kind: "ranger", lx: 2.52, depth: 4.36 }, { kind: "grenadier", lx: 6.05, depth: 0.76 }, { kind: "grenadier", lx: 7.17, depth: 3 }],
  5: [{ kind: "ballista", lx: 5.09, depth: 0.8 }, { kind: "ballista", lx: 3.49, depth: 2.17 }],
  6: [{ kind: "shade", lx: 5.63, depth: 5.13, rank: 2 }, { kind: "ranger", lx: 5.8, depth: 3.04 }],
  7: [{ kind: "blades", lx: 5.05, depth: 5.52 }, { kind: "blades", lx: 1.1, depth: 2.61 }, { kind: "blades", lx: 6.7, depth: 4.36 }, { kind: "blades", lx: 4.21, depth: 2.74 }],
  8: [{ kind: "ranger", lx: 6.55, depth: 2.79 }, { kind: "mine", lx: 2.74, depth: 4.41 }, { kind: "ranger", lx: 4.63, depth: 0.36 }, { kind: "mine", lx: 5.13, depth: 2.28 }],
  9: [{ kind: "hive", lx: 3.14, depth: 0.25, rank: 2 }, { kind: "blades", lx: 3.7, depth: 5.88 }],
  10: [{ kind: "ballista", lx: 3.69, depth: 0.98 }, { kind: "ballista", lx: 3.92, depth: 4.14 }, { kind: "ranger", lx: 1.37, depth: 2.61 }, { kind: "ranger", lx: 7.06, depth: 1.79 }],
  11: [{ kind: "storm", lx: 3.84, depth: 0.36 }, { kind: "bulwark", lx: 4.93, depth: 0.58 }, { kind: "storm", lx: 4.35, depth: 1.35 }],
  12: [{ kind: "shade", lx: 3.03, depth: 0.62 }, { kind: "golem", lx: 6.59, depth: 5.36 }, { kind: "golem", lx: 6.48, depth: 5.88 }],
  13: [{ kind: "bulwark", lx: 4.47, depth: 0.25, rank: 2 }, { kind: "grenadier", lx: 5.52, depth: 2.83, rank: 2 }],
  14: [{ kind: "lancer", lx: 8.3, depth: 1.46 }, { kind: "lancer", lx: 0.75, depth: 3.02 }, { kind: "lancer", lx: 6.26, depth: 1.38 }, { kind: "ranger", lx: 4.28, depth: 1.83 }],
  15: [{ kind: "golem", lx: 4.47, depth: 3.35 }, { kind: "ballista", lx: 4.71, depth: 0.25 }, { kind: "golem", lx: 0.85, depth: 2.22 }, { kind: "golem", lx: 6.14, depth: 3.38 }],
};
