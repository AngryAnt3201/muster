// Builds outputs/signoff/arenas/index.html: every act's arena with real level obstacles drawn as props, the same
// placement maths as the game (src/render/arena.ts), and a toggle that overlays the collision circles.
//   npx vite-node tools/arena-preview.ts
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LEVELS } from "../src/core/campaign";
import { H, W, type Obstacle } from "../src/core/defs";
import { propVariant, type ArenaManifest } from "../src/render/arena";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "public", "arenas");
const OUT = join(ROOT, "outputs", "signoff", "arenas");
mkdirSync(OUT, { recursive: true });
const man = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8")) as ArenaManifest;

// Acts without levels yet (the 7-act campaign isn't on this branch) get a showcase layout.
const SHOWCASE: Obstacle[] = [{ x: 1.6, y: 6.4, r: 0.6 }, { x: 4.5, y: 7.4, r: 0.75 }, { x: 7.4, y: 6.6, r: 0.55 }, { x: 3, y: 8.6, r: 0.45 }];
const acts = Object.keys(man.acts).map(Number).sort((a, b) => a - b).map((a) => {
  const info = man.acts[String(a)];
  const withObs = LEVELS.filter((l) => l.act === a && l.obstacles?.length);
  const pick = withObs.sort((p, q) => (q.obstacles!.length - p.obstacles!.length))[0];
  const obstacles = (pick?.obstacles ?? SHOWCASE).map((o) => ({ ...o, v: propVariant(o, info.props.length) }));
  // Half-size copies keep the page light; the game ships the full-size art.
  const ground = `act${a}.jpg`;
  execFileSync("sips", ["-Z", String(Math.round(Math.max(...info.size) / 2)), join(SRC, info.ground), "--out", join(OUT, ground)], { stdio: "ignore" });
  const props = info.props.map((p) => {
    execFileSync("sips", ["-Z", String(man.propRes / 2), join(SRC, p.file), "--out", join(OUT, p.file)], { stdio: "ignore" });
    return { file: p.file, footprint: p.footprint };
  });
  return { act: a, name: info.name, edge: info.edge, obstacle: info.obstacle, ground, props, anchor: info.anchor, obstacles, level: pick ? `${pick.id}. ${pick.name}` : "showcase layout" };
});

