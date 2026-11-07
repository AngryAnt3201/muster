// Bastion frame-rate probe: a late wave zoomed out (40+ bodies on screen), measured from real frame gaps,
// optionally under CPU throttling. PORT=5297 THROTTLE=4 node tools/td-perf.mjs
import { chromium, devices } from "playwright";
const PORT = process.env.PORT || "5297", THROTTLE = Number(process.env.THROTTLE || 1);
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`http://localhost:${PORT}/?td=meadow`);
if (process.env.FOLLOW) await page.evaluate(() => { window.__follow = true; });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const t = window.__td, run = t.run;
  t.pause(true);
  const order = ["pikeman", "ranger", "grenadier", "ranger", "blades", "storm", "ballista", "medic", "rime", "bulwark"];
  const pads = [...run.map.pads].sort((a, b) => b.y - a.y);
  while (run.wave < 17 && run.phase !== "lost") {
    if (run.phase === "build") {
      let i = run.defenders.length;
      for (const p of pads) { if (run.defenderAt(p.id)) continue; if (run.place(p.id, order[i % order.length])) i++; else break; }
      for (let g = 0; g < 30; g++) { const d = run.defenders.filter((d) => d.rank < 4 && (d.rank < 3 || run.canAscend())).sort((a, b) => a.rank - b.rank)[0]; if (!d || !run.upgrade(d.id)) break; }
      run.callWave();
    }
    run.step(); run.drain();
  }
  for (let i = 0; i < 18 * 30; i++) { run.step(); run.drain(); }
  // Zoomed all the way out over the busiest stretch: most of the defenders plus the wave.
  t.view.cam.zoom = t.view.cam.minZoom; const f = t.view.front(); t.view.cam.centerOn(t.run.map.w / 2, f ? Math.max(f.y - 4, t.run.map.h * 0.55) : t.run.map.h * 0.6);
  t.setFollow(!!window.__follow); t.pause(false);
});
await page.waitForTimeout(1500);
if (process.env.NOGROUND) await page.evaluate(() => { const c = document.createElement("canvas"); c.width = c.height = 4; window.__td.view.ground = c; });
if (process.env.NOUNITS) await page.evaluate(() => { window.__td.view.drawBody = () => {}; });
const cdp = await ctx.newCDPSession(page);
if (THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
const r = await page.evaluate(() => new Promise((res) => {
  const t = window.__td, gaps = []; let last = performance.now(), n = 0, units = [];
  const tick = (now) => { gaps.push(now - last); last = now; units.push(t.view.stats.units); if (++n < 300) requestAnimationFrame(tick); else {
    const g = gaps.slice(10).sort((a, b) => a - b), mean = g.reduce((a, b) => a + b, 0) / g.length;
    res({ fps: +(1000 / mean).toFixed(1), p95ms: +g[Math.floor(g.length * 0.95)].toFixed(1), unitsOnScreen: [Math.min(...units), Math.max(...units)], enemies: t.run.enemies.length, defenders: t.run.defenders.length });
  } };
  requestAnimationFrame(tick);
}));
console.log(JSON.stringify({ throttle: THROTTLE, follow: !!process.env.FOLLOW, ...r }));
await browser.close();
