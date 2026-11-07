# Muster gems: the economy model

Branch `feature/gems`. The code is `src/economy/gems.ts` (every number below), `src/economy/rewards.ts`, `src/store/gems.ts` and `src/ui/gemshop.ts`.
The 30-day table comes from `npx vite-node tools/gems-model.ts`, which runs the real earn rules.

## In one paragraph

Gems are an optional premium currency. Free players earn them by playing well: three-star clears, act bosses, Daily wins and streaks, and six achievements. That comes to about 35 a day for the first three days, then 4-8 a day with milestone spikes, and roughly 410 in the first month.
Paying players buy the same gems in five fixed packs. Gems buy coins (for troop upgrades, which are capped by campaign progress) or a Gauntlet Rally.
The Full Army stays cash only. There are no loot boxes, no random paid rewards, no energy, no timers, no ads and no tracking.

## Products (App Store consumables)

| Product id | Gems | US base price | Gems per $ | vs Pouch | Tag |
| --- | ---: | ---: | ---: | ---: | --- |
| `co.inflect.muster.gems.pouch` | 80 | 0.99 | 81 | - | |
| `co.inflect.muster.gems.sack` | 450 | 4.99 | 90 | +12% | |
| `co.inflect.muster.gems.coffer` | 1,000 | 9.99 | 100 | +24% | |
| `co.inflect.muster.gems.trove` | 2,200 | 19.99 | 110 | +36% | |
| `co.inflect.muster.gems.hoard` | 6,000 | 49.99 | 120 | +49% | Best value |
| `co.inflect.muster.fullarmy` (non-consumable, unchanged) | - | 4.99 | - | - | cash only |

**Why this ladder.** I kept the brief's anchor points. Each step adds about 12 points of value (81, 90, 100, 110, 120 gems per dollar), so the bonus is honest and even, and the "+x% more" on each card is true.
The top pack is +49%, not the +100% or more of an aggressive ladder, so the US$0.99 buyer isn't overpaying by much. That keeps it fair rather than bait.
The bonus and the Best value tag are worked out from StoreKit's live `price` on the device, so a storefront with a bent price ladder still tags the right pack. The app never shows a hard-coded price: every button shows StoreKit's `displayPrice`.
How many gems a product gives comes from the app's own catalogue (`GEM_PACKS`), never from store text.

## Earning gems free

| Source | Gems | Notes |
| --- | ---: | --- |
| First three-star clear of a campaign level | 4 | 48 levels, 192 in total (48 in the free acts) |
| First win over an act boss | 20 | 8 bosses, 160 (40 free) |
| First three-star solve of a Breakpoint puzzle | 2 | 18 puzzles, 36 (10 free) |
| Each scored Daily Challenge won | 4 | Repeats every day, about 3 a day at a 75% win rate |
| Daily streak 3 / 7 / 14 / 30 days | 10 / 25 / 40 / 80 | Counted on the best streak, so a reset never pays twice |
| Achievements | 5 to 60 | First Blood 5, Flawless Act 25, Breakpoint (5 puzzles) 15, Regular (10 Daily wins) 25, Gauntlet Runner (5 rivals in a run) 25, Warlord (whole campaign) 60 |

How it's paid: `rewardsOwed()` works out what the save has earned from progress and pays anything not yet in `save.rewards.claimed`. That makes it idempotent: a replay, a crash or a second result screen never pays twice.
Because it's derived from progress, players who were already past these milestones before gems existed are paid once on their first launch.
Rewards show on the result screen as a "+N Gems" strip with the reasons.

## Spending gems

| Sink | Price | What you get | Why it's fair |
| --- | ---: | --- | --- |
| Coin bundle S | 30 gems | 300 coins | 1 gem = 10 coins, the brief's anchor |
| Coin bundle M | 120 gems | 1,300 coins | +8% bulk bonus |
| Coin bundle L | 400 gems | 4,600 coins | +15% bulk bonus |
| Gauntlet Rally | 40 gems | Refight the rival who ended your run, at half health | Once per run, so a best score can't be bought outright. The Gauntlet is a Full Army feature anyway. |

