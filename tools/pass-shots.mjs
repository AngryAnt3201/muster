// Review shots of the War Pass, quests and special offers at phone size (390x844 @2x) into outputs/review/pass/.
// Needs vite running: npx vite --port 5594 --strictPort. Usage: node tools/pass-shots.mjs [base]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:5594/";
const out = new URL("../outputs/review/pass/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

/** A save mid-campaign so chests and offers have units to show. */
const SAVE = { campaign: { 1: 3, 2: 3, 3: 3, 4: 2, 5: 3, 6: 3, 7: 3, 8: 2, 9: 3, 10: 3, 11: 3, 12: 3, 13: 2, 14: 3, 15: 3 }, puzzles: {}, gauntlet: { best: 2, runs: 3 },
  daily: { streak: 2, bestStreak: 4, wins: 3 }, settings: { sound: false, haptics: false, speed: 1 }, seen: [],
  wallet: { coins: 4200, gems: 380, earned: { coins: 0, gems: 0 }, spent: { coins: 0, gems: 0 }, txIds: [] },
  collection: { cards: { blades: 12, ranger: 30, medic: 8, bulwark: 4, lancer: 2 }, found: ["blades", "ranger", "medic", "mine", "pikeman", "bulwark", "lancer", "shade"] } };

async function shot(name, query, act) {
  const page = await ctx.newPage();
  await page.addInitScript((s) => { if (!sessionStorage.getItem("seeded")) { localStorage.clear(); localStorage.setItem("muster.save.v1", JSON.stringify(s)); sessionStorage.setItem("seeded", "1"); } }, SAVE);
  await page.goto(base + query, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  if (act) await act(page);
  await page.screenshot({ path: `${out}${name}.png` });
  console.log("shot", name);
  await page.close();
}

await shot("01-pass-free", "?pass=free&safe=47,34");
await shot("02-pass-free-tracks", "?pass=free&safe=47,34", async (p) => { await p.evaluate(() => { const s = document.querySelector(".pass-screen"); const r = document.querySelector('.pt-row[data-row="9"]'); if (s && r) s.scrollTop = r.offsetTop - 120; }); await p.waitForTimeout(300); });
await shot("03-pass-premium-owned", "?pass=premium&safe=47,34");
await shot("04-pass-claiming", "?pass=claim&safe=47,34", async (p) => { await p.locator('.pt-cell.can[data-track="free"]').first().scrollIntoViewIfNeeded(); await p.locator('.pt-cell.can[data-track="free"]').first().click({ force: true }); await p.waitForTimeout(250); });
await shot("05-pass-claim-chest", "?pass=claim&safe=47,34", async (p) => { await p.locator('.pt-cell.can[data-tier="10"]').first().scrollIntoViewIfNeeded(); await p.locator('.pt-cell.can[data-tier="10"]').first().click({ force: true }); await p.waitForTimeout(1500); });
await shot("06-quests", "?pass=free&safe=47,34", async (p) => { await p.locator(".pass-quests").scrollIntoViewIfNeeded(); });
await shot("07-quest-claimed", "?pass=free&safe=47,34", async (p) => { await p.locator(".pq-claim").first().click({ force: true }); await p.waitForTimeout(400); });
await shot("08-premium-buying-pending", "?pass=free&store=pending&safe=47,34", async (p) => { await p.locator(".pass-premium").scrollIntoViewIfNeeded(); await p.waitForTimeout(500); await p.locator(".pp-buy").click({ force: true }); await p.waitForTimeout(900); });
await shot("09-premium-failed", "?pass=free&store=failed&safe=47,34", async (p) => { await p.locator(".pass-premium").scrollIntoViewIfNeeded(); await p.waitForTimeout(500); await p.locator(".pp-buy").click({ force: true }); await p.waitForTimeout(900); });
await shot("10-premium-purchased", "?pass=free&safe=47,34", async (p) => { await p.waitForTimeout(500); await p.locator(".pp-buy").click({ force: true }); await p.waitForTimeout(1200); });
await shot("11-shop-offers", "?shop&safe=47,34", async (p) => { await p.locator(".offers-section").scrollIntoViewIfNeeded(); await p.waitForTimeout(500); });
await shot("12-shop-offer-bought", "?shop&safe=47,34", async (p) => { await p.locator(".offers-section").scrollIntoViewIfNeeded(); await p.waitForTimeout(500); await p.locator(".of-buy").first().click({ force: true }); await p.waitForTimeout(2200); });
await shot("13-shop-offer-pending", "?shop&store=pending&safe=47,34", async (p) => { await p.locator(".offers-section").scrollIntoViewIfNeeded(); await p.waitForTimeout(500); await p.locator(".of-buy").first().click({ force: true }); await p.waitForTimeout(900); await p.locator(".offers-section").scrollIntoViewIfNeeded(); });
await shot("14-chest-odds-from-pass", "?pass=free&safe=47,34", async (p) => { await p.locator('.pt-cell[data-tier="20"][data-track="free"]').scrollIntoViewIfNeeded(); await p.locator('.pt-cell[data-tier="20"][data-track="free"]').click({ force: true }); await p.waitForTimeout(500); });
await browser.close();
