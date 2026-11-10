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

## Baseline (commit 34dd9dc, 10 Nov 2026): 23 / 42

Files are in `outputs/review/scorecard/before/`.

| # | Criterion | Score | Evidence |
|---|---|---|---|
| 1 | Unit readability at phone size | 2 | `mid-battle.jpg`: thick ink, team rings and team-coloured kit read at a glance, but the brawl at the far keep is a pile where single units can't be picked out. |
| 2 | Idle life | 1 | `idle.jpg`: ten frames across 1.5 s are near identical (3-9% of pixels change, most of it the Ascended ground glow); the 6-frame breathing clip is there but too small to see at this size. |
| 3 | Walk cycle weight | 2 | `walk.jpg`: an 8-frame gait paced to ground speed, a start hop and footfall dust under the lancer; no lean into turns or stop/start settle. |
| 4 | Attack anticipation and follow-through | 2 | `melee-hit.jpg`, `big-hit.jpg`: wind-up frames, a crouch and a lunge are there, but they are small next to the hit effects, so the blow reads more from the flash than from the body. |
| 5 | Hit feedback | 2 | `big-hit.jpg`: white flash, 3-frame hit-stop (frames +1 to +3 are held), impact star, crit number that pops, HP bar with a draining segment; knockback is a few pixels. |
| 6 | Death | 2 | `death.jpg`: fall frames, then a white poof with chunks (a blast for the keg); bodies leave nothing behind and the poof is the same for every kind. |
| 7 | Deploy / spawn entrance | 2 | `deploy-drop.jpg`: drop from height with a growing shadow, a light column, landing squash and a dust ring. |
| 8 | Projectiles | 1 | `ranged-shot.jpg`, `lobbed-shot.jpg`: arrows are 2-3 px slivers with a faint trail, the Bombard shell is a dark dot that is hard to find in frames +16 to +40, and an arrow landing leaves only the number. |
| 9 | Ability casts read as events | 2 | `ability-cast.jpg`: cast clip, gold rays and ring, a named ribbon that pops in; every ability gets the same burst. |
| 10 | Keep damage and destruction | 2 | `keep-damage-collapse.jpg`: four damage states with fire and smoke, the survivors march on it, it falls to rubble and the winner raises a flag; during the fight itself the keep never reacts. |
| 11 | Ambient arena life | 1 | `ambient-arena.jpg`: six frames over 1.7 s change 4% of pixels, all of it units and rings; nothing in the arena moves. Only four of the ten arenas (acts 7-10) have any ambient motion, and it sits outside the board. |
| 12 | UI motion | 1 | `home-idle.jpg`: the home screen is a still picture (0.6-1.2% of pixels change over 2.3 s); `home-tab-change.jpg`: tabs slide in, but buttons only shift down 3 px on press with no spring. |
| 13 | Reward ceremonies | 1 | `chest-open.jpg`: flash, rays and a card flip, but the chest is a flat box that never opens and nothing flies to the counters; `victory.jpg`: stars stamp in, then the screen is still by 1.7 s; `card-upgrade.jpg` (banner, sheen, counting stats) is the best of the three. |
| 14 | Camera and screen-level juice | 2 | `final-blow.jpg`: the last blow runs at 0.35x with rays and confetti, plus trauma shake and hit-stop on big hits; the camera never moves in. |