const data = { elev: man.elev, world: man.world, propFrame: man.propFrame, W, H, acts };
writeFileSync(join(OUT, "index.html"), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Muster arenas</title>
<style>
body{margin:0;background:#11141b;color:#e8e4da;font:14px/1.4 -apple-system,system-ui,sans-serif}
header{padding:14px 18px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
h1{font-size:18px;margin:0}
label{display:flex;gap:6px;align-items:center;cursor:pointer}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;padding:0 18px 24px}
figure{margin:0;background:#1b1f29;border-radius:12px;padding:10px}
canvas{width:100%;border-radius:8px;display:block}
figcaption{margin-top:8px}
figcaption b{font-size:15px}
small{color:#9aa0ac}
.props{display:flex;gap:4px;margin-top:6px}
.props img{width:33%;background:#2a2f3b;border-radius:6px}
</style></head><body>
<header><h1>Arenas per act</h1>
<label><input type="checkbox" id="circles"> show collision circles</label>
<label><input type="checkbox" id="units" checked> sample units walking behind and in front</label>
<small>Phone-sized board (9 x 14) with the Blender backdrop and obstacle props from real levels. Props hide units behind them.</small></header>
<div class="grid" id="grid"></div>
<script>
const D = ${JSON.stringify(data)};
const grid = document.getElementById("grid");
const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
const views = [];
for (const a of D.acts) {
  const f = document.createElement("figure");
  const c = document.createElement("canvas");
  f.appendChild(c);
  const cap = document.createElement("figcaption");
  cap.innerHTML = "<b>Act " + a.act + ": " + a.name + "</b><br><small>" + a.obstacle + " props, layout from " + a.level + "</small>";
  const strip = document.createElement("div"); strip.className = "props";
  for (const p of a.props) { const i = document.createElement("img"); i.src = p.file; i.title = "footprint " + p.footprint + " of the collision radius"; strip.appendChild(i); }
  cap.appendChild(strip);
  f.appendChild(cap);
  grid.appendChild(f);
  views.push({ a, c });
}
Promise.all(views.map(async (v) => { v.ground = await load(v.a.ground); v.props = await Promise.all(v.a.props.map((p) => load(p.file))); })).then(() => requestAnimationFrame(frame));
const stretch = 1 / Math.sin(D.elev * Math.PI / 180);
function frame(t) {
  const circles = document.getElementById("circles").checked, units = document.getElementById("units").checked;
  for (const v of views) draw(v, t / 1000, circles, units);
  requestAnimationFrame(frame);
}
function draw(v, t, circles, units) {
  const c = v.c, cw = c.clientWidth, ch = Math.round(cw * 19.5 / 9), dpr = devicePixelRatio || 1;
  if (c.width !== cw * dpr) { c.width = cw * dpr; c.height = ch * dpr; }
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = Math.min((cw - 16) / D.W, (ch - 120) / D.H), ox = (cw - D.W * s) / 2, oy = (ch - D.H * s) / 2;
  const sx = (x) => ox + x * s, sy = (y) => oy + y * s;
  g.fillStyle = v.a.edge; g.fillRect(0, 0, cw, ch);
  g.drawImage(v.ground, sx(D.world.x), sy(D.world.y), D.world.w * s, D.world.h * s);
  g.fillStyle = "rgba(6,10,18,0.28)"; g.beginPath(); g.rect(0, 0, cw, ch); g.rect(sx(0), sy(0), D.W * s, D.H * s); g.fill("evenodd");
  g.strokeStyle = "rgba(255,255,255,0.18)"; g.lineWidth = 1.5; g.strokeRect(sx(0), sy(0), D.W * s, D.H * s);
  const rect = (o) => { const w = D.propFrame * o.r * s, h = w * stretch; return { x: sx(o.x) - w * v.a.anchor[0], y: sy(o.y) - h * v.a.anchor[1], w, h }; };
  const obs = [...v.a.obstacles].sort((p, q) => p.y - q.y);
  for (const o of obs) { const r = rect(o); g.drawImage(v.props[o.v], r.x, r.y, r.w, r.h); }
  // sample "units": discs marching up and down the lanes past the props, painted in depth order
  const bodies = [];
  if (units) for (let i = 0; i < 6; i++) {
    const x = 0.9 + i * 1.45, y = 7 + Math.sin(t * 0.5 + i * 1.3) * 3.2;
    bodies.push({ x, y, side: i % 2 });
  }
  bodies.sort((p, q) => p.y - q.y);
  let k = 0;
  const repaint = (y) => { while (k < obs.length && obs[k].y <= y) { const o = obs[k++], r = rect(o), cx = sx(o.x), cy = sy(o.y), hw = o.r * s * 1.06; g.save(); g.beginPath(); g.rect(cx - hw, r.y, hw * 2, cy - r.y); g.clip(); g.drawImage(v.props[o.v], r.x, r.y, r.w, r.h); g.restore(); } };
  for (const b of bodies) {
    repaint(b.y);
    const x = sx(b.x), y = sy(b.y), r = 0.32 * s;
    g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.ellipse(x, y, r, r * 0.5, 0, 0, 7); g.fill();
    g.fillStyle = b.side ? "#ff6a4d" : "#3fd0c9"; g.strokeStyle = "#141016"; g.lineWidth = 2;
    g.beginPath(); g.ellipse(x, y - r * 1.1, r * 0.75, r * 1.1, 0, 0, 7); g.fill(); g.stroke();
  }
  repaint(Infinity);
  if (circles) for (const o of obs) {
    g.strokeStyle = "#ffe14d"; g.lineWidth = 2; g.setLineDash([4, 3]);
    g.beginPath(); g.arc(sx(o.x), sy(o.y), o.r * s, 0, 7); g.stroke(); g.setLineDash([]);
  }
}
</script></body></html>
`);
console.log(`wrote ${join(OUT, "index.html")} with ${acts.length} acts`);
