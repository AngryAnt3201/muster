// Two players in two browsers, end to end against the running game and match server (npm run play -- --no-open):
// an invite link, a friend request, a challenge, three rounds of a match, then one player quits.
//   node tools/versus-e2e.mjs [outDir]
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
const out = process.argv[2] ?? "captures/versus";
mkdirSync(out, { recursive: true });
const base = `http://localhost:${process.env.PORT || 5180}`;
const browser = await chromium.launch();
const errors = [];
const player = async (name) => {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false, isMobile: false });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  return page;
};
const check = (ok, what) => { if (!ok) { errors.push(`FAILED: ${what}`); console.log(`  x ${what}`); } else console.log(`  ok ${what}`); };
const game = (page, js) => page.evaluate(`(() => { const g = window.__game; return ${js}; })()`);
const drag = async (page, x0, y0, x1, y1) => { await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10); await page.mouse.up(); };

const a = await player("A"), b = await player("B");
await a.goto(`${base}/?versus`);
await a.waitForSelector(".vs-code");
const code = await a.textContent(".vs-code");
await a.fill(".vs-name", "Ada"); await a.press(".vs-name", "Enter");
await b.goto(`${base}/?add=${code}`);
await b.waitForSelector(".vs-row.pending");
await b.fill(".vs-name", "Bo"); await b.press(".vs-name", "Enter");
await a.waitForSelector(".vs-row.request");
await a.screenshot({ path: `${out}/1-request.png` });
await a.click(".vs-row.request .btn.primary");
await b.waitForSelector(".vs-row .vs-dot.on");
check(true, "invite link, friend request, accept, both online");
await b.screenshot({ path: `${out}/2-friends.png` });
await b.click(".vs-row .btn.gold");
await a.waitForSelector(".vs-challenge");
await a.screenshot({ path: `${out}/3-challenge.png` });
await a.click(".vs-challenge .btn.primary");
await Promise.all([a.waitForSelector(".game.mode-versus"), b.waitForSelector(".game.mode-versus")]);
check((await game(a, "g.match.seat")) !== (await game(b, "g.match.seat")), "match started, one seat each");
await a.waitForTimeout(1800);

for (let round = 1; round <= 3; round++) {
  for (const p of [a, b]) {
    // Drag every card you can afford onto your half, as a player would.
    for (let slot = 0; slot < 4; slot++) {
      if (await game(p, `g.match.canBuy(0, ${slot})`)) continue;
      const box = await p.locator(`.shop .card[data-slot="${slot}"]`).boundingBox();
      await drag(p, box.x + box.width / 2, box.y + box.height / 2, 90 + slot * 70, 430 + ((round * 37 + slot * 53) % 110));
      await p.waitForTimeout(250);
    }
  }
  check((await game(a, "g.match.sides[0].pieces.length")) > 0 && (await game(b, "g.match.sides[0].pieces.length")) > 0, `round ${round}: both bought`);
  check((await game(a, "g.match.sides[1].pieces.length")) === (await game(a, "g.match.sides[1].seen.length")), `round ${round}: the rival's new pieces are hidden`);
  if (round === 2) await a.screenshot({ path: `${out}/4-deploy.png` });
  await a.click(".btn.fight");
  await a.waitForTimeout(400);
  if (round === 2) { check((await a.textContent(".btn.fight")) === "Waiting", "Ready locks the board and waits"); check((await b.textContent(".cmdr-name")).includes("✓"), "the rival sees you are ready"); }
  await b.click(".btn.fight");
  await Promise.all([a, b].map((p) => p.waitForFunction("window.__game.phase === 'battle' && window.__game.hold <= 0")));
  // Each player's own troops fight from the bottom of their own screen.
  // (Checked on the pieces, not on where the fight has got to: the units start moving at once.)
  for (const p of [a, b]) check(await game(p, "(() => { const mine = g.match.sides[0].pieces, ids = new Set(mine.map((x) => x.id)); const bodies = g.battle.bodies.filter((x) => x.side === 0 && x.pieceId > 0); return mine.length > 0 && mine.every((x) => x.y > 7) && g.match.sides[1].pieces.every((x) => x.y < 7) && bodies.length > 0 && bodies.every((x) => ids.has(x.pieceId)); })()"), `round ${round}: own army starts at the bottom`);
  await a.waitForTimeout(1500);
  if (round === 2) await Promise.all([a.screenshot({ path: `${out}/5-battle-a.png` }), b.screenshot({ path: `${out}/5-battle-b.png` })]);
  for (const p of [a, b]) await p.click(".btn.skip").catch(() => {});
  await Promise.all([a, b].map((p) => p.waitForFunction(`window.__game.phase === 'deploy' && window.__game.match.round === ${round + 1}`, null, { timeout: 30000 })));
  const [ha, hb] = [await game(a, "[g.match.sides[0].hp, g.match.sides[1].hp]"), await game(b, "[g.match.sides[1].hp, g.match.sides[0].hp]")];
  check(ha[0] === hb[0] && ha[1] === hb[1], `round ${round}: both screens agree on the score (${ha.join(" / ")})`);
  await a.waitForTimeout(1300);
}
check((await game(a, "g.o.net.secondsLeft()")) > 30, "the deploy clock is running");
check(/Ready \d+/.test(await a.textContent(".btn.fight")), "the Ready button shows the clock");
await a.screenshot({ path: `${out}/6-clock.png` });

// B quits from the menu: A wins at once.
await b.click(".hud-top .icon-btn");
await b.click(".pause-sheet .btn.danger");
await a.waitForSelector(".results.won");
await a.waitForTimeout(900);
await a.screenshot({ path: `${out}/7-result.png` });
check((await a.textContent(".results")).includes("left the match"), "the winner is told why");
await b.waitForSelector(".vs-code");
check(true, "the quitter is back on Versus");

await browser.close();
if (errors.length) { console.log("\nERRORS:\n" + errors.join("\n")); process.exit(1); }
console.log(`\nAll good. Screenshots in ${out}/`);
