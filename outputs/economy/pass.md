# War Pass, daily quests and special offers

Code: `src/progression/pass.ts`, `quests.ts`, `passEvents.ts`; store: `src/store/pass.ts`, `offers.ts`, `consumable.ts`; UI: `src/ui/pass.ts`, `gemshop.ts` (offers). Tests: `tests/pass.test.ts`, `tests/passStore.test.ts`.
Rule: free to play, every level open. Nothing here changes a battle; purchases only get a player there faster.

Gem values below use the existing exchange rates: coins at 10 a gem (coin bundles), cards at the daily-deal coin price (common 15, rare 120, epic 900, legendary 6,000 coins) / 10, chests at their Shop gem price (Gilded 80, Royal 180, Legend 400; Iron, not sold, counted at 40).

## Season

- 30 days, numbered from a fixed epoch: Season 1 starts 1 Nov 2026 00:00 UTC (`SEASON_EPOCH`). Same season worldwide.
- Names and themes rotate: Blossom March, The Gilded Crown, Frostwatch, Ember Road, Shadow Muster.
- 30 tiers, **120 XP a tier** (3,600 XP for the season).
- A new season resets XP and claims. Premium is per season. Unclaimed rewards from an old season are not carried over (see Unfinished).

## Pass XP sources

| Source | XP | Notes |
| --- | --- | --- |
| Daily quest | 40-80 each, average 51.6 | three a day, average **155 XP/day** if all three are done |
| Stars or crowns from a win | 5 each | campaign stars, Bastion stars, 2 per Gauntlet rival or Skirmish win; **capped at 100 XP/day** (20 crowns) |
| Tier skip | fills the current tier | `ceil(50 x XP still needed / 120)` gems: 50 gems for a whole tier, less when part-filled |

## Daily quests

Three a day, three different kinds, seeded by the local date (same for everyone that day, like the daily deals). Tap to claim. Finished-but-unclaimed quests are paid automatically the next day.

| Kind | Targets | Coins | XP |
| --- | --- | --- | --- |
| Win N battles | 2 or 3 | 120 / 150 | 50 / 65 |
| Earn N stars or crowns | 6 or 9 | 150 / 190 | 60 / 75 |
| Upgrade a unit | 1 or 2 | 100 / 130 | 40 / 50 |
| Open a chest | 1 or 2 | 100 / 130 | 40 / 50 |
| Play Bastion | 1 | 120 | 50 |
| Play the Daily Challenge | 1 | 100 | 40 |

Average over a year of seeds: **128 coins and 52 XP a quest; 383 coins and 155 XP a day** with all three done.

## The two tracks

| | Free | Premium |
| --- | --- | --- |
| Coins | 3,700 | 7,100 |
| Gems | 40 | 410 |
| Chests | 3 Iron, 3 Gilded, 1 Royal | 3 Gilded, 3 Royal, 1 Legend's Reliquary |
| Cards | 80 common, 18 rare, 3 epic | 30 rare, 9 epic, 4 legendary |
| Cosmetic | **Blossom Keep** (tier 15) | **Gilded Keep** (tier 30) |
| Perk | | chests unlock **20% faster** while Premium is active |
| Worth in gems | **~1,560** | **~5,870** |

- Premium costs US$4.99 (the Sack: 450 gems). The premium track alone is worth about **13x** its price in gem terms, and it gives back 410 gems, close to the price. Clash Royale's Pass Royale is in the same range.
- Premium is retroactive: buying it at tier 12 makes premium tiers 1-12 claimable at once.
- Card rewards go to a specific unit, never a random one: the found unit of that rarity with the fewest spare cards. If a player can't find any unit of that rarity yet (legendaries early on), it drops a rarity at the same coin value (1 legendary = 7 epic cards).
- A keep skin already owned pays 60 gems (Blossom) or 150 gems (Gilded) instead.
- Chest rewards open with the usual chest sequence; their odds are the chest's own table (tap a chest on the track).
- A second Premium bought in a season it's already active in (only possible through a late Ask to Buy, since the app refuses the buy) pays 450 gems.

