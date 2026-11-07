# Troop progression: cards + coins, commander level, the Army

Branch `feature/army`. Code: `src/core/levels.ts` (the sim's level curve), `src/progression/economy.ts` (every number
on this page), `src/progression/troops.ts` (save binding, upgrades, XP, migration, reward hooks),
`src/progression/collection.ts` (found units and spare cards, the shared contract), `src/ui/army.ts` + `army.css`
(the Army screen, result lines, defeat hint). Tools: `tools/balance.ts`, `tools/progression-pace.ts`,
`tools/army-shots.mjs`. Shots: `outputs/review/army/`.

Nothing here is behind a paywall. Every level is reachable by playing; coins and gems only get you there faster.

## What a level does

| | |
|---|---|
| Levels | 1-12 (`MAX_LEVEL`) |
| Per level | **+8% health and damage** (`LEVEL_STEP`), healing too; spawned bodies (mites, thralls) share their maker's level |
| Level 12 | +88% |
| Level 1 | multiplier exactly 1: a level-1 army is the game as tuned (tested body for body) |
| Daily, Breakpoint puzzles | always level 1 for both sides, and no commander keep bonus (tested) |

8% is big on purpose: a level is felt, and a level behind is a real handicap (see the balance numbers below).

## Upgrade costs (cards + coins, Clash Royale style)

