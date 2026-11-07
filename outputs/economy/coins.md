# Coins and troop levels

Branch `feature/progression`. Code: `src/core/levels.ts` (the sim), `src/progression/economy.ts` (every number on this page), `src/progression/troops.ts` (save + wallet binding), `src/ui/barracks.ts` (Barracks + result-screen coin line). Coins only move through `src/economy/wallet.ts`.

## Shared anchors (the gem store uses the same ones)

| Anchor | Value | Where it shows up |
| --- | --- | --- |
| Coins a free player earns per day of active play | about 1,000 | earn table below |
| Coins to max one unit (level 1 to 10) | 12,000 exactly | `COINS_TO_MAX` |
| Value of 1 gem | about 10 coins | so maxing one unit is worth about 1,200 gems |

None of these changed.

## What a level does

- Every one of the 28 units has a level from 1 to 10. It's kept on the device and carries across matches.
- Each level past 1 adds **3% health and 3% damage** (healing and wards scale with damage), so level 10 is +27%. Spawned bodies (mites, thralls, shardlings, turrets, decoys) use their maker's level.
- **Why 3% and not 5%:** I tried 5% first. In `npm run balance`, one level of gap between a whole army and the foe moved the strong AI's win rate by about 30 points (Act 3: 77% to 46%). A uniform edge compounds, because each unit both lasts longer and hits harder. At 3% the same curve gives the results below.
- Levels stack on top of the in-match ranks (Recruit to Ascended). A level 10 unit is +27%, while an in-match rank 2 upgrade is +65% health, so ranks still matter more than levels.
- At level 1 the multiplier is exactly 1, so a level 1 army is the game as it was. All 281 tests from before still pass unchanged, and there are new tests that check a level 1 battle matches the old one body for body.
- Levels are part of the battle input for each side (`levels` in `BattleOptions` and `MatchConfig`), and the AI's planning sims see them too. The sim stays deterministic.

## Which modes use levels

| Mode | You | Foe |
| --- | --- | --- |
| Campaign | your levels | the whole foe army at the act's curve level (below) |
| Gauntlet | your levels | level 1, then +1 every 4 rivals (rival 5 is L2, rival 9 is L3), never above your cap |
| Skirmish (and AI vs AI watch) | your levels | **mirrored: the rival uses your levels too**. It's an AI lab, so a test stays a like-for-like fight |
| Daily Challenge | always level 1 | always level 1 |
| Breakpoint puzzles | always level 1 | always level 1 |

Daily and puzzles never get levels (`levelsFor()` returns nothing for them, and a test checks this). Everyone plays the same board at the same strength, and the puzzle solver's par values still hold.

## Upgrade costs

| Level | 1→2 | 2→3 | 3→4 | 4→5 | 5→6 | 6→7 | 7→8 | 8→9 | 9→10 | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Coins | 100 | 200 | 400 | 700 | 1,000 | 1,400 | 2,000 | 2,700 | 3,500 | **12,000** |
| Running total | 100 | 300 | 700 | 1,400 | 2,400 | 3,800 | 5,800 | 8,500 | 12,000 | |

The early levels are cheap, so a first win can buy one straight away. The last three levels cost 8,200 of the 12,000.

## Level cap

- **Cap = 2 + acts cleared**, where an act counts as cleared once its boss (level 6, 12, 18 and so on) is won. The cap is 2 at the start and 10 after Act 8.
- The Barracks shows the cap and which boss raises it. A boss first clear that raises the cap says so on the result screen ("Level cap raised to 3!").
- Only units you've met in the campaign can be levelled (`rosterAt(furthest level reached)`). The rest show as locked, with the level that unlocks them.
- **Free tier note:** without Full Army, Acts 3-8 are locked, so a free player's cap stops at **4**. That's another reason to buy Full Army, but it doesn't block anything: Acts 1-2 foes are level 1.

## Earning coins

Losses pay nothing (no farming by forfeit). The hooks sit on the result screens, marked `// [progression]` in `src/main.ts`.