**No pay-to-win cliff.** Coins only buy troop upgrades, and the Barracks agent caps upgrade levels by campaign progress. Money speeds up reaching the cap; it can't take you past it.
Campaign, Daily and Breakpoint boards are fixed, and the Daily score board is the same for everyone. Gems can't buy stars, Daily retries, units or a Full Army.
Other cheap sinks I considered and skipped: a Daily streak saver (it would need changes in `src/core/daily.ts`, outside this stream) and cosmetics (there's no cosmetic system yet).

## 30 days: free vs paying players

Assumptions:
- An active player clears Act 1 on day 1 and Act 2 on day 2, with about one level in three at three stars first time, then re-polishes one level a day.
- They solve the five free puzzles on day 3 and play the Daily every day, winning 3 in 4.
- The Full Army owner clears an act every two days from day 3 (Acts 3-8 by day 13), solves a puzzle a day and reaches Gauntlet rival 6.

Cumulative gems (bought gems in the total; free gems in brackets):

| Day | Free player | Full Army only (US$4.99 on day 1) | Full Army + Sack day 1 + Coffer day 10 (US$19.97) |
| --- | ---: | ---: | ---: |
| 1 | 37 | 37 | 487 (37 free) |
| 2 | 69 | 69 | 519 (69 free) |
| 3 | 104 | 132 | 582 (132 free) |
| 7 | 182 | 270 | 720 (270 free) |
| 14 | 283 | 556 | 2,006 (556 free) |
| 21 | 303 | 604 | 2,054 (604 free) |
| 30 | 411 | 748 | 2,198 (748 free) |

Gems earned each day:
- Free player: 37, 32, 35, then 4-8 a day, with milestone days of 58 (day 7), 44 (day 14) and 84 (day 30). Days 15-30 average 8 a day.
- Full Army owner: 37, 32, 63, then 30-120 on act-clear days until day 14, then about 8 a day.

What that means:
- A free player's first month (about 410 gems) is roughly one Sack (450 gems for US$4.99). Paying US$5 saves a month of play; it doesn't open a different game.
- 410 free gems buy about 4,300 coins (one L bundle) or ten Gauntlet Rallies.
- The US$20 spender has about 2,200 gems, around 24,000 coins. With upgrades capped by campaign progress, most of that only helps once they reach later acts. That's the intended ceiling.
- Early days hit the brief's band of 20-40 a day (37, 32, 35). It then tapers, because one-time rewards run out and only the Daily and milestones keep paying. `tests/gems.test.ts` checks this band and the month total (250-500).

## Apple rules this follows

- **Consumables** (Guideline 3.1.1): gems are bought through StoreKit 2 in-app purchase only. There are no links out and no other payment.
- **No random paid rewards** (3.1.1, loot boxes): every pack and every coin bundle gives a fixed, stated amount. Nothing paid is random.
- **Restore Purchases** applies to non-consumables only. The Shop says so: "Gems are used up when spent, so Restore Purchases can't bring them back: it restores the Full Army only." The review notes say it too.
- **Delivery**: a pack is credited (and saved) before its transaction is finished. A crash in between is picked up from `Transaction.unfinished` on the next launch. `creditPurchase(txId)` makes it impossible to pay twice, even when the buy, `Transaction.updates` and the launch sweep all report the same transaction.
- **Ask to Buy**: the pack shows "Waiting for approval". An approval arrives through `Transaction.updates` (kept until the game is listening) and the gems fly into the counter.
- **Refunds on consumables**: gems already spent aren't clawed back. Apple's refund flow handles abuse.
- **Privacy**: there's no account, no server, no ads and no tracking. The balance lives on the device, so the App Privacy label stays "Data Not Collected".

## Tuning knobs

Every number lives in `src/economy/gems.ts`: `GEM_PACKS`, `EARN`, `STREAK_MILESTONES`, `ACHIEVEMENTS`, `COIN_BUNDLES`, `RALLY_GEMS` and `RALLY_HP`.
Pack prices are set in App Store Connect, and the app reads them live. Gem amounts per product id are set in the app.
**Before shipping**, check `COIN_BUNDLES` against the Barracks' real upgrade costs. They were set on the 1 gem = 10 coins anchor before those costs existed.