Cards to go from level L to L+1 (`UPGRADE_CARDS`). Rarer units need fewer cards because their cards are scarcer
(campaign bundles pay a rare 50%, an epic 20% and a legendary 10% of a common's count).

| Rarity | 1>2 | 2>3 | 3>4 | 4>5 | 5>6 | 6>7 | 7>8 | 8>9 | 9>10 | 10>11 | 11>12 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Common | 2 | 4 | 8 | 15 | 25 | 40 | 60 | 90 | 130 | 180 | 250 | **804** |
| Rare | 1 | 2 | 4 | 8 | 12 | 20 | 30 | 45 | 65 | 90 | 125 | **402** |
| Epic | 1 | 1 | 2 | 3 | 5 | 8 | 12 | 18 | 26 | 36 | 50 | **162** |
| Legendary | 1 | 1 | 1 | 2 | 3 | 4 | 6 | 8 | 11 | 15 | 20 | **72** |

Coins per level for a common (`UPGRADE_COINS`); rarer units cost more (`RARITY_COINS`: rare x1.25, epic x1.5,
legendary x2, rounded to 10).

| | 1>2 | 2>3 | 3>4 | 4>5 | 5>6 | 6>7 | 7>8 | 8>9 | 9>10 | 10>11 | 11>12 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Common | 30 | 60 | 120 | 240 | 400 | 650 | 1,000 | 1,500 | 2,100 | 2,900 | 3,800 | **12,800** |
| Legendary | 60 | 120 | 240 | 480 | 800 | 1,300 | 2,000 | 3,000 | 4,200 | 5,800 | 7,600 | **25,600** |

A legendary is the hardest to max: 72 of the rarest cards and twice the coins.

## Commander level (the player's level)

| | |
|---|---|
| Levels | 1-13 (`MAX_COMMANDER`) |
| XP to reach level 2..13 (total) | 20, 60, 140, 280, 500, 800, 1,200, 1,700, 2,400, 3,300, 4,500, 6,000 (`COMMANDER_XP`) |
| XP per upgrade, by the level reached | L2 4, L3 6, L4 10, L5 16, L6 25, L7 40, L8 60, L9 90, L10 130, L11 180, L12 250 (`UPGRADE_XP`) |
| XP per win | campaign first clear 15 (boss 30), campaign replay 3, Gauntlet rival 8, Skirmish win 3 (`WIN_XP`) |
| **Troop level cap** | **commander level + 1** (2 for a new player, 12 at commander 11) (`levelCap`), replacing "2 + acts cleared" |
| Keep health | **+8 per commander level past 1** (`KEEP_HP_PER_LEVEL`), on your side only, in the campaign and the Gauntlet. Set through the match config's `hp`; no change to `src/core` |

The title shows a commander chip (level + XP bar); the Army shows the commander plate (level shield, XP bar, current
troop cap and keep bonus). An upgrade that crosses a threshold plays the commander level-up moment (full-screen
shield, rays, "Troop cap Lv N", "Keep +8 health"); a campaign/Gauntlet win that does so says it on the result line too.

## Collection: found units and cards

- Units must be **found** before they can be upgraded (`isFound`). Unfound units show in the Army as silhouettes with
  their rarity frame.
- A new save starts with 4 commons found: Blade Trio, Ranger, Mine, Medic (`STARTER_KINDS`).
- Every campaign win grants cards through `grantCards` (`campaignCards`): a **first clear** finds the units that level
  introduces (plus a few spares) and pays a bundle of `2 + 0.75 x act²` cards to two units of the level's roster; a
  **replay** pays `1 + 0.3 x act²` to one. Rarity shares scale the bundle (rare 50%, epic 20%, legendary 10%).
  The bundle grows with the act squared because late levels need far more cards and the roster is wider.
- The result screen shows the coins, the cards won (portraits in rarity frames, xN) and the commander XP.
- Chests and shop offers (another agent) feed the same `grantCards`.

## The gate: campaign foe levels and the recommended level

Campaign foes field their whole army at `EXPECTED_LEVEL_BY_ACT`:

| Act | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Foe level (= recommended level) | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| Foe stat edge over a level-1 army | 0 | +8% | +16% | +24% | +32% | +40% | +48% | +56% | +64% | +72% |
| Old curve (3%/level) | 1 (0) | 1 (0) | 2 (+3%) | 3 (+6%) | 3 | 4 | 4 | 5 (+12%) | | |

Acts 9-10 (The Saltwind Coast, Crownfall Citadel) continue the curve one level an act, under the level cap of 12;
their balance at expected pace is in `acts9-10.md`.

- Every level card shows **"Recommended Lv N"** (red when your army is more than half a level under it).
- Your army's level for a level is the average of your **best 8 found units in that level's roster** (`armyLevelOf`).
- On a campaign defeat with the army under-levelled, the result sheet shows **"Your army is under-levelled"** with your
  average vs the recommended level and an **Army** button.
- Gauntlet rivals start at level 1 and gain one every 3 rivals, never above your troop cap. Skirmish fields your levels
  on both sides (a like-for-like AI lab), and neither side gets a keep bonus.

## Free-play pace (`tools/progression-pace.ts`)

A player who never pays, plays the campaign once (plus the stated replays), earns ~120 coins a campaign level from
the other modes (a scored Daily ~230 + Skirmish up to 300 + Gauntlet over a day of ~6 levels) and upgrades greedily.
**No chests counted** (another agent), so this is a floor. Levels are at the end of each act.

No replays:

| Act | Commander | Cap | Foe | Best-8 avg | min | max | Found | Coins left |
|---|---|---|---|---|---|---|---|---|
| 1 | 4 | 5 | 1 | 3.4 | 2 | 4 | 5 | 1,098 |
| 2 | 5 | 6 | 2 | 3.6 | 2 | 5 | 8 | 2,204 |
| 3 | 6 | 7 | 3 | 4.4 | 3 | 5 | 10 | 3,178 |
| 4 | 6 | 7 | 4 | 5.0 | 4 | 6 | 12 | 3,250 |
| 5 | 7 | 8 | 5 | 5.6 | 5 | 6 | 12 | 2,410 |
| 6 | 8 | 9 | 6 | 6.3 | 6 | 7 | 18 | 458 |
| 7 | 9 | 10 | 7 | 6.3 | 6 | 7 | 28 | 64 |
| 8 | 9 | 10 | 8 | 6.4 | 6 | 7 | 28 | 8 |

Two replay wins per level: Acts 1-8 best-8 avg 3.6, 3.8, 4.9, 5.6, 6.1, 6.4, 6.4, 6.4.

Reading it: campaign income alone keeps a free player at or ahead of the foe through Act 6, and about one level
behind in Acts 7-8 (card-bound for commons at 7>8, coin-bound for rares). That last level comes from chests, the
Daily and the Gauntlet, which is where Clash Royale puts it too. The commander cap is never what stops a free player.

## Balance (`npm run balance`, one job at a time, 4 workers, `nice -n 10`)

Levels 9, 12 (Act 2), 15, 18 (Act 3), 21, 24 (Act 4), 33, 36 (Act 6), 45, 48 (Act 8); N=6 seeds per player, so each
cell is 6 games (17% steps). Raw output in `outputs/economy/balance/expected.txt`, `under.txt`, `behind.txt`.

Strong (0.9) / mid (0.5) player AI win rate by act:

| Player army vs foe at the curve | Act 2 | Act 3 | Act 4 | Act 6 | Act 8 |
|---|---|---|---|---|---|
| **Expected pace** (`PLAYER_LEVEL=expected`, parity) | 67% / 83% | 67% / 33% | 67% / 42% | 58% / 33% | 58% / 42% |
| **Under-levelled** (`PLAYER_LEVEL=1`, never upgrades) | 42% / 58% | **0% / 8%** | **0% / 0%** | 0% / 8% | 0% / 0% |
| **One level behind** (`PLAYER_LEVEL=behind`) | 42% / 58% | 42% / 33% | 25% / 33% | 33% / 17% | 42% / 8% |

- At the expected pace both sides are at the same level, so the campaign plays as tuned (the level-1 tuning run had
  strong at 71-77% by act on N=8; these N=6 cells are within noise of it). Note the expected run started before the
  curve's last two values moved from 8/9 to 7/8, so its Act 8 rows are L9 v L9: parity either way.
- **An army left at level 1 stalls at the Act 2 boss / start of Act 3** (strong 17% on the Act 2 boss, 0% from Act 3
  on): upgrades are the gate. That's a little earlier than "Act 3-4"; the first Act 3 level is where a level-1 army
  stops winning.
- **One level behind** (L1 v L2 in Act 2 ... L7 v L8 in Act 8) roughly halves the strong player's win rate (25-42%)
  and the mid player's falls to 8-33% from Act 3: still winnable with good play, but each upgrade is felt. That is where
  a campaign-only free player sits in Acts 7-8 (see the pace table); chests, the Daily and the Gauntlet close it.

## Deck (stretch, opt-in)

- Up to 8 found units (`DECK_SIZE`), picked from a unit's card in the Army ("Add to deck"); the deck strip sits under
  the commander plate.
- With a deck, your in-match shop offers only the deck units that are in that match's roster (campaign, Gauntlet,
  Skirmish), via the match config's `roster` for your side (`deckRoster`). The foe's shop is untouched.
