# Chests

The reward loop in the Clash Royale mould. Code: `src/progression/chests.ts` (rules), `src/ui/chests.ts` + `chests.css`
(chest bar, info sheet, opening, result line, Shop component). Tests: `tests/chests.test.ts`.
Shared economy anchors (from `coins.md` / `gems.md`): a free player earns ~1,000 coins a day of active play, maxing one
unit costs ~12,000 coins, 1 gem is worth ~10 coins, and 80 gems cost US$0.99.

Nothing is behind a paywall. Every chest unlocks for free with time; gems only make it faster.

## Slots and the cycle

- A **win** in Campaign, Gauntlet (each rival), Skirmish (vs AI, not Watch) or Bastion drops the next chest in the
  cycle into the first free slot of **4**. Slots full: no chest, a friendly "Slots full · Open a chest to make room"
  line, and the cycle waits (you never skip past a big chest because your slots were full).
- The type is **never random**. A fixed 24-chest cycle repeats:

```
wood wood iron wood gilded wood iron wood wood iron gilded wood
royal wood iron wood wood gilded iron wood wood iron gilded legend
```

| Chest | In cycle | Unlock | Coins (Act 1) | Cards (Act 1) | Gems |
|---|---|---|---|---|---|
| Wooden Crate | 12 / 24 | 15 min | 40 | 6 | 0 |
| Iron Coffer | 6 / 24 | 3 h | 120 | 18 | 0 |
| Gilded Chest | 4 / 24 | 8 h | 350 | 45 | 2 |
| Royal Hoard | 1 / 24 | 12 h | 800 | 110 | 8 |
| Legend's Reliquary | 1 / 24 | 24 h | 1,600 | 220 | 20 |
| Wayfarer's Satchel (free) | every 4 h, bank 2 | at once | 30 | 5 | 0 |
| Crown Casket (daily) | 10 stars/crowns a day | at once | 250 | 30 | 2 |

- Coins roll ±10% (rounded to 5). Coins and cards scale with the act: **x(1 + 0.15 × (act − 1))**, so Act 4 is x1.45
  and Act 8 x2.05. The act is fixed when the chest drops.
- One full cycle: 5,000 coins, 690 cards, 36 gems (Act 1), over **89 hours** of unlock time.
- **One chest unlocks at a time.** Tap a locked slot to start it (when nothing else is unlocking); tap a busy slot for the
  info sheet with odds and Open now. Long-press any slot also opens the info sheet.

### Crowns for the crown chest

Campaign win: its stars (1-3). Bastion win: its stars (1-3). Gauntlet rival beaten: 2. Skirmish win: 2.
10 in a local calendar day opens the Crown Casket once; it resets at local midnight.

## Gem skip: "Open now"

`gems = ceil(10 × hoursLeft^0.8)`, at least 1, 0 when ready. A locked chest costs its full timer.

| Time left | 15 min | 30 min | 1 h | 2 h | 3 h | 4 h | 6 h | 8 h | 12 h | 16 h | 24 h |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Gems | 4 | 6 | 10 | 18 | 25 | 31 | 42 | 53 | 74 | 92 | 128 |

Why this curve: it is concave like Clash Royale's, so a long timer costs less per hour (24 h is 5.3 gems/h, 1 h is
10 gems/h). It only ever falls as the timer runs down (tested). A whole fresh Legend's Reliquary is 128 gems, about
US$1.60 at the Pouch rate: a fair "get there faster", never a wall. Skipping a whole cycle from locked costs ~610 gems.

## Clock

Timers use the device clock, with a high-water mark (`seen`, kept in the save). **Game time is never behind the
latest device time already seen**, so:

- Winding the clock back pauses every timer until real time catches up (nothing speeds up, nothing goes negative).
- A chest's `readyAt` is always `startedAt + unlock`, `startedAt` is game time, so nothing can be ready before it started.
- Setting the clock forward a day to open a chest, then back, leaves game time a day ahead: the next chest costs the
  same day back. (Offline, a forward jump can't be told from real time; this makes it pointless rather than free.)
- The free-chest bank never counts from the future.

## Contents and odds

Contents are rolled **when the chest drops** with a seeded RNG (mulberry32) and stored in the save with the chest.
Reopening the app or the sheet never re-rolls. Free, crown and Shop chests roll the moment they're claimed/bought.

**Which units:** only units the player can find at their progress: everything met in the campaign so far
(`rosterAt(reachedLevel)`), plus any unit already found (a Starter Pack, say). Units the player owns are **4x** as likely
as ones met but not found yet, so most cards go to troops they can level, with a regular chance of a NEW unit.

**Rarity per card** (each card rolls independently, then each rarity's cards go to 1-3 units so the reveal stays a
handful of stacks):

| Chest | Common | Rare | Epic | Legendary |
|---|---|---|---|---|
| Wayfarer's Satchel | 90% | 9.5% | 0.5% | 0% |
| Wooden Crate | 88% | 11% | 1% | 0% |
| Crown Casket | 74% | 21% | 4.5% | 0.5% |
| Iron Coffer | 80% | 17% | 2.8% | 0.2% |
| Gilded Chest | 72% | 22% | 5.4% | 0.6% |
| Royal Hoard | 66% | 25% | 8% | 1% |
| Legend's Reliquary | 60% | 26% | 11% | 3% |

Every row sums to 100% (tested). If the player can't find any unit of a rarity yet (Storm and Golem, the legendaries,
join at levels 19 and 22), that rarity's share goes to the next rarity down, and the info sheet shows these
**effective odds for this player**, still summing to 100%, plus the chance of "at least one" of each rarity in the
whole chest. This is the disclosure Apple requires for randomized items that can be bought or sped up with gems
(App Store Review Guideline 3.1.1). Odds are reachable from every slot, the Shop's "Odds" buttons, and the free/crown
chests when not ready.

## A free player's expected cards per day

Assumptions: one chest unlocking at all times while awake (**engaged**: 16 h of unlock time a day, 4 free chests,
1 crown chest) or about half that (**casual**: 8 h, 2 free chests, 1 crown chest). Act 1 values; multiply by the act
scale (x1.45 in Act 4, x2.05 in Act 8). Wins are not the limit: 4-5 wins a day keep the slots fed.

| Per day | Chests (slots) | Coins | Gems | Common | Rare | Epic | Legendary |
|---|---|---|---|---|---|---|---|
| Engaged | 4.3 + 4 free + crown | ~1,270 | ~8.5 | ~127 | ~35 | ~9.8 | ~1.8 |
| Casual | 2.2 + 2 free + crown | ~760 | ~5.2 | ~75 | ~21 | ~5.6 | ~1.0 |

Per unit, divide by the number of units of that rarity the player has (10 common, 8 rare, 8 epic, 2 legendary in the
full roster; owned units get 4x the share of unowned). Daily deals add up to ~20 commons / 5 rares a day for coins.

Use these to check card costs per upgrade level: e.g. if a common needs 2/4/10/20/50/100/200/400/800 cards to max
(CR-like), an engaged player levelling one common hard gets ~127 × (owned share) a day; with 4 owned commons that's
~30 a day for each, so level 6 (50 cards) every couple of days early and about a month to max one, which is the
"upgrades are the gate" pace. Epics (~10 a day across all epics) and legendaries (~1.8 a day) should need far fewer
cards per level.

## Shop (`chestShop()`)

- **Chests for gems** (open at once, never take a slot): Gilded Chest 80, Royal Hoard 180, Legend's Reliquary 400.
  Each card has an Odds button (the same info sheet). Contents scale with the player's act.
- **Daily deals**: 3-6 specific unit cards for coins, the same for everyone on a local date (seeded by `muster-deals-YYYY-MM-DD`),
  refreshed at local midnight, only units the player can find, at most one epic or legendary a day, each bought once.

| Rarity | Cards per deal | Coins per card | Deal price |
|---|---|---|---|
| Common | 20 | 15 | 300 |
| Rare | 5 | 120 | 600 |
| Epic | 1 | 900 | 900 |
| Legendary | 1 | 6,000 | 6,000 |

## Opening moment

The chest drops from the top and squash-bounces (0.75 s), idles with a wobble and "Tap to open". Tap: the lid flies
off with a flash and rays, the chest drops to the bottom with a cards-left counter, and cards fly out one at a time
(commons first, legendaries last) with the unit portrait, a big count, a rarity tag and glow; epics and legendaries get
a full-screen colour flash. Units found for the first time get a NEW badge. Then coins and gems burst and fly into the
counters, and a summary grid with Collect ends it. Tap advances; tap-and-hold (0.48 s) skips to the summary. All
motion is transforms and opacity (no layout or animated shadows); reduced motion is respected.

The chest is **paid out before the first frame**, so quitting mid-animation never loses anything.

## Hooks

`src/main.ts` and `src/ui/td.ts`, each line marked `// [chests]`: the chest bar on the title (above the menu buttons),
`chestEarned(winChest(crowns))` after the Campaign, Gauntlet rival, Skirmish and Bastion wins, and the
`?chests=title|result|full|info|open|shop` review routes. Review shots: `PORT=5493 node tools/chests-shots.mjs`
writes `outputs/review/chests/`.
