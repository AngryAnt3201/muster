import "./styles.css";
import { DEFAULT_AI, TACTICS, type AIProfile, type Tactic } from "./core/ai";
import { ACTS, LEVELS } from "./core/campaign";
import { levelConfig, objectiveMet, objectiveText, puzzleConfig, puzzleStars, starsFor, type LevelDef, type PuzzleDef } from "./core/content";
import { UNITS, UNIT_KINDS, START_HP, type UnitKind } from "./core/defs";
import { boonChoices, duelConfig, endDuel, gauntletFoe, boardValue, newRun, takeBoon, type GauntletRun } from "./core/gauntlet";
import type { Match } from "./core/match";
import { PUZZLES } from "./core/puzzles";
import { setSound, sfx, unlockAudio } from "./audio/sfx";
import { initNative, setHaptics } from "./native";
import { loadSprites } from "./render/sprites";
import { applyStyleVars } from "./render/style";
import { load, save } from "./save";
import { el, stars } from "./ui/dom";
import { MAP_SIZE } from "./ui/mapdata";
import { mapForAct, nodeFractions, nodePositions, pathUpTo } from "./ui/maplayout";
import { GameScreen, TIER_NAMES, abilityOf, paintPortrait, statsLine } from "./ui/game";

const app = document.getElementById("app")!;
let game: GameScreen | null = null;
let demo: GameScreen | null = null;

function clear() {
  game?.destroy(); game = null;
  for (const c of [...app.children]) if (!c.classList.contains("game") || !demo || c !== demo.root) c.remove();
}
function stopDemo() { demo?.destroy(); demo = null; }

function btn(label: string | Node, cls: string, fn: () => void) {
  const b = el("button", { class: `btn ${cls}` }, [label]);
  b.addEventListener("click", () => { unlockAudio(); sfx("tap"); fn(); });
  return b;
}
function screen(cls: string, ...kids: Node[]) {
  const s = el("div", { class: `screen ${cls}` }, kids);
  app.append(s);
  return s;
}
function header(title: string, back: () => void, right?: Node) {
  return el("div", { class: "screen-head" }, [btn("‹", "icon-btn back", back), el("h1", {}, [title]), right ?? el("span")]);
}
function icon(kind: keyof typeof UNITS, size = 44) {
  const c = el("canvas", { class: "unit-icon", style: `width:${size}px;height:${size}px` }) as HTMLCanvasElement;
  requestAnimationFrame(() => paintPortrait(c, kind));
  return c;
}

// ---------------------------------------------------------------- title
function startDemo() {
  if (demo) return;
  const seed = Math.floor(Math.random() * 1e9);
  const ai = (t: Tactic): AIProfile => ({ ...DEFAULT_AI, difficulty: 0.7, tactic: t, aggression: 0.6 });
  demo = new GameScreen(app, {
    cfg: { seed, firstRound: 7, startGold: [14, 14], hp: [9999, 9999] },
    foe: ai(TACTICS[seed % TACTICS.length]),
    you: ai(TACTICS[(seed >> 3) % TACTICS.length]),
    mode: "demo",
    onEnd: () => {},
    onQuit: () => {},
  });
}

function title() {
  clear();
  startDemo();
  const s = load();
  const camp = Object.keys(s.campaign).length;
  screen("title",
    el("div", { class: "logo" }, [el("span", { class: "logo-word" }, ["MUSTER"]), el("span", { class: "logo-sub" }, ["build · place · clash"])]),
    el("div", { class: "menu" }, [
      btn(el("span", {}, ["Campaign", el("small", {}, [`${camp}/${LEVELS.length}`])]), "primary big", campaign),
      btn(el("span", {}, ["Gauntlet", el("small", {}, [s.gauntlet.best ? `best ${s.gauntlet.best}` : "endless"])]), "big", gauntlet),
      btn(el("span", {}, ["Breakpoint", el("small", {}, [`${Object.keys(s.puzzles).length}/${PUZZLES.length}`])]), "big", puzzles),
      btn(el("span", {}, ["Skirmish", el("small", {}, ["AI lab"])]), "big", skirmish),
    ]),
    el("div", { class: "title-foot" }, [
      btn("Barracks", "ghost small", barracks),
      btn(s.settings.sound ? "Sound on" : "Sound off", "ghost small", () => { save((x) => { x.settings.sound = !x.settings.sound; }); setSound(load().settings.sound); title(); }),
    ]),
  );
}