- If fewer than 4 deck units are in a match's roster (`DECK_MIN`), or there is no deck, the shop offers the whole
  roster as tuned, so a deck of late units never empties an early level and every balance number above still holds.
- Never in the Daily, Breakpoint puzzles or watch mode (tested).

## Migration (old saves, once, at boot: `migrateArmy`)

- Old levels (1-10 at +3%) become the new level with at least the same stats: `1 + ceil((old - 1) x 3 / 8)`, so old 2
  is 2, old 4 is 3, old 10 is 5.
- Found: the starters, every unit met in the campaign (`unlockedKinds`), and any levelled unit.
- Each cleared level back-pays its first-clear cards and commander XP; the old levels' upgrades count as XP too.
- Marked `progression.v = 2`; a migrated save is never touched again.

## Main.ts hooks (all marked `// [progression]`)

Two import lines; the title's commander chip; the "Army" title button with its upgrade-ready badge; the level card's
"Recommended Lv N" tag; the campaign defeat's under-levelled hint (queued after the result sheet); `barracks()` opening the Army (and `?army`, with
`?barracks` kept); `migrateArmy()` at boot. To merge cleanly beside the chests hooks, the old import lines and
`barracks()` keep their names (`src/ui/barracks.ts` re-exports the Army as `barracksScreen`/`barracksLabel`). Reward lines (`attachReward`) now open the Army.

## Not done

- The deck is opt-in and was not balance-tested with the AI (the balance tool plays whole rosters). See the Deck section.
- Chests and shop card offers: the chests agent's (they call `grantCards`).
- `outputs/economy/coins.md` still describes the old coin-only curve; this page supersedes its cost, cap and foe tables.
