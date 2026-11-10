# Polish scorecard

Motion and feedback graded against Clash Royale as the quality bar (motion only: Muster's look, characters and UI stay
its own). Each criterion is 0-3: 0 missing, 1 present but stiff, 2 good, 3 holds up beside Clash Royale. Graded
harshly from frame sequences, not stills.

## How it is measured

    npx vite --host 127.0.0.1 --port 5377 --strictPort
    PORT=5377 node tools/scorecard-shots.mjs <tag>      # writes outputs/review/scorecard/<tag>/*.jpg

- Phone size, 390x844 at 2x, headless Chromium. Battle moments use the 24-unit bench armies (12 a side, 24 kinds,
  ranks 1-4) on level 1's arena and are stepped frame by frame at 60 Hz with the game's own loop rules, so every strip
  shows exact frames around its event, including the frames before it (labels are frames from the event).
- Screens (home, chest, upgrade, victory) run live and are shot back to back (labels are ms).
- The tool also prints the share of pixels that change between consecutive frames of each strip: a rough "how much
  moves" number, quoted below where it is the evidence.

## Round 1 (10 Nov 2026): 24 / 42 before, 29 / 42 after

Before = commit 34dd9dc, files in `outputs/review/scorecard/before/`. After = branch `polish/scorecard-round`, files in
`outputs/review/scorecard/after/`. Same tool, same armies, same moments.

| # | Criterion | Before | After | Evidence (before, then after) |
|---|---|---|---|---|
| 1 | Unit readability at phone size | 2 | 2 | `mid-battle.jpg`: thick ink, team rings and team-coloured kit read at a glance, but the brawl at the far keep is a pile where single units can't be picked out. Not worked on; unchanged. |
| 2 | Idle life | 1 | 2 | Before `idle.jpg`: ten frames across 1.5 s are near identical (3-9% of pixels change, most of it the Ascended glow). After `idle.jpg`: every standing unit breathes about its feet, leans from foot to foot and dips now and then, each on its own clock (8-13% change); flyers hover. Still the same six drawn idle frames underneath: no head turns, blinks or weapon fidgets. |
| 3 | Walk cycle weight | 2 | 2 | `walk.jpg`: an 8-frame gait paced to ground speed, a start hop and footfall dust; no lean into turns or stop/start settle. Not worked on; unchanged. |
| 4 | Attack anticipation and follow-through | 2 | 2 | `melee-hit.jpg`, `big-hit.jpg`: wind-up frames, a crouch and a lunge are there but small next to the hit effects, so the blow reads more from the flash than from the body. Not worked on; unchanged. |
| 5 | Hit feedback | 2 | 2 | `big-hit.jpg`: white flash, 3-frame hit-stop, impact star, crit number that pops, draining HP bar; knockback is a few pixels. Shots now throw sparks back where they land (`ranged-shot.jpg` +14f), which is not enough for a 3. |
| 6 | Death | 2 | 2 | `death.jpg`: fall frames, then a white poof with chunks; the same poof for every kind and nothing is left behind. The last body of a round now finishes its fall in slow motion instead of freezing mid-fall; otherwise unchanged. |
| 7 | Deploy / spawn entrance | 2 | 2 | `deploy-drop.jpg`: drop from height with a growing shadow, a light column, landing squash and a dust ring. Not worked on; unchanged. |
| 8 | Projectiles | 1 | 2 | Before `ranged-shot.jpg`, `lobbed-shot.jpg`: arrows are 2-3 px slivers, the shell a dark dot that is hard to find, landings leave only the number. After: shots are about 60% larger with a comet tail in the shooter's colour (`ranged-shot.jpg` +3f, +6f), sparks and a ring where they land (+14f); lobbed shots swell at the top of the arc over a shrinking shadow, leave a steady smoke trail and show a tightening team ring where they will land (`lobbed-shot.jpg`). The arrow and shell sprites themselves are the same small drawings. |
| 9 | Ability casts read as events | 2 | 2 | `ability-cast.jpg`: cast clip, gold rays and ring, a named ribbon; every ability gets the same burst. Not worked on; unchanged. |
| 10 | Keep damage and destruction | 2 | 2 | `keep-damage-collapse.jpg`: four damage states, the march, the fall to rubble and the winner's flag; during the fight itself the keep never reacts. Not worked on; unchanged. |
| 11 | Ambient arena life | 1 | 2 | Before `ambient-arena.jpg`: nothing in the arena moves (act 1; only acts 7-10 had any ambient motion, outside the board). After `ambient-arena.jpg`: all ten arenas have their own mix of cloud shadows crossing the ground, wind gusts, motes (pollen, leaves, petals, snow, ash, embers, fireflies), butterflies and a flock that crosses with shadows (frames +0 to +180). The scenery itself is still a baked picture: trees, grass and banners do not sway, and there is no water motion outside the Fen. |
| 12 | UI motion | 1 | 2 | Before `home-idle.jpg`: the home is a still picture (0.6-1.2% of pixels change over 2.3 s) and buttons only shift 3 px on press. After `home-idle.jpg`: the key art drifts, clouds and a flock cross its sky, pollen rises, the Battle button breathes and takes a light sweep (1.9-3.9%); the tab's pieces pop in one after another; every button, chip and mode card squashes on press and springs back past rest. The figures in the key art are still frozen mid-swing. |
| 13 | Reward ceremonies | 2 | 2 | `chest-wait.jpg`, `chest-open.jpg`, `chest-summary.jpg`: the chest wiggles, its lid flies off, cards flip out by rarity, coins and gems fly to the counters, which count up; `card-upgrade.jpg` has a banner, sheen and counting stats; `victory.jpg` stamps its stars and is still by 1.7 s. Not worked on; unchanged. |
| 14 | Camera and screen-level juice | 2 | 3 | Before `final-blow.jpg`: rays and confetti over a locked camera (the "0.35x" finish in the code slowed nothing: the sim had already stopped). After `final-blow.jpg`: the last blow runs at 0.3x for half a second while the camera pushes in 14% on where the last body fell (frames +6 to +50) and eases back out, on top of the existing trauma shake and hit-stop; quakes, a falling colossus and a griffin landing punch the camera in briefly. This is the least certain grade on the card: it is judged from frame strips, not from a phone in the hand. A stricter reader would hold it at 2 (28 / 42). |

