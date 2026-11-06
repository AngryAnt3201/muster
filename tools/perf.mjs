// Frame cost of a 24-unit battle (all 24 kinds, ranks 1-4) on the diorama board, at iPhone 17 Pro size in Chromium.
// Needs this worktree's dev server: npx vite --port 5377 --strictPort, then: [PERF_GPU=1] node tools/perf.mjs [port] [cpuThrottle] [seconds]
// Reports, as median/p95/max ms: the live rAF loop (render time and frame gap), then a synchronous run of the same
// battle (sim + effects + draw per 60 Hz frame) whose syncFps is the CPU-side ceiling. A desktop proxy, not the
// simulator: on a loaded machine the rAF gap measures the machine, so compare syncFrameMs against a baseline build.
import { chromium, devices } from "playwright";
const [, , port = "5180", throttle = "1", secs = "8"] = process.argv;
// PERF_GPU=1 runs new headless Chromium with GPU raster (Metal via ANGLE); the default headless shell may raster in software.
const browser = await chromium.launch(process.env.PERF_GPU ? { channel: "chromium", args: ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] } : {});
const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 }, deviceScaleFactor: 3 });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/?level=1`);
await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(throttle) });
const res = await page.evaluate(async (secs) => {
  const g = window.__game;
  await Promise.all(g.plans);
  const m = g.match;
  // 12 a side, all 24 kinds once, ranks 1 to 4, spread over each deploy zone.
  const { UNITS } = await import("/src/core/defs.ts");
  const kinds = Object.keys(UNITS);
  let id = 1000;
  for (const s of [0, 1]) {
    m.sides[s].pieces = Array.from({ length: 12 }, (_, i) => {
      const x = 1 + (i % 6) * 1.4, row = Math.floor(i / 6);
      const y = s === 0 ? 12.6 - row * 2 : 1.4 + row * 2;
      return { id: id++, kind: kinds[(i + s * 12) % kinds.length], side: s, x, y, rank: 1 + ((i + s) % 4), spent: 3 };
    });
  }
  // Real games preload their rosters' sprites; these armies come from outside level 1's roster, so load all of them.
  const sprites = await import("/src/render/sprites.ts");
  sprites.preload([...kinds, "mite", "golemling", "thrall", "turret", "decoy", "queen"]);
  await new Promise((r) => setTimeout(r, 4000));
  const view = g.view, orig = view.render.bind(view);
  const draw = [], gap = [];
  let last = 0;
  view.render = (sc) => { const t = performance.now(); orig(sc); draw.push(performance.now() - t); if (last) gap.push(t - last); last = t; };
  await g.fight();
  // The sim's own step cost (one tick each), kept apart from the draw.
  const step = [], bodies = [], bt = g.battle, ostep = bt.step.bind(bt);
  bt.step = () => { const t = performance.now(); ostep(); step.push(performance.now() - t); };
  const t0 = performance.now();
  while (performance.now() - t0 < secs * 1000 && !bt.done) {
    await new Promise((r) => setTimeout(r, 250));
    bodies.push(bt.bodies.filter((u) => u.hp > 0).length);
  }
  // Then the same battle driven back to back off the rAF clock: 2 sim ticks + effects + draw per 60 Hz frame,
  // so the CPU cost per frame shows even when the machine is too busy for a steady rAF cadence.
  cancelAnimationFrame(g.raf); g.destroyed = true; view.render = orig;
  const sync = [], part = { sim: [], update: [], scene: [], render: [] };
  const lap = (k, fn) => { const t = performance.now(); const r = fn(); part[k].push(performance.now() - t); return r; };
  for (let f = 0; f < 240 && !bt.done; f++) {
    const t = performance.now();
    if (f % 2 === 0) lap("sim", () => { ostep(); view.consume(bt); });
    lap("update", () => view.update(1 / 60));
    const sc = lap("scene", () => g.scene());
    lap("render", () => view.render(sc));
    sync.push(performance.now() - t);
  }
  view.canvas.getContext("2d").getImageData(0, 0, 1, 1);
  const st = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return { n: b.length, med: +b[b.length >> 1].toFixed(2), p95: +b[Math.floor(b.length * 0.95)].toFixed(2), max: +b[b.length - 1].toFixed(2) }; };
  return { kinds: [0, 1].map((s) => m.sides[s].pieces.map((p) => `${p.kind}${p.rank}`).join(" ")), liveBodies: { first: bodies[0], max: Math.max(...bodies), last: bodies[bodies.length - 1] },
    syncFrameMs: st(sync), parts: Object.fromEntries(Object.entries(part).map(([k, v]) => [k, st(v)])), syncFps: sync.length ? +(1000 / st(sync).med).toFixed(1) : null, renderMs: st(draw), simStepMs: st(step), frameGapMs: st(gap), fps: gap.length ? +(1000 / st(gap).med).toFixed(1) : null, canvas: [view.canvas.width, view.canvas.height] };
}, Number(secs));
console.log(JSON.stringify({ throttle: Number(throttle), ...res }, null, 1));
if (errors.length) console.log("ERRORS:\n" + errors.join("\n"));
await browser.close();
