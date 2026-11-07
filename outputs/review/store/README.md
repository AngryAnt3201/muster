# Full Army gating, paywall and Shop (mock store)

Phone-size (390x844 @2x) shots from the web build with the mock store. Re-run with
`npx vite --port <port>` then `node tools/store-review.mjs outputs/review/store/after <port>`.
The seeded save has Acts 1-2 cleared (levels 1-12) and puzzles 1-5 solved, so every gate shows.

| Screen | Before | After |
| --- | --- | --- |
| Title (Shop button, Gauntlet marked Full Army) | before/title.png | after/title.png |
| Tapping Gauntlet | before/gauntlet-tap.png (opened Gauntlet) | after/paywall-from-gauntlet.png (paywall sheet) |
| Campaign, Act 2 | before/campaign-act2.png | after/campaign-act2.png (unchanged) |
| Campaign, Act 3 | before/campaign-act3.png (level 13 open) | after/campaign-act3.png (act-gate card) |
| Breakpoint | before/puzzles.png (6 open) | after/puzzles.png (6+ crowned, Full Army card) |
| Shop | none | after/shop.png |
| Shop after buying | none | after/shop-bought.png |
| Ask to Buy pending (`?store=pending`) | none | after/shop-pending.png |
| Payment failed (`?store=failed`) | none | after/shop-failed.png |
| Store unreachable (`?store=offline`) | none | after/shop-offline.png |
| Restore Purchases with an owned unlock | none | after/shop-restored.png |
| Act 3 and Breakpoint once owned | none | after/campaign-act3-owned.png, after/puzzles-owned.png |

The $4.99 in these shots is the mock store's price. On iOS the button shows StoreKit's `displayPrice`.
