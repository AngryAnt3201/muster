# Acts 9-10: balance at expected pace

Acts 9 (The Saltwind Coast, levels 49-54) and 10 (Crownfall Citadel, levels 55-60) take the campaign to 60 levels in
ten acts. The foe curve keeps climbing one level an act (`EXPECTED_LEVEL_BY_ACT` in `src/progression/economy.ts`):

| Act | 8 | 9 | 10 |
|---|---|---|---|
| Foe level (= "Recommended Lv") | 8 | 9 | 10 |
| Foe stat edge over a level-1 army | +56% | +64% | +72% |

The level cap is 12, so a player at the cap still has two levels in hand over the finale's foe.
Chests keep scaling 15% an act to Act 10 (2.35x Act 1, `actScale` in `src/progression/chests.ts`).

## Levels and twists

| Level | Name | Rival | Tactic | Twist |
|---|---|---|---|---|
| 49 | Landfall | Captain Wrack | swarm | the tide: foe +1 gold a round, 2 rocks |
| 50 | Gull Rock | Fowler Hesk | artillery | sea wind: foe bows, outriders, ballistas and harriers +20% damage. `[legendary] griffin` slot |
| 51 | Wreckers' Beach | Mother Gannet | ambush | foe mines stun longer and reach 25% wider, 3 rocks |
| 52 | Undertow | Siltmaster Dree | fortress | the undertow: your army moves 10% slower |
| 53 | Squall Line | Stormcaller Ysolde | balanced | squall: foe attacks and casts 15% faster. `[legendary] tide` slot |
| 54 | **The Saltwind Light** (boss) | Lightkeeper Orrin | artillery | the gale at his back: his army 20% faster, yours 10% slower; sea-stack board, lit lamplighter, two ballistas, outrider, harrier, hookwarden |
| 55 | The Broken Gate | Gatewarden Hollis | fortress | no reroll; foe bulwarks, golems and pikemen +20% health |
| 56 | Ember Stair | Pyre-Sergeant Calder | siege | foe kegs, grenadiers and bombards +20% damage, 3 rocks |
| 57 | Fallen Banners | Banneret Isolde | balanced | foe healing x1.4. `[legendary] lion` slot |
| 58 | Hall of Echoes | Duellist Corvane | blitz | the hall falls at dusk: 14-round limit |
| 59 | Last Light | Chancellor Vesk | siege | foe starts with +6 gold |
| 60 | **Crownfall** (finale) | King Aurel the Last | balanced | the old bosses' tricks at once: brood hives, lantern wards on every soldier, big mines; 7-piece opening board |

After the finale's result sheet, "Continue" shows the ending card (`src/ui/ending.ts`), then the Act 10 map.

## Method

