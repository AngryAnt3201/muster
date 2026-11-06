# Muster: Tactics: release checklist (zero to "Submitted for review")

About 15 minutes of your time, plus Apple's build processing (5 to 15 minutes) while you fill the listing.
Everything to paste is in `store/LISTING.md`. Everything about the name, version and ids is in `app.config.json`.

| | |
| --- | --- |
| App Store name | Muster: Tactics |
| Home-screen name | Muster |
| Bundle ID / SKU | `co.inflect.muster` |
| Team | Jack Wakem, `F4ZF9VS4GN` |
| Version | 1.0.0 (build 1) |
| Privacy Policy URL | https://muster-tactics.vercel.app/privacy.html |
| Support URL | https://muster-tactics.vercel.app/support.html |

Run the commands in your own Terminal (the release scripts refuse to run inside an agent shell).

## 0. Before you start (1 min)

```sh
cd ~/Desktop/game_development/muster
npm test && npm run build      # must pass: the release script stops if TypeScript fails
npm run store:shots            # only if the art changed since the screenshots in store/screenshots/
```

Xcode > Settings > Accounts: your Apple ID is listed and team **Jack Wakem (F4ZF9VS4GN)** shows as a paid Apple Developer Program team (not "Personal Team").

## 1. Put the privacy and support pages online (2 min)

```sh
cd ~/Desktop/game_development/muster/site
npx vercel@latest --prod
#   Set up and deploy? Y · scope: yours · link to existing project? N
#   project name: muster-tactics · directory: ./ · modify settings? N
```

Open https://muster-tactics.vercel.app/privacy.html to check it loads.
If Vercel gave a different URL: put it in `app.config.json` as `siteUrl`, run `npm run release:config` (rewrites the URLs in LISTING.md and the site), and use the URLs from LISTING.md below.
No Vercel? Drag the `site/` folder onto https://app.netlify.com/drop, or push it to GitHub Pages. It is plain static HTML.

## 2. Archive the app (3 to 5 min, mostly waiting)

```sh
cd ~/Desktop/game_development/muster
npm run ios:release
```

This runs `release:config` (checks lengths, icon has no alpha), `vite build`, `cap sync`, then `xcodebuild archive` for Release with automatic signing. `-allowProvisioningUpdates` lets Xcode register `co.inflect.muster` and create the signing certificate and profiles under your account the first time. Ends with `--- Archive: ios/App/build/Muster.xcarchive`.

If it fails on signing: open `ios/App/App.xcodeproj` once (`npm run ios:open`), App target > Signing & Capabilities, confirm Team = Jack Wakem and "Automatically manage signing" is on, close Xcode, run it again.

## 3. Create the app record (2 min)

https://appstoreconnect.apple.com/apps > **+** > New App

- Platforms: **iOS**
- Name: **Muster: Tactics**
- Primary Language: **English (U.S.)**
- Bundle ID: **co.inflect.muster** (in the list now that step 2 registered it)
- SKU: **co.inflect.muster**
- User Access: Full Access

If Apple says the name is taken, use the next free name in LISTING.md, set it as `storeName` in `app.config.json`, run `npm run release:config`, and carry on (no rebuild needed: the store name is not in the binary).

## 4. Upload the build (2 min, then Apple processes it)

Easiest: Xcode > Window > **Organizer** > Archives > "App 1.0.0 (1)" > **Distribute App** > App Store Connect > Upload > keep the defaults (automatic signing) > Upload.

Or from Terminal:

```sh
npm run ios:export                                   # -> ios/App/build/export/App.ipa
xcrun altool --upload-app -t ios -f ios/App/build/export/App.ipa \
  -u <your Apple ID email> -p <app-specific password from account.apple.com>
```

(or drag `App.ipa` into Apple's Transporter app). Apple emails you when processing is done, usually within 15 minutes. Fill in steps 5 to 7 meanwhile.

## 5. App Information, pricing, privacy (4 min)

From `store/LISTING.md`:

- **App Information**: Subtitle; Category = Games, subcategories Strategy and Casual; Content Rights = does not contain third-party content; **Age Rating** > Edit: answer as in LISTING.md (only "Cartoon or Fantasy Violence" = Infrequent/Mild, everything else None/No; expect **9+**).
- **Pricing and Availability**: Price = Free (USD 0.00), all countries and regions.
- **App Privacy**: Privacy Policy URL = `https://muster-tactics.vercel.app/privacy.html`; Get Started > "Do you or your third-party partners collect data from this app?" = **No** > Save > **Publish**. The label reads "Data Not Collected".
- **EU (Digital Services Act)**: if App Store Connect asks for trader status (Business > or the banner on the app), answer it; a free hobby app with no income is usually "not a trader". Without an answer the app is left out of EU storefronts but the rest of the world is fine.

## 6. Version 1.0 page (4 min)

iOS App > 1.0 Prepare for Submission:

- **Screenshots**: iPhone 6.9" Display: drag in `store/screenshots/01-battle.png` to `06-ai-lab.png` in order. No iPad needed (the app is iPhone only).
- **Promotional Text, Description, Keywords**: paste from LISTING.md.
- **Support URL**: `https://muster-tactics.vercel.app/support.html` · **Marketing URL**: `https://muster-tactics.vercel.app`
- **Copyright**: `2026 Jack Wakem`
- **Build**: + > pick 1.0.0 (1) once processed. No export compliance question (Info.plist says no non-exempt encryption).
- **App Review Information**: Sign-in required: **off**; contact Jack Wakem, jackwakem@gmail.com, your phone; Notes: paste from LISTING.md.
- **Version Release**: Automatically release this version.

## 7. Submit (1 min)

**Add for Review** > **Submit for Review**. Status becomes "Waiting for Review".

## What to expect

- Review usually starts within 24 hours and takes minutes once it starts; most apps are decided within 1 to 2 days. Statuses: Waiting for Review > In Review > Ready for Distribution (then it appears on the store within a few hours) or Rejected with a message in App Store Connect.
- Likeliest questions for this app, with answers ready: "Is this just a website?" (no: a full offline game, all content bundled, no network); "Screenshots must show the app" (they are the real game UI); age rating (fantasy violence, no blood: 9+).
- If rejected for something in the binary: fix, bump `build` to 2 in `app.config.json`, `npm run ios:release`, upload again, reply in Resolution Center. Metadata-only fixes need no new build.
- Promotional text can be edited any time; everything else on the version page needs a new version after release.
