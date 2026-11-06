// Phone-size shots of the Daily screens with a seeded save (streak, best, today done): PORT=<dev port> node tools/daily-shots.mjs
import { chromium, devices } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const d = new Date(); const p = (n) => String(n).padStart(2, "0");
const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
const y = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1); const ykey = `${y.getFullYear()}-${p(y.getMonth() + 1)}-${p(y.getDate())}`;
const save = { campaign: {}, puzzles: {}, gauntlet: { best: 0, runs: 0 }, settings: { sound: false, haptics: true, speed: 1 }, seen: [],
  daily: { last: key, streak: 4, bestStreak: 6, best: 1342, bestKey: ykey, played: 9, wins: 5, today: { key, done: true, won: true, score: 1286 } } };
await ctx.addInitScript((s) => localStorage.setItem("muster.save.v1", s), JSON.stringify(save));
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const base = "http://localhost:" + process.env.PORT;
await page.goto(base + "/?daily"); await page.waitForTimeout(2500);
await page.screenshot({ path: "outputs/review/daily/daily-done.png" });
await page.goto(base + "/"); await page.waitForTimeout(2500);
await page.screenshot({ path: "outputs/review/daily/title-done.png" });
// Practice run: plays, then quit back.
await page.goto(base + "/?daily"); await page.waitForTimeout(2000);
await page.click("text=Practice (unscored)"); await page.waitForTimeout(500);
await page.screenshot({ path: "outputs/review/daily/practice-intro.png" });
const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("muster.save.v1")).daily);
console.log(JSON.stringify(kept));
if (errors.length) console.log("ERRORS:\n" + errors.join("\n"));
await browser.close();