| Source | Coins |
| --- | --- |
| Campaign win | 30 + 8 × act (38 in Act 1, 94 in Act 8) |
| + per star earned in that match | 15 (max 45) |
| + first clear of a level (once) | 100 + 25 × act (125 in Act 1, 300 in Act 8) |
| Replays (wins on a level already cleared) | the win and stars above, **capped at 400 a day** across all replays (`REPLAY_DAILY_CAP`). The win is paid before the stars, so the last replay under the cap pays a partial amount. First clears are never capped and don't count toward it |
| Gauntlet, each rival beaten | 30 + 10 × rival number, max 150 (rival 1 = 40, rival 5 = 80) |
| Daily, scored attempt | win 200, loss 60, plus 10 × streak (max +100). Practice pays 0 |
| Skirmish win | (20 + 60 × rival difficulty) × fairness, where fairness = rival hp / your hp, clamped to 0.25-1. **Capped at 300 a day.** Watch mode pays 0 |

**One-time pot:** clearing all 48 levels pays 10,200 in first-clear bonuses, plus about 5,000 for the wins and stars, so about 15,000 for a first pass.

**A day of active play once the campaign is done (about 1,000):**

| | Coins |
| --- | --- |
| Daily (win, streak about 5) | 250 |
| Two Gauntlet runs to about rival 4 | 2 × 220 = 440 |
| Three campaign replays for stars (Act 5, 3 stars) | 3 × 115 = 345 |
| **Total** | **about 1,035** |

Skirmish can add up to 300. A player without Full Army (Daily, Skirmish and Acts 1-2 replays) gets about 250 + 300 + 4 × 90 ≈ 900.

## The expected free-player curve, and the campaign foe levels

This models a free player (no gems bought) on a first pass. They clear an act in about 1.5 days, play the Daily, a little Skirmish, and the act's six levels (first clears, about 2.3 stars each). They spread their coins over the army they use most:

| Reaching act | Coins earned so far | Per unit, over 6 units | Affordable level (under the cap) | Cap | **Foe level (`EXPECTED_LEVEL_BY_ACT`)** |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 0 | 1 | 2 | **1** |
| 2 | 1,785 | 298 | 2 | 3 | **1** |
| 3 | 3,768 | 628 | 3 | 4 | **2** |
| 4 | 5,949 | 992 | 4 | 5 | **3** |
| 5 | 8,328 | 1,388 | 4 | 6 | **3** |
| 6 | 10,905 | 1,818 | 5 | 7 | **4** |
| 7 | 13,680 | 2,280 | 5 | 8 | **4** |
| 8 | 16,653 | 2,776 | 6 | 9 | **5** |

Campaign foes field their whole army at **one level below** what that six-unit player can afford. That allows for coins spread over more units and for units that join the roster late at level 1. Acts 1-2 stay at level 1, so the free tier plays exactly as tuned.

- A player who keeps upgrading stays on or a little ahead of the curve, and the campaign plays as tuned.
- A player who never upgrades meets foes up to +12% stronger by Act 8.
- A player at the cap (level 9 in Act 8) is about +11% stronger than the foe there (1.24 against 1.12).

## Time to max (free player, no gems)

| Goal | Coins | Time |
| --- | --- | --- |
| One unit to level 4 (the free-tier cap) | 700 | under a day |
| One unit to level 10 | 12,000 | about 12 days at 1,000 a day, but level 10 needs Act 8 cleared first. After the campaign pot that's about **day 10-12** |
| A core army of 6 units to level 10 | 72,000 | about 15,000 from the campaign, then about 57 more days, so **about 2 months** |
| All 28 units to level 10 | 336,000 | **about 11 months** |

For the gem store, at 10 coins a gem: one unit's next level costs 10-350 gems, and maxing one unit costs 1,200 gems.

## Balance results

`npm run balance` takes troop levels now:

```
FOE_LEVEL=act                  foes at the campaign curve (or a number)
PLAYER_LEVEL=expected|cap|<n>  the player's whole army at the expected curve, at the cap for that act, or level n
```

Both default to 1, which is the game as it was tuned. `tools/gauntlet.ts` also takes `PLAYER_LEVEL` and `GAUNTLET_LEVELS=1`. Run on Acts 3, 5 and 8 (18 levels, N=8 seeds per player AI, strong 0.9 and mid 0.5). The targets are the tool's own: strong wins at least 50% of each level (40% on bosses), and mid falls off act by act.

