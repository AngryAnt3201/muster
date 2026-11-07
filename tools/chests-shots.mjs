// Phone-size (390x844 @2x) review shots of chests: the title's chest bar, a result with a chest earned, the chest info
// sheet with odds, an opening sequence (frames) and the Shop component. PORT=<port> node tools/chests-shots.mjs [outDir]
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "outputs/review/chests";
const port = process.env.PORT ?? "5493";
mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}/`;
// A free player in Act 3: Acts 1-2 cleared, a few units found, coins and gems from play.
const campaign = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [i + 1, i % 3 === 0 ? 2 : 3]));
const player = { settings: { sound: false, haptics: false, speed: 1 }, campaign, puzzles: {}, gauntlet: { best: 0, runs: 0 }, seen: [],
  wallet: { coins: 1840, gems: 260, earned: { coins: 1840, gems: 260 }, spent: { coins: 0, gems: 0 }, txIds: [] },
  rewards: { paid: ["act1", "act2"] }, collection: { cards: { blades: 6, ranger: 3 }, found: ["blades", "ranger", "mine", "bulwark", "medic"] } };

const browser = await chromium.launch();
const errors = [];
async function shots(list) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("muster.save.v1", JSON.stringify(s)); sessionStorage.setItem("seeded", "1"); } }, player);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  for (const [name, path, steps = []] of list) {
    if (path !== null) { await page.goto(base + path); await page.waitForTimeout(1600); }
    for (const s of steps) {
      if (s.tap) await page.mouse.click(195, 700);
      if (s.click) await page.click(s.click);
      if (s.scroll) await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "center" }), s.scroll);
      if (s.wait) await page.waitForTimeout(s.wait);
    }
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log("shot", name);
  }
  await ctx.close();
}

await shots([["title-chest-bar", "?chests=title"]]);
await shots([["result-chest-earned", "?chests=result", [{ wait: 1400 }]]]);
await shots([["result-slots-full", "?chests=full", [{ wait: 1400 }]]]);
await shots([["chest-info-odds", "?chests=info", [{ wait: 400 }]]]);
await shots([
  ["open-1-drop", "?chests=open", []],
  ["open-2-burst", null, [{ tap: 1 }, { wait: 260 }]],
  ["open-3-card", null, [{ wait: 700 }]],
  ["open-4-card", null, [{ tap: 1 }, { wait: 650 }]],
  ["open-5-card", null, [{ tap: 1 }, { wait: 650 }]],
  ["open-6-card", null, [{ tap: 1 }, { wait: 650 }]],
  ["open-7-epic", null, [{ tap: 1 }, { tap: 1 }, { wait: 300 }]],
  ["open-8-summary", null, [{ tap: 1 }, { tap: 1 }, { tap: 1 }, { tap: 1 }, { wait: 2600 }]],
]);
await shots([["shop-component", "?chests=shop", [{ wait: 600 }]]]);
await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
