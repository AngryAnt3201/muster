// Phone-size review shots of the home screen and its tabs (390x844 @2x, plus 375x667 for a small phone).
// PORT=<port> node tools/home-shots.mjs [outDir] [prefix] [only]   e.g. prefix "before-" for the old title.
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "outputs/review/home";
const prefix = process.argv[3] ?? "";
const only = process.argv[4] ?? "";
const port = process.env.PORT ?? "5591";
mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}/`;
// A free player in Act 3: Acts 1-2 cleared, a few units found, coins and gems from play.
const campaign = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [i + 1, i % 3 === 0 ? 2 : 3]));
const player = { settings: { sound: false, haptics: false, speed: 1 }, campaign, puzzles: { 1: 3, 2: 2 }, gauntlet: { best: 4, runs: 6 }, seen: [],
  wallet: { coins: 1840, gems: 260, earned: { coins: 1840, gems: 260 }, spent: { coins: 0, gems: 0 }, txIds: [] },
  rewards: { paid: ["act1", "act2"] }, collection: { cards: { blades: 6, ranger: 3, mine: 4 }, found: ["blades", "ranger", "mine", "bulwark", "medic"] } };

const browser = await chromium.launch();
const errors = [];
async function shots(list, size = { width: 390, height: 844 }, safe = "59,34") {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: size, screen: size, deviceScaleFactor: 2, hasTouch: true });
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("muster.save.v1", JSON.stringify(s)); sessionStorage.setItem("seeded", "1"); } }, player);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  for (const [name, path, steps = []] of list) {
    if (only && !name.includes(only)) continue;
    if (path !== null) { await page.goto(base + path + (path.includes("?") ? "&" : "?") + `safe=${safe}`); await page.waitForTimeout(1600); }
    for (const s of steps) {
      if (s.click) await page.click(s.click);
      if (s.wait) await page.waitForTimeout(s.wait);
    }
    await page.screenshot({ path: `${out}/${prefix}${name}.png` });
    console.log("shot", prefix + name);
  }
  await ctx.close();
}

const tab = (t) => ({ click: `.tb-tab[data-tab="${t}"]` });
await shots([
  ["home-390", ""],
  ["chest-ready-390", "?chests=title"],
  ["tab-shop-390", "", [tab("shop"), { wait: 700 }]],
  ["tab-army-390", "", [tab("army"), { wait: 700 }]],
  ["tab-modes-390", "", [tab("modes"), { wait: 700 }]],
  ["tab-pass-390", "", [tab("pass"), { wait: 700 }]],
  ["settings-390", "", [{ click: ".hm-gear" }, { wait: 500 }]],
]);
await shots([
  ["home-375x667", ""],
  ["tab-modes-375x667", "", [tab("modes"), { wait: 700 }]],
  ["tab-shop-375x667", "", [tab("shop"), { wait: 700 }]],
  ["tab-army-375x667", "", [tab("army"), { wait: 700 }]],
  ["settings-375x667", "", [{ click: ".hm-gear" }, { wait: 500 }]],
], { width: 375, height: 667 }, "20,0");
console.log(JSON.stringify({ errors }));
await browser.close();