`LEVELS=49,...,60 PLAYER_LEVEL=expected FOE_LEVEL=act PROCS=4 nice -n 10 npm run balance`, i.e. troop level = foe
level (L9 v L9 in Act 9, L10 v L10 in Act 10), one job at a time with 4 workers. Strong = AI difficulty 0.9, mid = 0.5.
Targets (as `tools/balance.ts`): strong wins at least 50% of a normal level and 40% of a boss; mid falls off act by act
(no act's mid average more than 5 points above the act before).
`power` scales the foe's health and damage (the twist column shows it as `foe hp/dmg x`).

## Runs

Seeds are fixed per attempt, so a level's row only changes when its numbers do; the final table takes each level from
the last run at its shipped `power` (N=12 per player, the Act 9 boss N=16).

**Final (shipped values), L9 v L9 in Act 9, L10 v L10 in Act 10**

| Level | power | Strong win | Strong stars | Rounds | Mid win | From |
|---|---|---|---|---|---|---|
| 49 Landfall | 0.95 | 67% | 1.8 | 12.1 | 67% | run 4 |
| 50 Gull Rock | 0.86 | 67% | 1.9 | 11.8 | 58% | run 3 |
| 51 Wreckers' Beach | 1.05 | 75% | 2.2 | 12.7 | 67% | run 4 |
| 52 Undertow | 0.80 | 58% | 1.6 | 13.6 | 42% | run 3 |
| 53 Squall Line | 0.78 | 50% | 1.5 | 12.2 | 33% | run 3 |
| 54 The Saltwind Light (boss) | 0.76 | 75% | 2.1 | 10.0 | 44% | sweep, N=16 |
| 55 The Broken Gate | 0.90 | 58% | 1.8 | 12.8 | 42% | run 3 |
| 56 Ember Stair | 0.86 | 67% | 2.0 | 12.1 | 67% | run 3 |
| 57 Fallen Banners | 1.08 | 83% | 2.3 | 13.0 | 33% | run 3 |
| 58 Hall of Echoes | 1.04 | 75% | 1.9 | 12.5 | 75% | run 4 |
| 59 Last Light | 0.76 | 50% | 1.3 | 12.8 | 33% | run 4 |
| 60 Crownfall (finale) | 0.84 | 50% | 1.5 | 10.6 | 58% | run 3 |

| Act | Strong | Mid |
|---|---|---|
| 8 The Mirelight Fen (reference, same run settings, N=12) | 69% | 49% |
| 9 The Saltwind Coast | 65% | 52% |
| 10 Crownfall Citadel | 64% | 51% |

Every level meets its target (strong >= 50%, bosses >= 40%). Strong eases down act by act (69% -> 65% -> 64%) and mid
holds within the 5-point rule (49% -> 52% -> 51%). The bosses: Lightkeeper Orrin 75% / 44%, King Aurel 50% / 58%.

**How it got there**

| Run | N | What changed | Misses |
|---|---|---|---|
| 1 | 8 | first draft (power 0.75-1.0) | 50 38%, 52 13%, 53 25%, 54 38% (boss), 59 0%; 57 and 58 100/100; mid rose Act 9 -> 10 |
| 2 | 8 | 50 0.86, 52 0.85, 53 0.85, 54 0.74, 57/58 1.08, 59 0.85 and its +1 gold a round dropped, 60 0.8 | 52 25%, 53 38%, 54 38%, 58 38%, 59 38% |
| 3 | 12 | Undertow slow 0.85 -> 0.9 and 0.8, 53 0.78, 54 0.7, 55 0.9, 56 0.86, 58 1.0, 59 0.8, 60 0.84 | 59 42%; Act 9 bosses and openers easy for mid |
| 4 | 12 | 49 0.95, 51 1.05, 54 0.72, 58 1.04, 59 0.76 | none; 54 mid 92% at 0.72 |
| sweep | 16 | 54 at 0.76 (75% / 44%) and 0.80 (50% / 44%): shipped 0.76 | none |

Noise: with N=12 one match is 8 points, and these late boards swing a lot (Hall of Echoes went 100% / 38% / 75% for
power 0.95 / 1.08 / 1.04 at N=8-12), so read single cells as +-15 points. The Act 9 boss is the most volatile: the
speed twist makes the opening clash decide most games.

Raw output: `outputs/economy/balance/acts9-10-run3.txt`, `acts9-10-run4.txt` and `acts9-10-act8-reference.txt`.

## For the lead: the three legendaries

The slots are marked `// [legendary] introduce <kind> here at merge` in `src/core/campaign.ts`: in `UNLOCKS` (ready
lines `[50, "griffin"]`, `[53, "tide"]`, `[57, "lion"]`) and above each level's draft. Each foe is built so the new unit
matters: Gull Rock (50) is a sky of harriers and outriders for the griffin, Squall Line (53) is storm casters and healers
for the tide, Fallen Banners (57) is a healing banner line for the lion. After adding them: `tests/content.test.ts`
expects every unit unlocked once and Acts 9-10 rosters to hold the whole 1.1 army (`rosterAt(48)`), so it keeps passing;
the older line `expect(new Set(LEVELS[47].roster)).toEqual(new Set(UNIT_KINDS))` will need `LEVELS[59]` once the
legendaries are in `UNIT_KINDS`. The store counts regenerate with `npm run release:config`. Re-run `LEVELS=50,53,57` at expected pace, since a new
player unit on those boards will lift the win rate.
