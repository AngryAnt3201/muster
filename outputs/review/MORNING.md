# Muster 1.1: morning review (7 Nov 2026)

Everything from the overnight run is on `swarm/muster-overnight-polish-the-meadow-build`. It is not merged to `main` and nothing has been sent to Apple.
`npx tsc --noEmit -p .` and `npx vitest run` pass on the merged branch (see "Checks" at the bottom).

## What changed

**Money: free download + one Full Army unlock**
- Free: Campaign Acts 1-2, Skirmish, Daily Challenge and Breakpoint puzzles 1-5.
- **Full Army** (`co.inflect.muster.fullarmy`, non-consumable, US$4.99) opens Acts 3-8, the Gauntlet and puzzles 6-18 for good.
- Anyone whose save already goes past Act 2 keeps everything without paying. A refund takes the unlock back, but this grandfathering is never undone.
- Where players see it: an act-gate card at the start of Act 3 (and every later act), a Full Army sheet when they tap the Gauntlet or a locked puzzle, and a **Shop** button on the title screen. Restore Purchases is on the Shop screen.
- The price comes from StoreKit's `displayPrice`, so no price is hard-coded. In the web/dev build a mock store shows $4.99, and `?store=pending|failed|cancelled|offline` forces each of those states.
- StoreKit 2 runs through a small local Capacitor plugin (`ios/MusterStore`). There's no third-party SDK, no ads and no tracking. `ios/App/Muster.storekit` lets you buy, cancel, Ask-to-Buy and restore in the simulator without an Apple account.
- Version is 1.1.0 (build 1). `store/LISTING.md`, `store/metadata.json` and `site/` no longer say "no in-app purchases". They describe the free tier and the unlock, and the counts (48 levels, eight acts, 28 units) are read from the game code.

**New content**
- **Daily Challenge** (title screen, free). There's one seeded board per local day, the same for every player and fully offline: rival, opening army, shop pool, a rule and an arena. You get one scored attempt plus unscored practice, and the streak and best score are saved on the device.
- **Four new units**, each rendered in Sunlit Meadow (4 tiers, idle/walk/attack/death) and balanced with `npm run balance`:
  - Hookwarden (tank). Chains a back-liner into the line. Ascended: Iron Tether.
  - Thornweaver (caster). Sows brambles in the enemy's path. Ascended: Bramble Crown.
  - Outrider (mounted bow). Circles its prey. Ascended: Running Fire.
  - Lamplighter (support). Lantern wards soak hits. Ascended: Beacon.
  - They unlock at levels 39-42.
- **Act 8, The Mirelight Fen**: levels 43-48 with their own arena and map page. The boss, Mother Wick, starts with her whole army lantern-warded. Act 8 needs the Full Army.

**Meadow polish**
- Units read at board scale. Small bodies draw at 1.5x, big ones taper to 1.25x, and allies that overlap on screen get nudged apart (render only, the sim is unchanged).
- Acts 5-7 courtyards have raised flagstones and snow relief and are no longer flat.
- Airborne VFX are depth-sorted with the units, and hits on flyers play at flyer height.
- The title art was re-rendered with room around the logo. The menu is now in paired rows (Daily/Gauntlet, Breakpoint/Skirmish) plus Barracks/Shop/Sound.

**Performance and size** (full numbers in `outputs/review/perf.md`)
- A 24-unit battle in the real app on the iPhone 17 Pro simulator runs at 56.6 - 57.3 fps (9 runs over the Act 1, Act 7 and Act 8 arenas), measured from actual frame gaps. That's above the 55 fps bar, and `main` was 55.4 - 56.7 fps on the same test.
- When the Mac was busy, the Act 8 board at full 3x resolution dipped to 47-54 fps. A 2x cap held 56-58 fps. It still ships at 3x, and there's a sign-off with a side-by-side comparison if you want the cap.
- The .app is 50.8 MB on device (49.3 MB zipped), well under the 120 MB limit, so no texture compression was needed.

## Screens, before and after

These are phone-size shots (390x844 @2x). "Before" is `main` from before the overnight run and "after" is this branch. Every file is in `outputs/review/morning/`, and you can re-shoot with `PORT=<port> node tools/morning-shots.mjs <before|after>`.