| Setup | Player / foe level (Act 3, 5, 8) | Act 3 strong / mid | Act 5 strong / mid | Act 8 strong / mid | Levels under target (strong) |
| --- | --- | --- | --- | --- | --- |
| Everyone level 1 (as tuned; identical to main) | 1/1, 1/1, 1/1 | 77% / 67% | 73% / 71% | 71% / 50% | none |
| On the curve: player at the expected level, foe at the curve | 2/2, 3/3, 5/5 | 75% / 65% | 79% / 63% | 73% / 44% | none |
| Never upgrades: player level 1, foe at the curve | 1/2, 1/3, 1/5 | 79% / 54% | 50% / 46% | 33% / 29% | L18 38%, L25 25%, L28 25%, L29 38%, L43 38%, L44 25%, L45 25%, L47 38%, L48 25% |
| Maxed: player at the cap, foe at the curve | 4/2, 6/3, 9/5 | 85% / 88% | 92% / 85% | 92% / 77% | none |
| (first try, +5% a level) Never upgrades | 1/2, 1/3, 1/5 | 46% / 44% | 35% / 25% | 23% / 8% | L13 38%, L14 38%, L17 38%, L18 13%, L25 38%, L26 38%, L28 13%, L30 25%, L43 13%, L44 25%, L45 38%, L46 38%, L47 25%, L48 0% |

What the table shows:
- **Level 1 is unchanged.** I ran `LEVELS=14,30 N=3` on `main` (631eb4d) and on this branch, and every match result (win, stars, rounds, hp, losses) is identical. The level 1 row is the tool's usual output.
- **On the curve, the campaign plays as tuned.** Every level meets its target, and the act averages sit within a few points of level 1 (Act 8 mid player 44% against 50%, which is within N=8 noise).
- **A player who never upgrades** is fine in Act 3 (foe +3%) but falls well short from Act 5 on (foe +6% to +12%). That's the push to visit the Barracks. A player who spends coins as they come stays on the curve.
- **A player at the cap** has an easier time (85-92% strong win, 2.0-3.0 stars) but doesn't sweep: the Act 3 boss is still 50% and the Act 5 boss 75%.
- **Level 45:** N=8 is noisy. In the first try (+5% a level), the on-curve run showed 13% there, so I re-ran it with N=24 (strong only): 75% at level 1 and 50% on the curve, both on target. In the +3% on-curve run it is 50% (strong), which is on target. Raw outputs are in `outputs/economy/balance/`.
- The tool's "mid win rate rises" check compares the acts it ran. With Acts 3, 5 and 8 only, that's 3 to 5, so a small rise there isn't a real flag. I also fixed it to name the real acts.


## Not done yet / notes

- Campaign replays are capped at 400 coins a day (`REPLAY_DAILY_CAP` in `src/progression/economy.ts`, tracked per day in `progression.replay`). Before the cap, a replay paid the win and that match's stars again with no limit (Act 8, 3 stars: 139 coins), so someone grinding three hours made about 3,500. 400 keeps the day-of-play model above whole (three Act 5 replays = 345) and is about three Act 8 replays. The most a grinder now makes in a day outside Gauntlet is about 400 replays + 300 Skirmish + 300 Daily = 1,000, in line with the 1,000-a-day anchor. Gauntlet runs are still uncapped.

- The in-match unit popover shows the unit's real health and damage at its rank and troop level (`unitStats` / `statsLine` in `src/ui/game.ts`) with a "Lv N" badge.
- Gauntlet rival levels, checked with `tools/gauntlet.ts` (6 runs, strong AI, player at level 1, so the worst case): rivals beaten were 0 0 3 6 15 16 (mean 6.7) without rival levels and 0 0 3 6 14 15 (mean 6.3) with them. The median is 6 both ways, so the effect is mild. That's only 6 runs, so it's a sanity check, not tuning.
- The Barracks header uses the shared currency pill (`currencyPill()` in `src/ui/currency.ts`), the same one as the title and Shop.
- Fixed: the Gauntlet boon sheet's "Rival N beaten · health left" kicker used to sit under the ribbon (the shared `.results .ribbon` pull-up). The sheet now leads with the ribbon and puts the kicker below it, with a `.boons`-scoped margin, so the shared CSS is untouched.

## Screens

They're in `outputs/review/progression/`, shot at 390x844 @2x. Re-shoot with `PORT=<vite port> node tools/progression-shots.mjs`.

- Barracks: `barracks-normal.png`, `barracks-upgrade.png` (the level-up moment), `barracks-after-upgrade.png`, `barracks-capped.png`, `barracks-max.png`, `barracks-short.png`, `barracks-get-coins-to-shop.png`, `barracks-locked.png`
- Result screens: `result-coins.png` (Act 1 boss, first clear, cap raised) and `gauntlet-coins.png`
- Elsewhere: `title-barracks-badge.png` and `level-sheet-foe-level.png`
