# Muster: Tactics: Full Army in-app purchase

Generated from `store/metadata.json` (`inAppPurchase`) by `npm run release:config`. Edit that, not this file.
What the player gets: the free download has Campaign Acts 1 and 2, the Daily Challenge, Skirmish and the first Breakpoint puzzles.
**Full Army** opens every act, the Gauntlet and every Breakpoint puzzle for good, with one payment. Players who had already reached Act 3 keep it without buying.
The app reads the price from the App Store (StoreKit 2), so changing the price here never needs a new build.

## 0. Once per account: Paid Apps Agreement (5 min, can take a day to go active)

App Store Connect > **Business** (Agreements, Tax, and Banking) > **Paid Apps** > accept the agreement, add a bank account and fill in the tax forms.
Until it says **Active**, the purchase cannot be sold and App Review cannot buy it in the sandbox.

## 1. Create the purchase (3 min)

Apps > Muster: Tactics > Monetization > **In-App Purchases** > **+**

| Field | Enter | Limit |
| --- | --- | --- |
| Type | **Non-Consumable** | |
| Reference Name | `Full Army unlock` | 16/64, only you see it |
| Product ID | `co.inflect.muster.fullarmy` | must match the app exactly; can never be changed or reused |

Click **Create**, then on the purchase's page:

| Section | Field | Enter |
| --- | --- | --- |
| Availability | Countries or Regions | All countries and regions (same as the app) |
| Price Schedule | Base price | USD 4.99 (United States base price; let Apple set the other storefronts from it) |
| App Store Localization (English (U.S.)) | Display Name | `Full Army` (9/30) |
| App Store Localization (English (U.S.)) | Description | `Every act, the Gauntlet and all puzzles` (39/45) |
| Family Sharing | | Off. Turning Family Sharing on for a non-consumable cannot be undone, so leave it off unless you want families to share the unlock. |
| Tax Category | | Match to parent app (the default) |
| Review Information | Screenshot | `store/screenshots/iap-review.png` (the Shop screen with the Full Army price, 1320x2868). Re-shoot with `node tools/store-shots.mjs --only=iap-review` while `npm run dev` runs. |
| Review Information | Review Notes | the block below |
| Promotional Image | | None (optional; only needed for App Store promotion or win-back offers) |

Review Notes:

```
Full Army is a one-time unlock. Without it, Campaign Acts 1 and 2, the Daily Challenge, Skirmish and the first Breakpoint puzzles are free. It opens every campaign act, the Gauntlet and every Breakpoint puzzle. To find it: title screen > Shop, or Campaign > the locked Act 3 card. Restore Purchases is on the Shop screen.
```
321/4000.

The purchase's status should now read **Ready to Submit**. If it says Missing Metadata, one of the fields above is empty.

## 2. Submit it with version 1.1.0

Apple requires the first in-app purchase to go to review together with a new app version.
On the iOS App > 1.1.0 page, scroll to **In-App Purchases and Subscriptions** > **+** > tick **Full Army** > Done.
Then submit the version as usual (`store/RELEASE-CHECKLIST.md` step 7). The purchase and the build are reviewed together.

## 3. Test it before submitting (optional, 5 min)

- **Simulator, no Apple account needed:** `npm run ios:open`, pick an iPhone simulator, press Run. The shared App scheme already uses `ios/App/Muster.storekit` (Edit Scheme > Run > Options > StoreKit Configuration), so the Shop shows US$4.99 and buy, cancel, Ask to Buy and Restore all work locally. Debug > StoreKit > Manage Transactions refunds or deletes the test purchase. The plugin's own StoreKit tests run from `ios/MusterStore/TestHost` (command at the top of its project.yml).
- **Sandbox on your iPhone:** App Store Connect > Users and Access > **Sandbox** > Test Accounts > **+**. On the iPhone, Settings > Developer > Sandbox Apple Account, sign in with it, then buy Full Army from a TestFlight or Xcode build. Sandbox purchases are free.
- **Restore:** delete the app, reinstall, open Shop > Restore Purchases. Full Army comes back. (Game progress does not; it lives on the device.)
