# Muster: Tactics: App Store listing

Generated from `store/metadata.json` by `npm run release:config` (name, version and URLs come from `app.config.json`). Edit those, not this file. Copy each block into App Store Connect as is.

## Name

```
Muster: Tactics
```
15/30. Home-screen name under the icon: **Muster** (`displayName` in app.config.json).

Availability, checked 2026-11-06 by searching `https://itunes.apple.com/search?term=<name>&entity=software` (US, AU, GB):

| Name | Status | Note |
| --- | --- | --- |
| Muster: Tactics (chosen) | free (no exact match) | Chosen by Jack. Existing 'Muster' apps are social, lifestyle, education and utility apps, none are games. |
| Muster: Army Battler | free (no exact match) | Says the genre in the name; strong for search. |
| Muster & Clash | free (no exact match) | Echoes the in-game tagline build, place, clash. |
| Muster: Auto Battler | free (no exact match) | Genre term people search for. |
| Musterfield | free (no exact match) | One original word, easy to own. |
| Muster Up: Tactics | free (no exact match) | Fallback if Muster: Tactics is reserved by someone. |
| Muster | TAKEN | Exact matches: Muster (Stalefish Labs, Social Networking) and muster (HATCH COLLECTIBLES, Lifestyle). |

A name someone has reserved in App Store Connect but not shipped won't show up in search; App Store Connect tells you when you create the app record. If it says the name is taken, use the next free option above, put it in `app.config.json` as `storeName` and run `npm run release:config`.

## Subtitle

```
Auto battler army strategy
```
26/30. Alternatives: "Build. Place. Clash.", "Place your army. Watch it win", "Turn-based army battler".

## Promotional text

```
New: a Daily Challenge for everyone, a new act and four new units. Free to start, and one Full Army unlock opens the whole campaign. No ads, no tracking, offline.
```
162/170. Can be changed any time without a new build.

## Description

```
Muster an army. Place it. Watch it fight.

Muster: Tactics is a turn-based army battler for one player. Each round you buy units from a shop of four and place them anywhere on your half of the field. Then you press Fight and the battle plays out on its own. Your units stay on the board and come back every round, so your army grows as the match goes on. Lose a round and your commander takes damage. First commander to zero loses.

28 UNITS, EACH WITH A MIND OF ITS OWN
No grid and no lanes: every unit steers freely and fights its own way. Blade Trios surround a target and slash as a pack. Rangers hold their distance and back off when rushed. Lancers charge straight through a line, wheel round and charge again. Shades cloak, blink behind the weakest enemy and strike. Mines lie buried until someone steps too close. Harriers fly over the melee, Sappers tunnel to the backline, Stormcallers chain lightning through tight formations. Where you place them decides the fight.

EVOLVE THEM. ASCEND THEM.
Rank a unit up from Recruit to Veteran to Elite and it looks tougher and hits harder at every step. From round 5 you can Ascend it: a transformed unit with a signature ability. Whirlwind slashes, Volley arrows, a Revive, Firebombs, Trample charges, Deep Freeze, Shrapnel shells and more. One Ascended ability for every unit, 28 in all.

RIVALS THAT THINK
Rivals plan their own draft and formation, and the toughest ones test their plans against your board before they commit. Buried mines stay hidden from them, so a good trap still springs. In the AI Lab you can tune a rival yourself: difficulty, aggression, tactic (swarm, fortress, artillery, ambush, blitz or siege), economy, rerolls and formation width. Or set two AIs against each other and watch.

FIVE WAYS TO PLAY
• Campaign: 48 levels across eight acts, each act ending in a boss fight. Unlock new units as you go and earn up to three stars on every level.
• Daily Challenge: one board a day, the same for every player. Win it, keep your streak going and beat your best.
• Gauntlet: one health pool against rival after rival. Your army carries over and every win brings a boon.
• Breakpoint: 18 one-battle puzzles against a fixed board with fixed gold. Find the win, then find a cheaper one for the stars.
• Skirmish: any rival, any settings, any starting health.

FREE TO START, FAIR TO PLAY
Download free and play the first two acts of the campaign, the first Breakpoint puzzles, the Daily Challenge and Skirmish, for as long as you like. One purchase, Full Army, opens every act, the Gauntlet and every Breakpoint puzzle for good, and Restore Purchases brings it back on a new iPhone.
Gems are optional. You earn them free from three-star clears, bosses, Daily wins and streaks, and spend them on coins for troop upgrades or a Gauntlet Rally. Gem packs in the Shop speed that up, and every pack says exactly what you get: no subscriptions, no energy, no loot boxes, no random rewards.

PLAYS YOUR WAY
• Short rounds that fit a spare minute, with 2× and 3× battle speed
• Fully offline: no account, no sign-in, no internet needed to play
• No ads, no tracking, no timers
• Your progress stays on your device
```
3175/4000.

## What's New in This Version

```
Daily Challenge: a new board every day, the same for every player, with a streak to keep. Free for everyone.
A new act: Act 8, six new levels and a new boss.
Four new units, each with its own Ascended ability.
Full Army: Muster is now free to start with Acts 1 and 2, Skirmish, the Daily Challenge and the first Breakpoint puzzles. A one-time Full Army unlock opens every act, the Gauntlet and every puzzle. If you already reached Act 3, you keep everything you had, no purchase needed.
Gems: earn them free from three-star clears, bosses, Daily wins and streaks, or buy a pack in the Shop. Spend them on coins for troop upgrades or a Gauntlet Rally.
Sunlit new art across units, arenas and menus.
```
697/4000. App Store Connect only asks for What's New on an update. If 1.0 was never released, this is the first version and the field does not appear: skip it.