// ---------------------------------------------------------------- campaign
const unlocked = (id: number) => id === 1 || (load().campaign[id - 1] ?? 0) > 0;
const SVG = "http://www.w3.org/2000/svg";

/** The campaign: one illustrated map per act (by ACTS index), level nodes on the painted road, swipe or arrows between acts. */
function campaign(focusAct?: number) {
  clear();
  const s = load();
  const acts = ACTS.map((name, i) => ({ name, index: i, levels: LEVELS.filter((l) => l.act === i + 1) })).filter((a) => a.levels.length);
  const next = LEVELS.find((l) => unlocked(l.id) && !s.campaign[l.id]) ?? [...LEVELS].reverse().find((l) => unlocked(l.id));
  const want = focusAct ?? next?.act ?? 1;
  let cur = Math.max(0, acts.findIndex((a) => a.index === want - 1));
  const total = Object.values(s.campaign).reduce((a, b) => a + b, 0);

  const kicker = el("small", {});
  const name = el("span", {});
  const actStars = el("span", { class: "act-stars" });
  const head = el("div", { class: "screen-head map-head" }, [
    btn("‹", "icon-btn back", title),
    el("h1", {}, [kicker, name]),
    el("div", { class: "map-totals" }, [actStars, el("span", { class: "star-total" }, [`★ ${total}`])]),
  ]);
  const view = el("div", { class: "map-view" });
  const prev = btn("‹", "icon-btn act-prev", () => go(cur - 1));
  const nextBtn = btn("›", "icon-btn act-next", () => go(cur + 1));
  const dots = el("div", { class: "act-dots" });
  const bar = el("div", { class: "act-bar" }, [prev, dots, nextBtn]);
  const scr = screen("campaign map-screen", head, view, bar);

  const actOpen = (a: (typeof acts)[number]) => unlocked(a.levels[0].id);
  acts.forEach((a, i) => {
    const d = el("button", { class: `act-dot ${actOpen(a) ? "" : "locked"}`, "aria-label": `Act ${a.index + 1}` });
    d.addEventListener("click", () => { sfx("tap"); go(i); });
    dots.append(d);
  });

  let swiped = false;
  function render(dir = 0) {
    const a = acts[cur];
    const map = mapForAct(a.index);
    const open = actOpen(a);
    kicker.textContent = `Act ${a.index + 1} of ${acts.length}`;
    name.textContent = a.name;
    const got = a.levels.reduce((n, l) => n + (s.campaign[l.id] ?? 0), 0);
    actStars.textContent = `${got}/${a.levels.length * 3}`;
    (prev as HTMLButtonElement).disabled = cur === 0;
    (nextBtn as HTMLButtonElement).disabled = cur === acts.length - 1;
    dots.querySelectorAll(".act-dot").forEach((d, i) => d.classList.toggle("on", i === cur));
    scr.style.setProperty("--map-tint", map.tint);

    const pts = nodePositions(map, a.levels.length);
    const reached = a.levels.reduce((k, l, i) => (unlocked(l.id) ? i : k), -1);
    const page = el("div", { class: `map ${open ? "" : "locked"} ${dir > 0 ? "from-right" : dir < 0 ? "from-left" : ""}`, style: `background-image:url(${map.image})` });
    // progress trail: the road walked so far, up to the furthest open node
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("class", "map-trail");
    svg.setAttribute("viewBox", `0 0 ${MAP_SIZE.w} ${MAP_SIZE.h}`);
    svg.setAttribute("preserveAspectRatio", "none");
    if (reached > 0) {
      const t = nodeFractions(a.levels.length)[reached];
      const line = document.createElementNS(SVG, "polyline");
      line.setAttribute("points", pathUpTo(map.path, t).map(([x, y]) => `${(x * MAP_SIZE.w).toFixed(1)},${(y * MAP_SIZE.h).toFixed(1)}`).join(" "));
      svg.append(line);
    }
    page.append(svg);
    a.levels.forEach((l, i) => {
      const lopen = unlocked(l.id);
      const best = s.campaign[l.id] ?? 0;
      const current = next?.id === l.id;
      const [x, y] = pts[i];
      const n = el("button", {
        class: `node ${lopen ? "" : "locked"} ${l.boss ? "boss" : ""} ${best ? "done" : ""} ${current ? "current" : ""}`,
        style: `left:${(x * 100).toFixed(2)}%;top:${(y * 100).toFixed(2)}%`,
        "aria-label": `Level ${l.id}: ${l.name}${lopen ? "" : " (locked)"}`,
      }, [
        el("span", { class: "node-face" }, [lopen ? el("span", { class: "node-id" }, [String(l.id)]) : el("span", { class: "node-lock" })]),
        stars(best),
      ]);
      if (l.boss) n.append(el("span", { class: "node-boss" }, ["Boss"]));
      if (l.unlock && lopen) n.append(icon(l.unlock, 24));
      if (current) n.append(el("span", { class: "node-name" }, [l.name]));
      n.addEventListener("click", () => {
        if (swiped) return;
        if (lopen) { sfx("tap"); levelSheet(l); } else { sfx("deny"); n.classList.remove("shake"); void n.offsetWidth; n.classList.add("shake"); }
      });
      page.append(n);
    });
    if (!open) {
      const prevBoss = LEVELS.find((l) => l.id === a.levels[0].id - 1);
      page.append(el("div", { class: "map-lock" }, [el("span", { class: "node-lock" }), el("b", {}, [`Act ${a.index + 1} is locked`]), el("small", {}, [prevBoss ? `Beat ${prevBoss.foe} to open it` : "Finish the act before it"])]));
    }
    view.replaceChildren(page);
    const focus = page.querySelector(".node.current") ?? page.querySelectorAll(".node")[Math.max(0, reached)];
    requestAnimationFrame(() => (focus as HTMLElement | null)?.scrollIntoView({ block: "center" }));
  }

  function go(i: number) {
    if (i < 0 || i >= acts.length || i === cur) return;
    const dir = i > cur ? 1 : -1;
    cur = i;
    render(dir);
  }

  // Horizontal swipe changes act; vertical drags still scroll the map.
  let sx = 0, sy = 0, down = false;
  view.addEventListener("pointerdown", (e) => { down = true; swiped = false; sx = e.clientX; sy = e.clientY; });
  view.addEventListener("pointerup", (e) => {
    if (!down) return;
    down = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      const before = cur;
      go(cur + (dx < 0 ? 1 : -1));
      if (cur !== before) { swiped = true; sfx("tap"); setTimeout(() => { swiped = false; }, 0); }
    }
  });
  view.addEventListener("pointercancel", () => { down = false; });
  render();
}

