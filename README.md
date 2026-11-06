# Muster

Turn-based unit battler for iPhone. Each commander has 400 health. Every round both sides buy units from a shop of four and place them anywhere in their half; units stay on the board and come back each round, so armies build up. Then the battle plays out on its own: free 360° steering, no grid, every unit with its own behaviour. The loser of a round takes damage: a base that grows each round, plus twice the threat of the winner's survivors.

## Units (12)

| Unit | Cost | Behaviour |
| --- | --- | --- |
| Mine | 2 | Buried and untargetable; a short fuse when an enemy steps close, then a blast 1 unit wide |
| Blade Trio | 3 | Three swords, one shared target, surround it and slash in an arc |
| Ranger | 3 | Holds bow range, strafes, backs off when rushed |
| Bulwark | 4 | Shield takes 60% less from the front; guards the ally in most danger; draws melee to itself |
| Medic | 3 | Heals the most hurt ally while keeping it between itself and the enemy |
| Grenadier | 4 | Lobs bombs where enemies will be bunched when they land |
| Shade | 4 | Cloaked flank, blinks behind the softest target and backstabs |
| Lancer | 4 | Aims, charges straight through a line, wheels round in an arc, again |
| Ballista | 3 | Fixed; slow turret; bolts pierce everything in line |
| Hive | 4 | Fixed; breeds mites that swarm (and trip mines) |
| Stormcaller | 5 | Chain lightning that jumps between bunched enemies |
| Golem | 5 | Slow giant, walks at structures first, splits into two golemlings when it falls |

Upgrade a placed unit to rank 2 and 3; sell for half of what it cost. Unspent gold earns interest (1 per 5, max 3).

## The AI

`src/core/ai.ts`. An `AIProfile` sets **difficulty** (how many plans it tests in simulation, how sharply it counters, how often it blunders), **aggression** (formation depth, damage vs defence), **tactic** (balanced, swarm, fortress, artillery, ambush, blitz, siege), **economy** (bank for interest and upgrades vs spend), **rerolls** and **spread** (formation width). Hard AIs simulate each candidate draft and formation against your visible board plus a guess at what you'll add; buried mines stay hidden from it. Tune them in-game under Skirmish (AI lab), including AI-vs-AI.

## Modes

- **Campaign**: 30 levels in 5 acts, a boss at the end of each, a new unit unlocked along the way, three stars per level.
- **Gauntlet**: one health pool against rival after rival; your army carries over and each win brings a boon.
- **Breakpoint**: one-battle puzzles against a fixed visible board with fixed gold; win, then win cheaper for stars.
- **Skirmish**: any AI profile, any health, or watch two AIs.

## Run

```
npm install
npm run dev          # http://localhost:5180 (deep links: ?level=3 ?puzzle=2 ?lab ?watch ?gauntlet)
npm test             # sim, match, AI, content
npm run build
npm run ios:sim      # build the iOS app for the simulator (Capacitor, no signing)
npm run ios:run      # build, install and launch on the booted simulator
npm run ios:open     # open in Xcode to run on a device
node tools/shot.mjs "/?level=1" out.png   # phone-size screenshot of the dev server
node tools/e2e.mjs <dir>                  # full AI-vs-AI match in the browser
```

Code: `src/core` is pure and deterministic (battle sim, match, AI, content); `src/render` draws it on a canvas; `src/ui` is the HUD and screens.
