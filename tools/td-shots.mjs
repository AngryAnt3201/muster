// Bastion review shots at phone size (390x844 @2x) from the dev server:
//   PORT=5297 node tools/td-shots.mjs [outDir]   (default outputs/review/td)
// Map select, wave start, mid-wave zoomed out and in, the build and upgrade sheets, the boss wave, the result,
// a panning frame strip, and an fps probe with 40+ bodies on screen.
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const PORT = process.env.PORT || "5297";
const out = process.argv[2] || "outputs/review/td";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const base = `http://localhost:${PORT}/`;
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const wait = (ms) => page.waitForTimeout(ms);
const notes = {};

// Title (with the new button) and map select.
await page.goto(base);
await wait(2200);
await shot("00-title");
await page.goto(`${base}?td`);
await wait(1500);
await shot("01-map-select");

// A run: script a sensible build, then play it forward fast in the sim and shoot key moments.
await page.goto(`${base}?td=meadow`);
await wait(2500);
// Build sheet on a free pad.
await page.evaluate(() => {
  const t = window.__td, pads = [...t.run.map.pads].sort((a, b) => b.y - a.y);
  t.view.cam.centerOn(pads[0].x, pads[0].y - 2);
  t.openPad(pads[0].id);
});
await wait(900);
await shot("03-build-sheet");
// Place a starting line, start wave 1.
const build = () => page.evaluate(() => {
  const t = window.__td, run = t.run;
  const order = ["pikeman", "ranger", "grenadier", "ranger", "blades", "storm", "ballista", "medic", "rime", "bulwark"];
  const pads = [...run.map.pads].sort((a, b) => b.y - a.y);
  let i = run.defenders.length;
  for (const p of pads) { if (run.defenderAt(p.id)) continue; const k = order[i % order.length]; if (run.place(p.id, k)) i++; else break; }
  for (let g = 0; g < 30; g++) { const d = [...run.defenders].sort((a, b) => a.rank - b.rank)[0]; if (!d || !run.upgrade(d.id)) break; }
  t.closeSheet(); t.refresh(true);
});
await build();
await page.evaluate(() => { const t = window.__td; t.closeSheet(); t.run.callWave(); t.setFollow(true); });
await wait(1300);
await shot("02-wave-start");
// Fast forward to wave 9 (air + assassins) mid-wave.
const ff = (wave, extra = 0) => page.evaluate(([wave, extra]) => {
  const t = window.__td, run = t.run;
  t.pause(true);
  const order = ["pikeman", "ranger", "grenadier", "ranger", "blades", "storm", "ballista", "medic", "rime", "bulwark"];
  const pads = [...run.map.pads].sort((a, b) => b.y - a.y);
  let guard = 0;
  while (run.wave < wave && run.phase !== "lost" && guard++ < 200000) {
    if (run.phase === "build") {
      let i = run.defenders.length;
      for (const p of pads) { if (run.defenderAt(p.id)) continue; const k = order[i % order.length]; if (run.place(p.id, k)) i++; else break; }
      for (let g = 0; g < 30; g++) { const d = [...run.defenders].filter((d) => d.rank < 4 && (d.rank < 3 || run.canAscend())).sort((a, b) => a.rank - b.rank)[0]; if (!d || !run.upgrade(d.id)) break; }
      run.callWave();
    }
    run.step(); run.drain();
  }
  for (let i = 0; i < extra * 30; i++) { run.step(); t.view.absorb(run.drain()); }
  t.refresh(true);
  t.pause(false);
  return { wave: run.wave, hp: run.keepHp, enemies: run.enemies.length, defenders: run.defenders.length };
}, [wave, extra]);
notes.mid = await ff(10, 14);
await page.evaluate(() => { const t = window.__td; t.setFollow(false); t.view.cam.follow = null; t.view.cam.zoom = 0.8; const f = t.view.front(); if (f) t.view.cam.centerOn(f.x, f.y - 6); t.view.cam.clamp(); });
await wait(500);
await shot("04-mid-wave-zoomed-out");
await page.evaluate(() => { const t = window.__td; t.view.cam.zoom = 2.1; const f = t.view.front(); if (f) t.view.cam.centerOn(f.x, f.y - 1); t.view.cam.clamp(); });
await wait(500);
await shot("05-mid-wave-zoomed-in");
// Upgrade sheet on a ranked defender.
await page.evaluate(() => { const t = window.__td; t.pause(true); const d = t.run.defenders.find((d) => d.kind === "ranger") ?? t.run.defenders[0]; t.view.cam.zoom = 1.5; t.view.cam.centerOn(d.x, d.y + 1.5); t.openPad(d.pad); });
await wait(700);
await shot("06-upgrade-sheet");
await page.evaluate(() => { const t = window.__td; t.closeSheet(); t.pause(false); });

// Perf probe: zoom out over the thick of a big wave and count frames.
notes.perfWave = await ff(17, 18);
await page.evaluate(() => { const t = window.__td; t.view.cam.zoom = 0.8; const f = t.view.front(); if (f) t.view.cam.centerOn(f.x, f.y - 7); t.setFollow(true); t.setSpeed(1); });
notes.perf = await page.evaluate(() => new Promise((res) => {
  const t = window.__td, gaps = []; let last = performance.now(), n = 0, maxUnits = 0;
  const tick = (now) => { gaps.push(now - last); last = now; maxUnits = Math.max(maxUnits, t.view.stats.units); if (++n < 240) requestAnimationFrame(tick); else res({ frames: n, fps: +(1000 / (gaps.slice(5).reduce((a, b) => a + b, 0) / (gaps.length - 5))).toFixed(1), worstMs: +Math.max(...gaps.slice(5)).toFixed(1), maxUnitsOnScreen: maxUnits, enemies: t.run.enemies.length, defenders: t.run.defenders.length, particles: t.view.stats.particles }); };
  requestAnimationFrame(tick);
}));
await shot("07-big-wave");
// Boss wave.
notes.boss = await ff(18, 40);
await page.evaluate(() => { const t = window.__td; const b = t.run.enemies.find((e) => e.boss); t.setFollow(false); t.view.cam.follow = null; t.view.cam.zoom = 1.3; if (b) t.view.cam.centerOn(b.x, b.y - 1); });
await wait(600);
await shot("08-boss-wave");
// Play it out for the result.
notes.result = await page.evaluate(() => {
  const t = window.__td, run = t.run;
  t.setSpeed(3);
  let g = 0;
  while (run.phase === "wave" && g++ < 100000) { if (run.time > 5000) break; run.step(); t.view.absorb(run.drain()); if (run.enemies.length === 0) break; }
  return run.snapshot();
});
await wait(3500);
await shot("09-result");

// Panning strip: a fresh run, swipe from the keep up toward the gates.
await page.goto(`${base}?td=fords`);
await wait(2200);
for (let i = 0; i < 4; i++) {
  await page.evaluate((i) => { const t = window.__td; t.view.cam.zoom = 1.1; t.view.cam.centerOn(t.run.map.w / 2, t.run.map.h - 8 - i * 13); }, i);
  await wait(350);
  await shot(`10-pan-${i + 1}`);
}
writeFileSync(`${out}/notes.json`, JSON.stringify({ ...notes, errors }, null, 2));
console.log(JSON.stringify({ ...notes, errors }, null, 2));
await browser.close();