function levelSheet(l: LevelDef) {
  const best = load().campaign[l.id] ?? 0;
  const objs = el("ul", { class: "objectives" }, l.stars.map((o, i) => el("li", { class: i < best ? "met" : "" }, ["★ ", objectiveText(o)])));
  const tags = el("div", { class: "tags" }, [
    el("span", { class: "tag" }, [cap(l.ai.tactic)]),
    el("span", { class: "tag" }, [`Rival health ${l.hp[1]}`]),
    ...(l.boss ? [el("span", { class: "tag boss" }, ["boss"])] : []),
  ]);
  const roster = el("div", { class: "roster" }, l.roster.map((k) => {
    const w = el("div", { class: `roster-unit ${k === l.unlock ? "new" : ""}` }, [icon(k, 34)]);
    return w;
  }));
  sheet(el("div", {}, [
    el("div", { class: "sheet-kicker" }, [`Act ${l.act} · Level ${l.id}`]),
    el("h2", {}, [l.name]),
    el("div", { class: "foe-line" }, ["vs ", el("b", {}, [l.foe])]),
    ...(l.line ? [el("p", { class: "flavour" }, [l.line])] : []),
    tags, roster, objs,
    btn("Fight", "primary big", () => { closeSheet(); playLevel(l); }),
  ]));
}

