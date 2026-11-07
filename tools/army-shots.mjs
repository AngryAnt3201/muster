// Phone-size (390x844 @2x) shots of the Army (card collection), for outputs/review/army/.
//   PORT=<dev port> node tools/army-shots.mjs
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const port = process.env.PORT || 5492;
const host = `http://localhost:${port}`;
const out = "outputs/review/army";
mkdirSync(out, { recursive: true });

const cleared = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, 3]));
const settings = { sound: false, haptics: false, speed: 1 };
const wallet = (coins) => ({ coins, gems: 0, earned: { coins, gems: 0 }, spent: { coins: 0, gems: 0 }, txIds: [] });
const base = { settings, puzzles: {}, gauntlet: { best: 0, runs: 0 }, seen: [] };
const found = ["blades", "ranger", "mine", "medic", "bulwark", "lancer", "grenadier", "ballista", "shade", "hive", "storm"];
// Part-way into Act 3: commander 4, a mixed collection with some cards ready.
const mid = {
  ...base, campaign: cleared(14),
  progression: { v: 2, xp: 250, legacyPaid: true, levels: { blades: 3, ranger: 4, bulwark: 2, mine: 2, lancer: 3, medic: 2 }, deck: ["blades", "ranger", "bulwark", "lancer", "medic", "shade"] },
  collection: { found, cards: { blades: 9, ranger: 11, mine: 3, medic: 6, bulwark: 5, lancer: 2, grenadier: 1, ballista: 3, shade: 1, hive: 0, storm: 1 } },
};
const SAVES = {
  normal: { ...mid, wallet: wallet(2450) },
  // One XP short of commander 5, so the next upgrade levels the commander up.
  levelup: { ...mid, wallet: wallet(2450), progression: { ...mid.progression, xp: 279 } },
  // Act 4, army left at level 1: the defeat hint.
  under: { ...base, campaign: cleared(19), wallet: wallet(300), progression: { v: 2, xp: 40, legacyPaid: true, levels: {} }, collection: { found, cards: {} } },
};

const browser = await chromium.launch();
const errors = [];
async function page(save) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((s) => {
    if (!sessionStorage.getItem("seeded")) { localStorage.setItem("muster.save.v1", s); sessionStorage.setItem("seeded", "1"); }
  }, JSON.stringify(SAVES[save]));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${p.url()}: ${e}`));
  p.on("console", (m) => { if (m.type() === "error" && !m.text().includes("vibrate")) errors.push(m.text()); });
  return p;
}
const settle = (p, ms = 900) => p.waitForTimeout(ms);

{
  const p = await page("normal");
  await p.goto(`${host}/?army`);
  await settle(p, 1400);
  await p.screenshot({ path: `${out}/army.png` });
  await p.locator(".ar-tile.ready").first().click();
  await settle(p, 600);
  await p.screenshot({ path: `${out}/army-detail.png` });
  await p.locator(".ar-upbtn").click();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/upgrade-moment.png` });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/upgrade-after.png` });
  await p.locator(".ar-close").click();
  await p.evaluate(() => document.querySelector(".ar-army").scrollBy(0, 2000));
  await settle(p, 500);
  await p.screenshot({ path: `${out}/unfound.png` });
}
{
  const p = await page("levelup");
  await p.goto(`${host}/?army`);
  await settle(p, 1400);
  await p.locator(".ar-tile.ready").first().click();
  await settle(p, 500);
  await p.locator(".ar-upbtn").click();
  await p.waitForTimeout(2300);
  await p.screenshot({ path: `${out}/commander-level-up.png` });
}
{
  const p = await page("normal");
  await p.goto(`${host}/`);
  await settle(p, 1400);
  await p.screenshot({ path: `${out}/title-army.png` });
}
{
  const p = await page("under");
  await p.goto(`${host}/?campaign=4`);
  await settle(p, 1400);
  await p.locator(".node.current").first().click();
  await settle(p, 700);
  await p.screenshot({ path: `${out}/level-card-recommended.png` });
}
{
  const p = await page("under");
  await p.goto(`${host}/?level=20`);
  await settle(p, 1500);
  await p.evaluate(() => {
    const g = window.__game;
    g.match.sides[0].hp = 0; g.match.winner = 1; g.match.phase = "over";
    g.o.onEnd(g.match);
  });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/defeat-under-levelled.png` });
}
{
  // A first clear: coins, cards (the unit the level introduces is found) and commander XP.
  const p = await page("normal");
  await p.goto(`${host}/?level=15`);
  await settle(p, 1500);
  await p.evaluate(() => {
    const g = window.__game;
    g.match.sides[1].hp = 0; g.match.winner = 0; g.match.phase = "over";
    g.o.onEnd(g.match);
  });
  await p.waitForTimeout(2200);
  await p.screenshot({ path: `${out}/result-cards.png` });
}
await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no page errors");
