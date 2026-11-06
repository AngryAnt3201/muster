import "./styles.css";
import { DEFAULT_AI, TACTICS, type AIProfile, type Tactic } from "./core/ai";
import { ACTS, LEVELS } from "./core/campaign";
import { levelConfig, objectiveMet, objectiveText, puzzleConfig, puzzleStars, starsFor, type LevelDef, type PuzzleDef } from "./core/content";
import { UNITS, START_HP } from "./core/defs";
import { boonChoices, duelConfig, endDuel, gauntletFoe, boardValue, newRun, takeBoon, type GauntletRun } from "./core/gauntlet";
import type { Match } from "./core/match";
import { PUZZLES } from "./core/puzzles";
import { setSound, sfx, unlockAudio } from "./audio/sfx";
import { initNative, setHaptics } from "./native";
import { loadSprites } from "./render/sprites";
import { load, save } from "./save";
import { el, stars } from "./ui/dom";
import { GameScreen, paintPortrait } from "./ui/game";

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
    el("div", { class: "title-foot" }, [btn(s.settings.sound ? "🔊" : "🔇", "icon-btn", () => { save((x) => { x.settings.sound = !x.settings.sound; }); setSound(load().settings.sound); title(); })]),
  );
}

// ---------------------------------------------------------------- campaign
const unlocked = (id: number) => id === 1 || (load().campaign[id - 1] ?? 0) > 0;

function campaign() {
  clear();
  const s = load();
  const total = Object.values(s.campaign).reduce((a, b) => a + b, 0);
  const list = el("div", { class: "acts" });
  ACTS.forEach((name, i) => {
    const act = i + 1;
    const levels = LEVELS.filter((l) => l.act === act);
    if (!levels.length) return;
    const nodes = levels.map((l) => {
      const open = unlocked(l.id);
      const n = el("button", { class: `node ${open ? "" : "locked"} ${l.boss ? "boss" : ""} ${s.campaign[l.id] ? "done" : ""}` }, [
        el("span", { class: "node-id" }, [String(l.id)]),
        stars(s.campaign[l.id] ?? 0),
      ]);
      if (l.unlock) n.append(icon(l.unlock, 26));
      n.addEventListener("click", () => { if (open) { sfx("tap"); levelSheet(l); } else sfx("deny"); });
      return n;
    });
    list.append(el("section", { class: "act" }, [el("h2", {}, [el("small", {}, [`Act ${act}`]), name]), el("div", { class: "nodes" }, nodes)]));
  });
  screen("campaign", header("Campaign", title, el("span", { class: "star-total" }, [`★ ${total}`])), list);
  // Scroll to the first unplayed level.
  const next = LEVELS.find((l) => unlocked(l.id) && !s.campaign[l.id]);
  if (next) requestAnimationFrame(() => (list.querySelectorAll(".node")[next.id - 1] as HTMLElement)?.scrollIntoView({ block: "center" }));
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
        secondary: ["Campaign", campaign],
      });
    },
    onQuit: campaign,
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

// ---------------------------------------------------------------- boot
async function boot() {
  const s = load();
  setSound(s.settings.sound);
  setHaptics(s.settings.haptics);
  await Promise.all([initNative(), loadSprites()]);
  window.addEventListener("pointerdown", () => unlockAudio(), { once: true });
  const q = new URLSearchParams(location.search);
  // Deep links for checks: ?level=3, ?puzzle=2, ?lab, ?gauntlet, ?watch
  if (q.has("level")) { const l = LEVELS.find((x) => x.id === Number(q.get("level"))); if (l) return playLevel(l); }
  if (q.has("puzzle")) { const p = PUZZLES.find((x) => x.id === Number(q.get("puzzle"))); if (p) return playPuzzle(p); }
  if (q.has("campaign")) return campaign();
  if (q.has("puzzles")) return puzzles();
  if (q.has("lab")) return skirmish();
  if (q.has("gauntlet")) { run = newRun(42); return duel(); }
  if (q.has("watch")) return playSkirmish({ foe: { ...DEFAULT_AI, tactic: "blitz" }, you: { ...DEFAULT_AI, difficulty: 0.9, tactic: "artillery" }, watch: true, hp: [400, 400] });
  title();
}
void boot();