function playLevel(l: LevelDef, attempt = 0) {
  clear(); stopDemo();
  game = new GameScreen(app, {
    cfg: levelConfig(l, attempt),
    foe: l.ai,
    mode: "campaign",
    title: l.name,
    arena: l.act,
    hint: l.id === 1 && !load().campaign[1],
    onEnd: (m) => {
      const n = starsFor(l, m);
      if (n > (load().campaign[l.id] ?? 0)) save((s) => { s.campaign[l.id] = n; });
      const nextL = LEVELS.find((x) => x.id === l.id + 1);
      results(m, {
        heading: m.winner === 0 ? "Victory" : "Defeat",
        stars: m.winner === 0 ? n : undefined,
        lines: l.stars.map((o) => [objectiveText(o), objectiveMet(o, m)] as [string, boolean]),
        primary: m.winner === 0 && nextL ? ["Next level", () => playLevel(nextL)] : ["Retry", () => playLevel(l, attempt + 1)],
        secondary: ["Campaign", () => campaign(l.act)],
      });
    },
    onQuit: () => campaign(l.act),
    onRestart: () => playLevel(l, attempt + 1),
  });
}

// ---------------------------------------------------------------- results
function results(m: Match, o: { heading: string; stars?: number; lines?: [string, boolean][]; note?: string; primary: [string, () => void]; secondary: [string, () => void] }) {
  const won = m.winner === 0;
  const lost = m.history.filter((r) => r.winner === 1).length;
  sheet(el("div", { class: `results ${won ? "won" : "lost"}` }, [
    el("h2", { class: "result-head" }, [o.heading]),
    ...(o.stars !== undefined ? [stars(o.stars)] : []),
    el("div", { class: "result-stats" }, [
      el("span", {}, [el("b", {}, [String(m.played)]), "rounds"]),
      el("span", {}, [el("b", {}, [String(Math.round(m.sides[0].hp))]), "health left"]),
      el("span", {}, [el("b", {}, [String(lost)]), "rounds lost"]),
    ]),
    ...(o.lines ? [el("ul", { class: "objectives" }, o.lines.map(([t, ok]) => el("li", { class: ok ? "met" : "" }, [ok ? "★ " : "☆ ", t])))] : []),
    ...(o.note ? [el("p", { class: "flavour" }, [o.note])] : []),
    btn(o.primary[0], "primary big", () => { closeSheet(); o.primary[1](); }),
    btn(o.secondary[0], "ghost", () => { closeSheet(); o.secondary[1](); }),
  ]), false);
}

// ---------------------------------------------------------------- sheets
let sheetEl: HTMLElement | null = null;
function sheet(content: HTMLElement, dismissable = true) {
  closeSheet();
  sheetEl = el("div", { class: "overlay" }, [el("div", { class: "sheet" }, [content])]);
  if (dismissable) sheetEl.addEventListener("click", (e) => { if (e.target === sheetEl) closeSheet(); });
  app.append(sheetEl);
}
function closeSheet() { sheetEl?.remove(); sheetEl = null; }

// ---------------------------------------------------------------- breakpoint
function puzzles() {
  clear();
  const s = load();
  const grid = el("div", { class: "puzzle-grid" }, PUZZLES.map((p, i) => {
    const open = i === 0 || (s.puzzles[PUZZLES[i - 1].id] ?? 0) > 0;
    const b = el("button", { class: `tile ${open ? "" : "locked"} ${s.puzzles[p.id] ? "done" : ""}` }, [
      el("span", { class: "tile-id" }, [String(p.id)]), el("span", { class: "tile-name" }, [p.name]), stars(s.puzzles[p.id] ?? 0),
    ]);
    b.addEventListener("click", () => { if (open) { sfx("tap"); playPuzzle(p); } else sfx("deny"); });
    return b;
  }));
  screen("puzzles", header("Breakpoint", title), grid);
}