## Keywords

```
turn based,wargame,battle,tactical,fantasy,medieval,knights,soldiers,puzzle,offline,commander,war
```
97/100. Comma separated, no spaces after commas, no competitor names, no words already in the name or subtitle (Apple indexes those anyway).

## App information

| Field | Value |
| --- | --- |
| Bundle ID | `co.inflect.muster` |
| SKU | `co.inflect.muster` |
| Version | 1.1.0 (build 1) |
| Primary language | English (U.S.) |
| Category | Games, subcategories Strategy and Casual; no secondary category |
| Price | Free (USD 0.00), all countries and regions. One in-app purchase (Full Army), see store/IAP.md |
| Copyright | 2026 Jack Wakem |
| Content rights | No, it does not contain, show, or access third-party content |
| Support URL | https://muster-tactics.vercel.app/support.html |
| Privacy Policy URL | https://muster-tactics.vercel.app/privacy.html |
| Marketing URL | https://muster-tactics.vercel.app |
| Export compliance | Handled in the binary: ITSAppUsesNonExemptEncryption = NO in Info.plist, so App Store Connect does not ask. |
| Release | Automatically release this version after App Review approval |

## Age rating (expected 9+)

App Store Connect > App Information > Age Rating > Edit. Answer every question with None / No except the one below. If Apple shows a question not listed here, the answer for this game is None / No.

| Question | Answer |
| --- | --- |
| Parental controls / age assurance in the app | No |
| Unrestricted web access | No |
| User-generated content | No |
| Messaging and chat | No |
| Advertising | No |
| Profanity or crude humor | None |
| Horror or fear themes | None |
| Alcohol, tobacco, or drug use or references | None |
| Medical or treatment information | None |
| Health or wellness topics | No |
| Mature or suggestive themes | None |
| Sexual content or nudity | None |
| Graphic sexual content and nudity | None |
| Cartoon or fantasy violence | **Infrequent/Mild** |
| Realistic violence | None |
| Prolonged graphic or sadistic realistic violence | None |
| Simulated gambling | None |
| Gambling (real money) | No |
| Contests | None |
| Loot boxes | No |

Battles are top-down fantasy units (swords, bows, bombs, lightning) knocking each other out: no blood, no gore, no realistic people. Infrequent/Mild cartoon or fantasy violence maps to 9+.

## In-app purchase

One non-consumable: **Full Army** (`co.inflect.muster.fullarmy`), USD 4.99 (United States base price; let Apple set the other storefronts from it). Every field to enter in App Store Connect is in `store/IAP.md`.

Plus 5 consumable gem packs (`co.inflect.muster.gems.*`): 80 Gems US$0.99, 450 Gems US$4.99, 1,000 Gems US$9.99, 2,200 Gems US$19.99, 6,000 Gems US$49.99. Also in `store/IAP.md` (section 4). Restore Purchases covers the Full Army only; consumables can't be restored.

## App Privacy

**Data Not Collected.** App Privacy > Get Started > 'Do you or your third-party partners collect data from this app?' = No, we do not collect data from this app. Then Publish. Still true with the Full Army purchase: Apple takes the payment outside the app, and the unlock is checked and remembered on the device only. Apple's rule: data processed only on device is not 'collected' (https://developer.apple.com/support/app-privacy-on-the-app-store/). No tracking. No third-party SDKs (StoreKit is Apple's own). No analytics, ads or crash reporting.

## App Review information

Sign-in required: **No** (untick "Sign-in required").

Contact: Jack Wakem, jackwakem@gmail.com, phone (fill in: your mobile with country code).

Notes:

```
Muster: Tactics is a single-player strategy game. No account or sign-in, no ads, no tracking. The game itself never uses the network; the only network use is Apple's own purchase sheet (StoreKit 2).

Free: Campaign Acts 1 and 2, the Daily Challenge, Skirmish (AI Lab) and the first Breakpoint puzzles.
In-app purchase: one non-consumable, Full Army (co.inflect.muster.fullarmy). It opens every campaign act, the Gauntlet and all Breakpoint puzzles. Players who had already reached Act 3 before this version keep that access without buying.

Also five consumable gem packs (co.inflect.muster.gems.pouch, .sack, .coffer, .trove, .hoard). Gems are a premium currency spent on coin bundles (troop upgrades) and a once-per-run Gauntlet Rally. Each pack gives a fixed, stated number of gems; nothing in the game gives random paid rewards. Gems are also earned free by playing. Restore Purchases restores the Full Army only: consumables are used up and cannot be restored, and the Shop says so. Gem packs: title screen > Shop, below Full Army.

To test the purchase with a sandbox account: on the title screen tap Shop, then tap the Full Army price button and confirm. The price shown comes from the App Store. You can also tap Campaign and open Act 3: the locked act card offers the same purchase. Restore Purchases is on the Shop screen.

How to play: tap Campaign, then level 1. Drag a unit card from the shop at the bottom onto your (lower) half of the board and tap FIGHT; the battle plays itself, and winning rounds brings the rival's health to zero.
Daily Challenge and Skirmish are open from the title screen for everyone.
```

## Screenshots

iPhone 6.9" display (1320 x 2868 portrait). iPhone only, so no iPad screenshots. Apple scales these down for smaller iPhones. Upload in this order from `store/screenshots/`:

1. `01-battle.png`
2. `02-deploy.png`
3. `03-ascended.png`
4. `04-campaign.png`
5. `05-breakpoint.png`
6. `06-ai-lab.png`

Re-shoot after art changes: `npm run dev` in one terminal, then `npm run store:shots`.