| Screen | Before | After |
| --- | --- | --- |
| Title | title-before.png | title-after.png (Daily, Shop, Gauntlet marked Full Army, new key art) |
| Shop | none | shop-after.png |
| Paywall: act-gate card (Act 3) | paywall-card-before.png (level 13 open) | paywall-card-after.png |
| Paywall: tapping Gauntlet | paywall-gauntlet-before.png (opens Gauntlet) | paywall-gauntlet-after.png (Full Army sheet) |
| Daily Challenge | none | daily-after.png |
| Campaign map, Act 1 | map-act1-before.png | map-act1-after.png ("Act 1 of 8") |
| Campaign map, Act 7 | map-act7-before.png | map-act7-after.png |
| Campaign map, Act 8 (owner) | none | map-act8-after.png |
| Campaign map, Act 8 (free player) | none | map-act8-free-after.png (act-gate card) |
| Battle, Act 1 (level 6) | battle-act1-before.png | battle-act1-after.png |
| Battle, Act 7 (level 40) | battle-act7-before.png | battle-act7-after.png (raised flagstones) |
| Battle, Act 8 boss (level 48) | none | battle-act8-after.png |
| App Store screenshots | store-before/01-06 | `store/screenshots/01-06` + `iap-review.png` (re-shot 7 Nov) |
| Battle, ranked showcase | battle-showcase-before.png | battle-showcase-after.png (unit sizing and spacing) |

More detailed sets: `outputs/review/store/` (all Shop states: bought, pending, failed, offline, restored), `outputs/review/daily/`, `outputs/review/polish/` (each polish fix), `outputs/review/act8/` and `outputs/review/units/`.

## What you do in App Store Connect

`store/IAP.md` has every field to paste and `store/RELEASE-CHECKLIST.md` has the whole submission. In order:

1. **Business > Paid Apps Agreement**: accept it and add bank + tax details. Start this first, because it can take a day to go Active, and until it does the purchase can't be sold or reviewed.
2. **Apps > Muster: Tactics > Monetization > In-App Purchases > +**:
   - Type: Non-Consumable
   - Reference Name: `Full Army unlock`
   - Product ID: `co.inflect.muster.fullarmy`
3. On the purchase's page:
   - Availability: all regions
   - Price: USD 4.99
   - Display Name: `Full Army`
   - Description: `Every act, the Gauntlet and all puzzles`
   - Family Sharing: off
   - Review screenshot: `store/screenshots/iap-review.png`
   - Review Notes: the block in IAP.md
4. In your own terminal, run the checklist's step 0 (tests, build, `npm run release:config`). Then run `npm run ios:release` to archive, and upload build 1.1.0 (1) from Xcode's Organizer (checklist steps 2 and 4).
5. On the 1.1.0 version page:
   - Paste the listing from `store/LISTING.md` and upload `store/screenshots/01-06`.
   - Under **In-App Purchases and Subscriptions**, tick Full Army. The first purchase has to go to review with a version.
   - Submit.

The listing screenshots (`store/screenshots/01-06`) and `iap-review.png` were re-shot on 7 Nov from this build, so they show Act 8, the 28-unit roster and the new title. All are 1320x2868 with no alpha. The old set is in `outputs/review/morning/store-before/`.

## Still open

- Nothing has been tested on a real iPhone yet: no StoreKit sandbox purchase on a device and no device fps run. The simulator and `Muster.storekit` cover buy, cancel, pending and restore.
- The Paid Apps Agreement and the App Store Connect purchase (steps 1-3 above) are yours to do. The purchase can't be reviewed until the agreement is Active.
- Balance: the Act 6 boss (level 36) is beaten by the strong test AI 38% of the time (8 runs), just under the 40% target. Playable, but worth a tune.
- The Daily Challenge only picks arenas from Acts 1-7. Adding the Act 8 fen would change every player's daily board from the day it ships, so it's left as is for now.
- Optional: cap the battle board at 2x resolution (see the sign-off). 3x passes on the simulator and should be fine on a phone.

## Checks

- `npx tsc --noEmit -p .`: clean.
- `npx vitest run`: 16 files, 278 tests pass (7 Nov, 00:15).
- fps: `node tools/perf-app.mjs` on the Release simulator build. Size: Release builds for iphoneos and iphonesimulator. Both are in `outputs/review/perf.md`.