function playPuzzle(p: PuzzleDef) {
  clear(); stopDemo();
  game = new GameScreen(app, {
    cfg: puzzleConfig(p),
    mode: "puzzle",
    title: p.name,
    showEnemyMines: true,
    onEnd: (m) => {
      const won = m.history[0]?.winner === 0;
      const n = puzzleStars(p, won, m.sides[0].gold);
      if (n > (load().puzzles[p.id] ?? 0)) save((s) => { s.puzzles[p.id] = n; });
      const next = PUZZLES[PUZZLES.indexOf(p) + 1];
      results(m, {
        heading: won ? "Solved" : "Not yet",
        stars: won ? n : undefined,
        lines: [["Win the battle", won], [`Keep ${p.silver}+ gold`, won && m.sides[0].gold >= p.silver], [`Keep ${p.par}+ gold`, won && m.sides[0].gold >= p.par]],
        primary: won && next ? ["Next puzzle", () => playPuzzle(next)] : ["Try again", () => playPuzzle(p)],
        secondary: ["Puzzles", puzzles],
      });
    },
    onQuit: puzzles,
    onRestart: () => playPuzzle(p),
  });
}

// ---------------------------------------------------------------- gauntlet
let run: GauntletRun | null = null;

function gauntlet() {
  clear();
  const s = load();
  screen("gauntlet", header("Gauntlet", title),
    el("div", { class: "panel" }, [
      el("p", { class: "lead" }, ["One health pool. Rival after rival. Your army carries on, and every win brings a boon."]),
      el("div", { class: "result-stats" }, [
        el("span", {}, [el("b", {}, [String(s.gauntlet.best)]), "best"]),
        el("span", {}, [el("b", {}, [String(s.gauntlet.runs)]), "runs"]),
      ]),
      ...(run && !run.over ? [btn(`Continue · rival ${run.stage}`, "primary big", () => duel())] : []),
      btn("New run", run && !run.over ? "big" : "primary big", () => { run = newRun(Math.floor(Math.random() * 1e9)); save((x) => { x.gauntlet.runs++; }); duel(); }),
    ]));
}

function duel() {
  if (!run) return;
  clear(); stopDemo();
  const r = run;
  const foe = gauntletFoe(r.stage, boardValue(r.board), r.seed);
  game = new GameScreen(app, {
    cfg: duelConfig(r, foe),
    foe: foe.ai,
    mode: "gauntlet",
    title: `Rival ${r.stage}`,
    onEnd: (m) => {
      const won = endDuel(r, m);
      if (!won) {
        if (r.wins > load().gauntlet.best) save((s) => { s.gauntlet.best = r.wins; });
        results(m, {
          heading: "Run over",
          note: `You beat ${r.wins} rival${r.wins === 1 ? "" : "s"}.`,
          primary: ["New run", () => { run = newRun(Math.floor(Math.random() * 1e9)); save((x) => { x.gauntlet.runs++; }); duel(); }],
          secondary: ["Menu", title],
        });
        return;
      }
      if (r.wins > load().gauntlet.best) save((s) => { s.gauntlet.best = r.wins; });
      boonPick(r);
    },
    onQuit: gauntlet,
  });
}

function boonPick(r: GauntletRun) {
  const choices = boonChoices(r);
  sheet(el("div", { class: "boons" }, [
    el("div", { class: "sheet-kicker" }, [`Rival ${r.stage - 1} beaten · ${Math.round(r.hp)} health left`]),
    el("h2", {}, ["Choose a boon"]),
    el("div", { class: "boon-list" }, choices.map((b) => btn(el("span", {}, [el("b", {}, [b.name]), el("small", {}, [b.text])]), "boon", () => { takeBoon(r, b.id); closeSheet(); duel(); }))),
  ]), false);
}

// ---------------------------------------------------------------- skirmish / AI lab
interface Lab { foe: AIProfile; you: AIProfile; watch: boolean; hp: [number, number]; }