**Correction to the first baseline.** The baseline was first committed as 23 / 42 with reward ceremonies at 1, on the
claim that nothing flies to the counters. That was wrong: `chest-summary.jpg` shows coins and gems flying to the counters and
counting up. The baseline for criterion 13 is 2 and the baseline total 24.

Raised a full point: 2, 8, 11, 12, 14. Not raised: the other nine.

## What still holds the score down

The three weakest areas now, and what each needs:

1. **Attack anticipation and follow-through (2), with walk weight (2) and death (2).** The clips are 6-8 frames a facing.
   Code already adds the crouch, lunge, squash and hit-stop it can; what is missing is drawn motion: longer wind-ups with
   the weapon trailing, a held follow-through, a turn-in-place, kind-specific deaths (a ragdoll tumble, armour
   scattering). That is new rendered animation (a Blender re-render of the atlases with more frames per clip), not code.
2. **Ambient arena life (2) and keep reactions (2).** The arenas are single baked pictures, so nothing in the scenery
   itself can move. Swaying trees and grass, fluttering banners, flowing water and a keep that flinches, cracks and
   sheds stones when struck during the fight need the scenery re-rendered as layers or short loops (art), then a small
   amount of code to play them.
3. **Reward ceremonies (2) and ability casts (2).** The chest is a small flat icon with a lid; the victory screen has
   no character on it; every ability shares one gold burst. These need illustrated art: a large chest with an opening
   animation, a victory pose for the commander or army, per-ability effect sheets. All of it also needs **audio**: the
   game has only a small set of synthesised effects, and a chest, a level-up or a final blow in Clash Royale lands as
   much through its sound as its motion. No sound was added or changed this round.

Unit readability (2) is the other one: the far-keep pile-up is a layout question (spacing, scale, or fading the keep),
not a motion one.

## Frame rate

24-unit bench (`node tools/perf.mjs <port> 1 8 1`: 402x874 at 3x, headless Chromium, software raster), baseline and
this branch run back to back from two dev servers, four pairs. The Mac was busy with other work (load average 5-9),
so the pairs are what to compare, not single numbers.

| | Live frame pacing (fps) | Frame gaps over 18.2 ms | CPU ceiling (sync fps) |
|---|---|---|---|
| Baseline 34dd9dc | 58.6 - 58.9 | 0.8 - 1.3% | 116 - 144 |
| This branch | 58.1 - 59.0 | 1.0 - 5.1% | 108 - 138 |
| Quietest pair (load 4.9) | 58.7 vs 59.0 | 1.1% vs 1.0% | 143.7 vs 138.0 |

Frame pacing is unchanged. The draw costs about 0.3 ms more a frame (4%) in the quietest pair, up to 1 ms in the
noisier ones; the first version of the cloud shadows (soft images) cost over 1 ms on its own and was replaced with flat
path fills. Not measured in the real app on the iOS Simulator this round (`tools/perf-app.mjs`, 56.6-57.3 fps on record
in `outputs/review/perf.md`).

## Not verified

- Nothing was run in WKWebView or on a phone: all captures and the bench are headless Chromium.
- Calm mode (reduce motion): the new motion is switched off by the same flag as the old (unit tests cover the camera
  push and slow motion; the idle, ambient and CSS paths were not looked at with the setting on).
- Ambient life was looked at in acts 1, 3 and 6; the other seven arenas only by the unit test that every arena has a mix.
- Battle speed 2x and 3x with the slow-motion finish were not captured.
