// Phone-size (390x844 @2x) shots of the polish/fixes round, for outputs/review/fixes/.
//   PORT=<dev port> HOST=localhost node tools/fixes-shots.mjs [only,comma,separated]
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const [, , only = ""] = process.argv;
const port = process.env.PORT || 5180;
const host = process.env.HOST || "localhost";
const want = only ? new Set(only.split(",")) : null;
const out = "outputs/review/fixes";
mkdirSync(out, { recursive: true });

const cleared = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, 3]));
const settings = { sound: false, haptics: false, speed: 1 };
const wallet = (coins, gems = 0) => ({ coins, gems, earned: { coins, gems }, spent: { coins: 0, gems: 0 }, txIds: [] });
const base = { settings, puzzles: cleared(5), gauntlet: { best: 0, runs: 0 }, seen: [] };
const levels = { blades: 6, ranger: 7, bulwark: 5, mine: 4, lancer: 6, medic: 5, grenadier: 4, ballista: 3, shade: 3 };
const SAVES = {
  levelled: { ...base, campaign: cleared(14), wallet: wallet(2450, 120), progression: { levels } },
};

const browser = await chromium.launch();
const errors = [];
async function page(save = "levelled") {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((s) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("muster.save.v1", s);
      localStorage.removeItem("muster.mockstore.v1");
      sessionStorage.setItem("seeded", "1");
    }
  }, JSON.stringify(SAVES[save]));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${p.url()}: ${e}`));
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return p;
}
const skip = (name) => want && !want.has(name);
const shot = async (p, name) => { await p.screenshot({ path: `${out}/${name}.png` }); console.log("shot", name); };
const deployAI = async (p) => p.evaluate(async () => {
  const ai = await import("/src/core/ai.ts");
  const g = window.__game, m = g.match;
  await Promise.all(g.plans ?? []);
  const me = { ...ai.DEFAULT_AI, difficulty: 0.85, aggression: 0.5, tactic: "balanced" };
  ai.applyPlan(m, 0, await ai.planTurnAsync(m, 0, me));
  g.refreshHud?.();
});

// 1. A placed unit's card at its troop level.
if (!skip("pop-level")) {
  const p = await page();
  await p.goto(`http://${host}:${port}/?level=10`);
  await p.waitForTimeout(2600);
  await deployAI(p);
  await p.waitForTimeout(600);
  await p.evaluate(() => { const g = window.__game; const pc = g.match.sides[0].pieces.find((x) => x.kind !== "mine") ?? g.match.sides[0].pieces[0]; g.selected = pc.id; g.openPop(pc); });
  await p.waitForTimeout(500);
  await shot(p, "pop-level");
  await p.context().close();
}

if (errors.length) console.log("ERRORS:\n" + errors.join("\n"));
await browser.close();