function skirmish() {
  clear();
  const lab: Lab = { foe: { ...DEFAULT_AI }, you: { ...DEFAULT_AI, difficulty: 0.8 }, watch: false, hp: [START_HP, START_HP], ...(load().lab as Partial<Lab> | undefined) };
  const persist = () => save((s) => { s.lab = lab; });
  const profileEditor = (p: AIProfile, label: string) => {
    const slider = (key: "difficulty" | "aggression" | "economy" | "spread", name: string, lo: string, hi: string) => {
      const out = el("output", {}, [String(Math.round(p[key] * 100))]);
      const input = el("input", { type: "range", min: "0", max: "100", value: String(Math.round(p[key] * 100)) }) as HTMLInputElement;
      input.addEventListener("input", () => { p[key] = Number(input.value) / 100; out.textContent = input.value; persist(); });
      return el("label", { class: "slider" }, [el("span", { class: "slider-name" }, [name, out]), input, el("span", { class: "slider-ends" }, [el("i", {}, [lo]), el("i", {}, [hi])])]);
    };
    const chips = el("div", { class: "chips" }, TACTICS.map((t) => {
      const c = el("button", { class: `chip ${p.tactic === t ? "on" : ""}` }, [t]);
      c.addEventListener("click", () => { p.tactic = t; persist(); sfx("tap"); chips.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x.textContent === t)); });
      return c;
    }));
    const rr = el("output", {}, [String(p.rerolls)]);
    const rerolls = el("input", { type: "range", min: "0", max: "3", value: String(p.rerolls) }) as HTMLInputElement;
    rerolls.addEventListener("input", () => { p.rerolls = Number(rerolls.value); rr.textContent = rerolls.value; persist(); });
    return el("section", { class: "profile" }, [
      el("h2", {}, [label]),
      slider("difficulty", "Difficulty", "green", "ruthless"),
      slider("aggression", "Aggression", "turtle", "all-in"),
      slider("economy", "Economy", "spend it", "bank it"),
      slider("spread", "Formation", "column", "wide"),
      el("label", { class: "slider" }, [el("span", { class: "slider-name" }, ["Rerolls a round", rr]), rerolls]),
      el("div", { class: "slider-name" }, ["Tactic"]), chips,
    ]);
  };
  const hpRow = (i: 0 | 1, name: string) => {
    const out = el("output", {}, [String(lab.hp[i])]);
    const input = el("input", { type: "range", min: "50", max: "800", step: "50", value: String(lab.hp[i]) }) as HTMLInputElement;
    input.addEventListener("input", () => { lab.hp[i] = Number(input.value); out.textContent = input.value; persist(); });
    return el("label", { class: "slider" }, [el("span", { class: "slider-name" }, [name, out]), input]);
  };
  const youBox = el("div", { class: lab.watch ? "" : "hidden" }, [profileEditor(lab.you, "Your side's AI")]);
  const watch = el("label", { class: "toggle" }, [el("input", { type: "checkbox", ...(lab.watch ? { checked: "" } : {}) }), el("span", {}, ["Watch AI vs AI"])]);
  watch.querySelector("input")!.addEventListener("change", (e) => { lab.watch = (e.target as HTMLInputElement).checked; youBox.classList.toggle("hidden", !lab.watch); persist(); });
  screen("lab", header("Skirmish", title),
    el("div", { class: "lab-body" }, [
      profileEditor(lab.foe, "Rival AI"),
      el("section", { class: "profile" }, [el("h2", {}, ["Health"]), hpRow(0, "You"), hpRow(1, "Rival")]),
      watch, youBox,
    ]),
    el("div", { class: "lab-foot" }, [btn("Start", "primary big", () => playSkirmish(lab))]),
  );
}

