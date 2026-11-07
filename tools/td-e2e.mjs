// Bastion touch-path check on the dev server: title button -> map select -> run; tap a pad, build, drag to pan,
// fling, double-tap zoom, call the wave, upgrade and sell. PORT=5297 node tools/td-e2e.mjs
import { chromium, devices } from "playwright";
const PORT = process.env.PORT || "5297";
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) process.exitCode = 1; };
await page.goto(`http://localhost:${PORT}/`);
await page.waitForTimeout(2000);
await page.click(".bastion-btn");
await page.waitForTimeout(800);
ok(await page.isVisible(".td-select"), "title button opens map select");
await page.click(".td-map-card >> nth=0");
await page.waitForTimeout(1500);
ok(await page.isVisible(".td-run canvas"), "map card starts a run");
// Tap the pad nearest the screen centre.
const pad = await page.evaluate(() => {
  const t = window.__td, c = t.view.cam;
  let best = null, bd = 1e9;
  for (const p of t.run.map.pads) { const s = c.toScreen(p.x, p.y); if (s.y < 120 || s.y > 600 || s.x < 30 || s.x > 300) continue; const d = Math.hypot(s.x - 195, s.y - 380); if (d < bd) { bd = d; best = { id: p.id, x: s.x, y: s.y }; } }
  return best;
});
await page.mouse.click(pad.x, pad.y);
await page.waitForTimeout(500);
ok(await page.isVisible(".td-roster"), "tapping a pad opens the build sheet");
const gold0 = await page.evaluate(() => window.__td.run.gold);
await page.click(".td-unit >> nth=6"); // Ranger
await page.waitForTimeout(300);
const placed = await page.evaluate((id) => window.__td.run.defenderAt(id)?.kind, pad.id);
ok(placed === "ranger", `build places a ranger (gold ${gold0} -> ${await page.evaluate(() => window.__td.run.gold)})`);
// Drag up the map, then fling.
const cy0 = await page.evaluate(() => window.__td.view.cam.cy);
await page.mouse.move(200, 300); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(200, 300 + i * 30); await page.waitForTimeout(16); }
await page.mouse.up();
await page.waitForTimeout(600);
const cy1 = await page.evaluate(() => window.__td.view.cam.cy);
ok(cy1 < cy0 - 5, `drag pans toward the gates (cy ${cy0.toFixed(1)} -> ${cy1.toFixed(1)}, inertia carries on)`);
// Double tap zooms.
const z0 = await page.evaluate(() => window.__td.view.cam.zoom);
const empty = await page.evaluate(() => { const t = window.__td; t.closeSheet(); for (let y = 250; y < 600; y += 20) for (let x = 40; x < 280; x += 20) if (t.view.padAt(x, y) < 0) return { x, y }; return { x: 150, y: 400 }; });
await page.mouse.click(empty.x, empty.y); await page.waitForTimeout(80); await page.mouse.click(empty.x, empty.y);
await page.waitForTimeout(700);
const z1 = await page.evaluate(() => window.__td.view.cam.zoom);
ok(Math.abs(z1 - z0) > 0.3, `double tap zooms (${z0.toFixed(2)} -> ${z1.toFixed(2)})`);
// Wheel / pinch path clamps.
await page.mouse.move(empty.x, empty.y); await page.mouse.wheel(0, -4000); await page.waitForTimeout(200);
const z2 = await page.evaluate(() => [window.__td.view.cam.zoom, window.__td.view.cam.maxZoom]);
ok(z2[0] <= z2[1] + 1e-6, `zoom clamps at max (${z2[0].toFixed(2)})`);
// Call the wave.
await page.click(".td-call");
await page.waitForTimeout(1500);
ok(await page.evaluate(() => window.__td.run.phase === "wave" && window.__td.run.wave === 1), "call button starts wave 1");
// Upgrade and sell through the sheet.
await page.evaluate((id) => { const t = window.__td; t.run.gold += 200; t.openPad(id); }, pad.id);
await page.waitForTimeout(300);
await page.click(".td-up");
await page.waitForTimeout(200);
ok(await page.evaluate((id) => window.__td.run.defenderAt(id)?.rank === 2, pad.id), "upgrade button ranks up");
await page.click(".td-sell");
await page.waitForTimeout(200);
ok(await page.evaluate((id) => !window.__td.run.defenderAt(id), pad.id), "sell button removes the defender");
ok(errors.length === 0, `no page errors ${errors.join(" | ")}`);
await browser.close();
