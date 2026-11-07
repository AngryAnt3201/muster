// The Barracks: every unit with its persistent level, current -> next stats, the coin cost and an Upgrade button.
// Also the coin line on result screens. Rules live in src/progression; coins move only through the wallet.
import "./barracks.css";
import { ACTS, rosterAt } from "../core/campaign";
import { UNITS, UNIT_KINDS, type UnitKind } from "../core/defs";
import { MAX_LEVEL, levelDmg, levelHp } from "../core/levels";
import { onWalletChange, wallet } from "../economy/wallet";
import { currencyBar } from "./currency";
import { buzz } from "../native";
import { unlockAudio, sfx } from "../audio/sfx";
import type { Reward } from "../progression/economy";
import { currentCap, troopState, upgradeTroop } from "../progression/troops";
import { abilityOf, framedPortrait, paintPortrait, ribbon, TIER_NAMES } from "./game";
import { el, fmt } from "./dom";
import { ROLE_FAMILY, ROLE_LABEL, icon, roleBadge } from "./kit";

/** Counts a number element from a to b. */
function tick(node: HTMLElement, a: number, b: number, ms: number, digits = 0, prefix = "") {
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3;
    const v = a + (b - a) * e;
    node.textContent = prefix + (digits ? fmt(v) : Math.round(v).toLocaleString("en"));
    if (k < 1 && node.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const unlockLevel = (k: UnitKind) => { for (let id = 1; id <= ACTS.length * 6; id++) if (rosterAt(id).includes(k)) return id; return 0; };
/** The act whose boss lifts the cap above `cap` (the cap is 2 + acts cleared). */
const actForCap = (cap: number) => Math.min(ACTS.length, cap - 1);

/** The two stats a level changes, at rank 1: [label, value at a level]. */
function statRows(k: UnitKind): [string, (lv: number) => number, number][] {
  const d = UNITS[k], bodies = d.bodies ?? 1;
  const rows: [string, (lv: number) => number, number][] = [];
  if (d.hp > 1) rows.push(["Health", (lv) => Math.round(d.hp * bodies * levelHp(lv)), 0]); // a Mine's 1 hp never changes
  if (d.dmg) rows.push([bodies > 1 ? "Damage each" : "Damage", (lv) => d.dmg * levelDmg(lv), 1]);
  else if (k === "medic") rows.push(["Healing", (lv) => 26 * levelDmg(lv), 1]);
  else if (k === "hive") rows.push(["Mite health", (lv) => Math.round(22 * levelHp(lv)), 0]);
  else if (k === "grave") rows.push(["Thrall health", (lv) => Math.round(80 * levelHp(lv)), 0]);
  return rows;
}
const show = (v: number, digits: number) => (digits ? fmt(v) : v.toLocaleString("en"));

export interface BarracksOpts { app: HTMLElement; back: () => void; shop: () => void; }

export function barracksScreen(o: BarracksOpts) {
  const head = el("div", { class: "screen-head" }, []);
  const backBtn = el("button", { class: "icon-btn back", "aria-label": "Back" }, [icon("back")]);
  backBtn.addEventListener("click", () => { unlockAudio(); sfx("tap"); o.back(); });
  head.append(backBtn, el("h1", {}, ["Barracks"]), currencyBar("barracks-cur", ["coins"]));

  const cap = currentCap();
  const pips = el("div", { class: "pg-pips" }, Array.from({ length: MAX_LEVEL }, (_, i) => el("i", { class: i < cap ? "on" : "" })));
  const capNote = cap >= MAX_LEVEL ? "Every level is open." : `Beat the boss of Act ${actForCap(cap)} to open level ${cap + 1}.`;
  const capBox = el("div", { class: "pg-capbox" }, [
    el("div", { class: "pg-cap-top" }, [el("b", {}, [`Level cap ${cap}`]), el("span", {}, [`of ${MAX_LEVEL}`])]),
    pips,
    el("small", {}, [capNote]),
  ]);

  const kinds = [...UNIT_KINDS].sort((a, b) => unlockLevel(a) - unlockLevel(b));
  const states = new Map(kinds.map((k) => [k, troopState(k)]));
  kinds.sort((a, b) => Number(states.get(a)!.locked) - Number(states.get(b)!.locked));
  const cards = new Map<UnitKind, HTMLElement>();
  const list = el("div", { class: "pg-list" }, kinds.map((k) => { const c = card(k); cards.set(k, c); return c; }));
  const scr = el("div", { class: "screen barracks-screen pg-barracks" }, [head, capBox, list]);
  o.app.append(scr);

  // Coins changed (an upgrade, or gems turned into coins on the Shop): refresh the buttons that depend on them.
  const off = onWalletChange(() => {
    if (!scr.isConnected) { off(); return; }
    for (const [k, c] of cards) if (!c.classList.contains("leveling")) refreshButton(k, c);
  });

  function card(k: UnitKind): HTMLElement {
    const d = UNITS[k], st = troopState(k);
    const { frame, canvas } = framedPortrait(k, 1, "pg-portrait");
    if (st.locked) {
      return el("div", { class: `pg-card locked fam-${roleFam(k)}` }, [
        el("div", { class: "pg-face" }, [frame, el("span", { class: "pg-lock" }, [icon("lock")])]),
        el("div", { class: "pg-id" }, [
          el("b", { class: "pg-name" }, [d.name]),
          el("span", { class: "role-line" }, [roleBadge(d.role), ROLE_LABEL[d.role]]),
          el("small", { class: "pg-unlock" }, [`Unlocks at campaign level ${unlockLevel(k)}`]),
        ]),
      ]);
    }
    // Tap the portrait to preview its rank art (Recruit to Ascended), as the old Barracks did.
    let tier = 1;
    const tierName = el("small", { class: "pg-tier" }, [TIER_NAMES[0]]);
    frame.addEventListener("click", () => {
      tier = (tier % 4) + 1; sfx("tap");
      frame.classList.remove("t1", "t2", "t3", "t4"); frame.classList.add(`t${tier}`);
      paintPortrait(canvas, k, tier); tierName.textContent = TIER_NAMES[tier - 1];
    });
    const badge = el("span", { class: "pg-lv" }, [el("small", {}, ["Lv"]), el("b", {}, [String(st.level)])]);
    const bar = el("div", { class: "pg-bar" }, Array.from({ length: MAX_LEVEL }, (_, i) => el("i", { class: `${i < st.level ? "on" : ""} ${i >= st.cap ? "shut" : ""}` })));
    const stats = el("div", { class: "pg-stats" }, statRows(k).map(([label]) => el("div", { class: "pg-stat" }, [el("span", {}, [label]), el("b", { class: "now" }), el("i", { class: "arrow" }, ["→"]), el("b", { class: "next" })])));
    const ab = abilityOf(k);
    const c = el("div", { class: `pg-card fam-${roleFam(k)}` }, [
      el("div", { class: "pg-face" }, [frame, badge, tierName]),
      el("div", { class: "pg-id" }, [
        el("div", { class: "pg-name-row" }, [el("b", { class: "pg-name" }, [d.name]), el("span", { class: "role-line" }, [roleBadge(d.role), ROLE_LABEL[d.role]])]),
        bar, stats,
        el("div", { class: "pg-act" }),
      ]),
      ...(ab ? [el("div", { class: "pg-ability" }, [el("b", {}, [`Ascended: ${ab.name}`]), " ", ab.text])] : []),
    ]);
    // Tap the card (not its buttons or portrait) to show the Ascended ability.
    c.addEventListener("click", (e) => { if (!(e.target as HTMLElement).closest("button, .frame")) c.classList.toggle("open"); });
    paintStats(k, c);
    refreshButton(k, c);
    return c;
  }

  function paintStats(k: UnitKind, c: HTMLElement) {
    const st = troopState(k);
    const atTop = st.level >= MAX_LEVEL;
    c.querySelectorAll<HTMLElement>(".pg-stat").forEach((row, i) => {
      const [, f, digits] = statRows(k)[i];
      row.querySelector(".now")!.textContent = show(f(st.level), digits);
      row.querySelector(".next")!.textContent = atTop ? "" : show(f(st.level + 1), digits);
      row.classList.toggle("top", atTop);
    });
  }

  function refreshButton(k: UnitKind, c: HTMLElement) {
    const st = troopState(k);
    const slot = c.querySelector(".pg-act");
    if (!slot) return;
    c.classList.toggle("ready", st.why === null);
    if (st.why === "max") { slot.replaceChildren(el("span", { class: "pg-max" }, [icon("crown"), "Max level"])); return; }
    if (st.why === "cap") { slot.replaceChildren(el("span", { class: "pg-capped" }, [icon("lock"), `Cap ${st.cap} · beat Act ${actForCap(st.cap)}`])); return; }
    const cost = el("span", { class: "pg-cost" }, [el("i", { class: "pg-coin" }), st.cost.toLocaleString("en")]);
    if (st.why === "coins") {
      const short = st.cost - wallet().coins;
      const get = el("button", { class: "btn small pg-get" }, ["Get coins"]);
      get.addEventListener("click", () => { unlockAudio(); sfx("tap"); o.shop(); });
      slot.replaceChildren(el("span", { class: "pg-short" }, [cost, el("small", {}, [`${short.toLocaleString("en")} short`])]), get);
      return;
    }
    const up = el("button", { class: "btn small gold pg-up" }, [el("span", {}, ["Upgrade"]), cost]);
    up.addEventListener("click", () => { unlockAudio(); levelUp(k, c); });
    slot.replaceChildren(up);
  }

  function levelUp(k: UnitKind, c: HTMLElement) {
    const before = troopState(k).level;
    const after = upgradeTroop(k);
    if (after === null) { sfx("deny"); buzz("error"); refreshButton(k, c); return; }
    sfx("upgrade"); buzz("success");
    setTimeout(() => sfx("win", 0.5), 220);
    // The moment: the card flashes gold, rays spin behind the portrait, the badge pops, stats count up with +n floaters.
    c.classList.remove("leveling"); void c.offsetWidth; c.classList.add("leveling");
    const face = c.querySelector(".pg-face")!;
    face.querySelector(".pg-rays")?.remove();
    face.prepend(el("i", { class: "pg-rays" }));
    const lv = c.querySelector(".pg-lv b") as HTMLElement;
    lv.textContent = String(after);
    c.querySelectorAll(".pg-bar i").forEach((p, i) => p.classList.toggle("on", i < after));
    c.querySelector(".pg-bar")!.children[after - 1]?.classList.add("new");
    statRows(k).forEach(([, f, digits], i) => {
      const row = c.querySelectorAll<HTMLElement>(".pg-stat")[i];
      const now = row.querySelector(".now") as HTMLElement;
      tick(now, f(before), f(after), 650, digits);
      const gain = f(after) - f(before);
      const float = el("i", { class: "pg-float" }, [`+${show(gain, digits)}`]);
      row.append(float);
      setTimeout(() => float.remove(), 1200);
      row.querySelector(".next")!.textContent = after >= MAX_LEVEL ? "" : show(f(after + 1), digits);
      row.classList.toggle("top", after >= MAX_LEVEL);
    });
    const toast = el("div", { class: "pg-toast" }, [ribbon(`Level ${after}!`, "gold"), el("small", {}, [UNITS[k].name])]);
    scr.append(toast);
    setTimeout(() => toast.remove(), 1500);
    setTimeout(() => { c.classList.remove("leveling"); refreshButton(k, c); }, 900);
    refreshButton(k, c);
  }
}

const roleFam = (k: UnitKind) => ROLE_FAMILY[UNITS[k].role];

/** The title screen's Barracks label, with a badge counting troops that can level up now. */
export function barracksLabel(): Node {
  const ready = UNIT_KINDS.filter((k) => troopState(k).why === null).length;
  return el("span", { class: "pg-menu" }, ["Barracks", ...(ready ? [el("i", { class: "pg-badge" }, [String(ready)])] : [])]);
}

// ---------------------------------------------------------------- result screens
/**
 * Adds the coins a result paid (and the troop level cap) to the result sheet on screen. Call right after the result
 * sheet is shown. `openBarracks` opens the Barracks from the line.
 */
export function attachReward(r: Reward, openBarracks?: () => void) {
  if (r.coins <= 0) return;
  const sheet = document.querySelector<HTMLElement>(".overlay .sheet > .results, .overlay .sheet > .boons");
  if (!sheet) return;
  const amount = el("b", {}, ["+0"]);
  const ready = UNIT_KINDS.filter((k) => troopState(k).why === null).length;
  const cap = currentCap();
  const levelLine = r.capTo
    ? el("span", { class: "pg-r-cap up" }, [icon("crown"), `Level cap raised to ${r.capTo}!`])
    : el("span", { class: "pg-r-cap" }, [`Troop level cap ${cap}`, ready ? ` · ${ready} ready to level up` : ""]);
  const row = el("div", { class: "pg-reward" }, [
    el("div", { class: "pg-r-top" }, [el("i", { class: "pg-coin big" }), amount, el("small", {}, ["coins"])]),
    el("div", { class: "pg-r-parts" }, r.parts.map(([t, n]) => el("span", {}, [t, el("b", {}, [` +${n}`])]))),
    levelLine,
  ]);
  if (openBarracks && (ready || r.capTo)) {
    const go = el("button", { class: "btn small gold pg-r-go" }, ["Barracks"]);
    go.addEventListener("click", () => { unlockAudio(); sfx("tap"); document.querySelector(".overlay")?.remove(); openBarracks(); });
    row.append(go);
  }
  const before = sheet.querySelector(":scope > .btn, :scope > .boon-list");
  sheet.insertBefore(row, before);
  setTimeout(() => { tick(amount, 0, r.coins, 700, 0, "+"); setTimeout(() => sfx("buy"), 700); }, 450);
}