function playSkirmish(lab: Lab) {
  clear(); stopDemo();
  game = new GameScreen(app, {
    cfg: { seed: Math.floor(Math.random() * 1e9), hp: lab.hp, names: [lab.watch ? "Blue AI" : "You", `${cap(lab.foe.tactic)} AI`] },
    foe: { ...lab.foe },
    you: lab.watch ? { ...lab.you } : undefined,
    mode: lab.watch ? "watch" : "skirmish",
    title: "Skirmish",
    onEnd: (m) => results(m, {
      heading: m.winner === 0 ? (lab.watch ? "Blue wins" : "Victory") : m.winner === 1 ? (lab.watch ? "Red wins" : "Defeat") : "Draw",
      primary: ["Again", () => playSkirmish(lab)],
      secondary: ["AI lab", skirmish],
    }),
    onQuit: skirmish,
    onRestart: () => playSkirmish(lab),
  });
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- barracks
function barracks() {
  clear();
  const list = el("div", { class: "barracks" }, UNIT_KINDS.map((k: UnitKind) => {
    const d = UNITS[k];
    const face = el("canvas", { class: "b-portrait" }) as HTMLCanvasElement;
    let tier = 1;
    const tiers = el("div", { class: "b-tiers" }, TIER_NAMES.map((n, i) => {
      const b = el("button", { class: `chip ${i === 0 ? "on" : ""}` }, [n]);
      b.addEventListener("click", () => {
        tier = i + 1; sfx("tap");
        tiers.querySelectorAll(".chip").forEach((c, j) => c.classList.toggle("on", j === i));
        paintPortrait(face, k, tier);
      });
      return b;
    }));
    requestAnimationFrame(() => paintPortrait(face, k, 1));
    const ab = abilityOf(k);
    return el("div", { class: "b-card" }, [
      el("div", { class: "b-top" }, [face, el("div", { class: "b-id" }, [
        el("div", { class: "b-name" }, [el("b", {}, [d.name]), el("span", { class: "b-cost" }, [String(d.cost)])]),
        el("div", { class: "b-short" }, [d.short]),
        el("div", { class: "b-stats" }, [statsLine(k)]),
      ])]),
      tiers,
      ...(ab ? [el("div", { class: "pop-ability" }, [el("b", {}, [`Ascended · ${ab.name}`]), " ", ab.text])] : []),
    ]);
  }));
  screen("barracks-screen", header("Barracks", title, el("span", { class: "star-total" }, [`${UNIT_KINDS.length} units`])), list);
}

// ---------------------------------------------------------------- showcase (debug / store shots)
function showcase(n: number) {
  clear(); stopDemo();
  const sets: [string, number, number, number][][] = [
    [["pikeman", 3.0, 4.8, 4], ["ravager", 6.0, 4.6, 3], ["rime", 2.2, 2.6, 4], ["tinker", 6.8, 2.2, 3], ["banner", 4.5, 3.2, 4], ["grave", 4.5, 1.2, 3]],
    [["lancer", 2.0, 3.6, 4], ["keg", 4.5, 4.9, 3], ["harrier", 6.5, 3.4, 4], ["sapper", 7.6, 4.2, 3], ["trickster", 3.4, 2.4, 4], ["bombard", 4.5, 0.8, 3]],
  ];
  const [mine, theirs] = n === 2 ? [sets[1], sets[0]] : sets;
  const start = (list: [string, number, number, number][]) => list.map(([kind, lx, depth, rank]) => ({ kind: kind as UnitKind, lx, depth, rank }));
  const ai = (t: Tactic): AIProfile => ({ ...DEFAULT_AI, difficulty: 0.6, tactic: t, economy: 1 });
  game = new GameScreen(app, {
    cfg: { seed: 7 + n, hp: [400, 400], firstRound: 6, start: [start(mine), start(theirs)], names: ["Tide", "Ember"] },
    foe: ai("balanced"),
    you: ai("balanced"),
    mode: "watch",
    title: "Showcase",
    onEnd: () => title(),
    onQuit: title,
  });
}

// ---------------------------------------------------------------- boot
async function boot() {
  applyStyleVars(document.documentElement);
  const s = load();
  setSound(s.settings.sound);
  setHaptics(s.settings.haptics);
  await Promise.all([initNative(), loadSprites()]);
  window.addEventListener("pointerdown", () => unlockAudio(), { once: true });
  const q = new URLSearchParams(location.search);
  // Deep links for checks: ?level=3, ?puzzle=2, ?lab, ?gauntlet, ?watch
  if (q.has("level")) { const l = LEVELS.find((x) => x.id === Number(q.get("level"))); if (l) return playLevel(l); }
  if (q.has("puzzle")) { const p = PUZZLES.find((x) => x.id === Number(q.get("puzzle"))); if (p) return playPuzzle(p); }
  if (q.has("campaign")) return campaign(Number(q.get("campaign")) || undefined);
  if (q.has("puzzles")) return puzzles();
  if (q.has("lab")) return skirmish();
  if (q.has("barracks")) return barracks();
  if (q.has("gauntlet")) { run = newRun(42); return duel(); }
  if (q.has("showcase")) return showcase(Number(q.get("showcase")) || 1);
  if (q.has("watch")) return playSkirmish({ foe: { ...DEFAULT_AI, tactic: "blitz" }, you: { ...DEFAULT_AI, difficulty: 0.9, tactic: "artillery" }, watch: true, hp: [400, 400] });
  title();
}
void boot();