## How fast it fills

| Player | Plays | Quests done | Crowns a play day | XP a day | Tier 15 (Blossom) | Tier 30 |
| --- | --- | --- | --- | --- | --- | --- |
| Engaged | every day | all 3 | 20+ (cap) | 255 | day 7 | **day 14** |
| Regular | every day | 2 of 3 | 10 | 153 | day 12 | **day 24** |
| Casual | 4 days a week | 1-2 | 6 | 61 | **day 29** | tier 15 by season end |

The engaged player finishes in two weeks, the regular player inside the season, and the casual player just reaches the free Blossom Keep. Finishing a tier with gems costs at most 50 gems, so a casual player 2 tiers short pays about 100 gems.

## Special offers

2 or 3 bundles at a time, rotating every 2 days from the season epoch (`OFFER_WINDOW_MS`), the same for everyone: always one small (t1/t2) and one big (t3/t4). Each is buyable once while it's up. Contents are fixed and shown before buying; the cards are for a named unit (picked by the offer's seed from units the player can find, dropping a rarity at equal value if none); the chest's contents are random with its odds behind the Odds button.

| Tier | Product | US$ | Bundles | Contents | Worth in gems | Same money in gem packs | Shown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| t1 | `co.inflect.muster.offer.t1` | 1.99 | Scout's Satchel | 200 gems, 2,000 coins, 30 common cards, Gilded Chest | 525 | 161 | 3x |
| t1 | | 1.99 | Recruit's Purse | 180 gems, 2,200 coins, 3 rare cards, Gilded Chest | 516 | 161 | 3x |
| t2 | `.t2` | 4.99 | Captain's Bundle | 700 gems, 5,000 coins, 12 rare cards, Royal Hoard | 1,524 | 450 | 3x |
| t2 | | 4.99 | Quartermaster's Crate | 650 gems, 6,000 coins, 1 epic card, Royal Hoard | 1,520 | 450 | 3x |
| t3 | `.t3` | 9.99 | Warlord's Hoard | 1,600 gems, 12,000 coins, 3 epic cards, Royal Hoard | 3,250 | 1,000 | 3x |
| t3 | | 9.99 | Siege Chest | 1,500 gems, 14,000 coins, 3 epic cards, Royal Hoard | 3,350 | 1,000 | 3x |
| t4 | `.t4` | 19.99 | Legend's Cache | 3,600 gems, 25,000 coins, 1 legendary card, Legend's Reliquary | 7,100 | 2,200 | 3x |

"Nx value" is `floor(worth / (price x gems-per-dollar of the biggest gem pack at or below that price))`, from live StoreKit prices when known. Rounded down, so it never overstates. The gems alone in every bundle already beat the same money spent on gem packs; coins, cards and the chest are on top.

## Store products (all consumables)

| Product | US$ | Rule |
| --- | --- | --- |
| `co.inflect.muster.pass` | 4.99 | once per season, app-enforced |
| `co.inflect.muster.offer.t1` / `.t2` / `.t3` / `.t4` | 1.99 / 4.99 / 9.99 / 19.99 | generic tiers; the app decides the bundle |

Every transaction is credited once (txId kept in the save) and saved before StoreKit is told it's finished; pending (Ask to Buy) arrives later through Transaction.updates; an offer bought then approved days later still pays the offer it was for (saved intent).

## Unfinished / to tune

- A season's unclaimed rewards are lost at rollover. Clash auto-claims leftovers; worth adding.
- After tier 30 extra XP is wasted (engaged players finish on day 14). A bonus bank (e.g. 100 coins per extra 120 XP) would keep quests meaningful in the second half.
- The chest UI (`src/ui/chests.ts`, not owned here) still labels unlock times without the Premium 20% perk; the timer itself is right (`unlockMsOf`). Swap `CHESTS[type].unlockMs` for `unlockMsOf(type)` there.
